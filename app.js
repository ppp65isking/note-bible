'use strict';
/* =====================================================================
   VERSE GARDEN — app.js
   ---------------------------------------------------------------------
   ★ FIREBASE SETUP — PASTE YOUR CONFIG HERE ★
   1. In the Firebase console (https://console.firebase.google.com),
      open your project "verse-notes" → Project settings → Your apps
      → Web app → copy the firebaseConfig object.
   2. Paste it below, replacing the empty strings.
   3. In Firebase console → Authentication → Sign-in method:
      enable "Email/Password" and "Google".
   4. In Firebase console → Firestore Database → create database
      (production mode is fine) and add these rules so each user can
      only read/write their own data:

      rules_version = '2';
      service cloud.firestore {
        match /databases/{database}/documents {
          match /users/{userId}/{document=**} {
            allow read, write: if request.auth != null
              && request.auth.uid == userId;
          }
        }
      }

   Until the config is filled in, the app runs in LOCAL MODE:
   everything saves to this device's localStorage and still works.
   ===================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyB8PL-46U55vWF9h86qNBECEvKTeQRuDqg",
  authDomain: "verse-notes.firebaseapp.com",
  projectId: "verse-notes",
  storageBucket: "verse-notes.firebasestorage.app",
  messagingSenderId: "243077023128",
  appId: "1:243077023128:web:3f625d5e96370be77117ed",
  measurementId: "G-GKQQJ32QH9"
};
/* ==================== end of Firebase config ==================== */

const FIREBASE_READY = typeof firebase !== 'undefined'
  && firebaseConfig.apiKey && firebaseConfig.apiKey.length > 0;
let auth = null, db = null, firebaseUser = null, localModeChosen = false;
if (FIREBASE_READY) {
  try {
    firebase.initializeApp(firebaseConfig);
    auth = firebase.auth();
    db = firebase.firestore();
  } catch (e) {
    console.warn('Firebase init failed, falling back to local mode:', e);
  }
}

/* ------------------------- constants ------------------------- */
const LS_KEY = 'verseGarden.v1';
const LS_VOTD = 'verseGarden.votd.v1';

const THEMES = {
  lavender: { name: 'Lavender 💜', accent: '#a78bfa', soft: '#ede9fe', bg: '#f5f0ff' },
  peach:    { name: 'Peach 🍑',    accent: '#fb923c', soft: '#ffedd5', bg: '#fff7ed' },
  mint:     { name: 'Mint 🌿',     accent: '#10b981', soft: '#d1fae5', bg: '#ecfdf5' },
  rose:     { name: 'Rose 🌹',     accent: '#f472b6', soft: '#fce7f3', bg: '#fff1f5' },
  sky:      { name: 'Sky 🩵',      accent: '#38bdf8', soft: '#e0f2fe', bg: '#f0f9ff' },
  honey:    { name: 'Honey 🍯',    accent: '#f59e0b', soft: '#fef3c7', bg: '#fffbeb' },
  ocean:    { name: 'Ocean 🌊',    accent: '#0284c7', soft: '#e0f2fe', bg: '#f0f9ff' },
  berry:    { name: 'Berry 🫐',    accent: '#be185d', soft: '#fce7f3', bg: '#fff1f5' },
  forest:   { name: 'Forest 🌲',   accent: '#15803d', soft: '#dcfce7', bg: '#f0fdf4' },
  sunset:   { name: 'Sunset 🌅',   accent: '#ea580c', soft: '#ffedd5', bg: '#fff7ed' }
};
const BACKGROUNDS = {
  dots:     { name: 'Dots',     emoji: '🔘' },
  waves:    { name: 'Waves',    emoji: '〰️' },
  petals:   { name: 'Petals',   emoji: '🌸' },
  hearts:   { name: 'Hearts',   emoji: '💜' },
  gradient: { name: 'Soft gradient', emoji: '🌈' },
  none:     { name: 'Plain',    emoji: '⬜' }
};
const DARK = { bg: '#1d1926', card: '#2b2540' };

/* 16 built-in SVG stickers (inline, no network needed) */
const STICKERS = [
  { id: 'heart', name: 'Heart', emoji: '💜', svg: '<svg viewBox="0 0 64 64"><path d="M32 56C12 42 6 28 14 17c6-8 14-6 18 2 4-8 12-10 18-2 8 11 2 25-18 39z" fill="#f472b6"/></svg>' },
  { id: 'star', name: 'Star', emoji: '⭐', svg: '<svg viewBox="0 0 64 64"><path d="M32 6l7 16 17 2-12 12 3 17-15-9-15 9 3-17L8 24l17-2z" fill="#fbbf24"/></svg>' },
  { id: 'flower', name: 'Flower', emoji: '🌸', svg: '<svg viewBox="0 0 64 64"><g fill="#f9a8d4"><circle cx="32" cy="14" r="10"/><circle cx="48" cy="26" r="10"/><circle cx="42" cy="46" r="10"/><circle cx="22" cy="46" r="10"/><circle cx="16" cy="26" r="10"/></g><circle cx="32" cy="30" r="9" fill="#fbbf24"/></svg>' },
  { id: 'bow', name: 'Bow', emoji: '🎀', svg: '<svg viewBox="0 0 64 64"><path d="M30 32L6 14v36zM34 32l24-18v36z" fill="#f472b6"/><circle cx="32" cy="32" r="7" fill="#be185d"/></svg>' },
  { id: 'sparkle', name: 'Sparkles', emoji: '✨', svg: '<svg viewBox="0 0 64 64"><path d="M32 4l5 17 17 5-17 5-5 17-5-17-17-5 17-5z" fill="#fde047"/><path d="M50 40l3 9 9 3-9 3-3 9-3-9-9-3 9-3z" fill="#a78bfa"/></svg>' },
  { id: 'sun', name: 'Sun', emoji: '☀️', svg: '<svg viewBox="0 0 64 64"><g stroke="#f59e0b" stroke-width="4" stroke-linecap="round"><line x1="32" y1="4" x2="32" y2="12"/><line x1="32" y1="52" x2="32" y2="60"/><line x1="4" y1="32" x2="12" y2="32"/><line x1="52" y1="32" x2="60" y2="32"/><line x1="12" y1="12" x2="18" y2="18"/><line x1="46" y1="46" x2="52" y2="52"/><line x1="52" y1="12" x2="46" y2="18"/><line x1="18" y1="46" x2="12" y2="52"/></g><circle cx="32" cy="32" r="13" fill="#fbbf24"/></svg>' },
  { id: 'moon', name: 'Moon', emoji: '🌙', svg: '<svg viewBox="0 0 64 64"><path d="M42 6a26 26 0 1 0 14 34A20 20 0 0 1 42 6z" fill="#fde68a"/></svg>' },
  { id: 'rainbow', name: 'Rainbow', emoji: '🌈', svg: '<svg viewBox="0 0 64 64" fill="none" stroke-width="6" stroke-linecap="round"><path d="M10 52a22 22 0 0 1 44 0" stroke="#f87171"/><path d="M17 52a15 15 0 0 1 30 0" stroke="#fbbf24"/><path d="M24 52a8 8 0 0 1 16 0" stroke="#34d399"/></svg>' },
  { id: 'butterfly', name: 'Butterfly', emoji: '🦋', svg: '<svg viewBox="0 0 64 64"><ellipse cx="18" cy="24" rx="13" ry="16" fill="#c4b5fd" transform="rotate(-20 18 24)"/><ellipse cx="46" cy="24" rx="13" ry="16" fill="#c4b5fd" transform="rotate(20 46 24)"/><ellipse cx="20" cy="46" rx="9" ry="11" fill="#a78bfa" transform="rotate(-15 20 46)"/><ellipse cx="44" cy="46" rx="9" ry="11" fill="#a78bfa" transform="rotate(15 44 46)"/><rect x="29" y="18" width="6" height="30" rx="3" fill="#6d28d9"/></svg>' },
  { id: 'leaf', name: 'Leaf', emoji: '🍃', svg: '<svg viewBox="0 0 64 64"><path d="M50 8C24 12 10 28 12 50c22 2 34-14 38-42z" fill="#34d399"/><path d="M16 48C24 34 36 24 46 16" stroke="#059669" stroke-width="3" fill="none" stroke-linecap="round"/></svg>' },
  { id: 'cloud', name: 'Cloud', emoji: '☁️', svg: '<svg viewBox="0 0 64 64"><path d="M18 50a12 12 0 0 1-2-23 16 16 0 0 1 30-4 11 11 0 0 1 2 27z" fill="#bae6fd"/></svg>' },
  { id: 'cross', name: 'Cross', emoji: '✝️', svg: '<svg viewBox="0 0 64 64"><rect x="26" y="8" width="12" height="48" rx="6" fill="#a78bfa"/><rect x="12" y="20" width="40" height="12" rx="6" fill="#a78bfa"/></svg>' },
  { id: 'dove', name: 'Dove', emoji: '🕊️', svg: '<svg viewBox="0 0 64 64"><ellipse cx="30" cy="36" rx="18" ry="12" fill="#fff"/><circle cx="46" cy="26" r="8" fill="#fff"/><path d="M52 26l8 3-8 3z" fill="#fbbf24"/><path d="M22 28c-4-10 2-18 10-18-2 8-4 14-10 18z" fill="#e0f2fe"/><circle cx="48" cy="24" r="1.6" fill="#1f2937"/></svg>' },
  { id: 'crown', name: 'Crown', emoji: '👑', svg: '<svg viewBox="0 0 64 64"><path d="M10 46L6 18l14 10L32 10l12 18 14-10-4 28z" fill="#fbbf24"/><circle cx="32" cy="50" r="4" fill="#f59e0b"/></svg>' },
  { id: 'strawberry', name: 'Berry', emoji: '🍓', svg: '<svg viewBox="0 0 64 64"><path d="M32 58C18 46 12 34 16 24c3-7 10-9 16-5 6-4 13-2 16 5 4 10-2 22-16 34z" fill="#fb7185"/><g fill="#fff"><circle cx="24" cy="32" r="1.8"/><circle cx="34" cy="28" r="1.8"/><circle cx="40" cy="38" r="1.8"/><circle cx="28" cy="44" r="1.8"/></g><path d="M32 18c-4-6-10-8-14-6 2 5 8 7 14 6 6 1 12-1 14-6-4-2-10 0-14 6z" fill="#34d399"/></svg>' },
  { id: 'tulip', name: 'Tulip', emoji: '🌷', svg: '<svg viewBox="0 0 64 64"><path d="M32 44C20 34 16 24 20 12c4 2 8 6 12 12 4-6 8-10 12-12 4 12 0 22-12 32z" fill="#f472b6"/><path d="M32 44v14" stroke="#34d399" stroke-width="4" stroke-linecap="round"/></svg>' }
];
const EMOJI_STICKERS = ['🌸','💜','✨','🌷','🦋','🌈','☀️','🌙','💐','🍓','🎀','⭐','💖','🌿','🕊️','🌻'];

