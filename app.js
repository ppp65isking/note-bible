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
/* ★ GOOGLE SIGN-IN FROM THE INSTALLED APP (FedCM) ★
   The installed PWA can't use the plain redirect flow (see
   handleGoogleSignIn). On Android Chrome it can instead sign in with
   FedCM — Google's account sheet opens inside the app, no redirect —
   but that needs this app's *Web* OAuth client ID:
   Google Cloud Console (console.cloud.google.com) → your project
   "verse-notes" → APIs & Services → Credentials → OAuth 2.0 Client IDs
   → "Web client (auto created by Google Service)" → copy its Client ID
   (looks like 243077023128-xxxx.apps.googleusercontent.com) and paste it
   here. While this is empty, Android falls back to the browser-tab path
   and iOS goes straight to it. */
const GOOGLE_CLIENT_ID = '243077023128-n1pb3bcqtur0cuhgeep3eq3c4iasrf30.apps.googleusercontent.com'; // Web OAuth client for project verse-notes (from google-services.json, client_type 3) — enables FedCM Google sign-in inside the Android installed PWA
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

/* ------------------------- Capacitor (native Android shell) -------------------------
   When the app runs inside the native Android app, the Capacitor runtime
   injects window.Capacitor into the WebView. On the web (GitHub Pages) it
   doesn't exist — so EVERY native call below is guarded by IS_NATIVE and
   the web build is completely untouched. Native-only features:
   fingerprint/face unlock, haptics, status-bar tint, splash screen. */
const CAP = (typeof window !== 'undefined' && window.Capacitor) || null;
const IS_NATIVE = !!(CAP && typeof CAP.getPlatform === 'function' && CAP.getPlatform() !== 'web');
/* Standalone (installed PWA) detection — the Google sign-in flow depends
   on it: a redirect that leaves the installed app can't reliably come
   back (see handleGoogleSignIn), so standalone gets the FedCM /
   browser-tab paths instead of the plain redirect. */
const IS_STANDALONE = (typeof window !== 'undefined') && (
  window.navigator.standalone === true ||
  (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches)
);
const IS_IOS = (typeof navigator !== 'undefined') && /iphone|ipad|ipod/i.test(navigator.userAgent);
const _nativePlugins = {};
function nativePlugin(name) {
  if (!IS_NATIVE || !CAP || typeof CAP.registerPlugin !== 'function') return null;
  if (!_nativePlugins[name]) {
    try { _nativePlugins[name] = CAP.registerPlugin(name); }
    catch (e) { return null; }
  }
  return _nativePlugins[name];
}
/* Light haptic tap — native only, silent no-op on the web. */
function nativeImpact(style) {
  const h = nativePlugin('Haptics');
  if (!h) return;
  try {
    const p = h.impact({ style: style || 'light' });
    if (p && p.catch) p.catch(() => { /* haptics unavailable */ });
  } catch (e) { /* ignore */ }
}
/* Native biometric unlock (fingerprint / face). Returns true on success.
   Falls back to the device PIN / pattern / password when the user taps it
   (allowDeviceCredential), and offers it even when no biometry is enrolled
   as long as the device itself is secured. False on cancel or failure. */
async function tryNativeBiometric() {
  const bio = nativePlugin('BiometricAuthNative');
  if (!bio) return false;
  try {
    const info = await bio.checkBiometry();
    if (!info || (!info.isAvailable && !info.deviceIsSecure)) return false;
    await bio.authenticate({
      reason: 'Unlock Verse Garden',
      cancelTitle: 'Use passcode',
      allowDeviceCredential: true,
      androidTitle: 'Unlock Verse Garden',
      androidSubtitle: 'Use your fingerprint or face to open your notes',
      androidConfirmationRequired: false,
    });
    return true;
  } catch (e) { return false; }
}
/* Status-bar tint follows the theme accent (native only). */
function nativeStatusBar() {
  const sb = nativePlugin('StatusBar');
  if (!sb) return;
  try {
    const p = sb.setBackgroundColor({ color: currentColors().accent });
    if (p && p.catch) p.catch(() => { /* ignore */ });
  } catch (e) { /* ignore */ }
}
/* Hide the launch splash once the app has rendered (native only).
   The splash is configured launchAutoHide:false so it stays up until here. */
function nativeSplashHide() {
  const sp = nativePlugin('SplashScreen');
  if (!sp) return;
  try {
    const p = sp.hide();
    if (p && p.catch) p.catch(() => { /* already hidden */ });
  } catch (e) { /* ignore */ }
}
/* Splash failsafe (native only): the app must NEVER strand on the launch
   logo. Boot hides the splash at the end, but if anything in boot throws
   first, this timer hides it anyway a few seconds later. On the web this
   is a no-op — nativeSplashHide() returns immediately when not native. */
if (IS_NATIVE) {
  setTimeout(() => { try { nativeSplashHide(); } catch (e) { /* ignore */ } }, 4000);
}

/* ------------------------- constants ------------------------- */
const LS_KEY = 'verseGarden.v1';
const LS_VOTD = 'verseGarden.votd.v1';
const LS_PIN = 'verseGarden.pin.v1';        // {salt, hash} — PIN hash only, never the PIN itself
const LS_GIPHY = 'verseGarden.giphyKey.v1'; // GIPHY API key, this device only — never synced/exported
const LS_BIBLE = 'verseGarden.bible.v1'; // last-read book + chapter, this device only
const LS_GOOGLE_RETURN = 'verseGarden.googleReturn.v1'; // timestamp set when a Google sign-in leaves the app for the browser

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

/* Diary moods + cover backgrounds. Cover backgrounds are diary-only
   (stars, sunshine, midnight…); `css` is used verbatim as the cover's
   background, so gradients and layered patterns both work. */
