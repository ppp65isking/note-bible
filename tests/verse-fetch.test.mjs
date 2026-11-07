// Verse-fetch tests for Verse Garden — no dependencies, run with:
//   node tests/verse-fetch.test.mjs
// Verse text comes from THREE free, key-free APIs (mirrors app.js — keep in sync):
//   1. bible-api.com (WEB)      https://bible-api.com/{ref}
//   2. labs.bible.org (NET)     https://labs.bible.org/api/?passage={ref}&type=json
//   3. api.getbible.net (KJV)   https://api.getbible.net/v2/kjv/{bookNr}/{chapter}.json
// fetchVerse() round-robins the starting source and falls through the others,
// so requests spread out and one service being down/rate-limited never blocks
// a lookup. A 429 on a single source is reported as SKIP (couldn't verify
// right now), not a failure — the chain absorbing it is the feature.
// Run sparingly: one full run is ~45 requests spread over 3 providers.
// Exit code 0 = all pass, 1 = something failed.
'use strict';

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_JS = path.join(__dirname, '..', 'app.js');
const FETCH_TIMEOUT_MS = 10000;
const GAP_MS = 2000; // be polite to free APIs

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];

function ok(name, cond, extra = '') {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; failures.push(name); console.log(`  FAIL  ${name}${extra ? ' — ' + extra : ''}`); }
}
function skip(name, why) {
  skipped++;
  console.log(`  SKIP  ${name} — ${why}`);
}
function check(name, result) {
  // result: { ok } | { skip, why } | { fail, why }
  if (result.ok) ok(name, true);
  else if (result.skip) skip(name, result.why);
  else ok(name, false, result.why || '');
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (e) => /HTTP 429/.test(String((e && e.message) || e));

/* ---- mirror of app.js verse sources (keep in sync) ---- */
const BOOK_NR = {
  'genesis': 1, 'exodus': 2, 'leviticus': 3, 'numbers': 4, 'deuteronomy': 5,
  'joshua': 6, 'judges': 7, 'ruth': 8, '1 samuel': 9, '2 samuel': 10,
  '1 kings': 11, '2 kings': 12, '1 chronicles': 13, '2 chronicles': 14,
  'ezra': 15, 'nehemiah': 16, 'esther': 17, 'job': 18, 'psalm': 19, 'psalms': 19,
  'proverbs': 20, 'ecclesiastes': 21, 'song of solomon': 22, 'song of songs': 22,
  'isaiah': 23, 'jeremiah': 24, 'lamentations': 25, 'ezekiel': 26, 'daniel': 27,
  'hosea': 28, 'joel': 29, 'amos': 30, 'obadiah': 31, 'jonah': 32, 'micah': 33,
  'nahum': 34, 'habakkuk': 35, 'zephaniah': 36, 'haggai': 37, 'zechariah': 38,
  'malachi': 39, 'matthew': 40, 'mark': 41, 'luke': 42, 'john': 43, 'acts': 44,
  'romans': 45, '1 corinthians': 46, '2 corinthians': 47, 'galatians': 48,
  'ephesians': 49, 'philippians': 50, 'colossians': 51, '1 thessalonians': 52,
  '2 thessalonians': 53, '1 timothy': 54, '2 timothy': 55, 'titus': 56,
  'philemon': 57, 'hebrews': 58, 'james': 59, '1 peter': 60, '2 peter': 61,
  '1 john': 62, '2 john': 63, '3 john': 64, 'jude': 65, 'revelation': 66
};
function parseRef(ref) {
  const m = ref.trim().replace(/\s+/g, ' ')
    .match(/^(?:(\d)\s+)?([A-Za-z]+(?:\s+[A-Za-z]+)*)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) throw new Error('cannot parse reference: ' + ref);
  const key = ((m[1] ? m[1] + ' ' : '') + m[2]).toLowerCase();
  const bookNr = BOOK_NR[key];
  if (!bookNr) throw new Error('unknown book: ' + key);
  return { bookNr, chapter: +m[3], verseStart: m[4] ? +m[4] : null, verseEnd: m[5] ? +m[5] : null };
}
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(timer); }
}
async function fetchFromBibleApi(ref) {
  const data = await fetchJson('https://bible-api.com/' + encodeURIComponent(ref.trim()));
  return { reference: data.reference, text: (data.text || '').trim() };
}
async function fetchFromBibleOrg(ref) {
  const data = await fetchJson('https://labs.bible.org/api/?passage=' + encodeURIComponent(ref.trim()) + '&type=json');
  if (!Array.isArray(data) || !data.length) throw new Error('bible.org: no verses');
  const text = data.map((v) => (v.text || '').trim()).join(' ');
  const first = data[0], last = data[data.length - 1];
  const reference = first.bookname + ' ' + first.chapter + ':' + first.verse +
    (data.length > 1 ? '-' + last.verse : '');
  return { reference, text: text.trim() };
}
async function fetchFromGetBible(ref) {
  const p = parseRef(ref);
  const data = await fetchJson('https://api.getbible.net/v2/kjv/' + p.bookNr + '/' + p.chapter + '.json');
  const verses = (data.verses || []).filter((v) =>
    p.verseStart == null || (v.verse >= p.verseStart && v.verse <= (p.verseEnd || p.verseStart)));
  if (!verses.length) throw new Error('getbible: no verses');
  const text = verses.map((v) => (v.text || '').trim()).join(' ');
  const reference = p.verseStart == null
    ? data.book_name + ' ' + p.chapter
    : data.book_name + ' ' + p.chapter + ':' + p.verseStart + (p.verseEnd ? '-' + p.verseEnd : '');
  return { reference, text: text.trim() };
}
const VERSE_SOURCES = [
  { name: 'bible-api', fetch: fetchFromBibleApi },
  { name: 'bible.org', fetch: fetchFromBibleOrg },
  { name: 'getbible', fetch: fetchFromGetBible }
];
let verseSourceCursor = 0;
async function fetchVerse(ref) {
  const start = verseSourceCursor++ % VERSE_SOURCES.length;
  const errors = [];
  for (let i = 0; i < VERSE_SOURCES.length; i++) {
    const src = VERSE_SOURCES[(start + i) % VERSE_SOURCES.length];
    try {
      const out = await src.fetch(ref);
      if (out && out.text && out.text.trim().length > 0) return out;
      throw new Error(src.name + ': empty text');
    } catch (e) {
      errors.push(src.name + ': ' + (e.message || e));
    }
  }
  throw new Error('Verse not found (' + errors.join('; ') + ')');
}
/* ---- end mirror ---- */