/* Verse of the day — 30 references with built-in fallback text (WEB wording) */
const VOTD = [
  { ref: 'John 3:16', text: 'For God so loved the world, that he gave his one and only Son, that whoever believes in him should not perish, but have eternal life.' },
  { ref: 'Psalm 23:1', text: 'The LORD is my shepherd; I shall not want.' },
  { ref: 'Proverbs 3:5', text: 'Trust in the LORD with all your heart, and don\'t lean on your own understanding.' },
  { ref: 'Philippians 4:13', text: 'I can do all things through Christ, who strengthens me.' },
  { ref: 'Jeremiah 29:11', text: 'For I know the thoughts that I think toward you, says the LORD, thoughts of peace, and not of evil, to give you hope and a future.' },
  { ref: 'Psalm 119:105', text: 'Your word is a lamp to my feet, and a light for my path.' },
  { ref: 'Romans 8:28', text: 'We know that all things work together for good for those who love God.' },
  { ref: 'Isaiah 41:10', text: 'Don\'t be afraid, for I am with you. Don\'t be dismayed, for I am your God. I will strengthen you. Yes, I will help you.' },
  { ref: 'Matthew 11:28', text: 'Come to me, all you who labor and are heavily burdened, and I will give you rest.' },
  { ref: 'Psalm 46:1', text: 'God is our refuge and strength, a very present help in trouble.' },
  { ref: 'Joshua 1:9', text: 'Be strong and courageous. Don\'t be afraid. Don\'t be dismayed, for the LORD your God is with you wherever you go.' },
  { ref: 'Proverbs 18:10', text: 'The name of the LORD is a strong tower: the righteous run to it, and are safe.' },
  { ref: 'Psalm 27:1', text: 'The LORD is my light and my salvation. Whom shall I fear?' },
  { ref: 'Lamentations 3:22-23', text: 'It is because of the LORD\'s loving kindnesses that we are not consumed, because his compassion doesn\'t fail. They are new every morning.' },
  { ref: '1 Corinthians 13:4', text: 'Love is patient and is kind. Love doesn\'t envy. Love doesn\'t brag, is not proud.' },
  { ref: 'Galatians 5:22-23', text: 'But the fruit of the Spirit is love, joy, peace, patience, kindness, goodness, faith, gentleness, and self-control.' },
  { ref: 'Psalm 34:8', text: 'Oh taste and see that the LORD is good. Blessed is the man who takes refuge in him.' },
  { ref: 'Matthew 6:33', text: 'But seek first God\'s Kingdom and his righteousness, and all these things will be given to you as well.' },
  { ref: 'Romans 15:13', text: 'Now may the God of hope fill you with all joy and peace in believing.' },
  { ref: 'Psalm 19:1', text: 'The heavens declare the glory of God. The expanse shows his handiwork.' },
  { ref: 'Isaiah 40:31', text: 'But those who wait for the LORD will renew their strength. They will mount up with wings like eagles.' },
  { ref: 'Philippians 4:6', text: 'In nothing be anxious, but in everything, by prayer and petition with thanksgiving, let your requests be made known to God.' },
  { ref: '1 Peter 5:7', text: 'casting all your worries on him, because he cares for you.' },
  { ref: 'Psalm 139:14', text: 'I will give thanks to you, for I am fearfully and wonderfully made.' },
  { ref: 'Hebrews 11:1', text: 'Now faith is assurance of things hoped for, proof of things not seen.' },
  { ref: '2 Timothy 1:7', text: 'For God didn\'t give us a spirit of fear, but of power, love, and self-control.' },
  { ref: 'Psalm 37:4', text: 'Delight yourself also in the LORD, and he will give you the desires of your heart.' },
  { ref: 'Matthew 5:16', text: 'Even so, let your light shine before men, that they may see your good works and glorify your Father who is in heaven.' },
  { ref: 'John 14:27', text: 'Peace I leave with you. My peace I give to you.' },
  { ref: 'Psalm 118:24', text: 'This is the day that the LORD has made. We will rejoice and be glad in it!' }
];

/* Reading plans — each plan keeps its own progress, so switching plans
   never loses where you were on another one. */
