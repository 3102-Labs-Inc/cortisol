// Records vault: everything private (readings, report keys) is encrypted with a key derived from the
// team passphrase before it is written to the private records repository. GitHub only ever stores ciphertext.
//   vault.json = { v:1, kdf:{name:'PBKDF2', hash:'SHA-256', iterations, salt}, check:{iv, data} }
//   check decrypts to CHECK_TEXT, which proves the passphrase without storing it.
// Records: encryptJSON(key, id, value) -> {v:1, id, iv, data}; AAD binds each file to its id.
(function (root) {
  'use strict';
  const isNode = typeof module !== 'undefined' && module.exports;
  const core = isNode ? require('../report-core.js') : root.TraceReportCore;
  const ITERATIONS = 600000, MIN_PASSPHRASE = 12, CHECK_TEXT = 'Trace records vault v1';
  const cryptoApi = () => {
    const c = root.crypto || (isNode ? require('node:crypto').webcrypto : null);
    if (!c || !c.subtle) throw Error('A secure browser context (HTTPS) is required.');
    return c;
  };
  const enc = new TextEncoder(), dec = new TextDecoder();
  async function deriveKey(passphrase, kdf) {
    if (!kdf || kdf.name !== 'PBKDF2' || kdf.hash !== 'SHA-256' || !(kdf.iterations >= ITERATIONS)) throw Error('Unsupported vault settings.');
    const c = cryptoApi();
    const base = await c.subtle.importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return c.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: kdf.iterations, salt: core.fromBase64(kdf.salt) }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  }
  async function seal(key, aad, bytes) {
    const c = cryptoApi(), iv = c.getRandomValues(new Uint8Array(12));
    const data = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad), tagLength: 128 }, key, bytes));
    return { iv: core.toBase64(iv), data: core.toBase64(data) };
  }
  async function unseal(key, aad, box) {
    return new Uint8Array(await cryptoApi().subtle.decrypt({ name: 'AES-GCM', iv: core.fromBase64(box.iv), additionalData: enc.encode(aad), tagLength: 128 }, key, core.fromBase64(box.data)));
  }
  function passphraseProblem(passphrase, confirm) {
    if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE) return 'Use a passphrase of at least ' + MIN_PASSPHRASE + ' characters (a short sentence works well).';
    if (confirm !== undefined && confirm !== passphrase) return 'The two passphrases do not match.';
    return '';
  }
  async function createVault(passphrase) {
    const problem = passphraseProblem(passphrase);
    if (problem) throw Error(problem);
    const kdf = { name: 'PBKDF2', hash: 'SHA-256', iterations: ITERATIONS, salt: core.toBase64(cryptoApi().getRandomValues(new Uint8Array(16))) };
    const key = await deriveKey(passphrase, kdf);
    return { vault: { v: 1, kdf, check: await seal(key, 'vault-check', enc.encode(CHECK_TEXT)) }, key };
  }
  async function unlockVault(vault, passphrase) {
    if (!vault || vault.v !== 1 || !vault.check) throw Error('The records vault file is not recognised.');
    const key = await deriveKey(passphrase, vault.kdf);
    try { if (dec.decode(await unseal(key, 'vault-check', vault.check)) === CHECK_TEXT) return key; } catch (_) { /* wrong passphrase */ }
    throw Error('That passphrase does not unlock the records.');
  }
  async function encryptJSON(key, id, value) { return { v: 1, id, ...(await seal(key, 'record:' + id, enc.encode(JSON.stringify(value)))) }; }
  async function decryptJSON(key, box) {
    if (!box || box.v !== 1 || typeof box.id !== 'string') throw Error('Unrecognised record file.');
    return JSON.parse(dec.decode(await unseal(key, 'record:' + box.id, box)));
  }
  const api = Object.freeze({ ITERATIONS, MIN_PASSPHRASE, passphraseProblem, createVault, unlockVault, encryptJSON, decryptJSON });
  root.TraceVault = api;
  if (isNode) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
