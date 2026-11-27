// Fa leggere al sito i dati dal nuovo sistema (Cloudflare) invece che da Google.
// Si esegue una volta: node scripts/aggiorna-sito.mjs  (rieseguirlo non cambia nulla)
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const radice = new URL('../public/', import.meta.url).pathname;
const html = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? html(p) : f.endsWith('.html') ? [p] : []; });
const hash = s => "'sha256-" + createHash('sha256').update(s, 'utf8').digest('base64') + "'";
const script = t => [...t.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*ld\+json)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);

for (const f of html(radice)) {
  const prima = readFileSync(f, 'utf8');
  let t = prima
    .replace(/https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)\/gviz\/tq/g, '/dati/d/$1')
    .replace(/https:\/\/lh3\.googleusercontent\.com\/d\//g, '/foto/')
    .replaceAll('/^https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[\\w-]+\\/exec$/', '/^(https:\\/\\/script\\.google\\.com\\/macros\\/s\\/[\\w-]+\\/exec|\\/api)$/')
    .replace(/ https:\/\/lh3\.googleusercontent\.com(?=[;\s])/g, '')
    .replace(/ https:\/\/docs\.google\.com https:\/\/\*\.googleusercontent\.com https:\/\/script\.google\.com/g, '');
  // gli script nella pagina sono cambiati: si aggiornano le loro impronte nella Content-Security-Policy
  const vecchi = script(prima).map(hash), nuovi = script(t).map(hash);
  vecchi.forEach((h, i) => { if (h !== nuovi[i]) t = t.split(h).join(nuovi[i]); });
  if (t !== prima) { writeFileSync(f, t); console.log('aggiornato', f.slice(radice.length)); }
}