const PLANS = {
  john30: {
    id: 'john30', name: 'John + Psalms', emoji: '📖',
    subtitle: "John's Gospel + favorite Psalms, one reading a day.",
    days: [
      ...Array.from({ length: 21 }, (_, i) => ({ day: i + 1, title: 'Gospel of John ' + (i + 1), ref: 'John ' + (i + 1) })),
      { day: 22, title: 'Psalm 1 — the blessed life', ref: 'Psalm 1' },
      { day: 23, title: 'Psalm 19 — the heavens declare', ref: 'Psalm 19' },
      { day: 24, title: 'Psalm 23 — the Shepherd', ref: 'Psalm 23' },
      { day: 25, title: 'Psalm 27 — light & salvation', ref: 'Psalm 27' },
      { day: 26, title: 'Psalm 34 — taste and see', ref: 'Psalm 34' },
      { day: 27, title: 'Psalm 46 — our refuge', ref: 'Psalm 46' },
      { day: 28, title: 'Psalm 91 — under His wings', ref: 'Psalm 91' },
      { day: 29, title: 'Psalm 121 — my help comes', ref: 'Psalm 121' },
      { day: 30, title: 'Psalm 139 — wonderfully made', ref: 'Psalm 139' }
    ]
  },
  fresh7: {
    id: 'fresh7', name: 'Fresh Start', emoji: '🌱',
    subtitle: 'A gentle 7-day week to begin — one beloved verse a day.',
    days: [
      { day: 1, title: 'Psalm 23 — the Shepherd', ref: 'Psalm 23' },
      { day: 2, title: 'John 3:16 — God so loved', ref: 'John 3:16' },
      { day: 3, title: 'Philippians 4:13 — strength', ref: 'Philippians 4:13' },
      { day: 4, title: 'Proverbs 3:5 — trust', ref: 'Proverbs 3:5' },
      { day: 5, title: 'Romans 8:28 — all things for good', ref: 'Romans 8:28' },
      { day: 6, title: 'Matthew 11:28 — rest', ref: 'Matthew 11:28' },
      { day: 7, title: 'Jeremiah 29:11 — hope and a future', ref: 'Jeremiah 29:11' }
    ]
  },
  proverbs31: {
    id: 'proverbs31', name: 'Proverbs', emoji: '🦉',
    subtitle: 'One chapter of Proverbs a day — 31 days of wisdom.',
    days: Array.from({ length: 31 }, (_, i) => ({ day: i + 1, title: 'Proverbs ' + (i + 1), ref: 'Proverbs ' + (i + 1) }))
  },
  psalms14: {
    id: 'psalms14', name: 'Psalms of Comfort', emoji: '🕊️',
    subtitle: 'Two weeks of comfort and hope from the Psalms.',
    days: [
      { day: 1, title: 'Psalm 1 — the blessed life', ref: 'Psalm 1' },
      { day: 2, title: 'Psalm 19 — the heavens declare', ref: 'Psalm 19' },
      { day: 3, title: 'Psalm 23 — the Shepherd', ref: 'Psalm 23' },
      { day: 4, title: 'Psalm 27 — light & salvation', ref: 'Psalm 27' },
      { day: 5, title: 'Psalm 34 — taste and see', ref: 'Psalm 34' },
      { day: 6, title: 'Psalm 42 — thirsting for God', ref: 'Psalm 42' },
      { day: 7, title: 'Psalm 46 — our refuge', ref: 'Psalm 46' },
      { day: 8, title: 'Psalm 63 — my soul thirsts', ref: 'Psalm 63' },
      { day: 9, title: 'Psalm 84 — lovely dwelling', ref: 'Psalm 84' },
      { day: 10, title: 'Psalm 91 — under His wings', ref: 'Psalm 91' },
      { day: 11, title: 'Psalm 103 — bless the Lord', ref: 'Psalm 103' },
      { day: 12, title: 'Psalm 121 — my help comes', ref: 'Psalm 121' },
      { day: 13, title: 'Psalm 139 — wonderfully made', ref: 'Psalm 139' },
      { day: 14, title: 'Psalm 150 — praise Him', ref: 'Psalm 150' }
    ]
  }
};

/* ------------------------- state ------------------------- */
const defaultState = () => ({
  notes: [],       // {id,title,ref,text,thoughts,tags[],sticker,starred,createdAt,updatedAt}
  prayers: [],     // {id,text,answered,createdAt}
  gratitude: [],   // {id,text,createdAt}
  activity: {},    // {'YYYY-MM-DD': true}
  plan: { id: 'john30', done: { john30: {}, fresh7: {}, proverbs31: {}, psalms14: {} } },
  profile: { name: '', setupDone: false },
  theme: { preset: 'lavender', customAccent: '', font: 'Quicksand', dark: false, background: 'dots' }
});
let state = defaultState();

/* Migrate older saved state into the current shape (used by loadLocal
   and importData): old flat planDone → per-plan progress, old
   theme.pattern → theme.background. */
function migrateState(parsed) {
  const next = Object.assign(defaultState(), parsed);
  next.theme = Object.assign(defaultState().theme, parsed.theme || {});
  // theme.pattern (old) → theme.background
  if (!parsed.theme || parsed.theme.background == null) {
    const oldPattern = parsed.theme && parsed.theme.pattern;
    if (oldPattern && BACKGROUNDS[oldPattern]) next.theme.background = oldPattern;
  }
  if (!BACKGROUNDS[next.theme.background]) next.theme.background = 'dots';
  if (!THEMES[next.theme.preset]) next.theme.preset = 'lavender';
  // old flat planDone → per-plan progress on the default plan
  next.plan = Object.assign(defaultState().plan, parsed.plan || {});
  next.plan.done = Object.assign(defaultState().plan.done, (parsed.plan && parsed.plan.done) || {});
  if (parsed.planDone && Object.keys(parsed.planDone).length) {
    next.plan.done.john30 = Object.assign({}, next.plan.done.john30, parsed.planDone);
  }
  if (!PLANS[next.plan.id]) next.plan.id = 'john30';
  next.profile = Object.assign(defaultState().profile, parsed.profile || {});
  return next;
}

/* ------------------------- helpers ------------------------- */
const $ = (id) => document.getElementById(id);
const uid = () => 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const todayStr = (d = new Date()) =>
  d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const fmtDate = (ts) => new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add('hidden'), 2800);
}

/* ------------------------- persistence ------------------------- */
function saveLocal() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* storage full/blocked */ }
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return;
    state = migrateState(JSON.parse(raw));
  } catch (e) { /* corrupted storage — start fresh */ }
}

function fsCol(name) {
  return db.collection('users').doc(firebaseUser.uid).collection(name);
}
async function syncToFirestore() {
  if (!db || !firebaseUser) return;
  try {
    const batch = db.batch();
    for (const name of ['notes', 'prayers', 'gratitude']) {
      for (const item of state[name]) {
        batch.set(fsCol(name).doc(item.id), item, { merge: true });
      }
    }
    batch.set(db.collection('users').doc(firebaseUser.uid).collection('meta').doc('settings'),
      { theme: state.theme, activity: state.activity, plan: state.plan, profile: state.profile }, { merge: true });
    await batch.commit();
  } catch (e) { console.warn('Firestore sync failed:', e); }
}
async function deleteFromFirestore(name, id) {
  if (!db || !firebaseUser) return;
  try { await fsCol(name).doc(id).delete(); } catch (e) { /* ignore */ }
}
async function loadFromFirestore() {
  if (!db || !firebaseUser) return;
  try {
    const [n, p, g, meta] = await Promise.all([
      fsCol('notes').get(), fsCol('prayers').get(), fsCol('gratitude').get(),
      db.collection('users').doc(firebaseUser.uid).collection('meta').doc('settings').get()
    ]);
    const pick = (snap) => snap.docs.map((d) => d.data());
    const remote = { notes: pick(n), prayers: pick(p), gratitude: pick(g) };
    // Firestore wins when it has data; otherwise keep local.
    if (remote.notes.length || remote.prayers.length || remote.gratitude.length || meta.exists) {
      state.notes = remote.notes;
      state.prayers = remote.prayers;
      state.gratitude = remote.gratitude;
      if (meta.exists) {
        const m = meta.data();
        if (m.theme) state.theme = Object.assign(defaultState().theme, m.theme);
        if (m.activity) state.activity = m.activity;
        // new per-plan progress; fall back to the old flat planDone
        if (m.plan) {
          state.plan = Object.assign(defaultState().plan, m.plan);
          state.plan.done = Object.assign(defaultState().plan.done, m.plan.done || {});
          if (!PLANS[state.plan.id]) state.plan.id = 'john30';
        } else if (m.planDone) {
          state.plan.done.john30 = Object.assign({}, state.plan.done.john30, m.planDone);
        }
        if (m.profile) state.profile = Object.assign(defaultState().profile, m.profile);
        if (!BACKGROUNDS[state.theme.background]) state.theme.background = 'dots';
      }
      saveLocal();
    }
  } catch (e) { console.warn('Firestore load failed, using local data:', e); }
}
function persist() {
  saveLocal();
  syncToFirestore();
}

