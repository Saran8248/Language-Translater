/**
 * Universal Translator - Popup Script
 * Handles settings persistence, tab communication, progress events, and UI states.
 */

document.addEventListener("DOMContentLoaded", async () => {
  // UI Elements
  const backendBadge = document.getElementById("backend-status-badge");
  const backendStatusText = document.getElementById("backend-status-text");
  const footerProviderName = document.getElementById("footer-provider-name");
  const pageLangDisplay = document.getElementById("page-lang-display");
  const statusBox = document.getElementById("status-live-region");
  const progressContainer = document.getElementById("progress-container");
  const progressBarFill = document.getElementById("progress-bar-fill");
  const progressText = document.getElementById("progress-text");

  const btnTranslate = document.getElementById("btn-translate");
  const btnTranslateText = document.getElementById("btn-translate-text");
  const btnRestore = document.getElementById("btn-restore");
  const btnTestBackend = document.getElementById("btn-test-backend");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const toggleAuto = document.getElementById("toggle-auto");
  const toggleOriginal = document.getElementById("toggle-original");
  const selectDisplayMode = document.getElementById("select-display-mode");
  const selectTargetLang = document.getElementById("select-target-lang");
  const inputBackendUrl = document.getElementById("input-backend-url");
  const settingsForm = document.getElementById("settings-form");

  let activeTabId = null;
  let isTranslating = false;

  /**
   * Update visual status message
   */
  function setStatus(message, type = "normal") {
    statusBox.textContent = message;
    statusBox.className = "status-box";
    if (type === "error") {
      statusBox.classList.add("error");
    } else if (type === "success") {
      statusBox.classList.add("success");
    }
  }

  /**
   * Update backend connection badge
   */
  function setBackendStatus(connected, providerName = "", errorMsg = "") {
    backendBadge.className = "status-badge";
    if (connected) {
      backendBadge.classList.add("badge-connected");
      backendStatusText.textContent = providerName ? `Connected (${providerName})` : "Connected";
      footerProviderName.textContent = providerName || "Connected";
    } else {
      backendBadge.classList.add("badge-disconnected");
      backendStatusText.textContent = "Offline";
      footerProviderName.textContent = "Offline";
      if (errorMsg) {
        setStatus(`Backend offline: ${errorMsg}`, "error");
      }
    }
  }

  /**
   * Check backend health
   */
  async function checkBackend(url) {
    backendBadge.className = "status-badge badge-checking";
    backendStatusText.textContent = "Checking...";
    try {
      const res = await new Promise((resolve) => {
        chrome.runtime.sendMessage({ action: "checkBackendStatus", backendUrl: url }, resolve);
      });
      if (res && res.connected) {
        setBackendStatus(true, res.provider);
        return true;
      } else {
        setBackendStatus(false, "", res?.error || "Cannot reach server");
        return false;
      }
    } catch (e) {
      setBackendStatus(false, "", e.message);
      return false;
    }
  }

  /**
   * Load stored settings and fill form
   */
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, (res) => {
        if (res && res.settings) {
          const s = res.settings;
          toggleAuto.checked = s.autoTranslate !== false;
          toggleOriginal.checked = s.showOriginal !== false;
          if (s.displayMode) selectDisplayMode.value = s.displayMode;
          if (s.targetLanguage) selectTargetLang.value = s.targetLanguage;
          if (s.backendUrl) inputBackendUrl.value = s.backendUrl;
        }
        resolve(res?.settings);
      });
    });
  }

  /**
   * Collect and save settings
   */
  async function saveSettings(silent = false) {
    const newSettings = {
      autoTranslate: toggleAuto.checked,
      showOriginal: toggleOriginal.checked,
      displayMode: selectDisplayMode.value,
      targetLanguage: selectTargetLang.value,
      backendUrl: inputBackendUrl.value.trim()
    };

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "saveSettings", settings: newSettings }, (res) => {
        if (res && res.success) {
          // Notify active tab of updated settings
          if (activeTabId) {
            chrome.tabs.sendMessage(activeTabId, { action: "updateSettings", settings: newSettings }).catch(() => {});
          }
          if (!silent) {
            setStatus("Settings saved successfully.", "success");
            setTimeout(() => setStatus("Ready to translate"), 2000);
          }
          resolve(true);
        } else {
          if (!silent) setStatus("Failed to save settings.", "error");
          resolve(false);
        }
      });
    });
  }

  /**
   * Query status from active tab content script
   */
  async function queryActiveTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return;
      activeTabId = tab.id;

      // Check for restricted URLs (chrome://, webstore, file:// without access)
      if (
        !tab.url ||
        tab.url.startsWith("chrome://") ||
        tab.url.startsWith("chrome-extension://") ||
        tab.url.includes("chromewebstore.google.com")
      ) {
        pageLangDisplay.textContent = "N/A";
        setStatus("This page cannot be accessed by the extension", "error");
        btnTranslate.disabled = true;
        btnRestore.disabled = true;
        return;
      }

      // Ping content script
      chrome.tabs.sendMessage(activeTabId, { action: "getPageStatus" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          pageLangDisplay.textContent = "Unknown";
          setStatus("Ready to translate");
          return;
        }

        // Display language
        if (response.language) {
          pageLangDisplay.textContent = response.language.toUpperCase();
        }

        if (response.isEnglish) {
          pageLangDisplay.textContent = "EN (English)";
          setStatus("Already English", "normal");
        } else if (response.status === "translated") {
          setStatus(`Translation complete (${response.translatedCount || 0} items)`, "success");
        } else if (response.status === "translating") {
          isTranslating = true;
          btnTranslate.disabled = true;
          btnTranslateText.textContent = "Translating...";
          progressContainer.classList.remove("hidden");
          setStatus("Translating page...", "normal");
        } else if (response.status === "restored") {
          setStatus("Original page restored", "normal");
        } else {
          setStatus("Ready to translate");
        }
      });
    } catch (e) {
      console.warn("Tab query error:", e);
    }
  }

  // Handle runtime messages for translation progress
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "translationProgress") {
      isTranslating = true;
      progressContainer.classList.remove("hidden");
      const pct = Math.round((message.current / (message.total || 1)) * 100);
      progressBarFill.style.width = `${pct}%`;
      progressText.textContent = `Translating: ${message.current} / ${message.total}`;
      setStatus(`Translating page... (${message.current}/${message.total})`, "normal");
    }

    if (message.action === "translationFinished") {
      isTranslating = false;
      btnTranslate.disabled = false;
      btnTranslateText.textContent = "Translate this page";
      progressContainer.classList.add("hidden");
      setStatus(`Translation complete (${message.count} items)`, "success");
    }

    if (message.action === "restored") {
      isTranslating = false;
      btnTranslate.disabled = false;
      btnTranslateText.textContent = "Translate this page";
      progressContainer.classList.add("hidden");
      setStatus("Original page restored", "normal");
    }
  });

  // Event: Translate button click
  btnTranslate.addEventListener("click", async () => {
    if (!activeTabId || isTranslating) return;

    isTranslating = true;
    btnTranslate.disabled = true;
    btnTranslateText.textContent = "Translating...";
    progressContainer.classList.remove("hidden");
    progressBarFill.style.width = "5%";
    progressText.textContent = "Scanning page...";
    setStatus("Translating page...", "normal");

    chrome.tabs.sendMessage(activeTabId, { action: "translatePage" }, (res) => {
      if (chrome.runtime.lastError) {
        isTranslating = false;
        btnTranslate.disabled = false;
        btnTranslateText.textContent = "Translate this page";
        progressContainer.classList.add("hidden");
        setStatus("Could not connect to page. Try refreshing.", "error");
      }
    });
  });

  // Event: Restore button click
  btnRestore.addEventListener("click", () => {
    if (!activeTabId) return;
    chrome.tabs.sendMessage(activeTabId, { action: "restorePage" }, () => {
      isTranslating = false;
      btnTranslate.disabled = false;
      btnTranslateText.textContent = "Translate this page";
      progressContainer.classList.add("hidden");
      setStatus("Original page restored", "normal");
    });
  });

  // Event: Test Backend Connection
  btnTestBackend.addEventListener("click", async () => {
    const url = inputBackendUrl.value.trim();
    if (!url) {
      setStatus("Please enter a backend URL.", "error");
      return;
    }
    const ok = await checkBackend(url);
    if (ok) {
      setStatus("Backend connection verified!", "success");
    }
  });

  // Event: Save Settings Form Submit
  settingsForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await saveSettings(false);
  });

  // Auto-save when toggles change for convenience
  toggleAuto.addEventListener("change", () => saveSettings(true));
  toggleOriginal.addEventListener("change", () => saveSettings(true));
  selectDisplayMode.addEventListener("change", () => saveSettings(true));
  selectTargetLang.addEventListener("change", () => saveSettings(true));

  // Initialize
  const settings = await loadSettings();
  await checkBackend(settings?.backendUrl || inputBackendUrl.value);
  await queryActiveTab();
});
