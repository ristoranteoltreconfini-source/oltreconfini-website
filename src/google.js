// Accesso al pannello con l'account Google (OpenID Connect).
// Entra solo chi è nell'elenco «Persone» del pannello: il titolare lo gestisce da Configurazione → Persone.
// Servono due segreti nel Worker: GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (Google Cloud → Credenziali → ID client OAuth).
import { AMB } from './gas.js';

const DURATA = 30 * 864e5;            // la sessione dura 30 giorni
const COOKIE = 'oc_sessione', STATO = 'oc_stato';

export const googleAttivo = env => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
const ritorno = url => url.origin + '/pannello/google';
const casuale = () => (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
const biscotti = req => Object.fromEntries((req.headers.get('cookie') || '').split(/;\s*/).filter(Boolean).map(x => { const i = x.indexOf('='); return [x.slice(0, i), x.slice(i + 1)]; }));
const biscotto = (n, v, sec, path) => `${n}=${v}; Path=${path || '/pannello'}; Max-Age=${sec}; HttpOnly; Secure; SameSite=Lax`;

function tabella() { AMB.sql.exec('CREATE TABLE IF NOT EXISTS sessioni (id TEXT PRIMARY KEY, email TEXT NOT NULL, scade INTEGER NOT NULL)'); }

// chi è collegato (email) oppure null
export function utente(req) {
  tabella();
  const id = biscotti(req)[COOKIE]; if (!id || !/^[a-f0-9]{64}$/.test(id)) return null;
  const r = AMB.sql.exec('SELECT email, scade FROM sessioni WHERE id=?', id).toArray()[0];
  if (!r || r.scade < Date.now()) return null;
  return r.email;
}

// 1. il pulsante «Accedi con Google» porta qui → Google
export function vaiAGoogle(req, env) {
  const url = new URL(req.url), stato = casuale();
  const q = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: ritorno(url), response_type: 'code', scope: 'openid email profile',
    state: stato, prompt: 'select_account', access_type: 'online' });
  return new Response(null, { status: 302, headers: { location: 'https://accounts.google.com/o/oauth2/v2/auth?' + q, 'set-cookie': biscotto(STATO, stato, 600) } });
}

// 2. Google rimanda qui: si verifica chi è e si apre la sessione
export async function daGoogle(req, env, ammesso) {
  const url = new URL(req.url), code = url.searchParams.get('code'), stato = url.searchParams.get('state');
  if (!code || !stato || stato !== biscotti(req)[STATO]) return pagina('Accesso non riuscito: riprova.', true);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: ritorno(url), grant_type: 'authorization_code' }) });
  if (!r.ok) return pagina('Google non ha confermato l’accesso: riprova.', true);
  const j = await r.json();
  // il token arriva direttamente da Google su connessione sicura: basta controllarne i campi
  let d = {}; try { d = JSON.parse(atob(String(j.id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) {}
  const email = String(d.email || '').toLowerCase();
  if (d.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(d.iss) || !d.email_verified || !(d.exp * 1000 > Date.now()) || !email)
    return pagina('Accesso non riuscito: riprova.', true);
  tabella();
  if (!ammesso(email)) return pagina('L’account ' + esc(email) + ' non ha accesso al pannello. Chiedi al titolare di aggiungerti (Configurazione → Persone) con questa email.', true);
  const id = casuale();
  AMB.sql.exec('DELETE FROM sessioni WHERE scade < ?', Date.now());
  AMB.sql.exec('INSERT INTO sessioni (id, email, scade) VALUES (?,?,?)', id, email, Date.now() + DURATA);
  const h = new Headers({ location: '/pannello' });
  h.append('set-cookie', biscotto(COOKIE, id, DURATA / 1000)); h.append('set-cookie', biscotto(STATO, '', 0));
  return new Response(null, { status: 302, headers: h });
}

export function esci(req) {
  tabella(); const id = biscotti(req)[COOKIE]; if (id) AMB.sql.exec('DELETE FROM sessioni WHERE id=?', id);
  return new Response(null, { status: 302, headers: { location: '/pannello', 'set-cookie': biscotto(COOKIE, '', 0) } });
}
// quando una persona viene tolta dal pannello: fuori anche dalle sessioni aperte
export function chiudiSessioni(email) { tabella(); AMB.sql.exec('DELETE FROM sessioni WHERE email=?', String(email).toLowerCase()); }

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export function pagina(msg, errore) {
  const html = `<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex">
<title>Oltreconfini · Pannello</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0b121c;color:#efe6d2;font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px;box-sizing:border-box}
main{max-width:380px}h1{font:italic 34px Georgia,serif;margin:0 0 4px}small{letter-spacing:.25em;color:#c9ae7c;font-size:12px}p{color:#c8c0b0}.e{color:#f0b4a4}
a.g{display:inline-flex;align-items:center;gap:10px;margin-top:22px;background:#fff;color:#1f1f1f;text-decoration:none;font-weight:600;padding:13px 22px;border-radius:6px}</style></head>
<body><main><h1>Oltreconfini</h1><small>PANNELLO</small>${msg ? `<p class="${errore ? 'e' : ''}">${msg}</p>` : ''}
<a class="g" href="/pannello/accedi"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#4285F4" d="M45 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h11.8c-.5 2.7-2 5-4.4 6.6v5.5h7.1c4.1-3.8 6.5-9.4 6.5-16.1z"/><path fill="#34A853" d="M24 46c5.9 0 10.9-2 14.5-5.3l-7.1-5.5c-2 1.3-4.5 2.1-7.4 2.1-5.7 0-10.5-3.8-12.2-9H4.5v5.7C8.1 41.1 15.5 46 24 46z"/><path fill="#FBBC05" d="M11.8 28.3c-.4-1.3-.7-2.8-.7-4.3s.3-3 .7-4.3V14H4.5C3 17 2 20.4 2 24s1 7 2.5 10l7.3-5.7z"/><path fill="#EA4335" d="M24 10.7c3.2 0 6.1 1.1 8.4 3.3l6.3-6.3C34.9 4.2 29.9 2 24 2 15.5 2 8.1 6.9 4.5 14l7.3 5.7c1.7-5.2 6.5-9 12.2-9z"/></svg>Accedi con Google</a></main></body></html>`;
  return new Response(html, { status: errore ? 403 : 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