const DIARY_MOODS = ['😊', '😌', '🙏', '💜', '😢', '🎉', '😴', '🌸'];
const COVER_BGS = {
  lavenderDream: { name: 'Lavender dream', css: 'linear-gradient(160deg,#c4b5fd,#a78bfa 45%,#7c3aed)' },
  peachSunset: { name: 'Peach sunset', css: 'linear-gradient(160deg,#fdba74,#fb923c 45%,#f472b6)' },
  mintMeadow: { name: 'Mint meadow', css: 'linear-gradient(160deg,#6ee7b7,#10b981 45%,#0d9488)' },
  roseGarden: { name: 'Rose garden', css: 'linear-gradient(160deg,#f9a8d4,#f472b6 45%,#be185d)' },
  oceanWaves: { name: 'Ocean waves', css: 'linear-gradient(160deg,#7dd3fc,#38bdf8 45%,#0369a1)' },
  sunshine: { name: 'Sunshine', css: 'linear-gradient(160deg,#fde68a,#fbbf24 45%,#f59e0b)' },
  honeyGlow: { name: 'Honey glow', css: 'linear-gradient(160deg,#fde68a,#f59e0b 45%,#b45309)' },
  midnight: { name: 'Midnight stars', css: 'radial-gradient(circle at 20% 20%, rgba(255,255,255,.8) 0 2px, transparent 3px), radial-gradient(circle at 70% 28%, rgba(255,255,255,.7) 0 2px, transparent 3px), radial-gradient(circle at 40% 62%, rgba(255,255,255,.8) 0 2px, transparent 3px), radial-gradient(circle at 85% 72%, rgba(255,255,255,.6) 0 2px, transparent 3px), radial-gradient(circle at 55% 88%, rgba(255,255,255,.7) 0 2px, transparent 3px), linear-gradient(160deg,#312e81,#1e1b4b 60%,#0f0a2e)' }
};
function defaultCover() {
  return { bg: 'lavenderDream', title: 'My Diary', glitter: { on: false, color: '#fde047' }, stickers: [] };
}

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
  diary: [],       // {id,date,title,text,mood,createdAt,updatedAt}
  diaryCover: defaultCover(), // {bg,title,glitter:{on,color},stickers:[{kind,id,src,x,y,size,rot}]}
  activity: {},    // {'YYYY-MM-DD': true}
  plan: { id: 'john30', done: { john30: {}, fresh7: {}, proverbs31: {}, psalms14: {} } },
  profile: { name: '', setupDone: false },
  theme: { preset: 'lavender', customAccent: '', font: 'Quicksand', dark: false, background: 'dots', textSize: 'cozy' }
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
  // diary (new in this version) — older saves just start empty
  if (!Array.isArray(next.diary)) next.diary = [];
  if (!next.diaryCover || typeof next.diaryCover !== 'object') next.diaryCover = defaultCover();
  else {
    next.diaryCover = Object.assign(defaultCover(), next.diaryCover);
    if (!Array.isArray(next.diaryCover.stickers)) next.diaryCover.stickers = [];
    if (!COVER_BGS[next.diaryCover.bg]) next.diaryCover.bg = 'lavenderDream';
    if (!next.diaryCover.glitter || typeof next.diaryCover.glitter !== 'object')
      next.diaryCover.glitter = { on: false, color: '#fde047' };
  }
  if (!['cozy', 'compact'].includes(next.theme.textSize)) next.theme.textSize = 'cozy';
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
    for (const name of ['notes', 'prayers', 'gratitude', 'diary']) {
      for (const item of state[name]) {
        batch.set(fsCol(name).doc(item.id), item, { merge: true });
      }
    }
    batch.set(db.collection('users').doc(firebaseUser.uid).collection('meta').doc('settings'),
      { theme: state.theme, activity: state.activity, plan: state.plan, profile: state.profile, diaryCover: state.diaryCover }, { merge: true });
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
    const [n, p, g, d, meta] = await Promise.all([
      fsCol('notes').get(), fsCol('prayers').get(), fsCol('gratitude').get(), fsCol('diary').get(),
      db.collection('users').doc(firebaseUser.uid).collection('meta').doc('settings').get()
    ]);
    const pick = (snap) => snap.docs.map((d) => d.data());
    const remote = { notes: pick(n), prayers: pick(p), gratitude: pick(g), diary: pick(d) };
    // Firestore wins when it has data; otherwise keep local.
    if (remote.notes.length || remote.prayers.length || remote.gratitude.length || remote.diary.length || meta.exists) {
      state.notes = remote.notes;
      state.prayers = remote.prayers;
      state.gratitude = remote.gratitude;
      state.diary = remote.diary;
      if (meta.exists) {
        const m = meta.data();
        if (m.theme) state.theme = Object.assign(defaultState().theme, m.theme);
        if (m.diaryCover) {
          state.diaryCover = Object.assign(defaultCover(), m.diaryCover);
          if (!Array.isArray(state.diaryCover.stickers)) state.diaryCover.stickers = [];
          if (!COVER_BGS[state.diaryCover.bg]) state.diaryCover.bg = 'lavenderDream';
        }
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
  document.body.dataset.textsize = state.theme.textSize === 'compact' ? 'compact' : 'cozy';
  document.body.style.fontFamily = "'" + state.theme.font + "', system-ui, sans-serif";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', c.accent);
  // sync settings UI
  const cc = $('customColor'); if (cc) cc.value = c.accent;
  const fs = $('fontSelect'); if (fs) fs.value = state.theme.font;
  const ts = $('textSizeSelect'); if (ts) ts.value = state.theme.textSize === 'compact' ? 'compact' : 'cozy';
  const sa = $('setupAccent'); if (sa) sa.value = c.accent;
  const sts = $('setupTextSize'); if (sts) sts.value = state.theme.textSize === 'compact' ? 'compact' : 'cozy';
  const bs = $('backgroundSelect'); if (bs) bs.value = state.theme.background || 'dots';
  const dt = $('darkToggle'); if (dt) dt.checked = !!state.theme.dark;
  document.querySelectorAll('#themeSwatches .swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.theme.preset && !state.theme.customAccent);
  });
  document.querySelectorAll('#setupThemes .swatch').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.theme.preset && !state.theme.customAccent);
  });
  nativeStatusBar(); // native shell: tint the Android status bar to match the theme
}
function buildThemeSwatches() {
  const wrap = $('themeSwatches');
  if (!wrap) return; // boot guard: never let a missing element kill the launch
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
/* Home hero: time-aware greeting + your name + today's date. */
function renderHomeGreeting() {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const name = (state.profile && state.profile.name) || '';
  $('homeGreeting').textContent = part + ' 🌸';
  $('homeNameLine').textContent = name ? 'Welcome back, ' + name : 'Welcome back';
  $('homeDateLine').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
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
  const all = code + ' ' + String((e && e.message) || '');
  if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential'))
    return 'Hmm, that email or password doesn\'t match. Try again 💜';
  if (code.includes('email-already-in-use')) return 'That email already has an account — try signing in instead.';
  if (code.includes('weak-password')) return 'Password needs at least 6 characters.';
  if (code.includes('invalid-email')) return 'That email doesn\'t look quite right.';
  if (code.includes('popup-closed')) return 'The Google window closed before finishing — try again.';
  if (code.includes('unauthorized-domain')) return 'This site isn\'t allowed for Google sign-in yet — add ppp65isking.github.io in Firebase → Authentication → Settings → Authorized domains.';
  // Native Android: Google rejects the app when its signing key's SHA-1
  // isn't the one registered in Firebase (debug builds use a fresh key
  // every time until the release signing step lands).
  if (all.includes('DEVELOPER_ERROR') || all.includes('developer_error') || all.includes('DEVELOPER ERROR'))
    return 'Google sign-in isn\'t set up for this app build yet — email sign-in still works.';
  if (all.toLowerCase().includes('cancel'))
    return 'Sign-in was cancelled — no worries, try again whenever 💜';
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
  // Native Android app: the web redirect flow can't run inside the native
  // WebView — use the native Firebase Auth plugin instead.
  if (IS_NATIVE) { await handleNativeGoogleSignIn(); return; }
  // Regular browser tab (not installed): the redirect round-trip stays in
  // the same tab and completes — this is the verified-working path.
  if (!IS_STANDALONE) {
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithRedirect(provider);
    } catch (e) {
      showAuthError(friendlyAuthError(e));
    }
    return;
  }
  // Installed PWA: a redirect leaves the app for a browser tab and the
  // return trip can't reliably get back. What actually happens (verified
  // on Android, screen recording): the app opens a Chrome Custom Tab to
  // Google, the user picks an account, and the OS reopens the installed
  // app fresh — Firebase's pending redirect lives in the tab's
  // sessionStorage, which the fresh app window can't see, so
  // getRedirectResult finds nothing and the login screen just shows again.
  // (On iPhone it's the same, and the browser tab and the app don't even
  // share storage, so a browser-side sign-in can't carry over at all.)
  // Two in-app paths instead:
  //  1. FedCM (Android Chrome): Google's account sheet opens inside the
  //     app — no popup, no redirect. Needs GOOGLE_CLIENT_ID above.
  //  2. Otherwise: sign in in a real browser tab and come back — on
  //     Android the tab and the app share storage, so the app picks the
  //     session up (see armGoogleReturnPickup). On iPhone the sign-in
  //     stays in Safari, so the note says so plainly.
  if (!IS_IOS) {
    const fedcm = await tryFedcmGoogleSignIn();
    if (fedcm === 'signed-in') return;
    if (fedcm === 'error') return; // error already shown to the user
    // 'unavailable' (FedCM off, no Google session, origin not ready) —
    // don't leave the button looking dead: open the browser tab straight
    // away, where the redirect flow is the verified-working path, and
    // show the note too so there's always a visible way forward if the
    // tab gets blocked.
    toast('Opening your browser to sign in… 🌷');
    openBrowserSignIn();
  }
  showBrowserSigninNote();
}

/* ---- FedCM (Google Identity Services) — in-app Google sign-in for the
   Android installed PWA. FedCM shows Google's account sheet as browser
   UI inside the app (no popup, no redirect), and the ID token it returns
   is exchanged for a Firebase session right here. iOS Safari doesn't
   support FedCM at all, so this path is Android-only by design.
   Returns 'signed-in' | 'unavailable' | 'error'. */
let _gisLoadPromise = null;
function loadGisScript() {
  if (window.google && window.google.accounts && window.google.accounts.id) return Promise.resolve(true);
  if (_gisLoadPromise) return _gisLoadPromise;
  _gisLoadPromise = new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve(!!(window.google && window.google.accounts && window.google.accounts.id));
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return _gisLoadPromise;
}
async function tryFedcmGoogleSignIn() {
  if (!GOOGLE_CLIENT_ID) return 'unavailable';
  const gisReady = await loadGisScript();
  if (!gisReady) return 'unavailable';
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    let momentTimer = null;
    try {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        auto_select: false,
        use_fedcm_for_prompt: true,
        callback: async (response) => {
          const token = response && response.credential;
          if (!token) { done('unavailable'); return; }
          try {
            await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
            toast('Welcome back! 🌷');
            done('signed-in');
          } catch (e) {
            showAuthError(friendlyAuthError(e));
            done('error');
          }
        },
      });
      // The moment listener fires when the sheet shows, is skipped, or is
      // dismissed. If nothing fires at all (no Google session in this
      // profile, FedCM off), give up after a few seconds instead of hanging.
      momentTimer = setTimeout(() => done('unavailable'), 6000);
      window.google.accounts.id.prompt((n) => {
        if (!n) return;
        if (n.isNotDisplayed() || n.isSkippedMoment() || n.isDismissedMoment()) {
          clearTimeout(momentTimer);
          done('unavailable');
        } else {
          // Sheet is showing — stop the timer; the credential callback (or
          // a later dismiss moment) settles this from here.
          clearTimeout(momentTimer);
        }
      });
    } catch (e) {
      clearTimeout(momentTimer);
      done('unavailable');
    }
  });
}

/* ---- "Sign in in your browser" — the fallback for the installed PWA
   when FedCM isn't available (no client ID yet, FedCM off, or iOS).
   The sign-in runs in a real browser tab, where the redirect round-trip
   completes. On Android the tab and the app share storage, so when the
   user comes back the app picks the session up (armGoogleReturnPickup).
   On iPhone the tab and the app do NOT share storage, so the sign-in
   stays in Safari — the note says so plainly instead of promising a
   return that can't happen. */
