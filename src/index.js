// Oltreconfini su Cloudflare: il sito (file statici), i dati che il sito legge, il pannello, le prenotazioni.
// Tutti i dati stanno in un solo Durable Object con database SQLite, conservato nell'Unione Europea.
import { DurableObject } from 'cloudflare:workers';
import { AMB, preparaDb, CAMBIATI, DA_TRADURRE, importaFoglio, leggiFoglio, leggiFile, CacheService, PropertiesService } from './gas.js';
import * as B from './backend.js';
import { ricalcolaAuto, traduciInCoda } from './auto.js';
import { inviaPosta } from './posta.js';

const SHIM = `<script>var google={script:{run:(function(){function R(ok,ko){this._ok=ok;this._ko=ko}
R.prototype.withSuccessHandler=function(f){return new R(f,this._ko)};R.prototype.withFailureHandler=function(f){return new R(this._ok,f)};
R.prototype.api=function(k,fn,args){var s=this;fetch('/pannello/api',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:k,fn:fn,args:args||[]})})
.then(function(r){return r.json()}).then(function(j){if(j.ok){if(s._ok)s._ok(j.r)}else if(s._ko)s._ko(new Error(j.err||'Errore'))})
.catch(function(){if(s._ko)s._ko(new Error('Connessione assente: riprova'))})};return new R()})()}};</script>`;

export class Oltreconfini extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    preparaDb(this.sql);
  }
  _pronto() {
    AMB.sql = this.sql; AMB.env = this.env;
    AMB.owner = String(this.env.OWNER_EMAIL || '').toLowerCase();
  }
  // dopo ogni operazione: colonne «(auto)», traduzioni, email. Non fa aspettare chi ha fatto la richiesta.
  _dopo() {
    const fogli = [...CAMBIATI]; CAMBIATI.clear();
    if (fogli.length) ricalcolaAuto(fogli);
    CAMBIATI.clear();
    const lavoro = (async () => {
      try { if (DA_TRADURRE.size) { await traduciInCoda(this.env); this._pronto(); if (fogli.length) { ricalcolaAuto(fogli); CAMBIATI.clear(); } } } catch (e) { console.log('traduzioni', e.message); }
      try { this._pronto(); await inviaPosta(this.env); } catch (e) { console.log('posta', e.message); }
    })();
    this.ctx.waitUntil(lavoro);
  }

  async fetch(req) {
    this._pronto();
    const url = new URL(req.url), p = url.pathname;
    try {
      // dati letti dal sito, nello stesso formato CSV dei fogli Google di prima
      let m = p.match(/^\/dati\/d\/([\w-]+)$/);
      if (m) {
        const v = leggiFoglio(m[1], url.searchParams.get('sheet') || '');
        if (!v) return new Response('Non trovato', { status: 404 });
        return new Response(csv(v), { headers: { 'content-type': 'text/csv; charset=utf-8', 'cache-control': 'public, max-age=15', 'access-control-allow-origin': '*' } });
      }
      m = p.match(/^\/foto\/([\w-]+)(?:=w\d+)?$/);
      if (m) return await this.foto(m[1]);
      // il sito: posti liberi, prenotazioni, opinioni (come prima l'App web di Google)
      if (p === '/api') {
        const out = req.method === 'POST'
          ? await B.doPost({ postData: { contents: (await req.text()).slice(0, 8000) } })
          : B.doGet({ parameter: Object.fromEntries(url.searchParams) });
        this._dopo();
        return risposta(out, { 'access-control-allow-origin': '*' });
      }
      if (p === '/pannello') {
        const k = url.searchParams.get('k') || '';
        const out = B.doGet({ parameter: Object.fromEntries(url.searchParams) });
        this._dopo();
        if (/html/.test(out.tipo)) out.testo = out.testo.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Oltreconfini · Pannello</title>' + SHIM);
        return risposta(out, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }, k ? 200 : 403);
      }
      if (p === '/pannello/api' && req.method === 'POST') {
        let j; try { j = JSON.parse(await req.text()); } catch (e) { return json({ ok: false, err: 'Richiesta non valida.' }, 400); }
        if (troppe(String(j.k || '').slice(0, 12))) return json({ ok: false, err: 'Troppe richieste: aspetta un minuto.' }, 429);
        try { const r = await B.api(j.k, String(j.fn || ''), j.args); this._dopo(); return json({ ok: true, r: r === undefined ? null : r }); }
        catch (e) { this._dopo(); return json({ ok: false, err: String(e && e.message || e).replace(/^Error:\s*/, '') }); }
      }
      return new Response('Non trovato', { status: 404 });
    } catch (e) {
      console.log('errore', e.stack || e);
      return new Response('Errore interno', { status: 500 });
    }
  }

  async foto(id) {
    let f = leggiFile(id);
    if (!f && !/^ft_/.test(id)) {           // foto ancora su Google Drive: si copia qui la prima volta che serve
      let r = null; try { r = await fetch('https://lh3.googleusercontent.com/d/' + id + '=w1400'); } catch (e) {}
      if (r && r.ok && /^image\//.test(r.headers.get('content-type') || '')) {
        const b = new Uint8Array(await r.arrayBuffer());
        this._pronto(); this.sql.exec('INSERT OR REPLACE INTO file (id, tipo, nome, dati, creato) VALUES (?,?,?,?,?)', id, r.headers.get('content-type'), 'da Drive', b, Date.now());
        f = leggiFile(id);
      }
    }
    if (!f) return new Response('Non trovata', { status: 404 });
    return new Response(f.dati, { headers: { 'content-type': f.tipo || 'image/jpeg', 'cache-control': 'public, max-age=31536000, immutable' } });
  }

  // lavori programmati (ogni minuto)
  async programmati(quando) {
    this._pronto();
    const d = new Date(quando), min = d.getUTCMinutes(), ora = B.oraRoma(d);
    const fai = (n, f) => { try { f(); } catch (e) { console.log(n, e.message); } };
    fai('prInvia', () => B.prInvia());
    if (min % 5 === 0) fai('prControlla', () => B.prControlla());
    if (min % 30 === 0) fai('promemoria', () => B.promemoria());
    if (ora.m === 0) {
      let oraPul = 3; try { oraPul = B.oraPulizia(); } catch (e) {}
      if (ora.h === oraPul) { fai('prNotte', () => B.prNotte()); fai('cache', () => CacheService.getScriptCache().pulisci()); }
      if (ora.h === 3) fai('copiaRiserva', () => B.copiaRiserva());
    }
    fai('registro', () => B.registroScarica_());
    this._dopo();
  }

  // prima messa in funzione: dati dei fogli e impostazioni (solo con la chiave di amministrazione)
  importa(dati) {
    this._pronto();
    (dati.fogli || []).forEach(f => importaFoglio(f.ss, f.nome, f.righe, f.pos));
    const P = PropertiesService.getScriptProperties();
    Object.entries(dati.prop || {}).forEach(([k, v]) => P.setProperty(k, typeof v === 'string' ? v : JSON.stringify(v)));
    ricalcolaAuto([...new Set((dati.fogli || []).map(f => f.ss))], true); CAMBIATI.clear();
    this._dopo();
    return { ok: true, fogli: (dati.fogli || []).length, daTradurre: DA_TRADURRE.size };
  }
  linkDi(email) {
    this._pronto();
    email = String(email || this.env.OWNER_EMAIL || '').toLowerCase();
    const p = B.persone_();
    if (!p.some(x => x.email === email)) { p.push({ email, nome: '', ruolo: email === B.proprietario_() ? 'admin' : 'personale', sezioni: ['pren', 'opinioni'], promemoria: false }); B.salvaPersone_(p); }
    const ch = B.chiavi_();
    if (!ch[email]) { ch[email] = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty('CHIAVI', JSON.stringify(ch)); }
    return PropertiesService.getScriptProperties().getProperty('PANNELLO') + '?k=' + ch[email];
  }
}

