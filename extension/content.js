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

  // Track user-selected / highlighted text across the webpage
  let lastCapturedSelection = "";

  function updateCapturedSelection() {
    try {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const str = sel.toString().trim();
        if (str.length > 2) {
          lastCapturedSelection = str;
        }
      }
    } catch (e) {}
  }

  document.addEventListener("selectionchange", updateCapturedSelection, { passive: true });
  document.addEventListener("mouseup", updateCapturedSelection, { passive: true });
  document.addEventListener("keyup", updateCapturedSelection, { passive: true });
  document.addEventListener("copy", () => {
    updateCapturedSelection();
  }, { passive: true });

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
   * Helper to identify navigation, sidebars, headers, and past history menus
   */
  function isNavigationOrSidebar(ancestor) {
    if (!ancestor) return false;
    const tag = ancestor.tagName ? ancestor.tagName.toUpperCase() : "";
    if (tag === "NAV" || tag === "ASIDE" || tag === "HEADER" || tag === "FOOTER") return true;

    const role = ancestor.getAttribute ? ancestor.getAttribute("role") : "";
    if (role === "navigation" || role === "banner" || role === "complementary") return true;

    const aria = ancestor.getAttribute && ancestor.getAttribute("aria-label") ? ancestor.getAttribute("aria-label").toLowerCase() : "";
    if (aria.includes("sidebar") || aria.includes("history") || aria.includes("navigation") || aria.includes("chat history")) return true;

    const id = ancestor.id ? ancestor.id.toLowerCase() : "";
    if (id.includes("sidebar") || id.includes("history")) return true;

    const cls = ancestor.className && typeof ancestor.className === "string" ? ancestor.className.toLowerCase() : "";
    if (cls.includes("sidebar") || cls.includes("history") || cls.includes("nav-")) return true;

    return false;
  }

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
      if (isNavigationOrSidebar(ancestor)) return false; // Strictly exclude sidebars & chat history!
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
   * Determine page language from actual visible text content on screen
   * (Does not blindly trust <html lang> because sites like ChatGPT or Twitter use English UI shells for foreign text)
   */
  async function detectPageLanguage() {
    // 1. First sample actual readable text from the screen
    const sampleBlocks = extractReadableScreenSummary();
    const sampleText = sampleBlocks.slice(0, 5).join(" ");

    if (sampleText && sampleText.trim().length > 8) {
      try {
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "detectLanguage", text: sampleText.substring(0, 400) },
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

    // 2. Fallback to html lang if visible text is unavailable
    let lang = "";
    if (document.documentElement && document.documentElement.lang) {
      lang = document.documentElement.lang.trim().toLowerCase();
    } else if (document.body && document.body.lang) {
      lang = document.body.lang.trim().toLowerCase();
    }

    if (lang && (lang === "en" || lang.startsWith("en-"))) {
      isEnglishPage = true;
      pageLanguage = lang;
      return lang;
    }

    if (lang) {
      pageLanguage = lang;
      isEnglishPage = false;
      return lang;
    }

    pageLanguage = "auto";
    return pageLanguage;
  }

  /**
   * Collect all eligible text nodes in the specified root element (capped to maxLimit to avoid freezing on massive dashboards)
   */
  function collectEligibleTextNodes(root = document.body, maxLimit = 60) {
    const nodes = [];
    if (!root) return nodes;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        if (processedNodes.has(node)) return NodeFilter.FILTER_REJECT;
        return isNodeEligible(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
      }
    });

    while (walker.nextNode() && nodes.length < maxLimit) {
      nodes.push(walker.currentNode);
    }
    return nodes;
  }

  /**
   * Specifically identifies and isolates the active Email Body container box
   * (Matches the exact white email card shown in the user's webmail screenshot)
   */
  function findEmailBodyElement() {
    // Strategy A: Find the banner 'Shown as plain text...' / 'Show original' button and get its body container
    try {
      const allDivs = document.querySelectorAll("div, section, button, a");
      for (const el of allDivs) {
        const txt = (el.textContent || "").trim();
        if (txt === "Show original" || txt.includes("Shown as plain text")) {
          const banner = el.closest("div");
          if (banner) {
            // 1. Next sibling element right below the banner
            let sibling = banner.nextElementSibling;
            while (sibling) {
              const bodyText = (sibling.innerText || sibling.textContent || "").trim();
              if (bodyText.length > 20 && !bodyText.includes("Shown as plain text")) {
                return sibling;
              }
              sibling = sibling.nextElementSibling;
            }

            // 2. Parent's sibling if banner is wrapped in an inner header bar
            if (banner.parentElement) {
              for (const child of banner.parentElement.children) {
                if (child !== banner) {
                  const cText = (child.innerText || child.textContent || "").trim();
                  if (cText.length > 20 && !cText.includes("Shown as plain text")) {
                    return child;
                  }
                }
              }

              if (banner.parentElement.nextElementSibling) {
                const pSib = banner.parentElement.nextElementSibling;
                const pText = (pSib.innerText || pSib.textContent || "").trim();
                if (pText.length > 20 && !pText.includes("Shown as plain text")) {
                  return pSib;
                }
              }
            }
          }
        }
      }
    } catch (e) {}

    // Strategy B: Standard webmail message body selectors
    const emailSelectors = [
      "[data-message-body]",
      "[data-email-body]",
      ".email-body",
      ".message-body",
      ".mail-body",
      ".email-content",
      ".message-content",
      ".mail-content",
      "div[class*='email-body' i]",
      "div[class*='message-body' i]",
      "div[class*='mail-body' i]",
      "div[class*='reading-pane' i]",
      "div[class*='detail-pane' i]"
    ];

    for (const sel of emailSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el && !isNavigationOrSidebar(el)) {
          const t = (el.innerText || el.textContent || "").trim();
          if (t.length > 25) return el;
        }
      } catch (e) {}
    }

    // Strategy C: Container following email headers ('Date:', 'Automatic reply')
    try {
      const candidates = document.querySelectorAll("div, section, article");
      for (const c of candidates) {
        if (isNavigationOrSidebar(c)) continue;
        const raw = (c.innerText || c.textContent || "").trim();
        // Check if this container contains the email body text (e.g. 'Vielen Dank für Ihre Nachricht')
        if (raw.includes("Vielen Dank") || (raw.includes("Sekretariat") && raw.includes("Nachricht"))) {
          // If it has children, return the innermost container that still has the text
          let target = c;
          for (const child of c.querySelectorAll("div, section")) {
            const ct = (child.innerText || child.textContent || "").trim();
            if (ct.includes("Vielen Dank") && !ct.includes("Automatic reply") && !ct.includes("Shown as plain text")) {
              target = child;
              break;
            }
          }
          return target;
        }
      }
    } catch (e) {}

    // Strategy D: Container with highest density of multi-sentence text
    try {
      const candidates = document.querySelectorAll("div, section, article");
      let best = null;
      let maxScore = 0;

      for (const el of candidates) {
        if (isNavigationOrSidebar(el)) continue;
        const raw = (el.innerText || el.textContent || "").trim();
        if (raw.length < 40 || raw.includes("Folders") || raw.includes("Search this folder") || raw.includes("EMAIL STAGES")) continue;

        const lines = raw.split("\n").map(l => l.trim()).filter(l => l.length > 10);
        if (lines.length >= 2) {
          const score = lines.reduce((acc, l) => acc + l.length, 0);
          if (score > maxScore && el.querySelectorAll("div").length < 15) {
            maxScore = score;
            best = el;
          }
        }
      }
      if (best) return best;
    } catch (e) {}

    return null;
  }

  /**
   * Helper to check if an element is visible in the viewport window
   */
  function isElementInViewport(el) {
    if (!el || el.offsetParent === null) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const windowHeight = window.innerHeight || document.documentElement.clientHeight;
    const windowWidth = window.innerWidth || document.documentElement.clientWidth;
    return rect.top < windowHeight && rect.bottom > 0 && rect.left < windowWidth && rect.right > 0;
  }

  /**
   * Extract readable screen text paragraphs for popup reader view
   * Prioritizes active email bodies, strictly ignoring sidebars, history menus, and navigation.
   */
  function extractReadableScreenSummary() {
    // 1. HIGHEST PRIORITY: Check if active email message body exists
    const emailEl = findEmailBodyElement();
    if (emailEl) {
      const raw = emailEl.innerText || emailEl.textContent || "";
      const lines = raw
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 2 && !l.includes("Shown as plain text") && l !== "Show original");
      if (lines.length > 0) {
        return lines.slice(0, 35);
      }
    }

    // 2. Otherwise scan visible content in main viewport
    const blocks = [];
    const container = document.querySelector("main") || document.querySelector("[role='main']") || document.querySelector("article") || document.body;
    
    // Query meaningful content elements inside main container
    const candidates = container.querySelectorAll(
      "p, [data-message-author-role='assistant'], .markdown p, div.whitespace-pre-wrap, h1, h2, h3, h4, li, [role='article'] p"
    );

    for (const el of candidates) {
      if (EXCLUDED_TAGS.has(el.tagName) || el.isContentEditable) continue;
      if (isNavigationOrSidebar(el)) continue;

      const text = el.innerText || el.textContent;
      if (text && text.trim().length > 3) {
        const lines = text.split("\n").map(l => l.trim()).filter(l => l.length > 3);
        for (const line of lines) {
          if (!blocks.includes(line)) {
            blocks.push(line);
            if (blocks.length >= 35) break;
          }
        }
      }
      if (blocks.length >= 35) break;
    }

    // Fallback if main container query missed items
    if (blocks.length === 0) {
      const textNodes = collectEligibleTextNodes(container, 30);
      for (const n of textNodes) {
        const val = n.textContent.trim();
        if (val.length > 5 && !blocks.includes(val)) {
          blocks.push(val);
          if (blocks.length >= 25) break;
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
    // If an active email body container exists, prioritize translating it directly!
    const emailEl = findEmailBodyElement();
    const targetRoot = emailEl || document.querySelector("main") || document.body;
    const nodes = collectEligibleTextNodes(targetRoot, 50);
    if (nodes.length === 0) {
      pageStatus = "translated";
      return [];
    }
    return await translateNodes(nodes);
  }

  /**
   * Reads the screen or user-selected text and translates for instant popup display
   */
  async function autoReadAndTranslateScreen() {
    updateCapturedSelection();

    // 1. HIGHEST PRIORITY: Check if user has highlighted / selected text on the page!
    let selectedText = "";
    try {
      const liveSel = window.getSelection() ? window.getSelection().toString().trim() : "";
      selectedText = liveSel.length > 2 ? liveSel : lastCapturedSelection;
    } catch (e) {
      selectedText = lastCapturedSelection;
    }

    if (selectedText && selectedText.length > 2) {
      // User selected text (e.g. highlighted email in CRM)!
      // TRANSLATE ONLY THIS SELECTED CONTENT! DO NOT TRANSLATE 1000 CRM NODES!
      const lines = selectedText
        .split("\n")
        .map(l => l.trim())
        .filter(l => l.length > 1);

      // Detect language of selected text
      const detResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "detectLanguage", text: selectedText.substring(0, 500) },
          resolve
        );
      });

      const lang = (detResp && detResp.success && detResp.language) ? detResp.language : "auto";

      // Translate the selected lines
      const transResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "translateBatch",
            texts: lines,
            target: currentSettings.targetLanguage || "en",
            source: lang,
            backendUrl: currentSettings.backendUrl
          },
          resolve
        );
      });

      const translatedLines = (transResp && transResp.success && Array.isArray(transResp.translations))
        ? transResp.translations
        : lines;

      return {
        isSelection: true,
        selectedText: selectedText,
        pageLanguage: (detResp && detResp.language) ? detResp.language : (lang !== "auto" ? lang : "de"),
        englishBlocks: translatedLines,
        count: translatedLines.length
      };
    }

    // 2. No text selected: Extract key screen blocks from the main viewport
    const screenBlocks = extractReadableScreenSummary();
    if (screenBlocks.length === 0) {
      return {
        isEnglish: true,
        pageLanguage: "en",
        englishBlocks: []
      };
    }

    // 2. Check language of the extracted screen blocks
    const sampleText = screenBlocks.slice(0, 10).join(" ");
    const detResp = await new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { action: "detectLanguage", text: sampleText.substring(0, 500) },
        resolve
      );
    });

    const isForeign = detResp && detResp.success && !detResp.is_english;
    const detectedLang = (isForeign && detResp.language) ? detResp.language : (pageLanguage !== "auto" && pageLanguage !== "en" ? pageLanguage : (isForeign ? "de" : "en"));

    // If genuinely English (no foreign sentences on screen)
    if (!isForeign && detectedLang === "en") {
      isEnglishPage = true;
      return {
        isEnglish: true,
        pageLanguage: "en",
        englishBlocks: screenBlocks.slice(0, 20)
      };
    }

    // 3. Screen content is foreign (e.g. German)!
    isEnglishPage = false;
    pageLanguage = detectedLang;

    // Trigger in-page text translation simultaneously
    const pageTranslatePromise = translatePage();

    // Batch translate screen blocks for the popup
    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            action: "translateBatch",
            texts: screenBlocks.slice(0, 25),
            target: currentSettings.targetLanguage || "en",
            source: detectedLang,
            backendUrl: currentSettings.backendUrl
          },
          resolve
        );
      });

      await pageTranslatePromise;

      if (response && response.success && Array.isArray(response.translations)) {
        const isEmail = Boolean(findEmailBodyElement());
        return {
          isEmailBody: isEmail,
          isEnglish: false,
          pageLanguage: detectedLang,
          englishBlocks: response.translations,
          count: response.translations.length
        };
      }
    } catch (e) {
      console.warn("Screen summary translation error:", e);
    }

    const isEmailFallback = Boolean(findEmailBodyElement());
    return {
      isEmailBody: isEmailFallback,
      isEnglish: false,
      pageLanguage: detectedLang,
      englishBlocks: screenBlocks,
      count: screenBlocks.length
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
    if (message.action === "ping") {
      sendResponse({ status: "ready" });
      return true;
    }

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