function showBrowserSigninNote() {
  const note = $('browserSignin');
  const text = $('browserSigninText');
  if (!note || !text) return;
  text.textContent = IS_IOS
    ? 'On iPhone, Google sign-in opens in Safari and stays signed in there — you can keep using Verse Garden in Safari. Or sign in with email here, which works right in the app, no browser needed.'
    : 'Google sign-in opens in your browser. Sign in there, then come back here — you\'ll be logged in. (Email sign-in works right here in the app too.)';
  const openBtn = $('browserSigninOpen');
  if (openBtn) openBtn.textContent = IS_IOS ? 'Open in Safari to sign in' : 'Open in browser to sign in';
  note.classList.remove('hidden');
  const checkBtn = $('browserSigninCheck');
  if (checkBtn) {
    let pending = null;
    try { pending = localStorage.getItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
    checkBtn.classList.toggle('hidden', !pending);
  }
}
function openBrowserSignIn() {
  try { localStorage.setItem(LS_GOOGLE_RETURN, String(Date.now())); } catch (e) { /* private mode */ }
  const url = location.origin + location.pathname + '?signin=google';
  window.open(url, '_blank');
  const checkBtn = $('browserSigninCheck');
  if (checkBtn) checkBtn.classList.remove('hidden');
  armGoogleReturnPickup();
}

/* When a Google sign-in was started from the app (or its browser tab),
   the session lands in shared storage on Android — but the installed app,
   sitting on the login screen in the background, doesn't notice until it
   reloads. So while a return is pending, the first time the app becomes
   visible again it reloads once to pick the session up. The flag is
   cleared before reloading, so this can never loop. */
let _returnPickupArmed = false;
function armGoogleReturnPickup() {
  if (_returnPickupArmed) return;
  let pending = null;
  try { pending = localStorage.getItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
  if (!pending) return;
  const age = Date.now() - Number(pending || 0);
  if (!Number.isFinite(age) || age > 15 * 60 * 1000) {
    try { localStorage.removeItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
    return;
  }
  // Already signed in — the flag is stale.
  if (firebaseUser) {
    try { localStorage.removeItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
    return;
  }
  _returnPickupArmed = true;
  // A sign-in may already have finished in the browser — surface the
  // "check again" note so the user can pull the session in by hand if
  // the automatic reload below never gets a chance to fire.
  if (IS_STANDALONE) showBrowserSigninNote();
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    document.removeEventListener('visibilitychange', onVisible);
    try { localStorage.removeItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
    location.reload();
  };
  document.addEventListener('visibilitychange', onVisible);
}
/* Native Google sign-in (Android app only) via @capacitor-firebase/auth.
   The plugin signs into the NATIVE Firebase Auth; its ID token is then
   bridged into the web (compat) SDK so onAuthStateChanged + Firestore see
   the same user. Requires google-services.json in android/app/ (decoded
   from the ANDROID_GOOGLE_SERVICES_JSON secret at build time) and the
   app's signing SHA-1 registered in Firebase — until the APK is signed
   with that key, Google answers DEVELOPER_ERROR (see friendlyAuthError). */
async function handleNativeGoogleSignIn() {
  const fa = nativePlugin('FirebaseAuthentication');
  if (!fa) {
    showAuthError('Native Google sign-in isn\'t in this build yet — email sign-in works for now.');
    return;
  }
  try {
    const result = await fa.signInWithGoogle();
    // Bridge the native session into the web SDK.
    let token = result && result.credential && result.credential.idToken;
    if (!token) {
      const r = await fa.getIdToken();
      token = r && r.token;
    }
    if (token) {
      await auth.signInWithCredential(firebase.auth.GoogleAuthProvider.credential(token));
      toast('Welcome back! 🌷');
    } else if (result && result.user) {
      // Native sign-in worked but no token came back to bridge — the auth
      // state settles on the next launch; ask the user to reopen the app.
      toast('Signed in — reopen the app to finish setting up 🌷');
    } else {
      showAuthError('Google sign-in didn\'t finish — please try again.');
    }
  } catch (e) {
    showAuthError(friendlyAuthError(e));
  }
}
function initAuth() {
  $('authSubmit').addEventListener('click', handleAuthSubmit);
  $('authPassword').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAuthSubmit(); });
  $('googleBtn').addEventListener('click', handleGoogleSignIn);
  // Installed-app Google sign-in: the "open in browser" note (see
  // showBrowserSigninNote) and its buttons.
  const bsOpen = $('browserSigninOpen');
  if (bsOpen) bsOpen.addEventListener('click', openBrowserSignIn);
  const bsCheck = $('browserSigninCheck');
  if (bsCheck) bsCheck.addEventListener('click', () => location.reload());
  const bsHide = $('browserSigninHide');
  if (bsHide) bsHide.addEventListener('click', () => $('browserSignin').classList.add('hidden'));
  // In the installed app (not the native shell, which has its own Google
  // path), set expectations before the user taps Google.
  if (IS_STANDALONE && !IS_NATIVE) {
    const hint = $('standaloneHint');
    if (hint) hint.classList.remove('hidden');
  }
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
    // Opened in a browser tab to sign in with Google (the installed app's
    // "Open in browser" path appends ?signin=google): once auth state is
    // known and there's no user yet, start the redirect flow right away.
    // The param is stripped before redirecting, so the return URL is
    // clean and can't re-trigger. Never auto-starts inside the installed
    // app itself — that's the flow that can't complete.
    let authStateFirst = true;
    const browserSigninParams = new URLSearchParams(location.search);
    auth.onAuthStateChanged(async (user) => {
      firebaseUser = user;
      if (user) {
        try { localStorage.removeItem(LS_GOOGLE_RETURN); } catch (e) { /* ignore */ }
        await loadFromFirestore();
        showApp();
      } else if (!localModeChosen) {
        showAuthScreen();
      }
      if (authStateFirst) {
        authStateFirst = false;
        if (!user && browserSigninParams.get('signin') === 'google' && !IS_STANDALONE) {
          history.replaceState(null, '', location.pathname + location.hash);
          handleGoogleSignIn(); // non-standalone here → redirect flow
        }
      }
    });
    // After a Google redirect sign-in, Firebase finishes it when the app reloads.
    // Surface any error (e.g. domain not authorized) instead of failing silently.
    auth.getRedirectResult().catch((e) => showAuthError(friendlyAuthError(e)));
    // A Google sign-in may have finished in a browser tab while this app
    // sat on the login screen — reload to pick the session up on return.
    armGoogleReturnPickup();
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

/* ------------------------- interactive Bible -------------------------
   All 66 books with chapter counts, so the reader's pickers always offer
   exactly the right chapters. `key` matches BOOK_NR (used for the KJV
   getbible source); `name` is the display name used for the other two
   sources. Chapters are fetched through the same 3 free sources as verse
   lookups — no new APIs, no keys. Each source returns per-verse data,
   so the reader can number every verse. */
const BIBLE_BOOKS = [
  { name: 'Genesis', key: 'genesis', chapters: 50, testament: 'OT' },
  { name: 'Exodus', key: 'exodus', chapters: 40, testament: 'OT' },
  { name: 'Leviticus', key: 'leviticus', chapters: 27, testament: 'OT' },
  { name: 'Numbers', key: 'numbers', chapters: 36, testament: 'OT' },
  { name: 'Deuteronomy', key: 'deuteronomy', chapters: 34, testament: 'OT' },
  { name: 'Joshua', key: 'joshua', chapters: 24, testament: 'OT' },
  { name: 'Judges', key: 'judges', chapters: 21, testament: 'OT' },
  { name: 'Ruth', key: 'ruth', chapters: 4, testament: 'OT' },
  { name: '1 Samuel', key: '1 samuel', chapters: 31, testament: 'OT' },
  { name: '2 Samuel', key: '2 samuel', chapters: 24, testament: 'OT' },
  { name: '1 Kings', key: '1 kings', chapters: 22, testament: 'OT' },
  { name: '2 Kings', key: '2 kings', chapters: 25, testament: 'OT' },
  { name: '1 Chronicles', key: '1 chronicles', chapters: 29, testament: 'OT' },
  { name: '2 Chronicles', key: '2 chronicles', chapters: 36, testament: 'OT' },
  { name: 'Ezra', key: 'ezra', chapters: 10, testament: 'OT' },
  { name: 'Nehemiah', key: 'nehemiah', chapters: 13, testament: 'OT' },
  { name: 'Esther', key: 'esther', chapters: 10, testament: 'OT' },
  { name: 'Job', key: 'job', chapters: 42, testament: 'OT' },
  { name: 'Psalms', key: 'psalm', chapters: 150, testament: 'OT' },
  { name: 'Proverbs', key: 'proverbs', chapters: 31, testament: 'OT' },
  { name: 'Ecclesiastes', key: 'ecclesiastes', chapters: 12, testament: 'OT' },
  { name: 'Song of Solomon', key: 'song of solomon', chapters: 8, testament: 'OT' },
  { name: 'Isaiah', key: 'isaiah', chapters: 66, testament: 'OT' },
  { name: 'Jeremiah', key: 'jeremiah', chapters: 52, testament: 'OT' },
  { name: 'Lamentations', key: 'lamentations', chapters: 5, testament: 'OT' },
  { name: 'Ezekiel', key: 'ezekiel', chapters: 48, testament: 'OT' },
  { name: 'Daniel', key: 'daniel', chapters: 12, testament: 'OT' },
  { name: 'Hosea', key: 'hosea', chapters: 14, testament: 'OT' },
  { name: 'Joel', key: 'joel', chapters: 3, testament: 'OT' },
  { name: 'Amos', key: 'amos', chapters: 9, testament: 'OT' },
  { name: 'Obadiah', key: 'obadiah', chapters: 1, testament: 'OT' },
  { name: 'Jonah', key: 'jonah', chapters: 4, testament: 'OT' },
  { name: 'Micah', key: 'micah', chapters: 7, testament: 'OT' },
  { name: 'Nahum', key: 'nahum', chapters: 3, testament: 'OT' },
  { name: 'Habakkuk', key: 'habakkuk', chapters: 3, testament: 'OT' },
  { name: 'Zephaniah', key: 'zephaniah', chapters: 3, testament: 'OT' },
  { name: 'Haggai', key: 'haggai', chapters: 2, testament: 'OT' },
  { name: 'Zechariah', key: 'zechariah', chapters: 14, testament: 'OT' },
  { name: 'Malachi', key: 'malachi', chapters: 4, testament: 'OT' },
  { name: 'Matthew', key: 'matthew', chapters: 28, testament: 'NT' },
  { name: 'Mark', key: 'mark', chapters: 16, testament: 'NT' },
  { name: 'Luke', key: 'luke', chapters: 24, testament: 'NT' },
  { name: 'John', key: 'john', chapters: 21, testament: 'NT' },
  { name: 'Acts', key: 'acts', chapters: 28, testament: 'NT' },
  { name: 'Romans', key: 'romans', chapters: 16, testament: 'NT' },
  { name: '1 Corinthians', key: '1 corinthians', chapters: 16, testament: 'NT' },
  { name: '2 Corinthians', key: '2 corinthians', chapters: 13, testament: 'NT' },
  { name: 'Galatians', key: 'galatians', chapters: 6, testament: 'NT' },
  { name: 'Ephesians', key: 'ephesians', chapters: 6, testament: 'NT' },
  { name: 'Philippians', key: 'philippians', chapters: 4, testament: 'NT' },
  { name: 'Colossians', key: 'colossians', chapters: 4, testament: 'NT' },
  { name: '1 Thessalonians', key: '1 thessalonians', chapters: 5, testament: 'NT' },
  { name: '2 Thessalonians', key: '2 thessalonians', chapters: 3, testament: 'NT' },
  { name: '1 Timothy', key: '1 timothy', chapters: 6, testament: 'NT' },
  { name: '2 Timothy', key: '2 timothy', chapters: 4, testament: 'NT' },
  { name: 'Titus', key: 'titus', chapters: 3, testament: 'NT' },
  { name: 'Philemon', key: 'philemon', chapters: 1, testament: 'NT' },
  { name: 'Hebrews', key: 'hebrews', chapters: 13, testament: 'NT' },
  { name: 'James', key: 'james', chapters: 5, testament: 'NT' },
  { name: '1 Peter', key: '1 peter', chapters: 5, testament: 'NT' },
  { name: '2 Peter', key: '2 peter', chapters: 3, testament: 'NT' },
  { name: '1 John', key: '1 john', chapters: 5, testament: 'NT' },
  { name: '2 John', key: '2 john', chapters: 1, testament: 'NT' },
  { name: '3 John', key: '3 john', chapters: 1, testament: 'NT' },
  { name: 'Jude', key: 'jude', chapters: 1, testament: 'NT' },
  { name: 'Revelation', key: 'revelation', chapters: 22, testament: 'NT' }
];
async function fetchChapterFromBibleApi(book, chapter) {
  const res = await fetch('https://bible-api.com/' + encodeURIComponent(book + ' ' + chapter));
  if (!res.ok) throw new Error('bible-api: HTTP ' + res.status);
  const data = await res.json();
  let verses = (data.verses || [])
    .map((v) => ({ n: v.verse, text: (v.text || '').trim() }))
    .filter((v) => v.n != null && v.text);
  if (!verses.length && data.text) {
    // Fallback if a source ever drops the per-verse array: split the
    // chapter text into lines and strip leading verse numbers.
    verses = String(data.text).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const m = l.match(/^(\d+)\s+(.*)$/);
      return m ? { n: +m[1], text: m[2].trim() } : { n: i + 1, text: l };
    });
  }
  if (!verses.length) throw new Error('bible-api: no verses');
  return { reference: data.reference || (book + ' ' + chapter), verses };
}
async function fetchChapterFromBibleOrg(book, chapter) {
  const res = await fetch('https://labs.bible.org/api/?passage=' + encodeURIComponent(book + ' ' + chapter) + '&type=json');
  if (!res.ok) throw new Error('bible.org: HTTP ' + res.status);
  const data = await res.json();
  if (!Array.isArray(data) || !data.length) throw new Error('bible.org: no verses');
  const verses = data.map((v) => ({ n: +v.verse, text: (v.text || '').trim() })).filter((v) => v.text);
  if (!verses.length) throw new Error('bible.org: no verses');
  return { reference: data[0].bookname + ' ' + data[0].chapter, verses };
}
async function fetchChapterFromGetBible(book, chapter) {
  const p = parseRef(book + ' ' + chapter);
  const res = await fetch('https://api.getbible.net/v2/kjv/' + p.bookNr + '/' + p.chapter + '.json');
  if (!res.ok) throw new Error('getbible: HTTP ' + res.status);
  const data = await res.json();
  const verses = (data.verses || [])
    .map((v) => ({ n: v.verse, text: (v.text || '').trim() }))
    .filter((v) => v.text);
  if (!verses.length) throw new Error('getbible: no verses');
  return { reference: data.book_name + ' ' + p.chapter, verses };
}
const CHAPTER_SOURCES = [
  { name: 'bible-api', fetch: fetchChapterFromBibleApi },
  { name: 'bible.org', fetch: fetchChapterFromBibleOrg },
  { name: 'getbible', fetch: fetchChapterFromGetBible }
];
let chapterSourceCursor = 0;
async function fetchChapter(book, chapter) {
  const start = chapterSourceCursor++ % CHAPTER_SOURCES.length;
  const errors = [];
  for (let i = 0; i < CHAPTER_SOURCES.length; i++) {
    const src = CHAPTER_SOURCES[(start + i) % CHAPTER_SOURCES.length];
    try {
      const out = await src.fetch(book, chapter);
      if (out && out.verses && out.verses.length) return out;
      throw new Error(src.name + ': empty chapter');
    } catch (e) { errors.push(src.name + ': ' + (e.message || e)); }
  }
  throw new Error('Chapter not found (' + errors.join('; ') + ')');
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
  $('homeNotesCount').textContent = state.notes.length;
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
  $('homeGratCount').textContent = state.gratitude.length;
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

/* ------------------------- interactive Bible reader ------------------------- */
let bibleBook = 'john';
let bibleChapter = 3;
let bibleInitDone = false;
let bibleRequestId = 0;
let bibleSelectedVerse = null; // { ref, text } — the verse tapped in the reader
function loadBiblePosition() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_BIBLE) || 'null');
    if (raw && BIBLE_BOOKS.some((b) => b.key === raw.book) && raw.chapter > 0) {
      const book = BIBLE_BOOKS.find((b) => b.key === raw.book);
      bibleBook = raw.book;
      bibleChapter = Math.min(raw.chapter, book.chapters);
    }
  } catch (e) { /* ignore — defaults are John 3 */ }
}
function saveBiblePosition() {
  try { localStorage.setItem(LS_BIBLE, JSON.stringify({ book: bibleBook, chapter: bibleChapter })); } catch (e) { /* ignore */ }
}
function buildBibleBookSelect() {
  const sel = $('bibleBookSelect');
  sel.innerHTML = '';
  for (const testament of ['OT', 'NT']) {
    const group = document.createElement('optgroup');
    group.label = testament === 'OT' ? 'Old Testament' : 'New Testament';
    for (const b of BIBLE_BOOKS.filter((x) => x.testament === testament)) {
      const opt = document.createElement('option');
      opt.value = b.key;
      opt.textContent = b.name;
      group.appendChild(opt);
    }
    sel.appendChild(group);
  }
  sel.value = bibleBook;
}
function buildBibleChapterSelect() {
  const book = BIBLE_BOOKS.find((b) => b.key === bibleBook);
  const sel = $('bibleChapterSelect');
  sel.innerHTML = '';
  for (let i = 1; i <= book.chapters; i++) {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = 'Chapter ' + i;
    sel.appendChild(opt);
  }
  sel.value = String(bibleChapter);
}
function renderBibleVerses(verses) {
  const wrap = $('bibleVerses');
  wrap.innerHTML = '';
  verses.forEach((v) => {
    const p = document.createElement('p');
    p.className = 'bible-verse';
    const num = document.createElement('sup');
    num.className = 'bible-verse-num';
    num.textContent = v.n;
    const txt = document.createElement('span');
    txt.textContent = v.text;
    p.append(num, txt);
    p.addEventListener('click', () => openVerseActions(v));
    wrap.appendChild(p);
  });
}
async function loadBibleChapter() {
  const book = BIBLE_BOOKS.find((b) => b.key === bibleBook);
  const label = book.name + ' ' + bibleChapter;
  $('bibleRefLabel').textContent = label;
  $('bibleVerses').innerHTML = '';
  $('bibleError').classList.add('hidden');
  $('bibleLoading').classList.remove('hidden');
  const token = ++bibleRequestId; // ignore stale replies from fast tapping
  try {
    const out = await fetchChapter(book.name, bibleChapter);
    if (token !== bibleRequestId) return;
    renderBibleVerses(out.verses);
  } catch (e) {
    if (token !== bibleRequestId) return;
    $('bibleError').textContent = "Couldn't load this chapter — check your connection and try again.";
    $('bibleError').classList.remove('hidden');
  } finally {
    if (token === bibleRequestId) $('bibleLoading').classList.add('hidden');
  }
}
function bibleStep(dir) {
  const bi = BIBLE_BOOKS.findIndex((b) => b.key === bibleBook);
  let bookIndex = bi;
  let ch = bibleChapter + dir;
  if (ch < 1) {
    if (bookIndex <= 0) { toast('This is the very first chapter 📖'); return; }
    bookIndex--;
    ch = BIBLE_BOOKS[bookIndex].chapters;
  } else if (ch > BIBLE_BOOKS[bookIndex].chapters) {
    if (bookIndex >= BIBLE_BOOKS.length - 1) { toast('This is the very last chapter 📖'); return; }
    bookIndex++;
    ch = 1;
  }
  bibleBook = BIBLE_BOOKS[bookIndex].key;
  bibleChapter = ch;
  saveBiblePosition();
  $('bibleBookSelect').value = bibleBook;
  buildBibleChapterSelect();
  loadBibleChapter();
}
function ensureBibleLoaded() {
  if (bibleInitDone) return;
  bibleInitDone = true;
  loadBibleChapter();
}
function setBibleView(view) {
  const read = view === 'read';
  $('bibleReadTabBtn').classList.toggle('active', read);
  $('biblePrayersTabBtn').classList.toggle('active', !read);
  $('bibleReader').classList.toggle('hidden', !read);
  $('biblePrayersPane').classList.toggle('hidden', read);
  if (!read) renderPrayers();
}
/* Tap a verse → action sheet: save to notes / add to prayers / copy. */
function openVerseActions(verse) {
  const book = BIBLE_BOOKS.find((b) => b.key === bibleBook);
  const ref = book.name + ' ' + bibleChapter + ':' + verse.n;
  bibleSelectedVerse = { ref, text: verse.text };
  $('verseActionRef').textContent = ref;
  $('verseActionText').textContent = '"' + verse.text + '"';
  $('verseActionModal').classList.remove('hidden');
}
function closeVerseActions() {
  $('verseActionModal').classList.add('hidden');
  bibleSelectedVerse = null;
}
async function copyText(t) {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch (e) {
    try {
      const ta = document.createElement('textarea');
      ta.value = t;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    } catch (e2) { return false; }
  }
}

