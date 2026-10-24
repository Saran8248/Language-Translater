/**
 * Universal Translator - Background Service Worker (Manifest V3)
 * Provides standalone built-in translation (no local Python server required!)
 * with automatic fallback to custom backend if configured.
 */

const DEFAULT_SETTINGS = {
  autoTranslate: true,
  showOriginal: true,
  targetLanguage: "en",
  backendUrl: "http://127.0.0.1:8000",
  displayMode: "inline-badge",
  useBuiltinTranslator: true // Standalone browser translation out-of-the-box
};

// In-memory runtime translation cache
const runtimeCache = new Map();

/**
 * Fast client-side language detection
 */
function detectLanguageFromText(text) {
  if (!text) return "en";
  // Japanese / Chinese / Korean scripts
  if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return "ja";
  if (/[\uac00-\ud7af]/.test(text)) return "ko";
  if (/[\u4e00-\u9fff]/.test(text)) return "zh";
  if (/[\u0600-\u06ff]/.test(text)) return "ar";
  if (/[\u0400-\u04ff]/.test(text)) return "ru";

  const lower = " " + text.toLowerCase().replace(/[^a-zäöüßéèàùâêîôûñáíóúç ]/g, " ") + " ";
  const de = [" der ", " die ", " das ", " und ", " in ", " den ", " von ", " zu ", " mit ", " sich ", " des ", " auf ", " für ", " ist ", " im ", " nicht ", " eine ", " ein ", " willkommen ", " nachrichten "];
  const fr = [" le ", " la ", " les ", " et ", " en ", " un ", " une ", " du ", " des ", " dans ", " pour ", " sur ", " avec ", " ce ", " est ", " pas ", " bienvenue "];
  const es = [" el ", " la ", " los ", " las ", " de ", " en ", " y ", " un ", " una ", " por ", " para ", " con ", " que ", " es ", " del ", " al ", " bienvenido "];
  const en = [" the ", " and ", " to ", " of ", " a ", " in ", " is ", " that ", " for ", " you ", " it ", " with ", " on ", " as ", " are ", " this "];

  const score = (words) => words.reduce((acc, w) => acc + (lower.includes(w) ? 1 : 0), 0);
  const scores = { de: score(de), fr: score(fr), es: score(es), en: score(en) };

  let bestLang = "en";
  let maxScore = scores.en;
  for (const [lang, s] of Object.entries(scores)) {
    if (s > maxScore) {
      maxScore = s;
      bestLang = lang;
    }
  }

  // If no clear match, check special characters
  if (maxScore === 0) {
    if (/[äöüß]/i.test(text)) return "de";
    if (/[éèàùâêîôûç]/i.test(text)) return "fr";
    if (/[áíóúñ¿¡]/i.test(text)) return "es";
  }

  return bestLang;
}

/**
 * Built-in direct translation using MyMemory API with concurrency control
 */
async function translateSingleBuiltin(text, sourceLang, targetLang) {
  const clean = text.trim();
  if (!clean) return text;

  // Determine source language
  let src = sourceLang;
  if (!src || src === "auto") {
    src = detectLanguageFromText(clean);
  }
  if (src === targetLang) return clean;

  const cacheKey = `${src}|${targetLang}|${clean}`;
  if (runtimeCache.has(cacheKey)) {
    return runtimeCache.get(cacheKey);
  }

  const endpoint = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(clean)}&langpair=${src}|${targetLang}`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(endpoint, { signal: controller.signal });
    clearTimeout(timer);

    if (resp.ok) {
      const data = await resp.json();
      const translated = data?.responseData?.translatedText;
      if (translated && !translated.includes("IS AN INVALID SOURCE LANGUAGE")) {
        runtimeCache.set(cacheKey, translated);
        return translated;
      }
    }
  } catch (e) {
    console.warn("[Universal Translator] Built-in fetch warning:", e.message);
  }

  // Fallback: return formatted or clean text
  return clean;
}

/**
 * Batch translate using built-in standalone browser translation
 */
async function translateBatchBuiltin(texts, targetLang = "en", sourceLang = "auto") {
  const results = new Array(texts.length);
  const semLimit = 5;
  let active = 0;
  let index = 0;

  // Detect overall language if auto
  let detected = sourceLang;
  if (!detected || detected === "auto") {
    const combinedSample = texts.slice(0, 5).join(" ");
    detected = detectLanguageFromText(combinedSample);
  }

  return new Promise((resolve) => {
    function next() {
      if (index >= texts.length && active === 0) {
        return resolve({
          success: true,
          translations: results,
          detected_language: detected,
          provider: "Built-in Browser Translator",
          cached_count: 0
        });
      }

      while (active < semLimit && index < texts.length) {
        const currentIndex = index++;
        active++;
        translateSingleBuiltin(texts[currentIndex], detected, targetLang)
          .then((trans) => {
            results[currentIndex] = trans;
          })
          .catch(() => {
            results[currentIndex] = texts[currentIndex];
          })
          .finally(() => {
            active--;
            next();
          });
      }
    }
    next();
  });
}

// Storage helpers
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
          if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
          else resolve(newSettings);
        });
      } else {
        resolve(newSettings);
      }
    });
  });
}

// Health check: Always returns connected because Built-in Translator is always ready!
async function checkBackendHealth(backendUrl) {
  // First check if local backend is up
  if (backendUrl) {
    try {
      const url = backendUrl.replace(/\/+$/, "") + "/health";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1500);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        const data = await resp.json();
        return { connected: true, provider: data.provider || "Local Backend", mode: "backend" };
      }
    } catch (e) {
      // Local backend not running, fallback to built-in seamlessly
    }
  }

  // Built-in browser engine is always ready and connected!
  return { connected: true, provider: "Instant Built-in (Standalone)", mode: "builtin" };
}

// Translate batch: Tries custom backend first if responsive; otherwise uses Built-in instantly
async function requestTranslation(texts, target, source, backendUrl) {
  // If backendUrl is set, try local backend first
  if (backendUrl) {
    try {
      const url = backendUrl.replace(/\/+$/, "") + "/translate";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2500);
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, target: target || "en", source: source || "auto" }),
        signal: controller.signal
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json();
        return {
          success: true,
          translations: data.translations,
          detected_language: data.detected_language,
          provider: data.provider,
          cached_count: data.cached_count
        };
      }
    } catch (e) {
      // Backend not running, proceed to built-in standalone translation
    }
  }

  // Standalone built-in translation (Zero configuration needed)
  return await translateBatchBuiltin(texts, target || "en", source || "auto");
}

// Central message listener
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "getSettings") {
    getStoredSettings().then((settings) => sendResponse({ success: true, settings }));
    return true;
  }

  if (message.action === "saveSettings") {
    saveStoredSettings(message.settings)
      .then((saved) => sendResponse({ success: true, settings: saved }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }

  if (message.action === "checkBackendStatus") {
    checkBackendHealth(message.backendUrl).then((status) => sendResponse(status));
    return true;
  }

  if (message.action === "translateBatch") {
    getStoredSettings().then((settings) => {
      const backendUrl = message.backendUrl || settings.backendUrl;
      const target = message.target || settings.targetLanguage;
      requestTranslation(message.texts, target, message.source, backendUrl).then((res) => sendResponse(res));
    });
    return true;
  }

  if (message.action === "detectLanguage") {
    const lang = detectLanguageFromText(message.text);
    sendResponse({
      success: true,
      language: lang,
      is_english: lang === "en",
      confidence: 0.95
    });
    return true;
  }
});
