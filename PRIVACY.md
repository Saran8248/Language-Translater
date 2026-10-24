# Privacy Policy & Data Disclosures

**Last Updated:** October 2026  
**Product:** Universal Translator Chrome Extension (Manifest V3)

---

## 1. Overview

Universal Translator is committed to protecting user privacy and data security. This document details what information is collected, how it is processed, which external services are utilized, and how user privacy is safeguarded.

## 2. Information Handled by the Extension

### Text Eligible for Translation
- **What is collected:** Only visible, non-interactive text nodes on supported foreign-language webpages that require translation.
- **What is excluded (Never Collected):**
  - Form inputs (`<input>`, `<textarea>`, `<select>`)
  - Password fields, credit card fields, and sensitive personal data
  - Content-editable elements (`[contenteditable="true"]`)
  - Code blocks (`<code>`, `<pre>`), scripts, and stylesheets
  - Protected or restricted browser pages (`chrome://`, Chrome Web Store, local extension settings)

### User Settings
- Extension configuration choices (e.g. `autoTranslate`, `showOriginal`, `displayMode`, `targetLanguage`, and `backendUrl`) are stored locally via `chrome.storage.sync` (or `chrome.storage.local`).
- User settings are never sold, shared with third parties, or sent to tracking servers.

## 3. Translation Providers and Data Flow

All translation requests are routed through a secure backend proxy service rather than calling third-party APIs directly from the browser:
- **No API Secrets in Browser:** Provider credentials (such as Google Cloud Translation or DeepL API keys) are maintained securely in the backend server's environment and are never bundled or exposed in client extension code.
- **Minimal Payload:** Only the minimum necessary text fragments are submitted in batched requests to the translation backend.
- **Provider Transparency:** The backend proxy integrates with supported translation providers (Google Cloud Translation, DeepL API, LibreTranslate, or MyMemory).
- **No Logging of Text:** The backend proxy does not persist or log webpage text content to disk or long-term databases.
- **In-Memory Caching:** Translations may be held temporarily in an in-memory LRU cache to reduce redundant API calls and optimize latency. The cache can be cleared at any time.

## 4. Permissions Requested

Universal Translator operates under the principle of least privilege, requesting only permissions strictly necessary for its core capabilities:

| Permission | Purpose |
|---|---|
| `storage` | Stores user configuration (auto-translation toggle, display mode, target language) across browser sessions. |
| `activeTab` | Grants temporary access to the active webpage tab when the user interacts with the extension popup. |
| `http://*/*` and `https://*/*` | Required for the content script to detect foreign-language text on visited webpages and communicate with the translation backend proxy. |

## 5. User Control & Data Retention

- **Restore Original:** Users can restore unmodified webpage text at any point without reloading the page by clicking "Restore original page".
- **Disable Auto-Translation:** Users can disable automatic translation at any time from the extension popup.
- **Local Storage Management:** Uninstalling the extension or clearing extension data via `chrome://extensions` immediately deletes all stored preferences.

## 6. Contact and Inquiries

If you have questions regarding this privacy disclosure or the Universal Translator project, please open an issue in the project repository.