/* ------------------------- More bottom sheet ------------------------- */
function openMore() { $('moreModal').classList.remove('hidden'); }
function closeMore() { $('moreModal').classList.add('hidden'); }

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
  $('morePlanSub').textContent = plan.name + ' — ' + pct + '% done';
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
  $('setupTextSize').value = state.theme.textSize === 'compact' ? 'compact' : 'cozy';
  $('setupAccent').value = currentColors().accent;
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
  if (!nav || !lens) return;
  const active = nav.querySelector('.tab-btn.active');
  lens.style.transition = animate ? '' : 'none';
  // Tabs that left the bottom bar (Thanks / Plan / Settings) have no
  // nav button — hide the lens instead of stretching it nowhere.
  if (!active) { lens.style.opacity = '0'; return; }
  lens.style.transform = 'translateX(' + active.offsetLeft + 'px)';
  lens.style.width = active.offsetWidth + 'px';
  lens.style.opacity = '1';
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
    lens.style.opacity = '1';
    lens.style.transform = 'translateX(' +
      Math.min(Math.max(x - w / 2, 10), rect.width - w - 10) + 'px)';
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

/* ------------------------- diary ------------------------- */
let editorMood = '😊';

function fmtDiaryDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T12:00:00');
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}
function renderDiary() {
  renderCoverPreview($('diaryCoverWrap'), state.diaryCover, false);
  const list = $('diaryList');
  list.innerHTML = '';
  const entries = [...state.diary].sort((a, b) =>
    (b.date || '').localeCompare(a.date || '') || (b.updatedAt || 0) - (a.updatedAt || 0));
  $('diaryEmpty').classList.toggle('hidden', entries.length > 0);
  entries.forEach((e) => {
    const card = document.createElement('article');
    card.className = 'note-card';
    card.innerHTML =
      '<div class="diary-mood">' + esc(e.mood || '🌸') + '</div>' +
      (e.title ? '<h3>' + esc(e.title) + '</h3>' : '') +
      '<p class="note-ref">' + esc(fmtDiaryDate(e.date)) + '</p>' +
      '<p class="note-thoughts diary-entry-text">' + esc(e.text || '') + '</p>' +
      '<p class="note-date">' + fmtDate(e.updatedAt || e.createdAt) + '</p>' +
      '<div class="note-actions">' +
      '<button class="btn" data-act="edit">✏️ Edit</button>' +
      '<button class="btn btn-danger" data-act="delete">🗑️</button>' +
      '</div>';
    card.querySelector('[data-act="edit"]').addEventListener('click', () => openDiaryEditor(e));
    card.querySelector('[data-act="delete"]').addEventListener('click', () => {
      if (!confirm('Delete this diary entry?')) return;
      state.diary = state.diary.filter((x) => x.id !== e.id);
      deleteFromFirestore('diary', e.id);
      persist();
      renderDiary();
      toast('Entry deleted 🗑️');
    });
    list.appendChild(card);
  });
}
function buildMoodPicker() {
  const wrap = $('diaryMoodPicker');
  wrap.innerHTML = '';
  DIARY_MOODS.forEach((m) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = m;
    b.classList.toggle('selected', m === editorMood);
    b.addEventListener('click', () => {
      editorMood = m;
      wrap.querySelectorAll('button').forEach((x) => x.classList.toggle('selected', x.textContent === m));
    });
    wrap.appendChild(b);
  });
}
function openDiaryEditor(entry) {
  buildMoodPicker();
  if (entry) {
    $('diaryModalTitle').textContent = 'Edit entry ✏️';
    $('diaryId').value = entry.id;
    $('diaryDate').value = entry.date || todayStr();
    $('diaryTitle').value = entry.title || '';
    $('diaryText').value = entry.text || '';
    editorMood = entry.mood || '😊';
    $('deleteDiaryBtn').classList.remove('hidden');
  } else {
    $('diaryModalTitle').textContent = 'New diary entry ✍️';
    $('diaryId').value = '';
    $('diaryDate').value = todayStr();
    $('diaryTitle').value = '';
    $('diaryText').value = '';
    editorMood = '😊';
    $('deleteDiaryBtn').classList.add('hidden');
  }
  document.querySelectorAll('#diaryMoodPicker button').forEach((x) =>
    x.classList.toggle('selected', x.textContent === editorMood));
  $('diaryModal').classList.remove('hidden');
}
function closeDiaryEditor() { $('diaryModal').classList.add('hidden'); }
function saveDiaryFromEditor() {
  const id = $('diaryId').value || uid();
  const existing = state.diary.find((e) => e.id === id);
  const text = $('diaryText').value.trim();
  if (!text) { toast('Write a little something first ✍️'); return; }
  const entry = {
    id,
    date: $('diaryDate').value || todayStr(),
    title: $('diaryTitle').value.trim(),
    text,
    mood: editorMood,
    createdAt: existing ? existing.createdAt : Date.now(),
    updatedAt: Date.now()
  };
  if (existing) Object.assign(existing, entry);
  else state.diary.push(entry);
  persist();
  recordActivity();
  closeDiaryEditor();
  renderDiary();
  toast('Diary entry saved! 📔');
}

