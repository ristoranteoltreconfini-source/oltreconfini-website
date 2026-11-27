// Sostituti dei servizi di Google Apps Script, sopra il database del Durable Object (SQLite in UE).
// Il codice del pannello (backend.js) resta quasi identico all'originale: chiama SpreadsheetApp,
// PropertiesService, CacheService… e qui quelle chiamate leggono e scrivono nel database.

export const AMB = { sql: null, env: null, dopo: [], owner: '' };

export function preparaDb(sql) {
  sql.exec(`CREATE TABLE IF NOT EXISTS fogli (ss TEXT NOT NULL, nome TEXT NOT NULL, pos INTEGER NOT NULL, dati TEXT NOT NULL, PRIMARY KEY (ss, nome))`);
  sql.exec(`CREATE TABLE IF NOT EXISTS prop (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS cache (k TEXT PRIMARY KEY, v TEXT NOT NULL, scade INTEGER NOT NULL)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS file (id TEXT PRIMARY KEY, tipo TEXT, nome TEXT, dati BLOB, creato INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS posta (id INTEGER PRIMARY KEY AUTOINCREMENT, msg TEXT NOT NULL, tentativi INTEGER DEFAULT 0, creato INTEGER)`);
  sql.exec(`CREATE TABLE IF NOT EXISTS traduzioni (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
}
const q = (s, ...a) => AMB.sql.exec(s, ...a).toArray();

/* ---------------- fogli ---------------- */
const str = v => v == null ? '' : v instanceof Date ? fmtData(v, 'dd/MM/yyyy') : String(v);
class Foglio {
  constructor(ss, nome) { this.ss = ss; this.nome = nome; }
  _v() { const r = q('SELECT dati FROM fogli WHERE ss=? AND nome=?', this.ss.id, this.nome)[0]; return r ? JSON.parse(r.dati) : []; }
  _s(v) { AMB.sql.exec('UPDATE fogli SET dati=? WHERE ss=? AND nome=?', JSON.stringify(v), this.ss.id, this.nome); segnaCambio(this.ss.id); }
  getName() { return this.nome; }
  setName(n) { AMB.sql.exec('UPDATE fogli SET nome=? WHERE ss=? AND nome=?', n, this.ss.id, this.nome); this.nome = n; return this; }
  getLastRow() { const v = this._v(); for (let i = v.length - 1; i >= 0; i--) if ((v[i] || []).some(x => x !== '')) return i + 1; return 0; }
  getLastColumn() { let m = 0; this._v().forEach(r => { for (let j = (r || []).length - 1; j >= 0; j--) if (r[j] !== '') { m = Math.max(m, j + 1); break; } }); return m; }
  getDataRange() { return new Intervallo(this, 1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn())); }
  getRange(r, c, nr, nc) {
    if (typeof r === 'string') {
      const m = r.match(/^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/), col = s => s.split('').reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0);
      if (!m) throw new Error('Intervallo non gestito: ' + r);
      const r1 = +m[2], c1 = col(m[1]), r2 = m[3] ? +m[4] : r1, c2 = m[3] ? col(m[3]) : c1;
      return new Intervallo(this, r1, c1, r2 - r1 + 1, c2 - c1 + 1);
    }
    return new Intervallo(this, r, c, nr || 1, nc || 1);
  }
  appendRow(a) { const v = this._v(), n = this.getLastRow(); v.length = Math.max(v.length, n); v.splice(n, 0, a.map(str)); this._s(v); return this; }
  clearContents() { this._s([]); return this; }
  deleteRows(da, n) { const v = this._v(); v.splice(da - 1, n || 1); this._s(v); }
  deleteRow(da) { this.deleteRows(da, 1); }
  setFrozenRows() { return this; }
  getParent() { return this.ss; }
}
class Intervallo {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  getValues() { const v = this.sh._v(), o = []; for (let i = 0; i < this.nr; i++) { const riga = v[this.r - 1 + i] || [], x = []; for (let j = 0; j < this.nc; j++) x.push(riga[this.c - 1 + j] == null ? '' : riga[this.c - 1 + j]); o.push(x); } return o; }
  getDisplayValues() { return this.getValues(); }
  getValue() { return this.getValues()[0][0]; }
  getDisplayValue() { return this.getValue(); }
  setValues(a) {
    const v = this.sh._v();
    for (let i = 0; i < this.nr; i++) {
      const k = this.r - 1 + i; while (v.length <= k) v.push([]);
      const riga = v[k]; for (let j = 0; j < this.nc; j++) { const cc = this.c - 1 + j; while (riga.length < cc) riga.push(''); riga[cc] = str((a[i] || [])[j]).replace(/^'(?=[=+\-@])/, ''); }
    }
    this.sh._s(v.map(r => r.map(x => x == null ? '' : x))); return this;
  }
  setValue(x) { return this.setValues([[x]]); }
  setNumberFormat() { return this; }
  setFontWeight() { return this; }
  setBackground() { return this; }
  clearContent() { return this.setValues(Array.from({ length: this.nr }, () => Array(this.nc).fill(''))); }
}
class Cartella {
  constructor(id) { this.id = id; }
  getId() { return this.id; }
  getUrl() { return ''; }
  getName() { return (q('SELECT nome FROM fogli WHERE ss=? ORDER BY pos LIMIT 1', this.id)[0] || {}).nome || ''; }
  getSheets() { return q('SELECT nome FROM fogli WHERE ss=? ORDER BY pos', this.id).map(r => new Foglio(this, r.nome)); }
  getSheetByName(n) { return q('SELECT nome FROM fogli WHERE ss=? AND nome=?', this.id, n).length ? new Foglio(this, n) : null; }
  insertSheet(n) {
    const pos = (q('SELECT MAX(pos) m FROM fogli WHERE ss=?', this.id)[0] || {}).m;
    AMB.sql.exec('INSERT INTO fogli (ss, nome, pos, dati) VALUES (?,?,?,?)', this.id, n, (pos == null ? -1 : pos) + 1, '[]'); return new Foglio(this, n);
  }
}
export const SpreadsheetApp = {
  openById(id) { if (!q('SELECT 1 FROM fogli WHERE ss=? LIMIT 1', id).length) throw new Error('Foglio inesistente: ' + id); return new Cartella(id); },
  create(nome) { const c = new Cartella('x' + uuid().replace(/-/g, '')); c.insertSheet(nome || 'Foglio1'); return c; }
};
// i fogli cambiati: dopo la risposta si ricalcolano le colonne «(auto)» (traduzioni e copie)
export const CAMBIATI = new Set();
function segnaCambio(id) { CAMBIATI.add(id); }
export function importaFoglio(ss, nome, righe, pos) {
  AMB.sql.exec('INSERT OR REPLACE INTO fogli (ss, nome, pos, dati) VALUES (?,?,?,?)', ss, nome, pos || 0, JSON.stringify(righe.map(r => r.map(str))));
}
export function leggiFoglio(ss, nome) {
  const r = nome ? q('SELECT dati FROM fogli WHERE ss=? AND nome=?', ss, nome)[0] : q('SELECT dati FROM fogli WHERE ss=? ORDER BY pos LIMIT 1', ss)[0];
  return r ? JSON.parse(r.dati) : null;
}

/* ---------------- proprietà, memoria, blocco ---------------- */
const Proprieta = {
  getProperty(k) { const r = q('SELECT v FROM prop WHERE k=?', k)[0]; return r ? r.v : null; },
  setProperty(k, v) { AMB.sql.exec('INSERT OR REPLACE INTO prop (k, v) VALUES (?,?)', k, String(v)); return this; },
  setProperties(o) { Object.keys(o).forEach(k => this.setProperty(k, o[k])); return this; },
  deleteProperty(k) { AMB.sql.exec('DELETE FROM prop WHERE k=?', k); return this; },
  getProperties() { const o = {}; q('SELECT k, v FROM prop').forEach(r => { o[r.k] = r.v; }); return o; },
  getKeys() { return q('SELECT k FROM prop').map(r => r.k); }
};
export const PropertiesService = { getScriptProperties: () => Proprieta };
const Memoria = {
  get(k) { const r = q('SELECT v, scade FROM cache WHERE k=?', k)[0]; if (!r) return null; if (r.scade < Date.now()) { AMB.sql.exec('DELETE FROM cache WHERE k=?', k); return null; } return r.v; },
  put(k, v, sec) { AMB.sql.exec('INSERT OR REPLACE INTO cache (k, v, scade) VALUES (?,?,?)', k, String(v), Date.now() + 1000 * (sec || 600)); },
  remove(k) { AMB.sql.exec('DELETE FROM cache WHERE k=?', k); },
  pulisci() { AMB.sql.exec('DELETE FROM cache WHERE scade < ?', Date.now()); }
};
export const CacheService = { getScriptCache: () => Memoria };
// il Durable Object esegue una richiesta alla volta tra un'attesa e l'altra: le sezioni senza «await» sono già protette
export const LockService = { getScriptLock: () => ({ waitLock() {}, tryLock() { return true; }, releaseLock() {} }) };

/* ---------------- email: in coda, partono subito dopo la risposta ---------------- */
export const MailApp = {
  sendEmail(o) {
    if (!o || !o.to) throw new Error('Destinatario mancante');
    const msg = { to: String(o.to).split(',').map(x => x.trim()).filter(Boolean), subject: String(o.subject || ''), html: String(o.htmlBody || o.body || ''),
      name: o.name || '', replyTo: o.replyTo || '', attachments: (o.attachments || []).map(a => ({ filename: a.nome, content: a.b64 || btoa(unescape(encodeURIComponent(a.testo || ''))), type: a.tipo })) };
    AMB.sql.exec('INSERT INTO posta (msg, creato) VALUES (?,?)', JSON.stringify(msg), Date.now());
  },
  getRemainingDailyQuota() { const n = q('SELECT COUNT(*) n FROM posta')[0].n; return Math.max(0, 1000 - n); }
};
export const GmailApp = { search: () => [], moveThreadsToTrash() {} };

/* ---------------- file (foto dei piatti) ---------------- */
export const Utilities = {
  formatDate: (d, tz, p) => fmtData(d, p),
  getUuid: () => uuid(),
  base64Encode: s => typeof s === 'string' ? btoa(unescape(encodeURIComponent(s))) : btoa(String.fromCharCode(...s)),
  base64Decode: s => { const b = atob(String(s).replace(/^data:[^,]*,/, '')), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; },
  computeDigest: (alg, s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return String(h >>> 0) + ':' + s.length; },
  DigestAlgorithm: { MD5: 'md5' },
  newBlob: (dati, tipo, nome) => typeof dati === 'string' ? { testo: dati, tipo, nome } : { bytes: dati, tipo, nome, b64: Utilities.base64Encode(dati) }
};
export const DriveApp = {
  Access: {}, Permission: {},
  getFolderById: id => ({ createFile: b => fileNuovo(b), getId: () => id }),
  createFolder: () => ({ getId: () => 'foto', createFile: b => fileNuovo(b) }),
  getFileById: id => ({ setTrashed() { AMB.sql.exec('DELETE FROM file WHERE id=?', id); } })
};
function fileNuovo(b) {
  const id = 'ft_' + uuid().replace(/-/g, '').slice(0, 24);     // con «_»: il sito non la confonde con le foto incluse
  AMB.sql.exec('INSERT INTO file (id, tipo, nome, dati, creato) VALUES (?,?,?,?,?)', id, b.tipo || 'image/jpeg', b.nome || '', b.bytes, Date.now());
  return { getId: () => id, setSharing() {} };
}
export function leggiFile(id) { return q('SELECT tipo, dati FROM file WHERE id=?', id)[0] || null; }

/* ---------------- servizi non più necessari ---------------- */
export const Session = { getEffectiveUser: () => ({ getEmail: () => AMB.owner }), getActiveUser: () => ({ getEmail: () => AMB.owner }) };
export const ScriptApp = {
  getService: () => ({ getUrl: () => (AMB.env && AMB.env.SITO ? AMB.env.SITO.replace(/\/?$/, '/') : '') + 'pannello' }),
  getProjectTriggers: () => ['promemoria', 'copiaRiserva', 'prControlla', 'prInvia', 'prNotte'].map(h => ({ getHandlerFunction: () => h })),
  deleteTrigger() {}, newTrigger: () => { const t = { timeBased: () => t, everyMinutes: () => t, everyDays: () => t, atHour: () => t, inTimezone: () => t, create: () => t }; return t; }
};
export const Logger = { log: (...a) => console.log(...a) };

/* ---------------- traduzioni: subito se già fatte, altrimenti in coda (le fa l'IA di Cloudflare dopo la risposta) ---------------- */
export const DA_TRADURRE = new Map();
export const LanguageApp = {
  translate(testo, da, a) {
    testo = String(testo || '').trim(); if (!testo) return '';
    const k = (da || 'auto') + '|' + a + '|' + testo, r = q('SELECT v FROM traduzioni WHERE k=?', k)[0];
    if (r) return r.v;
    DA_TRADURRE.set(k, { testo, da: da || '', a });
    return '';
  }
};

/* ---------------- richieste verso altri siti (solo con await) ---------------- */
export const UrlFetchApp = {
  async fetch(url, o) {
    o = o || {};
    const h = Object.assign({}, o.headers || {}); if (o.contentType) h['content-type'] = o.contentType;
    const r = await fetch(url, { method: (o.method || 'get').toUpperCase(), headers: h, body: o.payload, redirect: o.followRedirects === false ? 'manual' : 'follow' });
    const testo = await r.text();
    return { getResponseCode: () => r.status, getContentText: () => testo };
  }
};

/* ---------------- risposte (pagine e testi) ---------------- */
export const ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput: testo => { const o = { testo: String(testo), tipo: 'text/plain; charset=utf-8', setMimeType(m) { o.tipo = m + '; charset=utf-8'; return o; } }; return o; }
};
export const HtmlService = {
  createHtmlOutput: html => { const o = { testo: String(html), tipo: 'text/html; charset=utf-8', setTitle() { return o; }, addMetaTag() { return o; } }; return o; }
};

/* ---------------- date nel fuso di Roma ---------------- */
export function partiRoma(d) {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short', hourCycle: 'h23' });
  const o = {}; f.formatToParts(d).forEach(p => { o[p.type] = p.value; }); return o;
}
export function fmtData(d, p) {
  const o = partiRoma(d instanceof Date ? d : new Date(d)), u = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[o.weekday];
  return p.replace(/yyyy|MM|dd|HH|mm|ss|u/g, t => ({ yyyy: o.year, MM: o.month, dd: o.day, HH: o.hour, mm: o.minute, ss: o.second, u: String(u) })[t]);
}
function uuid() { return crypto.randomUUID(); }
