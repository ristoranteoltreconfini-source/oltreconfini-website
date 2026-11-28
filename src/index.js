// Oltreconfini su Cloudflare: il sito (file statici), i dati che il sito legge, il pannello, le prenotazioni.
// Tutti i dati stanno in un solo Durable Object con database SQLite, conservato nell'Unione Europea.
import { DurableObject } from 'cloudflare:workers';
import { AMB, preparaDb, CAMBIATI, DA_TRADURRE, importaFoglio, leggiFoglio, leggiFile, CacheService, PropertiesService } from './gas.js';
import * as B from './backend.js';
import { ricalcolaAuto, traduciInCoda } from './auto.js';
import { inviaPosta } from './posta.js';
import { leggiRecensione } from './email-recensioni.js';
import { chiaviVapid, iscrivi, invia } from './push.js';
import { googleAttivo, vaiAGoogle, vaiAGoogleRecensioni, daGoogle, esci, utente, pagina } from './google.js';

const PUSH = `<link rel="manifest" href="/manifest-pannello.json"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="theme-color" content="#0b121c"><script>
(function(){if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return;
var b64=function(s){s=s.replace(/-/g,'+').replace(/_/g,'/');var r=atob(s+'==='.slice((s.length+3)%4)),u=new Uint8Array(r.length);for(var i=0;i<r.length;i++)u[i]=r.charCodeAt(i);return u};
function bottone(){if(document.getElementById('pn-push'))return;var b=document.createElement('button');b.id='pn-push';b.type='button';b.textContent='🔔 Attiva le notifiche delle prenotazioni';
 b.style.cssText='position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;padding:14px;border:0;border-radius:10px;background:#c9ae7c;color:#0b121c;font:600 15px system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3)';
 b.onclick=function(){b.disabled=true;b.textContent='Un attimo…';Notification.requestPermission().then(function(p){if(p!=='granted')throw new Error('no');
   return navigator.serviceWorker.register('/pannello-sw.js',{scope:'/'}).then(function(){return navigator.serviceWorker.ready}).then(function(r){return fetch('/pannello/push-chiave').then(function(x){return x.json()}).then(function(k){return r.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:b64(k.pub)})})})
  }).then(function(sub){return fetch('/pannello/push-iscrivi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:window.CHIAVE,sub:sub.toJSON()})})}).then(function(){b.textContent='✓ Notifiche attive su questo telefono';setTimeout(function(){b.remove()},2500)})
  .catch(function(){b.disabled=false;b.textContent=Notification.permission==='denied'?'Notifiche bloccate: attivale nelle impostazioni del telefono':'Non riuscito: riprova';setTimeout(function(){b.remove()},4000)})};
 document.body.appendChild(b)}
window.addEventListener('load',function(){if(Notification.permission==='denied')return;navigator.serviceWorker.getRegistration('/').then(function(r){return r?r.pushManager.getSubscription():null}).then(function(s){if(s){fetch('/pannello/push-iscrivi',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({k:window.CHIAVE,sub:s.toJSON()})});return}bottone()}).catch(function(){})});
})();</script>`;
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
    const pc = AMB.pushCoda || []; AMB.pushCoda = [];
    if (pc.length) this.ctx.waitUntil((async () => { try { this._pronto();
      const em = B.persone_().filter(x => B.puoP_(x, 'pren')).map(x => x.email);
      for (const p of pc) { const d = B.dataPr_(B.giornoPr_(p.iso), 'it');
        await invia(em, { titolo: '🍽 Nuova prenotazione', testo: d.charAt(0).toUpperCase() + d.slice(1) + ' · ' + p.h + ' · ' + p.n + (p.n === 1 ? ' persona' : ' persone') + ' · ' + p.nm, url: '/pannello?t=pren', tag: 'pren-' + p.iso + p.h }, this.env.OWNER_EMAIL || 'info@oltreconfini.it'); }
    } catch (e) { console.log('push', e.message); } })());
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
      // accesso con Google
      const ammesso = e => B.persone_().some(x => x.email === e);
      if (p === '/pannello/accedi') return googleAttivo(this.env) ? vaiAGoogle(req, this.env) : pagina('Accesso con Google non ancora configurato: usa il link personale ricevuto per email.', true);
      if (p === '/pannello/google') { const r = await daGoogle(req, this.env, ammesso); if (r.status === 302 && /recensioni=collegate/.test(r.headers.get('location') || '')) this.ctx.waitUntil(B.gbpSincronizza_()); return r; }
      if (p === '/pannello/google-recensioni') {          // solo titolare o vice, già entrati nel pannello
        const e = utente(req), k = url.searchParams.get('k') || '', ch = B.chiavi_(), em = e || Object.keys(ch).find(m => ch[m] === k), x = em ? B.persone_().find(y => y.email === em) : null;
        if (!x || (x.ruolo !== 'admin' && x.ruolo !== 'vice')) return pagina('Solo il titolare o il vice possono collegare le recensioni Google: entra prima nel pannello.', true);
        if (!googleAttivo(this.env)) return pagina('Accesso Google non configurato.', true);
        return vaiAGoogleRecensioni(req, this.env);
      }
      if (p === '/pannello/esci') return esci(req);
      if (p === '/pannello') {
        let k = url.searchParams.get('k') || '';
        if (!k) { const e = utente(req); if (e && ammesso(e)) k = this.chiaveDi(e); }
        if (!k) return pagina(googleAttivo(this.env) ? '' : 'Usa il link personale ricevuto per email.', !googleAttivo(this.env));
        const out = B.doGet({ parameter: Object.assign(Object.fromEntries(url.searchParams), { k }) });
        this._dopo();
        if (/html/.test(out.tipo)) out.testo = out.testo.replace('<head>', '<head><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><title>Oltreconfini · Pannello</title>' + PUSH + SHIM);
        return risposta(out, { 'cache-control': 'no-store', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer' }, k ? 200 : 403);
      }
      // notifiche sul telefono: chiave pubblica e iscrizione del dispositivo (solo chi è nel pannello)
      if (p === '/pannello/push-chiave') return json({ pub: (await chiaviVapid()).pub });
      if (p === '/pannello/push-iscrivi' && req.method === 'POST') {
        let j = {}; try { j = JSON.parse(await req.text()); } catch (e) {}
        this._pronto(); const ch = B.chiavi_(), em = Object.keys(ch).find(m => ch[m] === j.k);
        if (!em || !j.sub || !/^https:\/\//.test(j.sub.endpoint || '') || !j.sub.keys) return json({ ok: false }, 403);
        iscrivi(em, j.sub); return json({ ok: true });
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
    PropertiesService.getScriptProperties().setProperty('ULTIMO-CONTROLLO', String(Date.now()));   // per «Controllo del sistema»
    fai('prInvia', () => B.prInvia());
    if (min % 5 === 0) fai('prControlla', () => B.prControlla());
    if (min % 5 === 2) fai('prRecensioni', () => B.prRecensioni_());
    if (min % 30 === 0) fai('promemoria', () => B.promemoria());
    if (ora.m === 0) {
      let oraPul = 3; try { oraPul = B.oraPulizia(); } catch (e) {}
      if (ora.h === oraPul) { fai('prNotte', () => B.prNotte()); fai('cache', () => CacheService.getScriptCache().pulisci()); }
      if (ora.h === 3) fai('copiaRiserva', () => B.copiaRiserva());
    }
    if (min === 7) { try { await B.gbpSincronizza_(); this._pronto(); } catch (e) { console.log('recensioni', e.message); } }   // recensioni Google, ogni ora
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
  // la chiave del pannello di una persona (creata se manca): con l'accesso Google la pagina la usa senza mostrarla
  chiaveDi(email) {
    const ch = B.chiavi_();
    if (!ch[email]) { ch[email] = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, ''); PropertiesService.getScriptProperties().setProperty('CHIAVI', JSON.stringify(ch)); }
    return ch[email];
  }
  // email arrivata a recensioni@: se è una notifica di Google «nuova recensione», va nella dashboard Opinioni
  emailRecensione(raw, oggetto, da) {
    this._pronto();
    this.sql.exec('CREATE TABLE IF NOT EXISTS mail_in (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, da TEXT, oggetto TEXT, raw TEXT, esito TEXT)');
    let r = { nome: '', stelle: 0, commento: '' };
    if (/google\.com$/i.test(da) && !/forwarding-noreply/i.test(da)) { try { r = leggiRecensione(raw, oggetto); } catch (e) {} }
    const ok = r.stelle >= 1 && r.stelle <= 5;
    this.sql.exec('INSERT INTO mail_in (ts, da, oggetto, raw, esito) VALUES (?,?,?,?,?)', Date.now(), da, oggetto, raw.slice(0, 200000), ok ? 'recensione' : 'altro');
    this.sql.exec('DELETE FROM mail_in WHERE id NOT IN (SELECT id FROM mail_in ORDER BY id DESC LIMIT 30)');      // si tengono solo le ultime, per controllo
    if (!ok) return { recensione: false };
    let h = 0; const k = r.nome + '|' + r.commento + '|' + new Date().toISOString().slice(0, 10); for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) >>> 0;
    B.gbpScrivi_([{ reviewId: 'mail-' + h.toString(36), starRating: ['', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE'][r.stelle], comment: r.commento, createTime: new Date().toISOString() }]);
    return { recensione: true };
  }
  // controllo per l'amministratore: quali configurazioni vede il sistema (solo sì/no, mai i valori)
  stato() { const e = this.env, s = k => !!(e[k] && String(e[k]).trim()); return { google: s('GOOGLE_CLIENT_ID') && s('GOOGLE_CLIENT_SECRET'), gemini: s('GEMINI_API_KEY'), email: s('RESEND_API_KEY'), titolare: s('OWNER_EMAIL'), sito: e.SITO || '' }; }
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
    if (url.hostname === 'www.oltreconfini.it') { url.hostname = 'oltreconfini.it'; return Response.redirect(url.toString(), 301); }   // un solo indirizzo per Google
    if (/^\/(dati\/d\/|foto\/|api$|pannello(\/[a-z-]+)?$)/.test(p)) return stub(env).fetch(req);
    if (p === '/_importa' && req.method === 'POST') { if (!ammin(req, env)) return new Response('No', { status: 403 }); return json(await stub(env).importa(await req.json())); }
    if (p === '/_stato') { if (!ammin(req, env)) return new Response('No', { status: 403 }); const s = k => !!(env[k] && String(env[k]).trim()); return json({ worker: { google: s('GOOGLE_CLIENT_ID') && s('GOOGLE_CLIENT_SECRET'), gemini: s('GEMINI_API_KEY') }, sistema: await stub(env).stato() }); }
    if (p === '/_link') { if (!ammin(req, env)) return new Response('No', { status: 403 }); return json({ link: await stub(env).linkDi(url.searchParams.get('email')) }); }
    return env.ASSETS.fetch(req);
  },
  async email(msg, env) {
    const raw = await new Response(msg.raw).text(), r = await stub(env).emailRecensione(raw.slice(0, 1000000), msg.headers.get('subject') || '', msg.from || '');
    if (!r || !r.recensione) { if (env.OWNER_EMAIL) await msg.forward(env.OWNER_EMAIL); }      // tutto il resto (es. conferma dell'inoltro di Gmail) arriva in Gmail
  },
  async scheduled(ev, env, ctx) { ctx.waitUntil(stub(env).programmati(ev.scheduledTime)); }
};