/* ------------------------- diary cover designer -------------------------
   The cover is a little book: a background, a title, stickers placed on
   it (tap to add, drag to move, sliders to resize/spin), and an optional
   glitter overlay. The design saves with the diary data (local + Firestore). */
let coverDraft = null;      // working copy while the designer is open
let coverSelected = -1;     // index of the selected placed sticker, or -1
let coverDrag = null;

function coverStickerHTML(s) {
  if (s.kind === 'svg') {
    const st = STICKERS.find((x) => x.id === s.id);
    return st ? st.svg : '🌸';
  }
  if (s.kind === 'emoji') return esc(s.id);
  if (s.kind === 'url') return '<img src="' + esc(s.src) + '" alt="" draggable="false">';
  return '🌸';
}
function glitterSpans(color) {
  // Seeded layout so the sparkles stay put between renders.
  let seed = 42;
  const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
  let html = '';
  const chars = ['✦', '✧', '✶', '✵'];
  for (let i = 0; i < 16; i++) {
    const left = (rnd() * 90 + 5).toFixed(1);
    const top = (rnd() * 90 + 5).toFixed(1);
    const size = Math.round(rnd() * 14 + 10);
    const delay = (rnd() * 1.8).toFixed(2);
    html += '<i style="left:' + left + '%;top:' + top + '%;font-size:' + size + 'px;color:' + esc(color) +
      ';animation-delay:' + delay + 's;">' + chars[i % chars.length] + '</i>';
  }
  return html;
}
function renderCoverPreview(wrap, cover, interactive) {
  if (!wrap || !cover) return;
  const bg = COVER_BGS[cover.bg] || COVER_BGS.lavenderDream;
  let html = '<div class="cover-preview" style="background:' + bg.css + '">';
  html += '<div class="cover-title' + (cover.title ? '' : ' no-title') + '">' + esc(cover.title || 'My Diary') + '</div>';
  if (cover.glitter && cover.glitter.on) {
    html += '<div class="cover-glitter">' + glitterSpans(cover.glitter.color || '#fde047') + '</div>';
  }
  (cover.stickers || []).forEach((s, i) => {
    html += '<div class="cover-sticker' + (interactive && i === coverSelected ? ' selected' : '') +
      '" data-i="' + i + '" style="left:' + s.x + '%;top:' + s.y + '%;width:' + s.size + 'px;height:' + s.size +
      'px;transform:translate(-50%,-50%) rotate(' + (s.rot || 0) + 'deg);font-size:' + s.size + 'px;">' +
      coverStickerHTML(s) + '</div>';
  });
  html += '</div>';
  wrap.innerHTML = html;
  if (interactive) wireCoverDrag(wrap);
}
function wireCoverDrag(wrap) {
  const preview = wrap.querySelector('.cover-preview');
  if (!preview) return;
  preview.querySelectorAll('.cover-sticker').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const i = +el.dataset.i;
      coverSelected = i;
      preview.querySelectorAll('.cover-sticker').forEach((x) => x.classList.remove('selected'));
      el.classList.add('selected');
      syncCoverControls();
      coverDrag = { i, pointerId: e.pointerId, rect: preview.getBoundingClientRect() };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
      el.classList.add('dragging');
    });
    el.addEventListener('pointermove', (e) => {
      if (!coverDrag || e.pointerId !== coverDrag.pointerId) return;
      const s = coverDraft.stickers[coverDrag.i];
      if (!s) return;
      s.x = Math.min(96, Math.max(4, ((e.clientX - coverDrag.rect.left) / coverDrag.rect.width) * 100));
      s.y = Math.min(96, Math.max(4, ((e.clientY - coverDrag.rect.top) / coverDrag.rect.height) * 100));
      el.style.left = s.x + '%';
      el.style.top = s.y + '%';
    });
    const endDrag = (e) => {
      if (!coverDrag || e.pointerId !== coverDrag.pointerId) return;
      coverDrag = null;
      el.classList.remove('dragging');
    };
    el.addEventListener('pointerup', endDrag);
    el.addEventListener('pointercancel', endDrag);
  });
}
function syncCoverControls() {
  const box = $('coverStickerControls');
  const s = coverSelected >= 0 ? coverDraft.stickers[coverSelected] : null;
  box.classList.toggle('hidden', !s);
  if (!s) return;
  $('coverStickerSize').value = s.size;
  $('coverStickerRot').value = s.rot || 0;
}
function openCoverDesigner() {
  coverDraft = JSON.parse(JSON.stringify(state.diaryCover || defaultCover()));
  coverSelected = -1;
  $('coverTitleInput').value = coverDraft.title || '';
  $('glitterToggle').checked = !!(coverDraft.glitter && coverDraft.glitter.on);
  $('glitterColor').value = (coverDraft.glitter && coverDraft.glitter.color) || '#fde047';
  $('stickerSearchResults').innerHTML = '';
  $('stickerSearchInput').value = '';
  $('stickerSearchHint').textContent = 'Searches Openverse — free photos & illustrations, no key needed. Add a GIPHY key in Settings for animated transparent stickers.';
  buildCoverBgPicker();
  buildCoverStickerTray();
  renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  syncCoverControls();
  $('coverModal').classList.remove('hidden');
}
function closeCoverDesigner() { $('coverModal').classList.add('hidden'); coverDraft = null; }
function saveCover() {
  if (!coverDraft) { closeCoverDesigner(); return; }
  coverDraft.title = ($('coverTitleInput').value || '').trim();
  coverDraft.glitter = { on: $('glitterToggle').checked, color: $('glitterColor').value || '#fde047' };
  state.diaryCover = coverDraft;
  persist();
  closeCoverDesigner();
  renderDiary();
  toast('Cover saved! 🎨');
}
function buildCoverBgPicker() {
  const wrap = $('coverBgPicker');
  wrap.innerHTML = '';
  for (const [key, b] of Object.entries(COVER_BGS)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = b.name;
    btn.style.background = b.css;
    btn.classList.toggle('selected', coverDraft.bg === key);
    btn.addEventListener('click', () => {
      coverDraft.bg = key;
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('selected'));
      btn.classList.add('selected');
      renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
    });
    wrap.appendChild(btn);
  }
}
function buildCoverStickerTray() {
  const wrap = $('coverStickerTray');
  wrap.innerHTML = '';
  const add = (sticker) => {
    coverDraft.stickers.push({
      kind: sticker.kind, id: sticker.id || null, src: sticker.src || null,
      x: 50, y: 50, size: 64, rot: 0
    });
    coverSelected = coverDraft.stickers.length - 1;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
    syncCoverControls();
  };
  STICKERS.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = s.svg;
    b.title = s.name;
    b.addEventListener('click', () => add({ kind: 'svg', id: s.id }));
    wrap.appendChild(b);
  });
  EMOJI_STICKERS.forEach((e) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = e;
    b.addEventListener('click', () => add({ kind: 'emoji', id: e }));
    wrap.appendChild(b);
  });
}

