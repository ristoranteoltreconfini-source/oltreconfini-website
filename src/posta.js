// Invio delle email messe in coda (conferme, promemoria, avvisi al personale).
// Servizio: Resend (resend.com, server in UE). Senza chiave le email restano in coda e si vedono nei log.
import { AMB } from './gas.js';

// versione «solo testo» dell'email, ricavata dalla grafica: i programmi di posta mostrano comunque la grafica,
// ma i filtri antispam si fidano di più delle email che hanno entrambe le versioni
export function soloTesto(html) {
  return String(html || '')
    .replace(/<head[\s\S]*?<\/head>/i, '').replace(/<div style="display:none[\s\S]*?<\/div>/i, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (m, u, x) => { x = x.replace(/<[^>]+>/g, '').trim(); return /^(mailto:|tel:)/.test(u) || x === u.replace(/^https?:\/\//, '').replace(/\/$/, '') ? x : x + ': ' + u; })
    .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|h1|h2|h3|tr|div|table)>/gi, '\n\n').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .split('\n').map(x => x.replace(/[ \t]+/g, ' ').trim()).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
export async function inviaPosta(env) {
  const righe = AMB.sql.exec('SELECT id, msg, tentativi FROM posta ORDER BY id LIMIT 20').toArray();
  for (const r of righe) {
    const m = JSON.parse(r.msg);
    if (!env.RESEND_API_KEY) { console.log('[email non inviata: manca RESEND_API_KEY]', m.to.join(', '), '·', m.subject); AMB.sql.exec('DELETE FROM posta WHERE id=?', r.id); continue; }
    let ok = false;
    try {
      const mitt = env.EMAIL_MITTENTE || 'Oltreconfini <prenotazioni@oltreconfini.it>';
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: m.name ? mitt.replace(/^[^<]*</, m.name.replace(/[<>"]/g, '') + ' <') : mitt, to: m.to, subject: m.subject, html: m.html, text: soloTesto(m.html),
          reply_to: m.replyTo || undefined, attachments: m.attachments && m.attachments.length ? m.attachments.map(a => ({ filename: a.filename, content: a.content })) : undefined }) });
      ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);      // errore definitivo (indirizzo sbagliato): non si riprova
      if (!res.ok) console.log('resend', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.log('resend', e.message); }
    if (ok || r.tentativi >= 5) AMB.sql.exec('DELETE FROM posta WHERE id=?', r.id);
    else AMB.sql.exec('UPDATE posta SET tentativi=tentativi+1 WHERE id=?', r.id);
  }
}