/* ------------------------- theme ------------------------- */
function currentColors() {
  const t = state.theme;
  const preset = THEMES[t.preset] || THEMES.lavender;
  const accent = t.customAccent || preset.accent;
  const soft = t.customAccent ? accent + '2e' : preset.soft;
  return {
    accent,
    soft: t.dark ? accent + '33' : soft,
    bg: t.dark ? DARK.bg : preset.bg,
    card: t.dark ? DARK.card : '#ffffff'
  };
}
function applyTheme() {
  const c = currentColors();
  const root = document.documentElement;
  root.style.setProperty('--accent', c.accent);
  root.style.setProperty('--accent-soft', c.soft);
  root.style.setProperty('--bg', c.bg);
  root.style.setProperty('--card', c.card);
  // liquid-glass tint + finger glow follow the theme accent
  root.style.setProperty('--glass-tint', c.accent + '4d');
  root.style.setProperty('--glass-glow', c.accent + '8c');
  root.dataset.theme = state.theme.dark ? 'dark' : 'light';
  document.body.dataset.background = state.theme.background || 'dots';
  document.body.style.fontFamily = "'" + state.theme.font + "', system-ui, sans-serif";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.accent);
  // sync settings UI
  const cc = $('customColor'); if (cc) cc.value = c.accent;
  const fs = $('fontSelect'); if (fs) fs.value = state.theme.font;
  const bs = $('backgroundSelect'); if (bs) bs.value = state.theme.background || 'dots';
  const dt = $('darkToggle'); if (dt) dt.checked = !!state.theme.dark;
  document.querySelectorAll('#themeSwatches .swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.theme.preset && !state.theme.customAccent);
  });
  document.querySelectorAll('#setupThemes .swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.theme.preset && !state.theme.customAccent);
  });
}
function buildThemeSwatches() {
  const wrap = $('themeSwatches');
  wrap.innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.dataset.preset = key;
    b.title = t.name;
    b.style.background = 'linear-gradient(135deg,' + t.accent + ',' + t.soft + ')';
    b.addEventListener('click', () => {
      state.theme.preset = key;
      state.theme.customAccent = '';
      applyTheme();
      persist();
    });
    wrap.appendChild(b);
  }
}

/* ------------------------- streak ------------------------- */
function computeStreak() {
  let count = 0;
  const d = new Date();
  if (!state.activity[todayStr(d)]) d.setDate(d.getDate() - 1); // streak can survive today so far
  while (state.activity[todayStr(d)]) {
    count++;
    d.setDate(d.getDate() - 1);
  }
  return count;
}
function recordActivity() {
  if (!state.activity[todayStr()]) {
    state.activity[todayStr()] = true;
    persist();
    renderStreak();
  }
}
function renderStreak() {
  const s = computeStreak();
  $('streakCount').textContent = s;
  $('homeStreak').textContent = s;
  $('homeStreakUnit').textContent = s === 1 ? 'day' : 'days';
}

/* ------------------------- auth ------------------------- */
let authMode = 'signin'; // or 'signup'
function showAuthError(msg) {
  const el = $('authError');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function friendlyAuthError(e) {
  const code = (e && e.code) || '';
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential'))
    return 'Hmm, that email or password doesn\'t match. Try again 💜';
  if (code.includes('email-already-in-use')) return 'That email already has an account — try signing in instead.';
  if (code.includes('weak-password')) return 'Password needs at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email doesn\'t look quite right.';
  if (code.includes('popup-closed')) return 'The Google window closed before finishing — try again.';
  if (code.includes('unauthorized-domain')) return 'This site isn\'t allowed for Google sign-in yet — add ppp65isking.github.io in Firebase → Authentication → Settings → Authorized domains.';
  return 'Something went wrong signing in. Please try again.';
}
let setupAutoShown = false;
function showApp() {
  $('authScreen').classList.add('hidden');
  $('app').classList.remove('hidden');
  const inLocal = !firebaseUser;
  const banner = $('localBanner');
  banner.classList.toggle('hidden', !inLocal);
  if (inLocal) {
    // Only mention the Firebase config when it genuinely isn't set up.
    banner.textContent = FIREBASE_READY
      ? '🌱 Local mode — your notes save on this device only. Sign in anytime to sync across devices.'
      : '🌱 Local mode — your notes save on this device only. Add your Firebase config to enable login & sync.';
  }
  const name = (state.profile && state.profile.name) || '';
  $('helloLine').textContent = firebaseUser
    ? 'welcome back, ' + (name || firebaseUser.displayName || firebaseUser.email || 'friend') + ' 🌷'
    : 'local mode — sign in to sync 🌷';
  $('accountLine').textContent = firebaseUser
    ? 'Signed in as ' + firebaseUser.email + ' — your data syncs across devices.'
    : 'Not signed in. Your notes live on this device only.';
  renderAll();
  // First launch: open the "Make it yours" setup once.
  if (!state.profile.setupDone && !setupAutoShown) {
    setupAutoShown = true;
    setTimeout(() => openSetup(), 400);
  }
}
function showAuthScreen() {
  $('app').classList.add('hidden');
  $('authScreen').classList.remove('hidden');
  $('localBanner').classList.add('hidden');
}
async function handleAuthSubmit() {
  const email = $('authEmail').value.trim();
  const password = $('authPassword').value;
  if (!email || !password) { showAuthError('Please enter an email and password.'); return; }
  if (!auth) { showAuthError('Sign-in isn\'t available in local mode.'); return; }
  $('authSubmit').disabled = true;
  try {
    if (authMode === 'signup') {
      await auth.createUserWithEmailAndPassword(email, password);
      toast('Welcome to the garden! 🌸');
    } else {
      await auth.signInWithEmailAndPassword(email, password);
      toast('Welcome back! 🌷');
    }
  } catch (e) {
    showAuthError(friendlyAuthError(e));
  } finally {
    $('authSubmit').disabled = false;
  }
}
async function handleGoogleSignIn() {
  if (!auth) { showAuthError('Google sign-in isn\'t available in local mode.'); return; }
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    // Popups don't work inside an installed PWA (standalone mode) — they open
    // and close instantly, and never come back. Redirect navigates the whole
    // app to Google and back, which works in the PWA and in the browser.
    await auth.signInWithRedirect(provider);
  } catch (e) {
    showAuthError(friendlyAuthError(e));
  }
}
function initAuth() {
  $('authSubmit').addEventListener('click', handleAuthSubmit);
  $('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
  $('googleBtn').addEventListener('click', handleGoogleSignIn);
  $('authToggle').addEventListener('click', () => {
    authMode = authMode === 'signin' ? 'signup' : 'signin';
    $('authSubmit').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
    $('authToggle').textContent = authMode === 'signup'
      ? 'Already have an account? Sign in' : 'New here? Create an account';
  });
  $('localBtn').addEventListener('click', () => {
    localModeChosen = true;
    showApp();
    toast('Local mode — notes save on this device 🌱');
  });
  $('signOutBtn').addEventListener('click', async () => {
    if (auth && firebaseUser) {
      await auth.signOut();
      toast('Signed out — see you soon! 👋');
    } else if (FIREBASE_READY && auth) {
      showAuthScreen();
    } else {
      toast('You\'re in local mode — there\'s no account to sign out of 🌱');
    }
  });
  if (auth) {
    auth.onAuthStateChanged(async (user) => {
      firebaseUser = user;
      if (user) {
        await loadFromFirestore();
        showApp();
      } else if (!localModeChosen) {
        showAuthScreen();
      }
    });
    // After a Google redirect sign-in, Firebase finishes it when the app reloads.
    // Surface any error (e.g. domain not authorized) instead of failing silently.
    auth.getRedirectResult().catch((e) => showAuthError(friendlyAuthError(e)));
  }
}

/* ------------------------- verse lookup (3 sources, rotating + fallback) -------------------------
   Verse text comes from three free, key-free Bible APIs. Each fetchVerse() call
   starts at a different source (round-robin, so requests spread out and no one
   service takes all the traffic) and falls through the others if one fails,
   is rate-limited, or returns nothing. Real app use is one fetch at a time,
   so rate limits are unlikely — the chain is belt-and-braces.
   1. bible-api.com (WEB) — https://bible-api.com/{ref}
   2. labs.bible.org (NET) — https://labs.bible.org/api/?passage={ref}&type=json
   3. api.getbible.net (KJV) — https://api.getbible.net/v2/kjv/{bookNr}/{chapter}.json
   All three return { reference, text }. */
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
  return {
    bookNr, chapter: +m[3],
    verseStart: m[4] ? +m[4] : null,
    verseEnd: m[5] ? +m[5] : null
  };
}
async function fetchFromBibleApi(ref) {
  const url = 'https://bible-api.com/' + encodeURIComponent(ref.trim());
  const res = await fetch(url);
  if (!res.ok) throw new Error('bible-api: HTTP ' + res.status);
  const data = await res.json();
  return { reference: data.reference, text: (data.text || '').trim() };
}
async function fetchFromBibleOrg(ref) {
  const url = 'https://labs.bible.org/api/?passage=' + encodeURIComponent(ref.trim()) + '&type=json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('bible.org: HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('bible.org: no verses');
  const text = data.map((v) => (v.text || '').trim()).join(' ');
  const first = data[0], last = data[data.length - 1];
  const reference = first.bookname + ' ' + first.chapter + ':' + first.verse +
    (data.length > 1 ? '-' + last.verse : '');
  return { reference, text: text.trim() };
}
async function fetchFromGetBible(ref) {
  const p = parseRef(ref);
  const url = 'https://api.getbible.net/v2/kjv/' + p.bookNr + '/' + p.chapter + '.json';
  const res = await fetch(url);
  if (!res.ok) throw new Error('getbible: HTTP ' + res.status);
  const data = await res.json();
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

/* ------------------------- verse of the day ------------------------- */
function votdEntry() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  const dayOfYear = Math.floor((now - start) / 86400000);
  return VOTD[dayOfYear % VOTD.length];
}
async function renderVOTD() {
  const entry = votdEntry();
  const today = todayStr();
  try {
    const cached = JSON.parse(localStorage.getItem(LS_VOTD) || 'null');
    if (cached && cached.date === today) {
      $('votdText').textContent = '"' + cached.text + '"';
      $('votdRef').textContent = '— ' + cached.ref;
      return;
    }
  } catch (e) { /* ignore bad cache */ }
  $('votdText').textContent = '"' + entry.text + '"';
  $('votdRef').textContent = '— ' + entry.ref;
  try {
    const live = await fetchVerse(entry.ref);
    $('votdText').textContent = '"' + live.text + '"';
    $('votdRef').textContent = '— ' + live.reference;
    localStorage.setItem(LS_VOTD, JSON.stringify({ date: today, ref: live.reference, text: live.text }));
  } catch (e) {
    // offline — the built-in text above stays, and we cache it so it is stable for the day
    try { localStorage.setItem(LS_VOTD, JSON.stringify({ date: today, ref: entry.ref, text: entry.text })); } catch (e2) { /* ignore */ }
  }
}

