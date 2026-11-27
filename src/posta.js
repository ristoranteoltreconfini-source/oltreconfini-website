// Invio delle email messe in coda (conferme, promemoria, avvisi al personale).
// Servizio: Resend (resend.com, server in UE). Senza chiave le email restano in coda e si vedono nei log.
import { AMB } from './gas.js';

export async function inviaPosta(env) {
  const righe = AMB.sql.exec('SELECT id, msg, tentativi FROM posta ORDER BY id LIMIT 20').toArray();
  for (const r of righe) {
    const m = JSON.parse(r.msg);
    if (!env.RESEND_API_KEY) { console.log('[email non inviata: manca RESEND_API_KEY]', m.to.join(', '), '·', m.subject); AMB.sql.exec('DELETE FROM posta WHERE id=?', r.id); continue; }
    let ok = false;
    try {
      const mitt = env.EMAIL_MITTENTE || 'Oltreconfini <prenotazioni@oltreconfini.it>';
      const res = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: m.name ? mitt.replace(/^[^<]*</, m.name.replace(/[<>"]/g, '') + ' <') : mitt, to: m.to, subject: m.subject, html: m.html,
          reply_to: m.replyTo || undefined, attachments: m.attachments && m.attachments.length ? m.attachments.map(a => ({ filename: a.filename, content: a.content })) : undefined }) });
      ok = res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429);      // errore definitivo (indirizzo sbagliato): non si riprova
      if (!res.ok) console.log('resend', res.status, (await res.text()).slice(0, 200));
    } catch (e) { console.log('resend', e.message); }
    if (ok || r.tentativi >= 5) AMB.sql.exec('DELETE FROM posta WHERE id=?', r.id);
    else AMB.sql.exec('UPDATE posta SET tentativi=tentativi+1 WHERE id=?', r.id);
  }
}
