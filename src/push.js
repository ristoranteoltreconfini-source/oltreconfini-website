// Notifiche push del pannello (Web Push, RFC 8291 + VAPID): funziona su Android e su iPhone con il pannello nella schermata Home.
import { AMB } from './gas.js';
const enc = new TextEncoder(), b64u = b => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), c => c.charCodeAt(0));
const cat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
const q = (s, ...a) => AMB.sql.exec(s, ...a).toArray();
export function tabellaPush() { AMB.sql.exec('CREATE TABLE IF NOT EXISTS push (endpoint TEXT PRIMARY KEY, email TEXT, sub TEXT, ts INTEGER)'); }
// chiavi VAPID del sito: create la prima volta e conservate nel database
export async function chiaviVapid() {
  tabellaPush(); const r = q("SELECT v FROM prop WHERE k='VAPID'")[0]; if (r) return JSON.parse(r.v);
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const v = { pub: b64u(await crypto.subtle.exportKey('raw', k.publicKey)), priv: await crypto.subtle.exportKey('jwk', k.privateKey) };
  AMB.sql.exec("INSERT OR REPLACE INTO prop (k, v) VALUES ('VAPID', ?)", JSON.stringify(v)); return v;
}
export function iscrivi(email, sub) { tabellaPush(); AMB.sql.exec('INSERT OR REPLACE INTO push (endpoint, email, sub, ts) VALUES (?,?,?,?)', String(sub.endpoint), email, JSON.stringify(sub), Date.now()); }
async function hkdf(salt, ikm, info, n) { const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']); return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, n * 8)); }
async function cifra(sub, testo) {             // RFC 8291 aes128gcm
  const ua = deb64u(sub.keys.p256dh), auth = deb64u(sub.keys.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']), asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaKey = await crypto.subtle.importKey('raw', ua, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, eph.privateKey, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), ua, asPub), 32), salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const k = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, k, cat(enc.encode(testo), new Uint8Array([2]))));
  return cat(salt, new Uint8Array([0, 0, 16, 0]), new Uint8Array([asPub.length]), asPub, ct);
}
async function vapid(endpoint, v, contatto) {
  const u = new URL(endpoint), h = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))), p = b64u(enc.encode(JSON.stringify({ aud: u.origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: 'mailto:' + contatto })));
  const key = await crypto.subtle.importKey('jwk', v.priv, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const s = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(h + '.' + p));
  return 'vapid t=' + h + '.' + p + '.' + b64u(s) + ', k=' + v.pub;
}
// manda una notifica a tutti gli iscritti tra le email indicate; gli abbonamenti scaduti si cancellano
export async function invia(emails, msg, contatto) {
  tabellaPush(); const v = await chiaviVapid(), body = JSON.stringify(msg);
  for (const r of q('SELECT endpoint, sub, email FROM push')) {
    if (emails.indexOf(r.email) < 0) continue;
    try {
      const sub = JSON.parse(r.sub), res = await fetch(sub.endpoint, { method: 'POST', headers: { authorization: await vapid(sub.endpoint, v, contatto), 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream', ttl: '86400', urgency: 'high' }, body: await cifra(sub, body) });
      if (res.status === 404 || res.status === 410) AMB.sql.exec('DELETE FROM push WHERE endpoint=?', r.endpoint);
    } catch (e) { console.log('push', e.message); }
  }
}