/* ------------------------- sticker search (real stickers via API) -------------------------
   DEFAULT: Openverse (api.openverse.org) — free, no key needed, works out
   of the box. It returns photos/illustrations (not transparent cut-outs).
   OPT-IN UPGRADE: if the user saved a GIPHY API key in Settings, GIPHY
   stickers (animated + transparent) are searched first, with Openverse as
   the fallback. The key lives in localStorage only — never synced, never
   exported, never in the repo. */
function giphyKey() {
  try { return (localStorage.getItem(LS_GIPHY) || '').trim(); } catch (e) { return ''; }
}
async function searchOpenverse(q) {
  const url = 'https://api.openverse.org/v1/images/?q=' + encodeURIComponent(q) + '&page_size=12';
  const res = await fetch(url);
  if (!res.ok) throw new Error('Openverse: HTTP ' + res.status);
  const data = await res.json();
  return (data.results || []).map((r) => ({
    src: r.thumbnail || r.url, title: r.title || 'Openverse image', source: 'Openverse'
  })).filter((r) => r.src);
}
async function searchGiphy(q, key) {
  const url = 'https://api.giphy.com/v1/stickers/search?api_key=' + encodeURIComponent(key) +
    '&q=' + encodeURIComponent(q) + '&limit=12&rating=g';
  const res = await fetch(url);
  if (!res.ok) throw new Error('GIPHY: HTTP ' + res.status);
  const data = await res.json();
  return (data.data || []).map((g) => ({
    src: (g.images && g.images.fixed_width && g.images.fixed_width.url) ||
      (g.images && g.images.original && g.images.original.url) || '',
    title: g.title || 'GIPHY sticker', source: 'GIPHY'
  })).filter((r) => r.src);
}
async function runStickerSearch() {
  const q = ($('stickerSearchInput').value || '').trim();
  const resultsEl = $('stickerSearchResults');
  const hintEl = $('stickerSearchHint');
  if (!q) { toast('Type something to search for — e.g. flowers 🌸'); return; }
  resultsEl.innerHTML = '<p class="muted small">Searching… 🔍</p>';
  const key = giphyKey();
  let results = [];
  let usedSource = 'Openverse';
  try {
    if (key) {
      // GIPHY opt-in: animated transparent stickers first.
      try {
        results = await searchGiphy(q, key);
        usedSource = 'GIPHY';
      } catch (e) { /* bad key / GIPHY down — fall through to Openverse */ }
    }
    if (!results.length) {
      results = await searchOpenverse(q);
      usedSource = 'Openverse';
    }
  } catch (e) {
    resultsEl.innerHTML = '<p class="muted small">Couldn\'t search right now — check your connection and try again.</p>';
    return;
  }
  hintEl.textContent = results.length
    ? 'Showing ' + usedSource + ' results — tap one to add it to your cover.' +
      (usedSource === 'Openverse' ? ' (Photos & illustrations — not transparent cut-outs. Add a GIPHY key in Settings for animated transparent stickers.)' : '')
    : 'No stickers found for "' + q + '" — try another word.';
  resultsEl.innerHTML = '';
  results.forEach((r) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = r.title;
    const img = document.createElement('img');
    img.src = r.src;
    img.alt = r.title;
    img.loading = 'lazy';
    b.appendChild(img);
    b.addEventListener('click', () => {
      if (!coverDraft) return;
      coverDraft.stickers.push({ kind: 'url', id: null, src: r.src, x: 50, y: 50, size: 80, rot: 0 });
      coverSelected = coverDraft.stickers.length - 1;
      renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
      syncCoverControls();
      toast('Sticker added to your cover! ✨');
    });
    resultsEl.appendChild(b);
  });
}

