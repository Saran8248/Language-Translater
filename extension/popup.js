/**
 * Universal Translator - Popup Script
 * Automatically reads the screen on open, translates into English,
 * and displays English content immediately without manual connection steps.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // UI Elements
  const backendBadge = document.getElementById("backend-status-badge");
  const backendStatusText = document.getElementById("backend-status-text");
  const pageLangDisplay = document.getElementById("page-lang-display");
  const statusBox = document.getElementById("status-live-region");
  const englishContentBody = document.getElementById("english-content-body");
  const btnCopyEnglish = document.getElementById("btn-copy-english");
  const copyBtnText = document.getElementById("copy-btn-text");

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
      html += `<div style="margin-bottom:6px; color:#16a34a; font-weight:600; font-size:11px;">✓ This page is already in English:</div>`;
    }

    for (const b of blocks) {
      const escaped = b.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      html += `<p>${escaped}</p>`;
    }
    englishContentBody.innerHTML = html;
  }

  // Copy button handler
  btnCopyEnglish.addEventListener("click", async () => {
    if (!latestEnglishText) return;
    try {
      await navigator.clipboard.writeText(latestEnglishText);
      copyBtnText.textContent = "Copied!";
      setTimeout(() => {
        copyBtnText.textContent = "Copy Text";
      }, 2000);
    } catch (e) {
      console.warn("Clipboard copy failed:", e);
    }
  });

  // Automatically read and translate screen
  async function triggerAutoScreenTranslation() {
    if (!activeTabId) return;

    isTranslating = true;
    btnTranslate.disabled = true;
    btnTranslateText.textContent = "Translating...";
    setStatus("Reading screen and auto-translating into English...", "normal");

    chrome.tabs.sendMessage(activeTabId, { action: "autoReadAndTranslateScreen" }, (response) => {
      isTranslating = false;
      btnTranslate.disabled = false;
      btnTranslateText.textContent = "Re-scan Screen";

      if (chrome.runtime.lastError || !response) {
        setStatus("Could not read tab. Refresh the webpage if needed.", "error");
        englishContentBody.innerHTML = `<p style="color:#dc2626;">Could not access page text. Please refresh the webpage.</p>`;
        return;
      }

      // Display detected language
      if (response.pageLanguage) {
        pageLangDisplay.textContent = response.pageLanguage.toUpperCase();
      }

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

      // AUTOMATICALLY READ & TRANSLATE SCREEN ON OPEN!
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