const csv = v => {
  let n = v.length; while (n > 0 && !(v[n - 1] || []).some(x => x !== '')) n--;
  let c = 0; v.slice(0, n).forEach(r => { for (let j = r.length - 1; j >= 0; j--) if (r[j] !== '') { c = Math.max(c, j + 1); break; } });
  return v.slice(0, n).map(r => Array.from({ length: c }, (_, j) => '"' + String(r[j] == null ? '' : r[j]).replace(/"/g, '""') + '"').join(',')).join('\n');
};
const json = (o, s) => new Response(JSON.stringify(o), { status: s || 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const risposta = (o, h, s) => new Response(o.testo, { status: s || 200, headers: Object.assign({ 'content-type': o.tipo }, h || {}) });
// al massimo 120 operazioni al minuto per persona (contro gli abusi)
const CONTA = new Map();
function troppe(chi) { const m = Math.floor(Date.now() / 60000), k = chi + ':' + m, n = (CONTA.get(k) || 0) + 1; CONTA.set(k, n); if (CONTA.size > 500) CONTA.clear(); return n > 120; }

// dati conservati nell'UE (in locale la giurisdizione non esiste: si usa quella normale)
const stub = env => { let ns = env.OLTRECONFINI; try { ns = ns.jurisdiction('eu'); return ns.get(ns.idFromName('principale')); } catch (e) { return env.OLTRECONFINI.get(env.OLTRECONFINI.idFromName('principale')); } };
const ammin = (req, env) => env.ADMIN_TOKEN && req.headers.get('authorization') === 'Bearer ' + env.ADMIN_TOKEN;

export default {
  async fetch(req, env) {
    const url = new URL(req.url), p = url.pathname;
    if (/^\/(dati\/d\/|foto\/|api$|pannello(\/api)?$)/.test(p)) return stub(env).fetch(req);
    if (p === '/_importa' && req.method === 'POST') { if (!ammin(req, env)) return new Response('No', { status: 403 }); return json(await stub(env).importa(await req.json())); }
    if (p === '/_link') { if (!ammin(req, env)) return new Response('No', { status: 403 }); return json({ link: await stub(env).linkDi(url.searchParams.get('email')) }); }
    return env.ASSETS.fetch(req);
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(stub(env).programmati(ev.scheduledTime)); }
};
