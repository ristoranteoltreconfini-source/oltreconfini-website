// Colonne «(auto)» dei fogli: prima erano formule di Google (traduzioni e copie in testo).
// Qui si ricalcolano dopo ogni modifica: copie subito, traduzioni dalla memoria o, se nuove, con l'IA.
import { AMB, DA_TRADURRE, LanguageApp } from './gas.js';

const LINGUE = { EN: 'en', DE: 'de', FR: 'fr' };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’']/g, "'").trim();

// per ogni colonna «(auto)»: da quale colonna prende il testo e cosa ne fa
function regole(h) {
  const fonti = h.map((x, i) => ({ i, n: norm(x) })).filter(c => c.n && !/\(auto\)|\(correzione\)/.test(c.n) && !/^(en|de|fr)\b/.test(c.n));
  const fonte = parola => { const p = norm(parola).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), re = new RegExp('^' + p + '(?![a-z])'); const c = fonti.find(x => re.test(x.n)); return c ? c.i : -1; };
  return h.map((x, i) => {
    let m = String(x).trim().match(/^(EN|DE|FR) (.+) \(auto\)$/);
    if (m) return { i, lingua: LINGUE[m[1]], da: fonte(m[2]) };
    m = String(x).trim().match(/^(.+) testo \(auto\)$/i);
    if (m) return { i, copia: true, da: fonte(m[1]) };
    return null;
  }).filter(r => r && r.da >= 0);
}

// semina = true (importazione): le traduzioni già presenti nei fogli diventano la memoria, così non si rifanno
export function ricalcolaAuto(fogli, semina) {
  fogli.forEach(ss => {
    AMB.sql.exec('SELECT nome, dati FROM fogli WHERE ss=?', ss).toArray().forEach(({ nome, dati }) => {
      const v = JSON.parse(dati), h = v[0] || [], R = regole(h); if (!R.length) return;
      let cambiato = false;
      v.slice(1).forEach(r => R.forEach(g => {
        const src = String(r[g.da] == null ? '' : r[g.da]).trim();
        const prima = String(r[g.i] == null ? '' : r[g.i]);
        if (semina && !g.copia && src && prima) AMB.sql.exec('INSERT OR IGNORE INTO traduzioni (k, v) VALUES (?,?)', 'it|' + g.lingua + '|' + src, prima);
        let val = g.copia ? src : (src ? LanguageApp.translate(src, 'it', g.lingua) : '');
        if (!g.copia && src && !val) val = prima;       // traduzione in arrivo: si tiene quella di prima
        while (r.length <= g.i) r.push('');
        if (r[g.i] !== val) { r[g.i] = val; cambiato = true; }
      }));
      if (cambiato) AMB.sql.exec('UPDATE fogli SET dati=? WHERE ss=? AND nome=?', JSON.stringify(v), ss, nome);
    });
  });
}

const NOMI = { it: 'italiano', en: 'inglese', de: 'tedesco', fr: 'francese', '': 'lingua da riconoscere' };
// traduce tutto ciò che è in coda: prima con Gemini (se c'è la chiave), altrimenti con l'IA di Cloudflare
export async function traduciInCoda(env) {
  const voci = [...DA_TRADURRE.entries()]; DA_TRADURRE.clear();
  for (let i = 0; i < voci.length; i += 40) {
    const pezzo = voci.slice(i, i + 40); let fatte = null;
    if (env.GEMINI_API_KEY) try { fatte = await conGemini(env, pezzo); } catch (e) { console.log('gemini', e.message); }
    if (!fatte && env.AI) try { fatte = await conCloudflare(env, pezzo); } catch (e) { console.log('workers ai', e.message); }
    if (!fatte) continue;
    pezzo.forEach(([k], j) => { const t = String(fatte[j] || '').trim(); if (t) AMB.sql.exec('INSERT OR REPLACE INTO traduzioni (k, v) VALUES (?,?)', k, t.slice(0, 5000)); });
  }
}
async function conGemini(env, pezzo) {
  const testi = pezzo.map(([, x]) => ({ da: NOMI[x.da] || x.da, a: NOMI[x.a] || x.a, testo: x.testo }));
  const prompt = 'Sei il traduttore del ristorante-pizzeria Oltreconfini (provincia di Varese). Traduci ogni testo dalla lingua indicata alla lingua di arrivo, ' +
    'in modo naturale per il menù e il sito di un ristorante. Non tradurre i nomi propri di piatti tipici italiani (es. «Pizza Margherita», «tiramisù»), di vini, produttori e marchi; mantieni a capo, numeri, prezzi e simboli. ' +
    'Rispondi solo con un array JSON di stringhe, nello stesso ordine e della stessa lunghezza.\n' + JSON.stringify(testi);
  for (const m of ['gemini-flash-lite-latest', 'gemini-2.5-flash-lite', 'gemini-flash-latest']) {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: 'application/json' } }) });
    if (!r.ok) continue;
    const j = await r.json(), t = (((j.candidates || [])[0] || {}).content || {}).parts;
    const a = JSON.parse((t || []).map(p => p.text || '').join('').replace(/^\s*```(json)?/i, '').replace(/```\s*$/, ''));
    if (Array.isArray(a) && a.length === pezzo.length) return a;
  }
  return null;
}
async function conCloudflare(env, pezzo) {
  const out = [];
  for (const [, x] of pezzo) {
    const r = await env.AI.run('@cf/meta/m2m100-1.2b', { text: x.testo, source_lang: x.da || 'it', target_lang: x.a });
    out.push(r && r.translated_text || '');
  }
  return out;
}
