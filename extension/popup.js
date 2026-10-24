/**
 * Universal Translator - Popup Script
 * Automatically detects user-selected text, copied clipboard text,
 * or visible viewport content, translating ONLY the target text into English.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // UI Elements
  const backendBadge = document.getElementById("backend-status-badge");
  const backendStatusText = document.getElementById("backend-status-text");
  const pageLangDisplay = document.getElementById("page-lang-display");
  const modeBadge = document.getElementById("mode-badge");
  const statusBox = document.getElementById("status-live-region");
  const englishBoxHeading = document.getElementById("english-box-heading");
  const englishContentBody = document.getElementById("english-content-body");

  const btnPasteTranslate = document.getElementById("btn-paste-translate");
  const pasteBtnText = document.getElementById("paste-btn-text");
  const btnCopyEnglish = document.getElementById("btn-copy-english");
  const copyBtnText = document.getElementById("copy-btn-text");

  const customTextInput = document.getElementById("custom-text-input");
  const btnTranslateCustom = document.getElementById("btn-translate-custom");

  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-text");

  const btnTranslate = document.getElementById("btn-translate");
  const btnTranslateText = document.getElementById("btn-translate-text");
  const btnRestore = document.getElementById("btn-restore");

  const toggleAuto = document.getElementById("toggle-auto");
  const toggleOriginal = document.getElementById("toggle-original");
  const selectDisplayMode = document.getElementById("select-display-mode");
  const inputBackendUrl = document.getElementById("input-backend-url");
  const settingsForm = document.getElementById("settings-form");

  let activeTabId = null;
  let isTranslating = false;
  let latestEnglishText = "";

  function setStatus(message, type = "normal") {
    statusBox.textContent = message;
    statusBox.className = "status-box";
    if (type === "error") statusBox.classList.add("error");
    else if (type === "success") statusBox.classList.add("success");
  }

  function displayEnglishContent(blocks, isAlreadyEnglish = false) {
    if (!blocks || blocks.length === 0) {
      englishContentBody.innerHTML = `<p style="color:#64748b; font-style:italic;">No readable text found on this screen.</p>`;
      latestEnglishText = "";
      return;
    }

    latestEnglishText = blocks.join("\n\n");
    let html = "";
    if (isAlreadyEnglish) {
      html += `<div style="margin-bottom:6px; color:#16a34a; font-weight:600; font-size:11px;">✓ This text is already in English:</div>`;
    }

    for (const b of blocks) {
      const escaped = b.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html += `<p>${escaped}</p>`;
    }
    englishContentBody.innerHTML = html;
  }

  // Copy translated text button
  btnCopyEnglish.addEventListener("click", async () => {
    if (!latestEnglishText) return;
    try {
      await navigator.clipboard.writeText(latestEnglishText);
      copyBtnText.textContent = "Copied!";
      setTimeout(() => {
        copyBtnText.textContent = "Copy";
      }, 2000);
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  });

  // Paste from clipboard & translate button
  btnPasteTranslate.addEventListener("click", async () => {
    try {
      pasteBtnText.textContent = "Pasting...";
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setStatus("Clipboard is empty. Copy some foreign text first (Ctrl+C).", "error");
        pasteBtnText.textContent = "📋 Paste & Translate";
        return;
      }

      const cleanText = text.trim();
      modeBadge.textContent = "📋 Copied Text";
      modeBadge.classList.add("selection-mode");
      if (englishBoxHeading) englishBoxHeading.textContent = "Copied Text Translation";
      setStatus("Translating clipboard text...", "normal");

      const detResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "detectLanguage", text: cleanText.substring(0, 400) }, resolve);
      });
      const lang = (detResp && detResp.language) ? detResp.language : "auto";
      pageLangDisplay.textContent = lang.toUpperCase();

      const lines = cleanText.split("\n").map(l => l.trim()).filter(Boolean);
      const transResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "translateBatch", texts: lines, target: "en", source: lang },
          resolve
        );
      });

      const translated = (transResp && Array.isArray(transResp.translations)) ? transResp.translations : lines;
      displayEnglishContent(translated, false);
      setStatus(`Clipboard text translated (${translated.length} lines)`, "success");
      pasteBtnText.textContent = "✓ Translated";
      setTimeout(() => {
        pasteBtnText.textContent = "📋 Paste & Translate";
      }, 2000);
    } catch (e) {
      console.warn("Clipboard paste error:", e);
      setStatus("Could not read clipboard. Please paste into the box below.", "error");
      pasteBtnText.textContent = "📋 Paste & Translate";
    }
  });

  // Custom text input translate button
  if (btnTranslateCustom && customTextInput) {
    btnTranslateCustom.addEventListener("click", async () => {
      const text = customTextInput.value.trim();
      if (!text) {
        setStatus("Please enter or paste foreign text into the box.", "error");
        return;
      }

      modeBadge.textContent = "✏️ Custom Text";
      modeBadge.classList.add("selection-mode");
      if (englishBoxHeading) englishBoxHeading.textContent = "Custom Text Translation";
      setStatus("Translating text...", "normal");

      const detResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "detectLanguage", text: text.substring(0, 400) }, resolve);
      });
      const lang = (detResp && detResp.language) ? detResp.language : "auto";
      pageLangDisplay.textContent = lang.toUpperCase();

      const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
      const transResp = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: "translateBatch", texts: lines, target: "en", source: lang },
          resolve
        );
      });

      const translated = (transResp && Array.isArray(transResp.translations)) ? transResp.translations : lines;
      displayEnglishContent(translated, false);
      setStatus("Custom text translated into English", "success");
    });
  }

  // Inject content script into active tab if it's not already running
  async function ensureContentScriptInjected(tabId) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(tabId, { action: "ping" }, async (res) => {
        if (chrome.runtime.lastError || !res) {
          try {
            await chrome.scripting.insertCSS({
              target: { tabId: tabId },
              files: ["content.css"]
            });
            await chrome.scripting.executeScript({
              target: { tabId: tabId },
              files: ["content.js"]
            });
            setTimeout(resolve, 200);
          } catch (err) {
            console.warn("Script injection fallback error:", err);
            resolve();
          }
        } else {
          resolve();
        }
      });
    });
  }

  // Automatically read and translate screen or user selection
  async function triggerAutoScreenTranslation() {
    if (!activeTabId) return;

    isTranslating = true;
    btnTranslate.disabled = true;
    btnTranslateText.textContent = "Translating...";
    setStatus("Analyzing screen / selected text...", "normal");

    await ensureContentScriptInjected(activeTabId);

    chrome.tabs.sendMessage(activeTabId, { action: "autoReadAndTranslateScreen" }, (response) => {
      isTranslating = false;
      btnTranslate.disabled = false;
      btnTranslateText.textContent = "Re-scan Screen";

      if (chrome.runtime.lastError || !response) {
        setStatus("Could not read tab. Refresh the webpage if needed.", "error");
        englishContentBody.innerHTML = `<p style="color:#dc2626;">Could not access page text. Please refresh the webpage once, then click <strong>Re-scan Screen</strong>.</p>`;
        return;
      }

      // Display detected language
      if (response.pageLanguage) {
        pageLangDisplay.textContent = response.pageLanguage.toUpperCase();
      }

      // Priority 1: User Selected Text
      if (response.isSelection) {
        modeBadge.textContent = "🎯 Selected Text";
        modeBadge.classList.add("selection-mode");
        if (englishBoxHeading) englishBoxHeading.textContent = "Selected Text Translation";
        setStatus(`Translated selected text (${response.count || 1} lines)`, "success");
        displayEnglishContent(response.englishBlocks, false);
        return;
      }

      // Priority 2: Active Email Body Detected (Webmail / CRM Inbox)
      if (response.isEmailBody) {
        modeBadge.textContent = "📧 Email Body";
        modeBadge.classList.add("selection-mode");
        if (englishBoxHeading) englishBoxHeading.textContent = "Email Body Translation";
        setStatus(`Email body translated into English (${response.count || 1} lines)`, "success");
        displayEnglishContent(response.englishBlocks, false);
        return;
      }

      // Priority 2: General Viewport Page Text
      modeBadge.textContent = "Instant English";
      modeBadge.classList.remove("selection-mode");
      if (englishBoxHeading) englishBoxHeading.textContent = "Translated English Content";

      if (response.isEnglish) {
        pageLangDisplay.textContent = "EN (English)";
        setStatus("Already English", "normal");
        displayEnglishContent(response.englishBlocks, true);
      } else {
        setStatus(`Translation complete (${response.count || response.englishBlocks?.length || 0} items)`, "success");
        displayEnglishContent(response.englishBlocks, false);
      }
    });
  }

  // Load settings
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, (res) => {
        if (res && res.settings) {
          const s = res.settings;
          toggleAuto.checked = s.autoTranslate !== false;
          toggleOriginal.checked = s.showOriginal !== false;
          if (s.displayMode) selectDisplayMode.value = s.displayMode;
          if (s.backendUrl) inputBackendUrl.value = s.backendUrl;
        }
        resolve(res?.settings);
      });
    });
  }

  // Save settings
  async function saveSettings(silent = false) {
    const newSettings = {
      autoTranslate: toggleAuto.checked,
      showOriginal: toggleOriginal.checked,
      displayMode: selectDisplayMode.value,
      backendUrl: inputBackendUrl.value.trim()
    };

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "saveSettings", settings: newSettings }, (res) => {
        if (res && res.success) {
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, { action: "updateSettings", settings: newSettings }).catch(() => {});
          }
          if (!silent) {
            setStatus("Settings saved successfully.", "success");
            setTimeout(() => setStatus("Ready"), 2000);
          }
          resolve(true);
        } else {
          resolve(false);
        }
      });
    });
  }

  // Query tab and start auto-translation immediately
  async function initTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      activeTabId = tab.id;

      if (
        !tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.includes("chromewebstore.google.com")
      ) {
        pageLangDisplay.textContent = "N/A";
        setStatus("This page cannot be accessed by the extension", "error");
        englishContentBody.innerHTML = `<p style="color:#64748b; font-style:italic;">Protected browser pages cannot be translated.</p>`;
        btnTranslate.disabled = true;
        btnRestore.disabled = true;
        return;
      }

      await ensureContentScriptInjected(activeTabId);
      triggerAutoScreenTranslation();
    } catch (e) {
      console.warn("Init tab error:", e);
    }
  }

  // Translation progress listener
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "translationProgress") {
      progressContainer.classList.remove("hidden");
      const pct = Math.round((message.current / (message.total || 1)) * 100);
      progressBarFill.style.width = `${pct}%`;
      progressText.textContent = `Translating: ${message.current} / ${message.total}`;
    }

    if (message.action === "translationFinished") {
      progressContainer.classList.add("hidden");
      setStatus(`Screen translated (${message.count} items)`, "success");
    }

    if (message.action === "restored") {
      progressContainer.classList.add("hidden");
      setStatus("Original page restored", "normal");
      englishContentBody.innerHTML = `<p style="color:#64748b; font-style:italic;">Original text restored. Click "Re-scan Screen" to translate again.</p>`;
    }
  });

  // Re-scan button click
  btnTranslate.addEventListener("click", () => {
    triggerAutoScreenTranslation();
  });

  // Restore button click
  btnRestore.addEventListener("click", () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: "restorePage" }, () => {
      setStatus("Original page restored", "normal");
    });
  });

  // Settings form handlers
  settingsForm.addEventListener("submit", (e) => {
    e.preventDefault();
    saveSettings(false);
  });
  toggleAuto.addEventListener("change", () => saveSettings(true));
  toggleOriginal.addEventListener("change", () => saveSettings(true));
  selectDisplayMode.addEventListener("change", () => saveSettings(true));

  // Initialize
  await loadSettings();
  await initTab();
});