/* ------------------------- app passcode -------------------------
   In-app PIN lock. The web can't use the phone's lock screen, so this is
   honestly labelled "App passcode". Only a salted SHA-256 hash is stored
   (crypto.subtle) — the PIN itself is never saved anywhere. */
function pinStored() {
  try {
    const raw = localStorage.getItem(LS_PIN);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && parsed.salt && parsed.hash ? parsed : null;
  } catch (e) { return null; }
}
async function sha256Hex(str) {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch (e) { /* fall through to the simple fallback */ }
  // Fallback for non-secure contexts (e.g. file://): a simple FNV-1a hash.
  // Weaker, but the PIN is still never stored in plain text.
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return 'fnv1a-' + (h >>> 0).toString(16);
}
async function hashPin(pin, salt) { return sha256Hex(pin + '::' + salt); }
function randomSalt() {
  const arr = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr);
  else for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
  return [...arr].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function verifyPin(pin) {
  const stored = pinStored();
  if (!stored) return false;
  return (await hashPin(pin, stored.salt)) === stored.hash;
}
async function savePin(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  try { localStorage.setItem(LS_PIN, JSON.stringify({ salt, hash })); } catch (e) { /* storage blocked */ }
  refreshPinUI();
}
function clearPin() {
  try { localStorage.removeItem(LS_PIN); } catch (e) { /* ignore */ }
  refreshPinUI();
}
function refreshPinUI() {
  const on = !!pinStored();
  $('pinStatus').textContent = on
    ? '🔒 Passcode is on — the app asks for it every time it opens.' + (IS_NATIVE ? ' On this device, your fingerprint or face unlocks it too.' : '')
    : 'No passcode set — anyone who opens the app can read it.';
  $('setPinBtn').classList.toggle('hidden', on);
  $('changePinBtn').classList.toggle('hidden', !on);
  $('removePinBtn').classList.toggle('hidden', !on);
}

/* Generic 4-digit pad: builds digit buttons into `padEl`, lights up `dotsEl`,
   calls onComplete(pin) when 4 digits are entered. */
function buildPinPad(padEl, dotsEl, onComplete) {
  padEl.innerHTML = '';
  dotsEl.innerHTML = '<span></span><span></span><span></span><span></span>';
  let pin = '';
  const paint = () => {
    dotsEl.querySelectorAll('span').forEach((s, i) => s.classList.toggle('filled', i < pin.length));
  };
  const press = (d) => {
    if (pin.length >= 4) return;
    pin += d;
    paint();
    if (pin.length === 4) {
      const done = pin;
      pin = '';
      setTimeout(paint, 150);
      onComplete(done);
    }
  };
  const del = () => { pin = pin.slice(0, -1); paint(); };
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach((n) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = String(n);
    b.addEventListener('click', () => press(String(n)));
    padEl.appendChild(b);
  });
  const empty = document.createElement('button');
  empty.type = 'button';
  empty.className = 'pin-empty';
  empty.tabIndex = -1;
  padEl.appendChild(empty);
  const zero = document.createElement('button');
  zero.type = 'button';
  zero.textContent = '0';
  zero.addEventListener('click', () => press('0'));
  padEl.appendChild(zero);
  const delBtn = document.createElement('button');
  delBtn.type = 'button';
  delBtn.className = 'pin-del';
  delBtn.textContent = '⌫';
  delBtn.addEventListener('click', del);
  padEl.appendChild(delBtn);
}

/* Lock screen (shown on launch when a passcode is set). */
function showLockScreen() {
  $('lockScreen').classList.remove('hidden');
  $('lockError').classList.add('hidden');
  // Native shell: try fingerprint / face first — the PIN pad underneath
  // stays as the fallback (and is already there if biometry is cancelled).
  if (IS_NATIVE) {
    tryNativeBiometric().then((ok) => {
      if (ok) {
        $('lockScreen').classList.add('hidden');
        toast('Welcome back! 🌷');
      }
    });
  }
  buildPinPad($('lockPad'), $('lockDots'), async (pin) => {
    if (await verifyPin(pin)) {
      $('lockScreen').classList.add('hidden');
      toast('Welcome back! 🌷');
    } else {
      const err = $('lockError');
      err.textContent = 'Wrong passcode — try again.';
      err.classList.remove('hidden');
      const card = document.querySelector('.lock-card');
      card.classList.remove('shake');
      void card.offsetWidth; // restart the animation
      card.classList.add('shake');
    }
  });
}
function maybeLockOnLaunch() {
  if (pinStored()) showLockScreen();
}

/* PIN modal flows: set / change / remove. */
let pinFlow = null; // {mode:'set'|'change'|'remove', stage:'current'|'new'|'confirm', first:''}
function openPinModal(mode) {
  pinFlow = { mode, stage: mode === 'set' ? 'new' : 'current', first: '' };
  const titles = {
    set: ['Set passcode', 'Choose a 4-digit passcode.'],
    change: ['Change passcode', 'First, enter your current passcode.'],
    remove: ['Turn off passcode', 'Enter your current passcode to turn it off.']
  };
  $('pinModalTitle').textContent = titles[mode][0];
  $('pinModalSub').textContent = titles[mode][1];
  $('pinError').classList.add('hidden');
  $('pinModal').classList.remove('hidden');
  buildPinPad($('pinPad'), $('pinDots'), onPinModalDigit);
}
function closePinModal() { $('pinModal').classList.add('hidden'); pinFlow = null; }
function pinModalWrong(msg) {
  const err = $('pinError');
  err.textContent = msg;
  err.classList.remove('hidden');
  const card = document.querySelector('.pin-card');
  card.classList.remove('shake');
  void card.offsetWidth;
  card.classList.add('shake');
}
async function onPinModalDigit(pin) {
  if (!pinFlow) return;
  if (pinFlow.stage === 'current') {
    if (await verifyPin(pin)) {
      if (pinFlow.mode === 'remove') {
        clearPin();
        closePinModal();
        toast('Passcode turned off 🔓');
      } else {
        pinFlow.stage = 'new';
        $('pinModalTitle').textContent = 'New passcode';
        $('pinModalSub').textContent = 'Choose a new 4-digit passcode.';
        $('pinError').classList.add('hidden');
      }
    } else {
      pinModalWrong('That\'s not the current passcode — try again.');
    }
    return;
  }
  if (pinFlow.stage === 'new') {
    pinFlow.first = pin;
    pinFlow.stage = 'confirm';
    $('pinModalTitle').textContent = 'Confirm passcode';
    $('pinModalSub').textContent = 'Enter it once more to make sure.';
    $('pinError').classList.add('hidden');
    return;
  }
  // stage === 'confirm'
  if (pin !== pinFlow.first) {
    pinFlow.stage = 'new';
    pinFlow.first = '';
    $('pinModalTitle').textContent = pinFlow.mode === 'set' ? 'Set passcode' : 'New passcode';
    $('pinModalSub').textContent = 'Those didn\'t match — choose a 4-digit passcode.';
    pinModalWrong('The two passcodes didn\'t match. Try again.');
    return;
  }
  await savePin(pin);
  closePinModal();
  toast(pinFlow.mode === 'change' ? 'Passcode changed! 🔒' : 'Passcode set! 🔒');
}
function resetAppData() {
  // Forgot passcode: wipe local data only. Firestore data is untouched and
  // re-syncs when the user signs in again.
  try {
    [LS_KEY, LS_VOTD, LS_PIN, LS_GIPHY].forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* ignore */ }
  location.reload();
}

/* ------------------------- tabs & render-all ------------------------- */
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab-page').forEach((s) =>
    s.classList.toggle('hidden', s.id !== 'tab-' + name));
  if (name === 'home') { renderHomeGreeting(); renderStreak(); renderPlan(); }
  if (name === 'plan') renderPlan();
  if (name === 'notes') { renderNotes(); renderTagChips(); }
  if (name === 'diary') renderDiary();
  if (name === 'gratitude') renderGratitude();
  if (name === 'prayers') { renderPrayers(); ensureBibleLoaded(); }
  if (name === 'settings') renderSettings();
  positionNavLens(true);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function renderAll() {
  applyTheme();
  buildPlanSelect();
  renderStreak();
  renderHomeGreeting();
  renderVOTD();
  renderNotes();
  renderTagChips();
  renderPrayers();
  renderGratitude();
  renderPlan();
  renderDiary();
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
  if (IS_IOS && !IS_STANDALONE) $('iosHint').classList.remove('hidden');
  window.addEventListener('appinstalled', () => {
    $('installBanner').classList.add('hidden');
    toast('Verse Garden installed! 🌸');
  });
}