/* ------------------------- stickers ------------------------- */
function stickerById(id) {
  if (!id) return null;
  if (id.startsWith('svg:')) return STICKERS.find((s) => s.id === id.slice(4)) || null;
  if (id.startsWith('emoji:')) return { emoji: id.slice(6) };
  return null;
}
function stickerHTML(id, fallbackEmoji) {
  const s = stickerById(id);
  if (s && s.svg) return s.svg;
  if (s && s.emoji) return esc(s.emoji);
  return esc(fallbackEmoji || '🌸');
}
function stickerEmojiForCanvas(id) {
  const s = stickerById(id);
  if (s && s.emoji) return s.emoji;
  if (s) {
    const match = STICKERS.find((x) => x.id === id.slice(4));
    return match ? match.emoji : '🌸';
  }
  return '🌸';
}

/* ------------------------- notes ------------------------- */
let activeTag = 'all';
let favOnly = false;
let sortMode = 'new';
let editorSticker = 'svg:heart';

function allTags() {
  const set = new Set();
  state.notes.forEach((n) => (n.tags || []).forEach((t) => set.add(t)));
  return [...set].sort();
}
function renderTagChips() {
  const wrap = $('tagChips');
  wrap.innerHTML = '';
  // ⭐ Favorites filter chip
  const fav = document.createElement('button');
  fav.className = 'tag-chip' + (favOnly ? ' active' : '');
  fav.textContent = '⭐ Favorites';
  fav.addEventListener('click', () => { favOnly = !favOnly; renderNotes(); renderTagChips(); });
  wrap.appendChild(fav);
  const tags = ['all', ...allTags()];
  tags.forEach((tag) => {
    const b = document.createElement('button');
    b.className = 'tag-chip' + (tag === activeTag ? ' active' : '');
    b.textContent = tag === 'all' ? '✨ All' : '#' + tag;
    b.addEventListener('click', () => { activeTag = tag; renderNotes(); });
    wrap.appendChild(b);
  });
}
function renderNotes() {
  const q = ($('searchInput').value || '').toLowerCase();
  const grid = $('notesGrid');
  grid.innerHTML = '';
  const list = state.notes
    .filter((n) => {
      const hay = [n.title, n.ref, n.text, n.thoughts, (n.tags || []).join(' ')].join(' ').toLowerCase();
      const okQ = !q || hay.includes(q);
      const okTag = activeTag === 'all' || (n.tags || []).includes(activeTag);
      const okFav = !favOnly || !!n.starred;
      return okQ && okTag && okFav;
    })
    .sort((a, b) => {
      if (sortMode === 'old') return (a.updatedAt || 0) - (b.updatedAt || 0);
      if (sortMode === 'az') return (a.title || '').localeCompare(b.title || '');
      return (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  const hasNotes = state.notes.length > 0;
  $('notesEmpty').classList.toggle('hidden', hasNotes);
  $('notesNoMatch').classList.toggle('hidden', !(hasNotes && list.length === 0));
  list.forEach((n) => {
    const card = document.createElement('article');
    card.className = 'note-card' + (n.starred ? ' starred' : '');
    card.innerHTML =
      '<div class="note-sticker">' + stickerHTML(n.sticker) + '</div>' +
      '<h3>' + esc(n.title || 'Untitled') + '</h3>' +
      (n.ref ? '<p class="note-ref">' + esc(n.ref) + '</p>' : '') +
      (n.text ? '<p class="note-verse">"' + esc(n.text) + '"</p>' : '') +
      (n.thoughts ? '<p class="note-thoughts">' + esc(n.thoughts) + '</p>' : '') +
      ((n.tags && n.tags.length)
        ? '<div class="note-tags">' + n.tags.map((t) => '<span class="note-tag">#' + esc(t) + '</span>').join('') + '</div>'
        : '') +
      '<p class="note-date">' + fmtDate(n.updatedAt || n.createdAt) + '</p>' +
      '<div class="note-actions">' +
      '<button class="btn note-star' + (n.starred ? ' starred' : '') + '" data-act="star" title="Favorite">' + (n.starred ? '⭐' : '☆') + '</button>' +
      '<button class="btn" data-act="share">💌 Share</button>' +
      '<button class="btn" data-act="edit">✏️ Edit</button>' +
      '<button class="btn btn-danger" data-act="delete">🗑️</button>' +
      '</div>';
    card.querySelector('[data-act="star"]').addEventListener('click', () => {
      n.starred = !n.starred;
      persist();
      renderNotes();
      toast(n.starred ? 'Added to favorites ⭐' : 'Removed from favorites');
    });
    card.querySelector('[data-act="share"]').addEventListener('click', () => shareNote(n));
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openNoteEditor(n));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (!confirm('Delete this note?')) return;
      state.notes = state.notes.filter((x) => x.id !== n.id);
      deleteFromFirestore('notes', n.id);
      persist();
      renderNotes();
      renderTagChips();
      toast('Note deleted 🗑️');
    });
    grid.appendChild(card);
  });
}
function buildStickerPicker() {
  const wrap = $('stickerPicker');
  wrap.innerHTML = '';
  const addBtn = (value, inner) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.dataset.value = value;
    b.innerHTML = inner;
    b.addEventListener('click', () => {
      editorSticker = value;
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x.dataset.value === value));
    });
    wrap.appendChild(b);
    return b;
  };
  STICKERS.forEach((s) => addBtn('svg:' + s.id, s.svg));
  EMOJI_STICKERS.forEach((e) => addBtn('emoji:' + e, esc(e)));
  wrap.querySelectorAll('button').forEach((x) =>
    x.classList.toggle('selected', x.dataset.value === editorSticker));
}
function openNoteEditor(note) {
  buildStickerPicker();
  if (note) {
    $('noteModalTitle').textContent = 'Edit note ✏️';
    $('noteId').value = note.id;
    $('noteTitle').value = note.title || '';
    $('verseRef').value = note.ref || '';
    $('verseText').value = note.text || '';
    $('noteThoughts').value = note.thoughts || '';
    $('noteTags').value = (note.tags || []).join(', ');
    editorSticker = note.sticker || 'svg:heart';
    $('deleteNoteBtn').classList.remove('hidden');
  } else {
    $('noteModalTitle').textContent = 'New note 🌱';
    $('noteId').value = '';
    $('noteTitle').value = '';
    $('verseRef').value = '';
    $('verseText').value = '';
    $('noteThoughts').value = '';
    $('noteTags').value = '';
    editorSticker = 'svg:heart';
    $('deleteNoteBtn').classList.add('hidden');
  }
  document.querySelectorAll('#stickerPicker button').forEach((x) =>
    x.classList.toggle('selected', x.dataset.value === editorSticker));
  $('noteModal').classList.remove('hidden');
}
function closeNoteEditor() { $('noteModal').classList.add('hidden'); }
function saveNoteFromEditor() {
  const id = $('noteId').value || uid();
  const existing = state.notes.find((n) => n.id === id);
  const note = {
    id,
    title: $('noteTitle').value.trim() || 'Untitled',
    ref: $('verseRef').value.trim(),
    text: $('verseText').value.trim(),
    thoughts: $('noteThoughts').value.trim(),
    tags: $('noteTags').value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
    sticker: editorSticker,
    starred: existing ? !!existing.starred : false,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, note);
  else state.notes.push(note);
  persist();
  recordActivity();
  closeNoteEditor();
  renderNotes();
  renderTagChips();
  toast('Note saved! 💾');
}

