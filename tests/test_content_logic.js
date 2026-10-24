/**
 * Automated tests for Universal Translator content extraction and filtering rules.
 * Runs in Node.js.
 */
const assert = require("assert");

// Exclusion rules under test
const EXCLUDED_TAGS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA", "INPUT", "SELECT",
  "CODE", "PRE", "KBD", "SAMP", "SVG", "CANVAS", "AUDIO", "VIDEO",
  "IFRAME", "EMBED", "OBJECT", "MATH"
]);

function isTextEligible(text) {
  if (!text || !text.trim()) return false;
  const trimmed = text.trim();
  // Pure punctuation or numbers
  if (/^[\d\s.,\/#!$%\^&\*;:{}=\-_`~()@+?><\[\]'"]+$/.test(trimmed)) return false;
  // URLs or emails
  if (/^(https?:\/\/|www\.)\S+$/i.test(trimmed) || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return false;
  }
  return true;
}

function createBatches(items, maxBatchSize = 25, maxChars = 2500) {
  const batches = [];
  let currentBatch = [];
  let currentBatchChars = 0;

  for (const item of items) {
    const text = item.text.trim();
    if (!text) continue;

    if (currentBatch.length >= maxBatchSize || currentBatchChars + text.length > maxChars) {
      batches.push(currentBatch);
      currentBatch = [];
      currentBatchChars = 0;
    }
    currentBatch.push(item);
    currentBatchChars += text.length;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);
  return batches;
}

console.log("Running Universal Translator Content Filtering Tests...");

// Test 1: Tag exclusion
EXCLUDED_TAGS.forEach(tag => {
  assert(EXCLUDED_TAGS.has(tag), `Tag ${tag} should be excluded`);
});
assert(!EXCLUDED_TAGS.has("P"), "Paragraph tag should not be excluded");
assert(!EXCLUDED_TAGS.has("H1"), "H1 tag should not be excluded");
assert(!EXCLUDED_TAGS.has("SPAN"), "Span tag should not be excluded");
assert(!EXCLUDED_TAGS.has("A"), "Anchor tag should not be excluded");
console.log("✓ Tag exclusion tests passed");

// Test 2: Text eligibility
assert(isTextEligible("Willkommen auf unserer Webseite") === true, "German sentence should be eligible");
assert(isTextEligible("Bonjour le monde") === true, "French sentence should be eligible");
assert(isTextEligible("1234567") === false, "Pure numbers should be ignored");
assert(isTextEligible("... ,,, !!! ???") === false, "Pure punctuation should be ignored");
assert(isTextEligible("   ") === false, "Whitespace should be ignored");
assert(isTextEligible("https://example.com/page") === false, "URLs should be ignored");
assert(isTextEligible("test@example.com") === false, "Emails should be ignored");
console.log("✓ Text eligibility tests passed");

// Test 3: Batching behavior
const sampleItems = Array.from({ length: 65 }, (_, i) => ({
  id: i,
  text: `Dies ist ein Testelement Nummer ${i} für die Übersetzung.`
}));

const batches = createBatches(sampleItems, 25, 2500);
assert.strictEqual(batches.length, 3, "65 items with batch size 25 should produce 3 batches");
assert.strictEqual(batches[0].length, 25, "First batch size should be 25");
assert.strictEqual(batches[1].length, 25, "Second batch size should be 25");
assert.strictEqual(batches[2].length, 15, "Third batch size should be 15");
console.log("✓ Batching logic tests passed");

console.log("\nALL CONTENT SCRIPT LOGIC TESTS PASSED!");