/* ------------------------- wire up UI ------------------------- */
function initUI() {
  document.querySelectorAll('.tab-btn').forEach((b) =>
    b.addEventListener('click', () => { nativeImpact('light'); switchTab(b.dataset.tab); }));

  // Quick-add (+) in the middle of the bottom bar — straight to a new note.
  $('quickAddBtn').addEventListener('click', () => { nativeImpact('medium'); openNoteEditor(null); });

  // Home hero cards — shortcuts to Plan and Thanks.
  const goPlan = () => switchTab('plan');
  const goGrat = () => switchTab('gratitude');
  $('homePlanCard').addEventListener('click', goPlan);
  $('homePlanCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goPlan(); } });
  $('homeGratCard').addEventListener('click', goGrat);
  $('homeGratCard').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goGrat(); } });

  // More bottom sheet (header ⋯ button + Home "More" card).
  $('moreBtn').addEventListener('click', openMore);
  $('homeMoreBtn').addEventListener('click', openMore);
  $('moreCloseBtn').addEventListener('click', closeMore);
  $('moreModal').addEventListener('click', (e) => { if (e.target === $('moreModal')) closeMore(); });
  document.querySelectorAll('.more-item').forEach((b) => {
    b.addEventListener('click', () => {
      const action = b.dataset.more;
      closeMore();
      if (action === 'gratitude') switchTab('gratitude');
      else if (action === 'plan') switchTab('plan');
      else if (action === 'settings') switchTab('settings');
      else if (action === 'export') exportData();
      else if (action === 'import') $('importFile').click();
      else if (action === 'setup') openSetup();
    });
  });

  // Interactive Bible reader (inside the Prayers tab).
  loadBiblePosition();
  buildBibleBookSelect();
  buildBibleChapterSelect();
  $('bibleBookSelect').addEventListener('change', (e) => {
    bibleBook = e.target.value;
    bibleChapter = 1;
    saveBiblePosition();
    buildBibleChapterSelect();
    loadBibleChapter();
  });
  $('bibleChapterSelect').addEventListener('change', (e) => {
    bibleChapter = +e.target.value;
    saveBiblePosition();
    loadBibleChapter();
  });
  $('biblePrevBtn').addEventListener('click', () => bibleStep(-1));
  $('bibleNextBtn').addEventListener('click', () => bibleStep(1));
  $('bibleReadTabBtn').addEventListener('click', () => setBibleView('read'));
  $('biblePrayersTabBtn').addEventListener('click', () => setBibleView('prayers'));

  // Verse action sheet — tap a Bible verse.
  $('verseSaveBtn').addEventListener('click', () => {
    if (!bibleSelectedVerse) return;
    const v = bibleSelectedVerse;
    closeVerseActions();
    openNoteEditor(null);
    $('verseRef').value = v.ref;
    $('verseText').value = v.text;
    $('noteTitle').value = v.ref;
  });
  $('versePrayBtn').addEventListener('click', () => {
    if (!bibleSelectedVerse) return;
    addPrayer(bibleSelectedVerse.ref + ' — "' + bibleSelectedVerse.text + '"');
    closeVerseActions();
    toast('Added to your prayers 🙏');
  });
  $('verseCopyBtn').addEventListener('click', async () => {
    if (!bibleSelectedVerse) return;
    const ok = await copyText(bibleSelectedVerse.ref + ' — "' + bibleSelectedVerse.text + '"');
    toast(ok ? 'Verse copied 📋' : "Couldn't copy — long-press the verse instead");
  });
  $('verseActionCloseBtn').addEventListener('click', closeVerseActions);
  $('verseActionModal').addEventListener('click', (e) => { if (e.target === $('verseActionModal')) closeVerseActions(); });

  // Diary
  $('newDiaryBtn').addEventListener('click', () => openDiaryEditor(null));
  $('closeDiaryBtn').addEventListener('click', closeDiaryEditor);
  $('diaryModal').addEventListener('click', (e) => { if (e.target === $('diaryModal')) closeDiaryEditor(); });
  $('saveDiaryBtn').addEventListener('click', saveDiaryFromEditor);
  $('deleteDiaryBtn').addEventListener('click', () => {
    const id = $('diaryId').value;
    if (!id || !confirm('Delete this diary entry?')) return;
    state.diary = state.diary.filter((x) => x.id !== id);
    deleteFromFirestore('diary', id);
    persist();
    closeDiaryEditor();
    renderDiary();
    toast('Entry deleted 🗑️');
  });

  // Cover designer
  $('designCoverBtn').addEventListener('click', openCoverDesigner);
  $('closeCoverBtn').addEventListener('click', closeCoverDesigner);
  $('coverModal').addEventListener('click', (e) => { if (e.target === $('coverModal')) closeCoverDesigner(); });
  $('saveCoverBtn').addEventListener('click', saveCover);
  $('coverTitleInput').addEventListener('input', (e) => {
    if (!coverDraft) return;
    coverDraft.title = e.target.value;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  });
  $('glitterToggle').addEventListener('change', (e) => {
    if (!coverDraft) return;
    coverDraft.glitter.on = e.target.checked;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  });
  $('glitterColor').addEventListener('input', (e) => {
    if (!coverDraft) return;
    coverDraft.glitter.color = e.target.value;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  });
  $('coverStickerSize').addEventListener('input', (e) => {
    if (!coverDraft || coverSelected < 0) return;
    coverDraft.stickers[coverSelected].size = +e.target.value;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  });
  $('coverStickerRot').addEventListener('input', (e) => {
    if (!coverDraft || coverSelected < 0) return;
    coverDraft.stickers[coverSelected].rot = +e.target.value;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
  });
  $('coverStickerDeleteBtn').addEventListener('click', () => {
    if (!coverDraft || coverSelected < 0) return;
    coverDraft.stickers.splice(coverSelected, 1);
    coverSelected = -1;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
    syncCoverControls();
  });
  $('coverStickerDoneBtn').addEventListener('click', () => {
    coverSelected = -1;
    renderCoverPreview($('coverDesignerPreview'), coverDraft, true);
    syncCoverControls();
  });
  $('stickerSearchBtn').addEventListener('click', runStickerSearch);
  $('stickerSearchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runStickerSearch(); });

  // App passcode
  $('setPinBtn').addEventListener('click', () => openPinModal('set'));
  $('changePinBtn').addEventListener('click', () => openPinModal('change'));
  $('removePinBtn').addEventListener('click', () => openPinModal('remove'));
  $('pinCancelBtn').addEventListener('click', closePinModal);
  $('pinModal').addEventListener('click', (e) => { if (e.target === $('pinModal')) closePinModal(); });
  $('lockForgotBtn').addEventListener('click', () => {
    if (!confirm('Forgot your passcode? This erases everything stored on THIS device — notes, diary, prayers, gratitude and settings. If you\'re signed in, your synced data comes back when you sign in again. Erase everything on this device?')) return;
    resetAppData();
  });
  refreshPinUI();

  // GIPHY key (optional upgrade for animated stickers — device only)
  $('giphyKeyInput').value = giphyKey();
  $('giphyKeySaveBtn').addEventListener('click', () => {
    const key = ($('giphyKeyInput').value || '').trim();
    if (!key) { toast('Paste your GIPHY key first — or leave it empty, Openverse search already works.'); return; }
    try { localStorage.setItem(LS_GIPHY, key); } catch (e) { /* storage blocked */ }
    toast('GIPHY key saved on this device ✨');
  });
  $('giphyKeyClearBtn').addEventListener('click', () => {
    try { localStorage.removeItem(LS_GIPHY); } catch (e) { /* ignore */ }
    $('giphyKeyInput').value = '';
    toast('GIPHY key removed — sticker search uses Openverse.');
  });

  // Text size + custom accent (also in the setup flow)
  $('textSizeSelect').addEventListener('change', (e) => {
    state.theme.textSize = e.target.value;
    applyTheme();
    persist();
  });
  $('setupAccent').addEventListener('input', (e) => {
    state.theme.customAccent = e.target.value;
    applyTheme();
    persist();
  });
  $('setupTextSize').addEventListener('change', (e) => {
    state.theme.textSize = e.target.value;
    applyTheme();
    persist();
  });

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
/* Boot is wrapped so that no single failure can strand the app on the
   launch splash (native) or leave a blank screen (web): the steps run in
   order, a failure falls through to showing the app anyway, and the
   splash is hidden in the finally — plus the 4s failsafe timer above as
   a backstop. */
try {
  loadLocal();
  buildThemeSwatches();
  applyTheme();
  initAuth();
  initUI();
  initPWA();
  maybeLockOnLaunch(); // passcode set? PIN pad first, before any content
} catch (e) {
  console.error('Boot failed partway — showing the app anyway:', e);
  try { showApp(); } catch (e2) { /* last resort: splash failsafe still fires */ }
} finally {
  nativeSplashHide(); // native shell: dismiss the launch splash now the app has rendered
}

// No Firebase config yet (or Firebase failed) → straight into local mode.
if (!auth) {
  showApp();
}
