/**
 * Universal Translator - Content Script
 * Automatically reads screen text, safely renders translations into the DOM,
 * and supplies English content directly to the popup.
 */

(function () {
  if (window.__universalTranslatorLoaded) return;
  window.__universalTranslatorLoaded = true;

  // Settings & state
  let currentSettings = {
    autoTranslate: true,
    showOriginal: true,
    targetLanguage: "en",
    backendUrl: "http://127.0.0.1:8000",
    displayMode: "inline-badge"
  };

  let pageStatus = "ready"; // "ready" | "translating" | "translated" | "already_english" | "restored"
  let pageLanguage = "auto";
  let isEnglishPage = false;
  let translationSessionId = 0;
  let isMutatingOwnDom = false;

  // Track modified nodes: Map<TextNode, { originalText, element, mode }>
  const translatedNodesRegistry = new Map();
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

    const text = node.textContent;
    if (!text || !text.trim()) return false;

    const trimmed = text.trim();
    // Ignore pure numbers, punctuation, or single symbols
    if (/^[\d\s.,\/#!$%\^&\*;:{}=\-_`~()@+?><\[\]'"]+$/.test(trimmed)) return false;

    // Ignore URLs or email addresses
    if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      return false;
    }

    // Check parent element
    const parent = node.parentElement;
    if (!parent) return false;

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
   * Determine page language from attributes, meta tags, and text samples
   */
  async function detectPageLanguage() {
    let lang = "";

    if (document.documentElement && document.documentElement.lang) {
      lang = document.documentElement.lang.trim().toLowerCase();
    } else if (document.body && document.body.lang) {
      lang = document.body.lang.trim().toLowerCase();
    }

    if (!lang) {
      const meta = document.querySelector('meta[http-equiv="content-language"], meta[name="language"]');
      if (meta && meta.content) {
        lang = meta.content.trim().toLowerCase();
      }
    }

    if (lang && (lang === "en" || lang.startsWith("en-") || lang.startsWith("eng"))) {
      isEnglishPage = true;
      pageLanguage = lang;
      return lang;
    }

    if (lang) {
      pageLanguage = lang;
      return lang;
    }

    // Sample visible text to detect
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
            { action: "detectLanguage", text: sampleText.substring(0, 300) },
            resolve
          );
        });
        if (response && response.success && response.language) {
          pageLanguage = response.language;
          isEnglishPage = Boolean(response.is_english);
          return pageLanguage;
        }
      } catch (e) {
        // Fallback
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
   * Extract readable screen text paragraphs for popup reader view
   */
  function extractReadableScreenSummary() {
    const blocks = [];
    const elements = document.querySelectorAll("h1, h2, h3, h4, p, li, article, section, [role='article']");

    for (const el of elements) {
      if (EXCLUDED_TAGS.has(el.tagName) || el.isContentEditable) continue;
      const text = el.innerText || el.textContent;
      if (text && text.trim().length > 15) {
        const clean = text.trim();
        // Skip duplicate additions
        if (!blocks.some(b => b.includes(clean) || clean.includes(b))) {
          blocks.push(clean);
          if (blocks.length >= 25) break; // First 25 major readable blocks
        }
      }
    }

    // Fallback: If no structured blocks found, gather from text nodes
    if (blocks.length === 0) {
      const textNodes = collectEligibleTextNodes(document.body);
      for (const n of textNodes) {
        const val = n.textContent.trim();
        if (val.length > 20) {
          blocks.push(val);
          if (blocks.length >= 20) break;
        }
      }
    }

    return blocks;
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
        const subtitle = document.createElement("div");
        subtitle.className = "ut-translation-subtitle";
        subtitle.setAttribute("data-ut-translation", "true");
        subtitle.textContent = translatedText;

        if (node.nextSibling) {
          node.parentNode.insertBefore(subtitle, node.nextSibling);
        } else {
          node.parentNode.appendChild(subtitle);
        }
        translatedNodesRegistry.set(node, { originalText, element: subtitle, mode });

      } else if (showOriginal && mode === "inline-badge") {
        const badge = document.createElement("span");
        badge.className = "ut-translation-badge";
        badge.setAttribute("data-ut-translation", "true");
        badge.setAttribute("title", "English Translation");
        badge.textContent = ` [EN: ${translatedText}] `;

        if (node.nextSibling) {
          node.parentNode.insertBefore(badge, node.nextSibling);
        } else {
          node.parentNode.appendChild(badge);
        }
        translatedNodesRegistry.set(node, { originalText, element: badge, mode });

      } else {
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
    if (!nodes || nodes.length === 0) return [];

    const sessionId = ++translationSessionId;
    pageStatus = "translating";

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
    const translatedStrings = [];

    for (let bIndex = 0; bIndex < batches.length; bIndex++) {
      if (translationSessionId !== sessionId) return translatedStrings;

      const batch = batches[bIndex];
      const textsToTranslate = batch.map((item) => item.text);

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

        if (translationSessionId !== sessionId) return translatedStrings;

        if (response && response.success && Array.isArray(response.translations)) {
          for (let i = 0; i < batch.length; i++) {
            const translated = response.translations[i];
            if (translated && translated !== batch[i].text) {
              applyTranslationToNode(batch[i].node, batch[i].text, translated);
              translatedStrings.push(translated);
            }
          }
          completedNodesCount += batch.length;

          chrome.runtime.sendMessage({
            action: "translationProgress",
            current: completedNodesCount,
            total: totalNodesCount
          }).catch(() => {});
        }
      } catch (err) {
        console.error("[Universal Translator] Batch translation error:", err);
      }
    }

    if (translationSessionId === sessionId) {
      pageStatus = "translated";
      chrome.runtime.sendMessage({
        action: "translationFinished",
        count: completedNodesCount
      }).catch(() => {});
    }

    return translatedStrings;
  }

  /**
   * Main Translate Page trigger
   */
  async function translatePage() {
    const nodes = collectEligibleTextNodes(document.body);
    if (nodes.length === 0) {
      pageStatus = "translated";
      return [];
    }
    return await translateNodes(nodes);
  }

  /**
   * Reads the screen and translates summary for instant popup display
   */
  async function autoReadAndTranslateScreen() {
    // 1. First trigger in-page translation
    const pageTranslatePromise = translatePage();

    // 2. Extract key screen blocks
    const screenBlocks = extractReadableScreenSummary();

    if (isEnglishPage) {
      return {
        isEnglish: true,
        pageLanguage: "en",
        englishBlocks: screenBlocks.slice(0, 15)
      };
    }

    // 3. Batch translate screen blocks for the popup
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "translateBatch",
            texts: screenBlocks.slice(0, 15),
            target: currentSettings.targetLanguage || "en",
            source: pageLanguage || "auto",
            backendUrl: currentSettings.backendUrl
          },
          resolve
        );
      });

      await pageTranslatePromise;

      if (response && response.success && Array.isArray(response.translations)) {
        return {
          isEnglish: false,
          pageLanguage: response.detected_language || pageLanguage,
          englishBlocks: response.translations,
          count: translatedNodesRegistry.size
        };
      }
    } catch (e) {
      console.warn("Screen summary translation error:", e);
    }

    return {
      isEnglish: false,
      pageLanguage: pageLanguage,
      englishBlocks: screenBlocks,
      count: translatedNodesRegistry.size
    };
  }

  /**
   * Restore original page content
   */
  function restoreOriginalPage() {
    translationSessionId++;
    isMutatingOwnDom = true;

    try {
      translatedNodesRegistry.forEach((data, node) => {
        if (data.element && data.element.parentNode) {
          data.element.parentNode.removeChild(data.element);
        }
        if (data.mode === "replace" && node && node.parentNode) {
          node.textContent = data.originalText;
          if (node.parentElement) {
            node.parentElement.classList.remove("ut-translated-hover-target");
            node.parentElement.removeAttribute("title");
          }
        }
      });

      translatedNodesRegistry.clear();
      pageStatus = "restored";
      chrome.runtime.sendMessage({ action: "restored" }).catch(() => {});
    } finally {
      isMutatingOwnDom = false;
    }
  }

  /**
   * MutationObserver for dynamic page content
   */
  let mutationTimeout = null;
  const pendingAddedNodes = new Set();

  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      if (isMutatingOwnDom) return;
      if (pageStatus !== "translated" && !currentSettings.autoTranslate) return;

      let hasNewElements = false;
      for (const mut of mutations) {
        if (mut.type === "childList" && mut.addedNodes.length > 0) {
          for (const added of mut.addedNodes) {
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
        }, 350);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
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

  // Runtime message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "autoReadAndTranslateScreen") {
      autoReadAndTranslateScreen().then((data) => sendResponse(data));
      return true;
    }

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

  // Initialization routine
  async function init() {
    try {
      const resp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
      });
      if (resp && resp.settings) {
        currentSettings = { ...currentSettings, ...resp.settings };
      }

      await detectPageLanguage();
      setupMutationObserver();

      // Automatically translate foreign pages on page load
      if (currentSettings.autoTranslate) {
        if (isEnglishPage) {
          pageStatus = "already_english";
        } else {
          setTimeout(() => {
            translatePage();
          }, 350);
        }
      }
    } catch (err) {
      console.warn("[Universal Translator] Init warning:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