/* ------------------------- prayers & gratitude ------------------------- */
function renderPrayers() {
  const list = $('prayerList');
  list.innerHTML = '';
  $('prayerEmpty').classList.toggle('hidden', state.prayers.length > 0);
  [...state.prayers].sort((a, b) => (a.answered - b.answered) || (b.createdAt - a.createdAt)).forEach((p) => {
    const li = document.createElement('li');
    if (p.answered) li.className = 'done';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!p.answered;
    cb.title = 'Mark as answered';
    cb.addEventListener('change', () => {
      p.answered = cb.checked;
      persist();
      if (p.answered) { recordActivity(); toast('Answered prayer! Praise God 🙌'); }
      renderPrayers();
    });
    const span = document.createElement('span');
    span.className = 'item-text';
    span.textContent = p.text;
    const date = document.createElement('span');
    date.className = 'item-date';
    date.textContent = fmtDate(p.createdAt);
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '🗑️';
    del.addEventListener('click', () => {
      state.prayers = state.prayers.filter((x) => x.id !== p.id);
      deleteFromFirestore('prayers', p.id);
      persist();
      renderPrayers();
    });
    li.append(cb, span, date, del);
    list.appendChild(li);
  });
}
function renderGratitude() {
  const list = $('gratList');
  list.innerHTML = '';
  $('gratEmpty').classList.toggle('hidden', state.gratitude.length > 0);
  [...state.gratitude].sort((a, b) => b.createdAt - a.createdAt).forEach((g) => {
    const li = document.createElement('li');
    const span = document.createElement('span');
    span.className = 'item-text';
    span.textContent = '💛 ' + g.text;
    const date = document.createElement('span');
    date.className = 'item-date';
    date.textContent = fmtDate(g.createdAt);
    const del = document.createElement('button');
    del.className = 'mini-btn';
    del.textContent = '🗑️';
    del.addEventListener('click', () => {
      state.gratitude = state.gratitude.filter((x) => x.id !== g.id);
      deleteFromFirestore('gratitude', g.id);
      persist();
      renderGratitude();
    });
    li.append(span, date, del);
    list.appendChild(li);
  });
}
function addGratitude(text) {
  const t = (text || '').trim();
  if (!t) return;
  state.gratitude.push({ id: uid(), text: t, createdAt: Date.now() });
  persist();
  recordActivity();
  renderGratitude();
}

/* ------------------------- reading plan ------------------------- */
function activePlan() {
  return PLANS[state.plan.id] || PLANS.john30;
}
function planDoneMap() {
  if (!state.plan.done[state.plan.id]) state.plan.done[state.plan.id] = {};
  return state.plan.done[state.plan.id];
}
function planProgress() {
  const plan = activePlan();
  const doneMap = planDoneMap();
  const done = plan.days.filter((p, i) => doneMap[i]).length;
  return { done, total: plan.days.length, pct: Math.round((done / plan.days.length) * 100) };
}
function buildPlanSelect() {
  const sel = $('planSelect');
  sel.innerHTML = '';
  for (const p of Object.values(PLANS)) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.emoji + ' ' + p.name + ' — ' + p.days.length + ' days';
    sel.appendChild(opt);
  }
  sel.value = state.plan.id;
}
function switchPlan(newId) {
  if (!PLANS[newId] || newId === state.plan.id) return;
  const current = activePlan();
  const next = PLANS[newId];
  const hasProgress = Object.keys(planDoneMap()).length > 0;
  if (hasProgress && !confirm(
    'Switch to the ' + next.name + ' plan? Your progress on ' + current.name +
    ' is saved — you can switch back anytime. The new plan starts fresh.')) {
    $('planSelect').value = state.plan.id;
    return;
  }
  state.plan.id = newId;
  planDoneMap();
  persist();
  renderPlan();
  toast('Switched to the ' + next.name + ' plan ' + next.emoji);
}
function renderPlan() {
  const plan = activePlan();
  const doneMap = planDoneMap();
  const { done, total, pct } = planProgress();
  $('planName').textContent = plan.emoji + ' ' + plan.name + ' plan';
  $('planSub').textContent = plan.subtitle;
  $('planBar').style.width = pct + '%';
  $('planBarMini').style.width = pct + '%';
  $('planText').textContent = done + ' of ' + total + ' days done';
  $('planPct').textContent = pct;
  const firstOpen = plan.days.findIndex((p, i) => !doneMap[i]);
  $('todayReading').textContent = firstOpen === -1
    ? 'You finished the whole plan! 🎉'
    : 'Day ' + plan.days[firstOpen].day + ': ' + plan.days[firstOpen].title + ' (' + plan.days[firstOpen].ref + ')';
  const list = $('planList');
  list.innerHTML = '';
  plan.days.forEach((p, i) => {
    const li = document.createElement('li');
    if (doneMap[i]) li.className = 'done';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!doneMap[i];
    cb.addEventListener('change', () => {
      doneMap[i] = cb.checked;
      if (cb.checked) recordActivity();
      persist();
      renderPlan();
    });
    const span = document.createElement('span');
    span.className = 'item-text';
    span.textContent = 'Day ' + p.day + ' — ' + p.title;
    const ref = document.createElement('span');
    ref.className = 'item-date';
    ref.textContent = p.ref;
    li.append(cb, span, ref);
    list.appendChild(li);
  });
}