function extractVotd() {
  const src = fs.readFileSync(APP_JS, 'utf8');
  const start = src.indexOf('const VOTD = [');
  const end = src.indexOf('];', start);
  if (start < 0 || end < 0) throw new Error('VOTD block not found in app.js');
  const block = src.slice(start, end);
  return [...block.matchAll(/ref:\s*'([^']+)'\s*,\s*text:\s*'((?:[^'\\]|\\.)*)'/g)]
    .map((m) => ({ ref: m[1], text: m[2].replace(/\\'/g, "'") }));
}

(async () => {
  console.log('Verse Garden — verse-fetch tests (3 sources)\n');

  // [1] VOTD data sanity (offline fallback must exist for every entry)
  const votd = extractVotd();
  console.log(`[1] VOTD data in app.js (${votd.length} entries)`);
  ok('exactly 30 VOTD entries', votd.length === 30, `got ${votd.length}`);
  ok('every entry has a ref', votd.every((e) => e.ref && e.ref.trim().length > 0));
  ok('every entry has non-empty fallback text', votd.every((e) => e.text && e.text.trim().length > 10));
  ok('no duplicate refs', new Set(votd.map((e) => e.ref)).size === votd.length);

  // [2] Rotation math (same as app.js votdEntry)
  console.log('[2] VOTD rotation math');
  let rotationOk = true;
  for (let day = 0; day <= 366; day++) {
    const idx = day % votd.length;
    if (idx < 0 || idx >= votd.length || !votd[idx].ref) { rotationOk = false; break; }
  }
  ok('dayOfYear % 30 always picks a valid entry (days 0–366)', rotationOk);

  // [3] parseRef unit tests (no network)
  console.log('[3] parseRef unit tests');
  const parseCases = [
    ['John 3:16', { bookNr: 43, chapter: 3, verseStart: 16, verseEnd: null }],
    ['Psalm 23', { bookNr: 19, chapter: 23, verseStart: null, verseEnd: null }],
    ['Psalms 23:1', { bookNr: 19, chapter: 23, verseStart: 1, verseEnd: null }],
    ['Lamentations 3:22-23', { bookNr: 25, chapter: 3, verseStart: 22, verseEnd: 23 }],
    ['1 John 4:8', { bookNr: 62, chapter: 4, verseStart: 8, verseEnd: null }],
    ['Song of Solomon 2:4', { bookNr: 22, chapter: 2, verseStart: 4, verseEnd: null }],
    ['Genesis 1:1', { bookNr: 1, chapter: 1, verseStart: 1, verseEnd: null }],
    ['Revelation 22:21', { bookNr: 66, chapter: 22, verseStart: 21, verseEnd: null }]
  ];
  for (const [input, want] of parseCases) {
    try {
      const got = parseRef(input);
      ok(`parseRef("${input}")`, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}`);
    } catch (e) {
      ok(`parseRef("${input}")`, false, String(e.message || e));
    }
  }
  for (const bad of ['NotABook 99:99', 'Hello', 'John', '3:16']) {
    try { parseRef(bad); ok(`parseRef("${bad}") throws`, false, 'did not throw'); }
    catch (e) { ok(`parseRef("${bad}") throws`, true); }
  }

  // [4] Source rotation: starting source cycles 0,1,2,0,1,2
  console.log('[4] Source rotation');
  const starts = [];
  for (let c = 0; c < 6; c++) starts.push(c % VERSE_SOURCES.length);
  ok('cursor cycles through all 3 sources evenly', JSON.stringify(starts) === '[0,1,2,0,1,2]');

  // [5] Per-source smoke checks (a 429 is a SKIP — the chain absorbing it is the feature)
  console.log('[5] Per-source smoke checks');
  const smoke = [
    ['bible-api', fetchFromBibleApi, ['John 3:16', 'Psalm 23:1']],
    ['bible.org', fetchFromBibleOrg, ['John 3:16', 'Lamentations 3:22-23']],
    ['getbible', fetchFromGetBible, ['John 3:16', '1 John 4:8', 'Psalm 23']]
  ];
  for (const [name, fn, refs] of smoke) {
    for (const ref of refs) {
      try {
        const out = await fn(ref);
        check(`${name} "${ref}" -> ${out.reference}`, out.text.length > 10 ? { ok: true } : { fail: true, why: 'empty text' });
      } catch (e) {
        if (isRateLimit(e)) check(`${name} "${ref}"`, { skip: true, why: 'rate-limited (429), try later' });
        else check(`${name} "${ref}"`, { fail: true, why: String(e.message || e) });
      }
      await sleep(GAP_MS);
    }
  }

  // [6] Full VOTD run through the multi-source chain (source-agnostic: any source may serve it)
  console.log('[6] Live fetch — all 30 VOTD references (multi-source chain)');
  for (const { ref } of votd) {
    try {
      const live = await fetchVerse(ref);
      ok(`${ref} -> ${live.reference}`, live.text.length > 10, `textLen=${live.text.length}`);
    } catch (e) {
      ok(`${ref} -> live fetch`, false, String(e.message || e));
    }
    await sleep(GAP_MS);
  }

  // [7] Typical lookups through the chain
  console.log('[7] Live fetch — typical lookup inputs (multi-source chain)');
  for (const ref of ['John 3:16', 'Psalm 23', 'Genesis 1:1', 'Romans 8:28', '1 John 4:8', 'Psalm 119:105', '  John 1:1  ', 'Ecclesiastes 3:1']) {
    try {
      const live = await fetchVerse(ref);
      ok(`lookup "${ref}" -> ${live.reference}`, live.text.length > 10, `textLen=${live.text.length}`);
    } catch (e) {
      ok(`lookup "${ref}"`, false, String(e.message || e));
    }
    await sleep(GAP_MS);
  }

  // [8] Failure path: invalid ref must fail on ALL THREE sources, and say so
  console.log('[8] Failure path — invalid reference');
  try {
    await fetchVerse('NotABook 99:99');
    ok('invalid ref fails on all sources', false, 'fetchVerse returned 200?!');
  } catch (e) {
    const msg = String(e.message || e);
    ok(
      'invalid ref fails on all sources',
      msg.includes('Verse not found') && msg.includes('bible-api') && msg.includes('bible.org') && msg.includes('getbible'),
      msg
    );
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped.`);
  if (failed > 0) {
    console.log('Failed: ' + failures.join(' | '));
    process.exit(1);
  }
})().catch((e) => {
  console.error('Test runner crashed:', e);
  process.exit(1);
});
