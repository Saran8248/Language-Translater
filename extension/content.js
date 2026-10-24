/**
 * Universal Translator - Content Script
 * Handles text extraction, safe rendering, restoration, dynamic DOM mutations,
 * and language detection.
 */

(function () {
  // Prevent duplicate script execution in the same context
  if (window.__universalTranslatorLoaded) return;
  window.__universalTranslatorLoaded = true;

  // State management
  let currentSettings = {
    autoTranslate: true,
    showOriginal: true,
    targetLanguage: "en",
    backendUrl: "http://127.0.0.1:8000",
    displayMode: "inline-badge"
  };

  let pageStatus = "ready"; // "ready" | "translating" | "translated" | "already_english" | "restored" | "error"
  let pageLanguage = "auto";
  let isEnglishPage = false;
  let translationSessionId = 0;
  let isMutatingOwnDom = false;

  // Track modified nodes: Map<TextNode, { originalText, badgeElement, mode }>
  const translatedNodesRegistry = new Map();
  // WeakSet to avoid processing already seen text nodes
  const processedNodes = new WeakSet();

  // Elements to strictly exclude from translation
  const EXCLUDED_TAGS = new Set([
    "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
    "CODE", "PRE", "KBD", "SAMP", "SVG", "CANVAS", "AUDIO", "VIDEO",
    "IFRAME", "EMBED", "OBJECT", "MATH"
  ]);

  /**
   * Safe check if a node or its ancestors should be ignored
   */
  function isNodeEligible(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return false;

    // Check if empty or whitespace only
    const text = node.textContent;
    if (!text || !text.trim()) return false;

    // Ignore pure numbers, punctuation, or single symbols
    const trimmed = text.trim();
    if (/^[\d\s.,\/#!$%\^&\*;:{}=\-_`~()@+?><\[\]'"]+$/.test(trimmed)) return false;

    // Ignore URLs or email addresses
    if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return false;
    }

    // Check parent element
    const parent = node.parentElement;
    if (!parent) return false;

    // Check excluded tags on parent and ancestors
    let ancestor = parent;
    while (ancestor) {
      if (EXCLUDED_TAGS.has(ancestor.tagName)) return false;
      if (ancestor.isContentEditable) return false;
      if (ancestor.classList && (
        ancestor.classList.contains("ut-translation-badge") ||
        ancestor.classList.contains("ut-translation-subtitle") ||
        ancestor.classList.contains("ut-ignore")
      )) {
        return false;
      }
      if (ancestor.hasAttribute && ancestor.hasAttribute("data-ut-translation")) return false;
      ancestor = ancestor.parentElement;
    }

    return true;
  }

  /**
   * Determine page language from document attributes and meta tags
   */
  async function detectPageLanguage() {
    let lang = "";

    // 1. Check html lang or body lang
    if (document.documentElement && document.documentElement.lang) {
      lang = document.documentElement.lang.trim().toLowerCase();
    } else if (document.body && document.body.lang) {
      lang = document.body.lang.trim().toLowerCase();
    }

    // 2. Check meta content-language
    if (!lang) {
      const meta = document.querySelector('meta[http-equiv="content-language"], meta[name="language"]');
      if (meta && meta.content) {
        lang = meta.content.trim().toLowerCase();
      }
    }

    // Check if explicitly English
    if (lang && (lang === "en" || lang.startsWith("en-") || lang.startsWith("eng"))) {
      isEnglishPage = true;
      pageLanguage = lang;
      return lang;
    }

    if (lang) {
      pageLanguage = lang;
      return lang;
    }

    // 3. Fallback: sample page text and ask backend
    const sampleNodes = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => isNodeEligible(n) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
    });

    let sampledChars = 0;
    while (walker.nextNode() && sampledChars < 300) {
      const val = walker.currentNode.textContent.trim();
      if (val.length > 5) {
        sampleNodes.push(val);
        sampledChars += val.length;
      }
    }

    if (sampleNodes.length > 0) {
      const sampleText = sampleNodes.join(" ");
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "detectLanguage", text: sampleText.substring(0, 300), backendUrl: currentSettings.backendUrl },
            resolve
          );
        });
        if (response && response.success && response.language) {
          pageLanguage = response.language;
          isEnglishPage = Boolean(response.is_english);
          return pageLanguage;
        }
      } catch (e) {
        // Fallback to auto
      }
    }

    pageLanguage = "auto";
    return pageLanguage;
  }

  /**
   * Collect all eligible text nodes in the specified root element
   */
  function collectEligibleTextNodes(root = document.body) {
    const nodes = [];
    if (!root) return nodes;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
        return isNodeEligible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  /**
   * Safely render translated text into the DOM according to current display mode
   * NEVER evaluates HTML; uses safe text assignment only.
   */
  function applyTranslationToNode(node, originalText, translatedText) {
    if (!node || !node.parentNode) return;

    isMutatingOwnDom = true;
    try {
      const mode = currentSettings.displayMode || "inline-badge";
      const showOriginal = currentSettings.showOriginal !== false;

      if (showOriginal && mode === "ruby-subtitle") {
        // Subtitle view: insert a block beneath
        const subtitle = document.createElement("div");
        subtitle.className = "ut-translation-subtitle";
        subtitle.setAttribute("data-ut-translation", "true");
        subtitle.textContent = translatedText; // Safe text rendering

        // Insert after parent block or after node
        if (node.nextSibling) {
          node.parentNode.insertBefore(subtitle, node.nextSibling);
        } else {
          node.parentNode.appendChild(subtitle);
        }
        translatedNodesRegistry.set(node, { originalText, element: subtitle, mode });

      } else if (showOriginal && mode === "inline-badge") {
        // Default mode: display original text + inline English badge alongside
        const badge = document.createElement("span");
        badge.className = "ut-translation-badge";
        badge.setAttribute("data-ut-translation", "true");
        badge.setAttribute("title", "English Translation");
        badge.textContent = ` [EN: ${translatedText}] `; // Safe text rendering

        if (node.nextSibling) {
          node.parentNode.insertBefore(badge, node.nextSibling);
        } else {
          node.parentNode.appendChild(badge);
        }
        translatedNodesRegistry.set(node, { originalText, element: badge, mode });

      } else {
        // Replace mode with tooltip: replace text content and save original in hover title
        const parent = node.parentElement;
        if (parent) {
          parent.classList.add("ut-translated-hover-target");
          parent.setAttribute("title", `Original: ${originalText}`);
        }
        node.textContent = translatedText;
        translatedNodesRegistry.set(node, { originalText, element: null, mode: "replace" });
      }

      processedNodes.add(node);
    } finally {
      isMutatingOwnDom = false;
    }
  }

  /**
   * Translate a list of text nodes in progressive batches
   */
  async function translateNodes(nodes) {
    if (!nodes || nodes.length === 0) return;

    const sessionId = ++translationSessionId;
    pageStatus = "translating";

    // Batch configuration: 25 items or max 2500 chars per batch
    const BATCH_SIZE = 25;
    const batches = [];
    let currentBatch = [];
    let currentBatchChars = 0;

    for (const node of nodes) {
      const text = node.textContent.trim();
      if (!text) continue;

      if (currentBatch.length >= BATCH_SIZE || currentBatchChars + text.length > 2500) {
        batches.push(currentBatch);
        currentBatch = [];
        currentBatchChars = 0;
      }
      currentBatch.push({ node, text });
      currentBatchChars += text.length;
    }
    if (currentBatch.length > 0) batches.push(currentBatch);

    const totalNodesCount = nodes.length;
    let completedNodesCount = 0;

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      // If user restored or cancelled during batch processing, abort
      if (translationSessionId !== sessionId) {
        console.log("[Universal Translator] Session aborted or restored.");
        return;
      }

      const batch = batches[bIndex];
      const textsToTranslate = batch.map(item => item.text);

      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "translateBatch",
              texts: textsToTranslate,
              target: currentSettings.targetLanguage || "en",
              source: pageLanguage || "auto",
              backendUrl: currentSettings.backendUrl
            },
            resolve
          );
        });

        if (translationSessionId !== sessionId) return;

        if (response && response.success && Array.isArray(response.translations)) {
          for (let i = 0; i < batch.length; i++) {
            const translated = response.translations[i];
            if (translated && translated !== batch[i].text) {
              applyTranslationToNode(batch[i].node, batch[i].text, translated);
            }
          }
          completedNodesCount += batch.length;

          // Broadcast progress
          chrome.runtime.sendMessage({
            action: "translationProgress",
            current: completedNodesCount,
            total: totalNodesCount
          }).catch(() => {});
        } else {
          console.warn("[Universal Translator] Batch failed:", response?.error);
        }
      } catch (err) {
        console.error("[Universal Translator] Translation batch error:", err);
      }
    }

    if (translationSessionId === sessionId) {
      pageStatus = "translated";
      chrome.runtime.sendMessage({
        action: "translationFinished",
        count: completedNodesCount
      }).catch(() => {});
    }
  }

  /**
   * Main Translate Page trigger
   */
  async function translatePage() {
    const nodes = collectEligibleTextNodes(document.body);
    if (nodes.length === 0) {
      pageStatus = "translated";
      return;
    }
    await translateNodes(nodes);
  }

  /**
   * Restore original page content
   * Removes all extension-created DOM elements and reverts replaced text.
   */
  function restoreOriginalPage() {
    // Invalidate any pending translation callbacks
    translationSessionId++;
    isMutatingOwnDom = true;

    try {
      translatedNodesRegistry.forEach((data, node) => {
        // If an extra badge or subtitle element was created, remove it
        if (data.element && data.element.parentNode) {
          data.element.parentNode.removeChild(data.element);
        }

        // If node text was replaced, restore original text
        if (data.mode === "replace" && node && node.parentNode) {
          node.textContent = data.originalText;
          if (node.parentElement) {
            node.parentElement.classList.remove("ut-translated-hover-target");
            node.parentElement.removeAttribute("title");
          }
        }
      });

      // Clear registries
      translatedNodesRegistry.clear();
      pageStatus = "restored";

      chrome.runtime.sendMessage({ action: "restored" }).catch(() => {});
    } finally {
      isMutatingOwnDom = false;
    }
  }

  /**
   * MutationObserver for dynamic page content with debounce throttling
   */
  let mutationTimeout = null;
  const pendingAddedNodes = new Set();

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // Disregard mutations triggered by the extension itself
      if (isMutatingOwnDom) return;
      if (pageStatus !== "translated" && !currentSettings.autoTranslate) return;

      let hasNewElements = false;
      for (const mut of mutations) {
        if (mut.type === "childList" && mut.addedNodes.length > 0) {
          for (const added of mut.addedNodes) {
            // Ignore if added node is extension's own UI
            if (added.nodeType === Node.ELEMENT_NODE) {
              if (added.classList && (
                added.classList.contains("ut-translation-badge") ||
                added.classList.contains("ut-translation-subtitle")
              )) {
                continue;
              }
              pendingAddedNodes.add(added);
              hasNewElements = true;
            } else if (added.nodeType === Node.TEXT_NODE && isNodeEligible(added)) {
              pendingAddedNodes.add(added);
              hasNewElements = true;
            }
          }
        }
      }

      if (hasNewElements) {
        if (mutationTimeout) clearTimeout(mutationTimeout);
        mutationTimeout = setTimeout(() => {
          processDynamicNodes();
        }, 350); // 350ms throttle
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function processDynamicNodes() {
    if (pendingAddedNodes.size === 0) return;
    const targets = Array.from(pendingAddedNodes);
    pendingAddedNodes.clear();

    const nodesToTranslate = [];
    for (const target of targets) {
      if (target.nodeType === Node.TEXT_NODE) {
        if (isNodeEligible(target) && !processedNodes.has(target)) {
          nodesToTranslate.push(target);
        }
      } else if (target.nodeType === Node.ELEMENT_NODE) {
        const found = collectEligibleTextNodes(target);
        nodesToTranslate.push(...found);
      }
    }

    if (nodesToTranslate.length > 0 && pageStatus === "translated") {
      translateNodes(nodesToTranslate);
    }
  }

  /**
   * Listen for commands from Popup or Background worker
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "translatePage") {
      translatePage().then(() => sendResponse({ success: true, status: pageStatus }));
      return true;
    }

    if (message.action === "restorePage") {
      restoreOriginalPage();
      sendResponse({ success: true, status: pageStatus });
      return true;
    }

    if (message.action === "getPageStatus") {
      sendResponse({
        status: pageStatus,
        language: pageLanguage,
        isEnglish: isEnglishPage,
        translatedCount: translatedNodesRegistry.size,
        settings: currentSettings
      });
      return true;
    }

    if (message.action === "updateSettings") {
      currentSettings = { ...currentSettings, ...message.settings };
      sendResponse({ success: true });
      return true;
    }
  });

  /**
   * Initialization routine
   */
  async function init() {
    try {
      // 1. Fetch user settings
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
      });
      if (resp && resp.settings) {
        currentSettings = { ...currentSettings, ...resp.settings };
      }

      // 2. Detect page language
      await detectPageLanguage();

      // 3. Setup dynamic content observer
      setupMutationObserver();

      // 4. Auto-translation logic
      if (currentSettings.autoTranslate) {
        if (isEnglishPage) {
          pageStatus = "already_english";
          console.log("[Universal Translator] Page language is English. Skipping auto-translation.");
        } else {
          console.log(`[Universal Translator] Auto-translating foreign page (detected: ${pageLanguage})...`);
          // Slight delay to allow initial DOM rendering to settle
          setTimeout(() => {
            translatePage();
          }, 300);
        }
      }
    } catch (err) {
      console.warn("[Universal Translator] Init warning:", err);
    }
  }

  // Run when DOM is ready
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