/* ------------------------- share as image ------------------------- */
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(ctx, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}
async function shareNote(note) {
  const canvas = $('shareCanvas');
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const c = currentColors();
  try {
    await document.fonts.load('600 64px Caveat');
    await document.fonts.load('700 44px Quicksand');
  } catch (e) { /* fonts may already be loaded or unavailable offline */ }

  // background
  const grad = ctx.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, c.soft);
  grad.addColorStop(1, '#ffffff');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // soft decorative circles
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = c.accent;
  [[120, 140, 130], [960, 260, 90], [920, 1180, 150], [150, 1150, 80]].forEach(([x, y, r]) => {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  });
  ctx.globalAlpha = 1;
  // white card
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(ctx, 70, 90, W - 140, H - 180, 48);
  ctx.fill();

  let y = 250;
  // sticker emoji
  ctx.font = '150px serif';
  ctx.textAlign = 'center';
  ctx.fillText(stickerEmojiForCanvas(note.sticker), W / 2, y);
  y += 130;
  // verse text
  ctx.fillStyle = '#3b3345';
  ctx.font = '600 62px Caveat, cursive';
  const verseLines = wrapText(ctx, '"' + (note.text || note.title || '') + '"', W - 260);
  verseLines.slice(0, 8).forEach((line) => { ctx.fillText(line, W / 2, y); y += 78; });
  // reference
  if (note.ref) {
    y += 20;
    ctx.fillStyle = c.accent;
    ctx.font = '700 46px Quicksand, sans-serif';
    ctx.fillText(note.ref, W / 2, y);
    y += 80;
  }
  // thoughts
  if (note.thoughts) {
    ctx.fillStyle = '#6b6480';
    ctx.font = '500 44px Caveat, cursive';
    const tLines = wrapText(ctx, note.thoughts, W - 300);
    tLines.slice(0, 5).forEach((line) => { ctx.fillText(line, W / 2, y); y += 58; });
  }
  // footer
  ctx.fillStyle = c.accent;
  ctx.font = '700 34px Quicksand, sans-serif';
  ctx.fillText('Verse Garden 🌸', W / 2, H - 130);

  $('shareModal').classList.remove('hidden');
}
function downloadShare() {
  const canvas = $('shareCanvas');
  canvas.toBlob((blob) => {
    if (!blob) { toast('Couldn\'t make the image — try again.'); return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'verse-garden.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast('Image downloaded! 💌');
  }, 'image/png');
}

/* ------------------------- export / import ------------------------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'verse-garden-backup-' + todayStr() + '.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('Backup downloaded! 💾');
}
function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== 'object') throw new Error('bad file');
      state = migrateState(parsed);
      persist();
      applyTheme();
      renderAll();
      toast('Data restored! 🌸');
    } catch (e) {
      toast('That file doesn\'t look like a Verse Garden backup.');
    }
  };
  reader.readAsText(file);
}

/* ------------------------- "Make it yours" setup flow -------------------------
   First launch (or Settings → Redo my setup): name → theme → background
   → reading plan. Theme/background apply live as you pick them. Skipping
   is always allowed; prefs save locally and to Firestore when signed in. */
let setupStep = 1;
let setupPlanId = null;

function openSetup() {
  setupStep = 1;
  setupPlanId = state.plan.id;
  $('setupName').value = (state.profile && state.profile.name) || '';
  $('setupFont').value = state.theme.font;
  $('setupDark').checked = !!state.theme.dark;
  buildSetupThemes();
  buildSetupBackgrounds();
  buildSetupPlans();
  renderSetupStep();
  $('setupModal').classList.remove('hidden');
}
function closeSetup() { $('setupModal').classList.add('hidden'); }
function finishSetup() {
  state.profile.name = ($('setupName').value || '').trim();
  state.profile.setupDone = true;
  if (setupPlanId && PLANS[setupPlanId]) {
    state.plan.id = setupPlanId;
    planDoneMap();
  }
  persist();
  applyTheme();
  renderAll();
  closeSetup();
  toast('Your garden is ready! 🌸');
}
function renderSetupStep() {
  document.querySelectorAll('.setup-step').forEach((el) => {
    el.classList.toggle('hidden', +el.dataset.step !== setupStep);
  });
  document.querySelectorAll('#setupDots .setup-dot').forEach((dot, i) => {
    dot.classList.toggle('active', i + 1 === setupStep);
  });
  $('setupBackBtn').classList.toggle('hidden', setupStep === 1);
  $('setupNextBtn').textContent = setupStep === 4 ? 'Start my garden 🌸' : 'Next →';
}
function buildSetupThemes() {
  const wrap = $('setupThemes');
  wrap.innerHTML = '';
  for (const [key, t] of Object.entries(THEMES)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.dataset.preset = key;
    b.title = t.name;
    b.style.background = 'linear-gradient(135deg,' + t.accent + ',' + t.soft + ')';
    b.addEventListener('click', () => {
      state.theme.preset = key;
      state.theme.customAccent = '';
      applyTheme();
      persist();
    });
    wrap.appendChild(b);
  }
  applyTheme();
}
function buildSetupBackgrounds() {
  const wrap = $('setupBackgrounds');
  wrap.innerHTML = '';
  for (const [key, b] of Object.entries(BACKGROUNDS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'setup-option' + (state.theme.background === key ? ' selected' : '');
    btn.innerHTML = '<span class="opt-emoji">' + b.emoji + '</span>' +
      '<span><span class="opt-name">' + esc(b.name) + '</span>' +
      '<span class="opt-sub" style="display:block;">' +
      (key === 'gradient' ? 'Soft color wash using your theme' : 'Subtle texture behind everything') +
      '</span></span>';
    btn.addEventListener('click', () => {
      state.theme.background = key;
      applyTheme();
      persist();
      wrap.querySelectorAll('.setup-option').forEach((x) => x.classList.remove('selected'));
      btn.classList.add('selected');
    });
    wrap.appendChild(btn);
  }
}
function buildSetupPlans() {
  const wrap = $('setupPlans');
  wrap.innerHTML = '';
  for (const p of Object.values(PLANS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'setup-option' + (setupPlanId === p.id ? ' selected' : '');
    btn.innerHTML = '<span class="opt-emoji">' + p.emoji + '</span>' +
      '<span><span class="opt-name">' + esc(p.name) + ' — ' + p.days.length + ' days</span>' +
      '<span class="opt-sub" style="display:block;">' + esc(p.subtitle) + '</span></span>';
    btn.addEventListener('click', () => {
      setupPlanId = p.id;
      wrap.querySelectorAll('.setup-option').forEach((x) => x.classList.remove('selected'));
      btn.classList.add('selected');
    });
    wrap.appendChild(btn);
  }
}

/* ------------------------- liquid-glass nav: slide lens -------------------------
   Drag a finger across the bottom bar and a glass "lens" pill follows it,
   with a soft glow under the finger; on release it snaps to the nearest
   tab and switches to it. Short taps still work exactly as before — the
   click that follows a drag is swallowed so it can't double-switch. */
let navDrag = null;
let navDragged = false;

function nearestTabBtn(x) {
  const btns = [...document.querySelectorAll('#bottomNav .tab-btn')];
  let best = null, bestD = Infinity;
  for (const b of btns) {
    const c = b.offsetLeft + b.offsetWidth / 2;
    const d = Math.abs(c - x);
    if (d < bestD) { bestD = d; best = b; }
  }
  return best;
}
function positionNavLens(animate) {
  const nav = $('bottomNav');
  const lens = $('navLens');
  const active = nav ? nav.querySelector('.tab-btn.active') : null;
  if (!nav || !lens || !active) return;
  lens.style.transition = animate ? '' : 'none';
  lens.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  lens.style.width = active.offsetWidth + 'px';
}
function initNavSlide() {
  const nav = $('bottomNav');
  if (!nav) return;
  nav.addEventListener('pointerdown', (e) => {
    navDrag = { x0: e.clientX, moved: false, pointerId: e.pointerId };
    try { nav.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
  });
  nav.addEventListener('pointermove', (e) => {
    if (!navDrag || e.pointerId !== navDrag.pointerId) return;
    if (!navDrag.moved && Math.abs(e.clientX - navDrag.x0) < 8) return;
    navDrag.moved = true;
    navDragged = true;
    const rect = nav.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    const lens = $('navLens');
    const w = lens.offsetWidth || 60;
    lens.style.transition = 'none';
    lens.style.transform = 'translateX(' +
      Math.min(Math.max(x - w / 2, 4), rect.width - w - 4) + 'px)';
    const glow = $('navGlow');
    glow.style.opacity = '1';
    glow.style.transform = 'translate(' + (x - 32) + 'px, -50%)';
    const nearest = nearestTabBtn(x);
    nav.querySelectorAll('.tab-btn').forEach((b) =>
      b.classList.toggle('slide-hover', b === nearest));
  });
  const endDrag = (e) => {
    if (!navDrag || (e.pointerId !== undefined && e.pointerId !== navDrag.pointerId)) return;
    const wasDrag = navDrag.moved;
    const rect = nav.getBoundingClientRect();
    const x = Math.min(Math.max(e.clientX - rect.left, 0), rect.width);
    navDrag = null;
    $('navGlow').style.opacity = '0';
    nav.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('slide-hover'));
    if (wasDrag) {
      const btn = nearestTabBtn(x);
      if (btn) switchTab(btn.dataset.tab);
      positionNavLens(true);
      // The tap-click after a drag is swallowed by the capture handler
      // below; clear the flag shortly after as a safety net.
      setTimeout(() => { navDragged = false; }, 300);
    }
  };
  nav.addEventListener('pointerup', endDrag);
  nav.addEventListener('pointercancel', () => {
    navDrag = null;
    $('navGlow').style.opacity = '0';
    nav.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('slide-hover'));
    positionNavLens(true);
  });
  // Swallow the click that follows a drag (capture phase runs first).
  nav.addEventListener('click', (e) => {
    if (navDragged) { e.stopPropagation(); e.preventDefault(); navDragged = false; }
  }, true);
  window.addEventListener('resize', () => positionNavLens(false));
  window.addEventListener('load', () => positionNavLens(false));
  requestAnimationFrame(() => positionNavLens(false));
}

/* ------------------------- tabs & render-all ------------------------- */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach((s) =>
    s.classList.toggle('hidden', s.id !== 'tab-' + name));
  if (name === 'plan') renderPlan();
  if (name === 'notes') { renderNotes(); renderTagChips(); }
  positionNavLens(true);
}
function renderAll() {
  applyTheme();
  buildPlanSelect();
  renderStreak();
  renderVOTD();
  renderNotes();
  renderTagChips();
  renderPrayers();
  renderGratitude();
  renderPlan();
}

/* ------------------------- PWA ------------------------- */
let deferredPrompt = null;
function initPWA() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline or file:// — app still works */ });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    $('installBanner').classList.remove('hidden');
  });
  $('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    $('installBanner').classList.add('hidden');
  });
  $('installDismiss').addEventListener('click', () => $('installBanner').classList.add('hidden'));
  $('iosDismiss').addEventListener('click', () => $('iosHint').classList.add('hidden'));
  // iOS Safari has no beforeinstallprompt — show the manual hint instead.
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isStandalone = window.navigator.standalone === true
    || window.matchMedia('(display-mode: standalone)').matches;
  if (isIOS && !isStandalone) $('iosHint').classList.remove('hidden');
  window.addEventListener('appinstalled', () => {
    $('installBanner').classList.add('hidden');
    toast('Verse Garden installed! 🌸');
  });
}

