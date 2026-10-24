/**
 * Universal Translator - Background Service Worker (Manifest V3)
 * Manages communication with backend translation proxy, settings storage, and tab events.
 */

const DEFAULT_SETTINGS = {
  autoTranslate: true,
  showOriginal: true,
  targetLanguage: "en",
  backendUrl: "http://127.0.0.1:8000",
  displayMode: "inline-badge" // "inline-badge" | "ruby-subtitle" | "replace-with-tooltip"
};

// Helper to access storage (chrome.storage.sync with fallback to local)
async function getStoredSettings() {
  return new Promise((resolve) => {
    const storageArea = chrome.storage.sync || chrome.storage.local;
    storageArea.get(DEFAULT_SETTINGS, (items) => {
      if (chrome.runtime.lastError) {
        chrome.storage.local.get(DEFAULT_SETTINGS, (fallbackItems) => {
          resolve({ ...DEFAULT_SETTINGS, ...fallbackItems });
        });
      } else {
        resolve({ ...DEFAULT_SETTINGS, ...items });
      }
    });
  });
}

async function saveStoredSettings(newSettings) {
  return new Promise((resolve, reject) => {
    const storageArea = chrome.storage.sync || chrome.storage.local;
    storageArea.set(newSettings, () => {
      if (chrome.runtime.lastError) {
        chrome.storage.local.set(newSettings, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(newSettings);
          }
        });
      } else {
        resolve(newSettings);
      }
    });
  });
}

// Health check to verify backend connectivity
async function checkBackendHealth(backendUrl) {
  const url = (backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, "") + "/health";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const response = await fetch(url, {
      method: "GET",
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return { connected: true, provider: data.provider, version: data.version };
    }
    return { connected: false, error: `HTTP ${response.status}: ${response.statusText}` };
  } catch (err) {
    clearTimeout(timeoutId);
    return { connected: false, error: err.name === "AbortError" ? "Backend connection timed out" : err.message };
  }
}

// Send batch translation request to backend proxy
async function requestTranslation(texts, target, source, backendUrl) {
  const url = (backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, "") + "/translate";
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for batch

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        texts: texts,
        target: target || "en",
        source: source || "auto"
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      let errorDetail = `HTTP ${response.status}`;
      try {
        const errorJson = await response.json();
        if (errorJson.detail) errorDetail = errorJson.detail;
      } catch (e) {
        // use default error detail
      }
      throw new Error(errorDetail);
    }

    const data = await response.json();
    return {
      success: true,
      translations: data.translations,
      detected_language: data.detected_language,
      provider: data.provider,
      cached_count: data.cached_count
    };
  } catch (err) {
    clearTimeout(timeoutId);
    const message = err.name === "AbortError" ? "Translation request timed out" : err.message;
    return {
      success: false,
      error: message
    };
  }
}

// Detect language of text sample
async function requestLanguageDetection(text, backendUrl) {
  const url = (backendUrl || DEFAULT_SETTINGS.backendUrl).replace(/\/+$/, "") + "/detect";
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text })
    });
    if (response.ok) {
      const data = await response.json();
      return { success: true, ...data };
    }
    return { success: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// Extension lifecycle setup
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === "install") {
    // Save default settings on fresh install
    await saveStoredSettings(DEFAULT_SETTINGS);
  }
});

// Central message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    getStoredSettings().then(settings => sendResponse({ success: true, settings }));
    return true; // Keep message port open for async response
  }

  if (message.action === "saveSettings") {
    saveStoredSettings(message.settings)
      .then(saved => sendResponse({ success: true, settings: saved }))
      .catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "checkBackendStatus") {
    checkBackendHealth(message.backendUrl).then(status => sendResponse(status));
    return true;
  }

  if (message.action === "translateBatch") {
    getStoredSettings().then(settings => {
      const backendUrl = message.backendUrl || settings.backendUrl;
      const target = message.target || settings.targetLanguage;
      requestTranslation(message.texts, target, message.source, backendUrl)
        .then(res => sendResponse(res));
    });
    return true;
  }

  if (message.action === "detectLanguage") {
    getStoredSettings().then(settings => {
      const backendUrl = message.backendUrl || settings.backendUrl;
      requestLanguageDetection(message.text, backendUrl)
        .then(res => sendResponse(res));
    });
    return true;
  }
});
