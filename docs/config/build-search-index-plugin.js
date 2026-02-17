const fs = require('fs');
const path = require('path');
const LZString = require('lz-string');
const { stemmer } = require('stemmer');

const docsJson = require('../src/assets/documentation.json');
const outputFile = path.join(__dirname, '../src/assets/search-index.json');

// Basic stop words.
const stopWords = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'if',
  'then',
  'else',
  'on',
  'in',
  'with',
  'to',
  'for',
  'of',
  'by',
  'at',
  'from',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
]);

// Tokenize: lower-case, split on non-word characters, filter stop words, and stem.
function tokenize(text) {
  return text
    .toLowerCase()
    .split(/[\W_]+/)
    .filter((token) => token.length > 0 && !stopWords.has(token))
    .map((token) => stemmer(token));
}

// Simple slugify: lower-case, replace non-word characters with hyphens.
function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Extracts sections from a Markdown file.
 *
 * It scans for headings (lines starting with '#' up to '######').
 * If an explicit ID is provided via `{#...}`, it’s used; otherwise a slug is generated.
 * Text before the first heading becomes an “intro” section.
 *
 * Each section object includes a heading level. (For intro sections, level is 0.)
 *
 * @param {string} content File content.
 * @param {string} defaultTitle Fallback title (typically the file name).
 * @returns {Array} Array of section objects: { title, id, content, level }.
 */
function extractSections(content, defaultTitle) {
  const lines = content.split('\n');
  const sections = [];
  // Match headings like: "## My Section" or "## My Section {#my-section}"
  const headingRegex = /^(#{1,6})\s*(.+?)(?:\s*\{#([\w-]+)\})?\s*$/;
  let i = 0;

  // Collect intro lines (before the first heading).
  const introLines = [];
  while (i < lines.length && !headingRegex.test(lines[i])) {
    introLines.push(lines[i]);
    i++;
  }
  if (introLines.length && introLines.join('').trim() !== '') {
    sections.push({
      title: defaultTitle,
      id: '', // No fragment for intro section.
      content: introLines.join('\n'),
      level: 0, // Treat intro as no heading.
    });
  }

  // Process each heading and its following lines.
  while (i < lines.length) {
    const match = lines[i].match(headingRegex);
    if (match) {
      const headingLevel = match[1].length; // H1 = 1, H2 = 2, etc.
      const headingText = match[2].trim();
      const headingId = match[3] ? match[3].trim() : slugify(headingText);
      i++;
      const sectionLines = [];
      while (i < lines.length && !headingRegex.test(lines[i])) {
        sectionLines.push(lines[i]);
        i++;
      }
      sections.push({
        title: headingText,
        id: headingId,
        content: sectionLines.join('\n'),
        level: headingLevel,
      });
    } else {
      i++;
    }
  }
  return sections;
}

/**
 * Returns a weight multiplier based on heading level.
 * You can adjust these values to boost higher‐level headings.
 */
function getHeadingWeight(level) {
  if (level === 1) return 7; // H1: boost heavily.
  if (level === 2) return 3; // H2: moderately high.
  if (level === 3) return 1.5; // H3: slight boost.
  if (level >= 4) return 1.2; // H4+ get a modest boost.
  return 1; // For intro (level 0) or any unexpected value.
}

// Instead of a simple Set, we store a mapping from docId to a cumulative weight.
const invertedIndex = {}; // token -> { docId: weight, ... }

/**
 * Adds a token for a given docId with the specified weight.
 */
function addTokenToIndex(token, docId, weight) {
  if (!invertedIndex[token]) {
    invertedIndex[token] = {};
  }
  invertedIndex[token][docId] = (invertedIndex[token][docId] || 0) + weight;
}

function buildIndex() {
  const docs = {}; // Map docId -> { title, url, content }
  let idCounter = 1;

  docsJson.entries.forEach((docEntry) => {
    if (!docEntry.published) return;
    const file = path.join(
      __dirname,
      '../src/assets/markdown/',
      `${docEntry.path}.md`,
    );
    const content = fs.readFileSync(file, 'utf8');

    const baseUrl = docEntry.slug;

    // Use file name (without extension) as the default title.
    const defaultTitle = path.basename(file, path.extname(file));

    // Split the document into sections.
    const sections = extractSections(content, defaultTitle);

    sections.forEach((section) => {
      const docId = idCounter++;
      // If the section has an ID (from a heading), append it as a fragment.
      const url = section.id ? `${baseUrl}#${section.id}` : baseUrl;
      const title = section.title;
      const docContent = section.content;

      docs[docId] = { title, url };

      // Weight for title tokens depends on the heading level.
      const titleWeight = getHeadingWeight(section.level);
      const titleTokens = tokenize(title);
      const contentTokens = tokenize(docContent);

      // Add title tokens with their boost.
      titleTokens.forEach((token) => {
        addTokenToIndex(token, docId, titleWeight);
      });
      // Add body tokens with a default weight of 1.
      contentTokens.forEach((token) => {
        addTokenToIndex(token, docId, 1);
      });
    });
  });

  const indexObject = {
    docs,
    invertedIndex, // mapping token -> { docId: weight, ... }
  };

  // Compress the JSON representation.
  const jsonStr = JSON.stringify(indexObject);
  const compressed = LZString.compressToUTF16(jsonStr);
  const output = { compressedIndex: compressed };
  fs.writeFileSync(outputFile, JSON.stringify(output, null, 2));
}

class BuildSearchIndexPlugin {
  apply(compiler) {
    // Use a Promise-based hook if your script is async
    compiler.hooks.beforeRun.tapPromise('BuildSearchIndexPlugin', async () => {
      await buildIndex();
    });
  }
}

module.exports = BuildSearchIndexPlugin;
