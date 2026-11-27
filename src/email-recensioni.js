// Email in arrivo su recensioni@oltreconfini.it (inoltrate da Gmail): le notifiche di Google «nuova recensione»
// diventano righe della dashboard Opinioni. Tutto il resto (es. la conferma dell'inoltro di Gmail) va al Gmail del ristorante.
const qp = s => s.replace(/=\r?\n/g, '').replace(/(=[0-9A-F]{2})+/gi, m => { try { return decodeURIComponent(m.replace(/=/g, '%')); } catch (e) { return m; } });
const b64 = s => { try { const b = atob(s.replace(/\s+/g, '')), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new TextDecoder().decode(u); } catch (e) { return ''; } };
function parti(raw) {                      // tutte le parti testuali, decodificate
  const out = [], vai = (blocco) => {
    const i = blocco.search(/\r?\n\r?\n/); if (i < 0) return;
    const h = blocco.slice(0, i), body = blocco.slice(i).trim(), ct = (h.match(/content-type:\s*([^;\r\n]+)/i) || [])[1] || 'text/plain';
    const bd = (h.match(/boundary="?([^";\r\n]+)"?/i) || [])[1];
    if (/multipart/i.test(ct) && bd) { body.split('--' + bd).slice(1).forEach(p => { if (!/^--/.test(p)) vai(p.replace(/^\r?\n/, '')); }); return; }
    const enc = (h.match(/content-transfer-encoding:\s*(\S+)/i) || [])[1] || '';
    const t = /base64/i.test(enc) ? b64(body) : /quoted/i.test(enc) ? qp(body) : body;
    out.push({ ct: ct.toLowerCase(), t });
  };
  vai(raw); return out;
}
const testo = html => html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<br\s*\/?>|<\/(p|div|tr|td|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&rsquo;/g, '’').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/[ \t]+/g, ' ');
const RUMORE = /rispondi|reply|leggi|visualizza|google llc|amphitheatre|annulla l'iscrizione|unsubscribe|ricevi questa email|privacy|gestisci|business profile|profilo dell.attività|scarica l.app|©/i;

export function leggiRecensione(raw, oggetto) {
  const P = parti(raw), html = P.find(p => /html/.test(p.ct)), pl = P.find(p => /plain/.test(p.ct));
  const t = (pl && pl.t.trim().length > 40 ? pl.t : html ? testo(html.t) : (pl || {}).t || '').replace(/\r/g, '');
  const tutto = oggetto + '\n' + t;
  const nome = ((oggetto.match(/^(?:.*?:\s*)?(.+?)\s+ha (?:lasciato|scritto|pubblicato) una recensione/i) || tutto.match(/\n\s*(.+?)\s+ha (?:lasciato|scritto|pubblicato) una recensione/i) || [])[1] || '').trim();
  let stelle = (t.match(/★/g) || []).length;
  if (!(stelle >= 1 && stelle <= 5)) { const m = tutto.match(/\b([1-5])\s*(?:\/\s*5|su 5|stell[ae]|stars?)\b/i) || tutto.match(/(?:valutazione|rating)\D{0,12}([1-5])\b/i); stelle = m ? +m[1] : 0; }
  // il commento: le righe «di testo vero» dopo il nome, prima dei pulsanti
  const righe = t.split('\n').map(x => x.trim()).filter(Boolean);
  let i0 = righe.findIndex(x => nome && x.indexOf(nome) >= 0); if (i0 < 0) i0 = 0;
  const comm = [];
  for (const x of righe.slice(i0 + 1)) { if (RUMORE.test(x)) { if (comm.length) break; continue; } if (/^[★☆\s]+$/.test(x) || x === nome || /ha (lasciato|scritto) una recensione/i.test(x)) continue; comm.push(x); if (comm.join(' ').length > 1500) break; }
  return { nome, stelle, commento: comm.join(' ').replace(/\s+/g, ' ').trim().slice(0, 1500) };
}