/* ------------------------- wire up UI ------------------------- */
function initUI() {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => switchTab(b.dataset.tab)));

  $('newNoteBtn').addEventListener('click', () => openNoteEditor(null));
  $('closeNoteBtn').addEventListener('click', closeNoteEditor);
  $('noteModal').addEventListener('click', (e) => { if (e.target === $('noteModal')) closeNoteEditor(); });
  $('saveNoteBtn').addEventListener('click', saveNoteFromEditor);
  $('deleteNoteBtn').addEventListener('click', () => {
    const id = $('noteId').value;
    if (!id || !confirm('Delete this note?')) return;
    state.notes = state.notes.filter((x) => x.id !== id);
    deleteFromFirestore('notes', id);
    persist();
    closeNoteEditor();
    renderNotes();
    renderTagChips();
    toast('Note deleted 🗑️');
  });
  $('searchInput').addEventListener('input', renderNotes);
  $('sortSelect').addEventListener('change', (e) => {
    sortMode = e.target.value;
    renderNotes();
  });

  $('planSelect').addEventListener('change', (e) => switchPlan(e.target.value));

  // "Make it yours" setup flow
  $('redoSetupBtn').addEventListener('click', () => openSetup());
  $('setupBackBtn').addEventListener('click', () => {
    if (setupStep > 1) { setupStep--; renderSetupStep(); }
  });
  $('setupNextBtn').addEventListener('click', () => {
    if (setupStep < 4) { setupStep++; renderSetupStep(); }
    else finishSetup();
  });
  $('setupSkipBtn').addEventListener('click', () => {
    state.profile.setupDone = true;
    persist();
    closeSetup();
  });
  $('setupFont').addEventListener('change', (e) => {
    state.theme.font = e.target.value;
    applyTheme();
    persist();
  });
  $('setupDark').addEventListener('change', (e) => {
    state.theme.dark = e.target.checked;
    applyTheme();
    persist();
  });

  // Liquid-glass nav: sliding lens
  initNavSlide();

  $('lookupBtn').addEventListener('click', async () => {
    const ref = $('verseRef').value.trim();
    if (!ref) { toast('Type a verse reference first — e.g. John 3:16'); return; }
    $('lookupBtn').disabled = true;
    $('lookupBtn').textContent = '…';
    try {
      const v = await fetchVerse(ref);
      $('verseRef').value = v.reference;
      $('verseText').value = v.text;
      toast('Verse found! ✨');
    } catch (e) {
      toast('Couldn\'t fetch that verse — check the reference or your connection.');
    } finally {
      $('lookupBtn').disabled = false;
      $('lookupBtn').textContent = '🔍 Look up';
    }
  });

  $('votdSaveBtn').addEventListener('click', () => {
    const text = $('votdText').textContent.replace(/^"|"$/g, '');
    const ref = $('votdRef').textContent.replace(/^— /, '');
    openNoteEditor(null);
    $('verseRef').value = ref;
    $('verseText').value = text;
    $('noteTitle').value = 'Verse of the day';
  });

  $('addPrayerBtn').addEventListener('click', () => {
    const t = $('prayerInput').value.trim();
    if (!t) return;
    state.prayers.push({ id: uid(), text: t, answered: false, createdAt: Date.now() });
    $('prayerInput').value = '';
    persist();
    recordActivity();
    renderPrayers();
  });
  $('prayerInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addPrayerBtn').click(); });

  const addGrat = () => {
    addGratitude($('gratInput').value);
    $('gratInput').value = '';
  };
  $('addGratBtn').addEventListener('click', addGrat);
  $('gratInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') addGrat(); });
  $('quickGratBtn').addEventListener('click', () => {
    addGratitude($('quickGratInput').value);
    $('quickGratInput').value = '';
    toast('Added to your gratitude jar 💛');
  });

  $('todayCheckBtn').addEventListener('click', () => {
    const plan = activePlan();
    const doneMap = planDoneMap();
    const firstOpen = plan.days.findIndex((p, i) => !doneMap[i]);
    if (firstOpen === -1) { toast('You finished the whole plan! 🎉'); return; }
    doneMap[firstOpen] = true;
    recordActivity();
    persist();
    renderPlan();
    toast('Day ' + plan.days[firstOpen].day + ' done — nice! 📖');
  });

  $('customColor').addEventListener('input', (e) => {
    state.theme.customAccent = e.target.value;
    applyTheme();
    persist();
  });
  $('fontSelect').addEventListener('change', (e) => {
    state.theme.font = e.target.value;
    applyTheme();
    persist();
  });
  $('backgroundSelect').addEventListener('change', (e) => {
    state.theme.background = e.target.value;
    applyTheme();
    persist();
  });
  $('darkToggle').addEventListener('change', (e) => {
    state.theme.dark = e.target.checked;
    applyTheme();
    persist();
  });

  $('exportBtn').addEventListener('click', exportData);
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  $('closeShareBtn').addEventListener('click', () => $('shareModal').classList.add('hidden'));
  $('shareModal').addEventListener('click', (e) => { if (e.target === $('shareModal')) $('shareModal').classList.add('hidden'); });
  $('downloadShareBtn').addEventListener('click', downloadShare);
}

/* ------------------------- init ------------------------- */
loadLocal();
buildThemeSwatches();
applyTheme();
initAuth();
initUI();
initPWA();

// No Firebase config yet (or Firebase failed) → straight into local mode.
if (!auth) {
  showApp();
}
