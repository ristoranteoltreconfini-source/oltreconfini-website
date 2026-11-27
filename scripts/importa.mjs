// Importazione iniziale: i fogli Google pubblici (menù, eventi, avvisi, vini, bevande, domande, orari, prezzi,
// impostazioni) diventano il database del nuovo sistema.
//   node scripts/importa.mjs scarica                     → scarica i fogli in migrazione/dati
//   node scripts/importa.mjs invia <indirizzo> <email>   → li manda al sistema (serve ADMIN_TOKEN nell'ambiente)
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

const DIR = new URL('../migrazione/dati/', import.meta.url).pathname;
const FOGLI = {
  menu: '17VDTk8vTuRRGopyZX1Xurbn2HeKW7UybRyaMOI4SGdk', speciali: '1pUILHxGPZY4pVVKz30u6kKz4qjc-2VkfM_wvNrxw9yI',
  oggi: '1v_NRS6B0PGeC2fCGgbp8Myrp45ZGUbUPI9fAbl9Viso', avvisi: '13APEOWk5UfT-UKSeQwimxqCDEv2IPVpj_aZZLZmPvig',
  vini: '1-0z5yJQEZGXKPylGXmVyayMo8MxCSr8Hzqds6wjrhHw', bevande: '1YRDF5-ylgRLAHKflsOT0bA5tR5KGI0ACIERCyqR0krA',
  faq: '10hYZp8qGAr9u4ZR1MNMUYZ1ZUmQgBZcCoSoVDRbJQ_A', opinioni: '1Xv-dDcraWsFk-x60C1va0w3h3W9Mwv8GsGnlwDszoEs'
};
const RISERVA = { menu: '1qzLLSIVL9OhBv-mTW1DG3_IQrYnpTu3d_m_s7jgi_1U', speciali: '1rHk3fJJ26kJJHBgCk08H3JNaK7g7KdcdhUjyfgVzro4' };
// [chiave, foglio, scheda nel file Google, scheda nel nuovo sistema]
const SCHEDE = [['menu', 'menu', '', 'Menù'], ['menu-Categorie', 'menu', 'Categorie', 'Categorie'], ['speciali', 'speciali', '', 'Eventi'],
  ['oggi', 'oggi', '', 'Menù della settimana'], ['oggi-Prezzi formule', 'oggi', 'Prezzi formule', 'Prezzi formule'], ['oggi-Orari', 'oggi', 'Orari', 'Orari'],
  ['oggi-Impostazioni', 'oggi', 'Impostazioni', 'Impostazioni'], ['avvisi', 'avvisi', '', 'Avvisi'], ['vini', 'vini', '', 'Vini'],
  ['bevande', 'bevande', '', 'Bevande'], ['faq', 'faq', '', 'Domande']];

function csv(t) {
  const out = []; let r = [], c = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); out.push(r); r = []; c = ''; }
    else c += ch;
  }
  if (c !== '' || r.length) { r.push(c); out.push(r); }
  return out;
}

const [, , cmd, indirizzo, email] = process.argv;
if (cmd === 'scarica') {
  mkdirSync(DIR, { recursive: true });
  for (const [k, f, scheda] of SCHEDE) {
    const u = `https://docs.google.com/spreadsheets/d/${FOGLI[f]}/gviz/tq?tqx=out:csv&headers=1` + (scheda ? '&sheet=' + encodeURIComponent(scheda) : '');
    const r = await fetch(u); if (!r.ok) throw new Error(k + ': ' + r.status);
    writeFileSync(DIR + k + '.csv', await r.text()); console.log('scaricato', k);
  }
} else if (cmd === 'invia') {
  if (!indirizzo || !process.env.ADMIN_TOKEN) throw new Error('Uso: ADMIN_TOKEN=… node scripts/importa.mjs invia https://indirizzo/ email-titolare');
  const sito = indirizzo.replace(/\/?$/, '/'), fogli = [];
  SCHEDE.forEach(([k, f, scheda, nome], i) => {
    if (!existsSync(DIR + k + '.csv')) return;
    let righe = csv(readFileSync(DIR + k + '.csv', 'utf8'));
    if (k === 'oggi-Impostazioni') {           // il sito manda prenotazioni e opinioni al nuovo sistema
      const imposta = (chiave, v) => { const r = righe.find(x => String(x[0]).trim().toLowerCase() === chiave.toLowerCase()); if (r) r[1] = v; else righe.push([chiave, v]); };
      imposta('opinioni', '/api'); imposta('Indirizzo del sito', sito);
    }
    fogli.push({ ss: FOGLI[f], nome, pos: i, righe });
    if (RISERVA[f] && !scheda) fogli.push({ ss: RISERVA[f], nome, pos: 0, righe });
  });
  if (!fogli.some(f => f.ss === FOGLI.oggi && f.nome === 'Impostazioni')) fogli.push({ ss: FOGLI.oggi, nome: 'Impostazioni', pos: 9, righe: [['Chiave', 'Valore'], ['opinioni', '/api'], ['Indirizzo del sito', sito]] });
  fogli.push({ ss: FOGLI.opinioni, nome: 'Opinioni', pos: 0, righe: [['Data', 'Ora', 'Cosa ha preso', 'Cucina', 'Pizza', 'Sala', 'Ambiente', 'Attesa', 'Ritiro', 'Media',
    'Cosa è piaciuto', 'Cosa migliorare', 'Vorrebbe trovare', 'Lingua', 'Stato', 'Nota interna', 'Piaciuto (italiano)', 'Da migliorare (italiano)', 'Vorrebbe (italiano)']] });
  const owner = String(email || '').toLowerCase().trim();
  const prop = { PANNELLO: sito + 'pannello', 'FOGLI-V': '8', 'PR-TRIG': 'v3-3' };
  if (owner) { prop.OWNER = owner; prop.PERSONE = [{ email: owner, nome: '', ruolo: 'admin', sezioni: ['pren', 'oggi', 'orari', 'piatti', 'eventi', 'avvisi', 'vini', 'bevande', 'opinioni', 'faq'], promemoria: true }]; }
  const r = await fetch(sito + '_importa', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.ADMIN_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ fogli, prop }) });
  console.log(r.status, await r.text());
} else console.log('Comandi: scarica | invia <indirizzo> <email>');
