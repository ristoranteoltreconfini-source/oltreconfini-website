// Il cuore del pannello: è lo script Apps Script originale, che ora gira su Cloudflare.
// I servizi di Google (fogli, email, memoria…) sono sostituiti in gas.js.
import { AMB, SpreadsheetApp, PropertiesService, CacheService, LockService, MailApp, GmailApp, Utilities, DriveApp, Session, ScriptApp, Logger, LanguageApp, UrlFetchApp, ContentService, HtmlService } from './gas.js';
import PAGINA from './pannello.html';
/******************************************************************************
 * OLTRECONFINI – Pannello del sito, promemoria e copie di riserva
 * Un solo file da incollare. Le istruzioni passo passo sono nel riepilogo che vi ho mandato.
 *
 * COSA FA
 *  - PANNELLO (si apre dal telefono come un'app): menù del giorno e prezzi delle formule, piatti
 *    e pizze (con foto), menù speciali ed eventi, chiusure / avvisi / pizza della settimana, vini,
 *    bevande, coperto, domande.
 *    Scrive negli stessi fogli Google che il sito legge: il sito si aggiorna in pochi minuti.
 *  - PROMEMORIA: dal lunedì al sabato, dalle 9:30 alle 12:00, un'email ogni mezz'ora finché il
 *    menù del giorno non è pubblicato.
 *  - COPIE DI RISERVA: ogni notte copia menù e menù speciali in due fogli di riserva.
 *  - OPINIONI: riceve dal sito i voti del modulo "Com'è andata?" (anonimi) e li mostra in una
 *    dashboard nel pannello, visibile anche al socio (solo quella sezione).
 ******************************************************************************/

// TUTTO SI CONFIGURA DAL PANNELLO (sezione Impostazioni): persone, promemoria, indirizzo del sito, link recensioni.
// Nel file "Persone.gs" resta solo la chiave dell'IA (CHIAVE_IA), che è segreta. Le eventuali righe EMAIL / LETTORI / SITO
// rimaste lì servono solo la prima volta, per riempire il pannello; dopo comanda il pannello.
// Il proprietario dello script è sempre nel pannello e non si può togliere: nessuno resta chiuso fuori.
const TZ = 'Europe/Rome';
// impostazioni delle prenotazioni (righe della scheda Impostazioni, si cambiano dal pannello)
// ogni riga: chiave interna → [nome della riga nella scheda Impostazioni, valore iniziale, tipo]
// tipo: [min, max] = numero · 's' = interruttore sì/no · 't' = testo · 'e' = email
const PR_RIGHE = {
  on: ['Prenotazioni online', 'sì', 's'], copL: ['Coperti a pranzo', '40', [0, 999]], copD: ['Coperti a cena', '50', [0, 999]],
  durL: ['Durata del tavolo a pranzo', '90', [30, 300]], durD: ['Durata del tavolo a cena', '120', [30, 300]],
  maxN: ['Persone massime per prenotazione online', '8', [1, 30]], step: ['Intervallo tra gli orari prenotabili', '15', [5, 60]],
  pochi: ['Soglia ultimi posti', '4', [0, 99]], prom: ['Promemoria al cliente, ore prima', '3', [0, 24]],
  avv: ['Ritardo, email dopo', '15', [5, 120]], lib: ['Ritardo, senza risposta dopo', '30', [10, 180]], libAuto: ['Liberazione automatica del tavolo', 'no', 's'],
  etaMax: ['Ritardo massimo concesso al cliente', '60', [5, 180]], etaMarg: ['Ritardo, margine dopo l’orario confermato', '15', [0, 60]],
  emObbl: ['Email obbligatoria anche al telefono', 'no', 's'], doppia: ['Ore per riconoscere un doppione', '4', [0, 24]],
  oraMax: ['Prenotazioni online massime all’ora', '30', [1, 500]], conserva: ['Giorni di conservazione dei dati', '0', [0, 30]],
  oraPul: ['Ora di cancellazione dei dati', '3', [0, 6]], avvisa: ['Avvisami delle prenotazioni per oggi', 'sì', 's'],
  nomeLoc: ['Nome del locale', 'Oltreconfini', 't'], indLoc: ['Indirizzo del locale', 'Via G. Mazzini 82, 21050 Bisuschio (VA)', 't'],
  telLoc: ['Telefono del locale', '+39 0332 475287', 't'], mailLoc: ['Email del locale', 'info@oltreconfini.it', 'e'], notaMail: ['Nota in fondo alle email', '', 't']
};
const PR_IMP = {}, PR_DEF = {}; Object.keys(PR_RIGHE).forEach(k => { PR_IMP[k] = PR_RIGHE[k][0]; PR_DEF[k] = PR_RIGHE[k][1]; });
const proprietario_ = () => { let m = PROP.getProperty('OWNER') || ''; if (!m) { try { m = String(Session.getEffectiveUser().getEmail() || '').toLowerCase(); if (m) PROP.setProperty('OWNER', m); } catch (e) {} } return m; };
// PERSONE E PERMESSI
// ruolo: 'admin' (il titolare: tutto), 'vice' (tutto, e gestisce il personale), 'personale' (solo le sezioni scelte)
// [{email, nome, ruolo, sezioni: ['pren', …], promemoria: true/false}]
const SEZIONI_PANNELLO = {pren: 'Prenotazioni', oggi: 'Menù della settimana', orari: 'Orari', piatti: 'Piatti e pizze', eventi: 'Eventi',
  avvisi: 'Eventi in arrivo e avvisi', vini: 'Vini', bevande: 'Bevande', opinioni: 'Opinioni', faq: 'Domande'};
const SEZ_PREDEFINITE = ['pren', 'opinioni'];     // un cameriere nuovo vede prenotazioni e opinioni
function persone_() {
  let p = null; try { p = JSON.parse(PROP.getProperty('PERSONE') || 'null'); } catch (e) {}
  if (!Array.isArray(p)) {          // prima volta: si parte dalle righe di Persone.gs (se ci sono)
    p = [];
    const add = (m, ruolo) => { m = String(m || '').toLowerCase().trim(); if (/@/.test(m) && !p.some(x => x.email === m)) p.push({email: m, ruolo, promemoria: ruolo === 'editor'}); };
    if (typeof EMAIL !== 'undefined') EMAIL.forEach(m => add(m, 'editor'));
    if (typeof LETTORI !== 'undefined') LETTORI.forEach(m => add(m, 'lettore'));
  }
  // vecchio formato (editor / lettore) → nuovo: chi aveva tutto lo tiene (tranne la gestione delle persone), il socio vede le opinioni
  let cambiato = false;
  p.forEach(x => {
    if (x.ruolo === 'editor') { x.ruolo = 'personale'; x.sezioni = Object.keys(SEZIONI_PANNELLO); cambiato = true; }
    if (x.ruolo === 'lettore') { x.ruolo = 'personale'; x.sezioni = ['opinioni']; x.promemoria = false; cambiato = true; }
    if (['admin', 'vice', 'personale'].indexOf(x.ruolo) < 0) { x.ruolo = 'personale'; cambiato = true; }
    if (!Array.isArray(x.sezioni)) { x.sezioni = SEZ_PREDEFINITE.slice(); cambiato = true; }
    x.sezioni = x.sezioni.filter(k => SEZIONI_PANNELLO[k]);
  });
  const o = proprietario_();
  if (o) { const t = p.find(x => x.email === o); if (!t) { p.unshift({email: o, nome: 'Titolare', ruolo: 'admin', sezioni: Object.keys(SEZIONI_PANNELLO), promemoria: false}); cambiato = true; } else if (t.ruolo !== 'admin') { t.ruolo = 'admin'; cambiato = true; } }
  if (cambiato) PROP.setProperty('PERSONE', JSON.stringify(p));
  return p;
}
// ha accesso a una sezione? (admin e vice: a tutto)
const puoP_ = (x, sez) => !!x && (x.ruolo === 'admin' || x.ruolo === 'vice' || (x.sezioni || []).indexOf(sez) >= 0);
// chi riceve il promemoria del menù del giorno e gli avvisi del locale: chi lo ha acceso e può vedere quella sezione
const editori_ = () => persone_().filter(x => puoP_(x, 'oggi') || puoP_(x, 'pren'));
// impostazioni lette dalla scheda Impostazioni (le scrive il pannello)
function sito_() {
  const v = impostazione_('Indirizzo del sito') || (typeof SITO !== 'undefined' ? String(SITO) : '');
  return /^https?:\/\/[\w.-]+/.test(v) ? v.replace(/\/?$/, '/') : 'https://oltreconfini.it/';
}
const FOGLI = {
  menu: '17VDTk8vTuRRGopyZX1Xurbn2HeKW7UybRyaMOI4SGdk',
  speciali: '1pUILHxGPZY4pVVKz30u6kKz4qjc-2VkfM_wvNrxw9yI',
  oggi: '1v_NRS6B0PGeC2fCGgbp8Myrp45ZGUbUPI9fAbl9Viso',
  avvisi: '13APEOWk5UfT-UKSeQwimxqCDEv2IPVpj_aZZLZmPvig',
  vini: '1-0z5yJQEZGXKPylGXmVyayMo8MxCSr8Hzqds6wjrhHw',
  bevande: '1YRDF5-ylgRLAHKflsOT0bA5tR5KGI0ACIERCyqR0krA',
  faq: '10hYZp8qGAr9u4ZR1MNMUYZ1ZUmQgBZcCoSoVDRbJQ_A',
  opinioni: '1Xv-dDcraWsFk-x60C1va0w3h3W9Mwv8GsGnlwDszoEs'
};
const RISERVA = {menu: '1qzLLSIVL9OhBv-mTW1DG3_IQrYnpTu3d_m_s7jgi_1U', speciali: '1rHk3fJJ26kJJHBgCk08H3JNaK7g7KdcdhUjyfgVzro4'};
// sezioni del pannello → foglio (e scheda) dove scrivono
const SEZ = {
  piatti: {id: FOGLI.menu}, eventi: {id: FOGLI.speciali}, avvisi: {id: FOGLI.avvisi},
  vini: {id: FOGLI.vini}, bevande: {id: FOGLI.bevande}, faq: {id: FOGLI.faq}, prezzi: {id: FOGLI.oggi, tab: 'Prezzi formule'},
  orari: {id: FOGLI.oggi, tab: 'Orari'}, regole: {id: FOGLI.oggi, tab: 'Impostazioni'}, categorie: {id: FOGLI.menu, tab: 'Categorie'}
};
const PROP = PropertiesService.getScriptProperties();
const oggiTesto = () => Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy');
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
const bottone = (url, testo) => '<a href="' + url + '" style="display:inline-block;background:#c9ae7c;color:#0b121c;padding:14px 22px;text-decoration:none;font:600 16px Arial,sans-serif;border-radius:4px">' + testo + '</a>';

/* =========================== INSTALLAZIONE =========================== */
// le funzioni da eseguire a mano (installa, link, demo…) funzionano solo dall'editor, per il titolare:
// nessuno può lanciarle dal web, nemmeno chi ha una pagina del pannello aperta
function soloTitolare_() {
  let u = ''; try { u = String(Session.getActiveUser().getEmail() || '').toLowerCase(); } catch (e) {}
  if (!u || u !== proprietario_()) throw new Error('Questa funzione si esegue solo dall’editor di Apps Script, dal titolare.');
}

function installa() { soloTitolare_();
  // scheda dei prezzi delle formule (il sito la legge da qui)
  const ss = SpreadsheetApp.openById(FOGLI.oggi);
  if (!ss.getSheetByName('Prezzi formule')) {
    const px = ss.insertSheet('Prezzi formule');
    px.getRange(1, 1, 5, 3).setNumberFormat('@').setValues([
      ['Formula', 'Cosa comprende', 'Prezzo €'],
      ['Menù completo', 'Primo, secondo, acqua e caffè', '15'],
      ['Menù solo primo', 'Primo, acqua e caffè', '10'],
      ['Menù solo secondo', 'Secondo, acqua e caffè', '13'],
      ['Menù pizza', 'Pizza a piacere, acqua e caffè', '+2']]);
    px.getRange('A1:C1').setFontWeight('bold');
  }
  // coperto (si vede nel menù del QR): una riga in più nei prezzi
  const px = ss.getSheetByName('Prezzi formule');
  if (!px.getDataRange().getDisplayValues().some(r => /^coperto/i.test(r[0])))
    px.getRange(px.getLastRow() + 1, 1, 1, 3).setNumberFormat('@').setValues([['Coperto', 'A persona, solo alla carta', '2,50']]);
  // orari di apertura della settimana (il sito li legge da qui; vuoto = chiuso)
  if (!ss.getSheetByName('Orari')) {
    const o = ss.insertSheet('Orari');
    o.getRange(1, 1, 8, 5).setNumberFormat('@').setValues([['Giorno', 'Pranzo dalle', 'Pranzo alle', 'Cena dalle', 'Cena alle']].concat(
      ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato', 'Domenica'].map(g => [g, '12:00', '14:30', '19:00', '22:30'])));
    o.getRange('A1:E1').setFontWeight('bold');
  }
  // colonna "Tema" nel foglio degli avvisi (Tema del sito: Natale, Pasqua…)
  const av = SpreadsheetApp.openById(FOGLI.avvisi).getSheets()[0];
  if (!colonne_(av).some(c => /^tema/i.test(c.h))) av.getRange(1, av.getLastColumn() + 1).setValue('Tema');
  ['Pranzo dalle', 'Pranzo alle', 'Cena dalle', 'Cena alle'].forEach(t => { if (!colonne_(av).some(c => c.h.toLowerCase() === t.toLowerCase())) av.getRange(1, av.getLastColumn() + 1).setValue(t); });
  // colonna "Foto" nel foglio del menù (il pannello ci salva la foto del piatto)
  const mn = SpreadsheetApp.openById(FOGLI.menu).getSheets()[0];
  if (!colonne_(mn).some(c => /^foto/i.test(c.h))) mn.getRange(1, mn.getLastColumn() + 1).setValue('Foto (dal pannello)');
  // indirizzo a cui il sito manda le opinioni (scheda "Impostazioni", letta dal sito)
  let imp = ss.getSheetByName('Impostazioni');
  if (!imp) imp = ss.insertSheet('Impostazioni');
  const url = ScriptApp.getService().getUrl();
  if (!url) throw new Error('Prima pubblica il pannello: Esegui il deployment → Nuovo deployment → App web. Poi riesegui "installa".');
  // il sito manda le opinioni a questo stesso indirizzo
  if (!imp.getRange(1, 1).getValue()) imp.getRange(1, 1, 1, 2).setValues([['Chiave', 'Valore']]);
  const giaUrl = urlSito_();
  if (!giaUrl || (!provaUrl_(giaUrl).ok && provaUrl_(url).ok)) scriviUrl_(url);
  try { cache_().remove('url-ok'); } catch (e) {}
  // regole per prenotazioni e asporto (scheda Impostazioni, sotto l'indirizzo delle opinioni)
  const REG = [['Ultima prenotazione (minuti prima della chiusura)', '45'], ['Preavviso prenotazione oggi (minuti)', '60'], ['Preavviso asporto (minuti)', '20'],
    ['Ultimo ritiro asporto (minuti prima della chiusura)', '15'], ['Prenotazioni fino a (giorni)', '60']];
  const giaImp = imp.getDataRange().getDisplayValues().map(r => String(r[0]).toLowerCase());
  REG.forEach(r => { if (!giaImp.some(x => x.indexOf(r[0].toLowerCase().slice(0, 14)) === 0)) imp.getRange(imp.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([r]); });
  const op = SpreadsheetApp.openById(FOGLI.opinioni).getSheets()[0];
  if (!op.getRange(1, 15).getValue()) op.getRange(1, 15, 1, 2).setValues([['Stato', 'Nota interna']]);
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('promemoria').timeBased().everyMinutes(30).create();
  ScriptApp.newTrigger('copiaRiserva').timeBased().everyDays(1).atHour(3).inTimezone(TZ).create();
  PROP.deleteProperty('PR-TRIG'); prTrigger_();
  try { GmailApp.search('"OCPREN" older_than:1d', 0, 1); } catch (e) {}   // chiede subito il permesso di pulire le copie delle email
  copiaRiserva();
  try { PROP.deleteProperty('FOGLI-V'); CHI = {email: proprietario_(), ruolo: 'admin', sezioni: Object.keys(SEZIONI_PANNELLO)}; aggiornaFogli_(); } catch (e) { Logger.log('Festività: ' + e.message); }
  const prima = PROP.getProperty('PANNELLO');
  if (!prima || !provaUrl_(prima).ok) PROP.setProperty('PANNELLO', provaUrl_(url).ok ? url : (prima || url));
  mandaLink_(false, prima !== PROP.getProperty('PANNELLO'));
  if (!provaUrl_(urlSito_()).ok) Logger.log('ATTENZIONE: il sito non raggiunge ancora il sistema. Apri il pannello → Configurazione → Controllo del sistema e incolla l’URL dell’App web (Gestisci deployment).');
  Logger.log(prima !== PROP.getProperty('PANNELLO') ? 'Fatto. Ognuno ha ricevuto per email il suo link personale al pannello.' : 'Fatto. Fogli aggiornati; il link è arrivato per email solo alle persone nuove.');
}
// se un link è stato perso o inoltrato: tutti i link cambiano e arrivano di nuovo per email
// mostra nel registro (in basso) i link personali di tutti, senza mandare email
function mostraLink() { soloTitolare_();
  if (!PROP.getProperty('PANNELLO') || !Object.keys(chiavi_()).length) { Logger.log('Prima esegui "installa".'); return; }
  const ch = chiavi_();
  Object.keys(ch).forEach(m => Logger.log(m + '  →  ' + linkDi_(m)));
}
function nuoviLink() { soloTitolare_(); mandaLink_(true); Logger.log('Link nuovi inviati. I vecchi non funzionano più.'); }

/* =========================== DEMO DELLE OPINIONI =========================== */
// "demoOpinioni": crea un foglio a parte con un anno di opinioni inventate e lo mostra nel pannello.
// "fineDemo": il pannello torna alle opinioni vere e il foglio di prova va nel cestino.
// Le opinioni vere non vengono mai toccate.
function foglioOpinioni_() {
  const demo = PROP.getProperty('OPINIONI_DEMO');
  if (demo) { try { return SpreadsheetApp.openById(demo).getSheets()[0]; } catch (e) {} }
  return SpreadsheetApp.openById(FOGLI.opinioni).getSheets()[0];
}
function demoOpinioni() { soloTitolare_();
  fineDemo();
  const ss = SpreadsheetApp.create('PROVA · Opinioni per la demo (si cancella con fineDemo)'), sh = ss.getSheets()[0];
  const R = a => a[Math.floor(Math.random() * a.length)], P = (a, w) => { let x = Math.random() * w.reduce((p, q) => p + q, 0); for (let i = 0; i < a.length; i++) { x -= w[i]; if (x <= 0) return a[i]; } return a[a.length - 1]; };
  const TIPI = [['Pizza', ['pizza', 'sala', 'ambiente', 'attesa'], 30], ['Piatti della cucina', ['cucina', 'sala', 'ambiente', 'attesa'], 22],
    ['Pizza e cucina', ['cucina', 'pizza', 'sala', 'ambiente', 'attesa'], 18], ['Pranzo di lavoro', ['cucina', 'sala', 'attesa'], 16], ['Asporto', ['pizza', 'ritiro'], 14]];
  const COL = ['cucina', 'pizza', 'sala', 'ambiente', 'attesa', 'ritiro'];
  const BEST = {
    pizza: ['Impasto leggerissimo, si digerisce benissimo', 'La pizza Oltreconfini con il gambero rosso è spettacolare', 'La Sila con provola e porcini', 'La pizza fritta da provare', 'Margherita perfetta, cornicione alto', 'La Bologna con mortadella e pistacchio', 'Ottima la Roma-Calabria'],
    cucina: ['Gnocchi di zucca buonissimi', 'Il cacciucco come in Toscana', 'Costata cotta alla perfezione', 'Il raviolo bottone con la ’nduja', 'Il tagliere da dividere, abbondante', 'Tagliata di cervo squisita', 'Polipo morbidissimo'],
    pranzo: ['Veloce e buono, perfetto per la pausa pranzo', 'Menù del giorno vario e a buon prezzo', 'Serviti in 40 minuti, ottimo'],
    asporto: ['Pizza ancora calda a casa', 'Ordine su WhatsApp comodissimo', 'Puntuali al ritiro'],
    sala: ['Personale gentile e sorridente', 'La sala con gli archi è bellissima', 'Ottima carta dei vini, ci hanno consigliato bene', 'Bambini contenti con il menù bimbi', 'Francesco è passato al tavolo, molto accogliente', 'Tutto buono, torneremo'],
    de: ['Sehr gute Pizza, leichter Teig', 'Freundliche Bedienung', 'Schönes Ambiente, gute Weine'], en: ['Great pizza and friendly staff', 'Lovely place, good wine list'], fr: ['Très bonne pizza, pâte légère', 'Accueil chaleureux']};
  const NEG = {
    it: {Attesa: {pizza: ["Abbiamo aspettato quasi un'ora per le pizze", 'Il sabato sera attesa troppo lunga per la pizza'], cucina: ['Tempi lunghi tra antipasto e primo', 'Il sabato sera attesa troppo lunga']},
      Servizio: ['Cameriere poco attento, abbiamo dovuto chiamarlo più volte', "Personale un po' sbrigativo"], Prezzo: {pizza: ["Pizze speciali un po' care", "Bibite care rispetto alla pizza"], cucina: ["Vino al calice un po' caro", 'Conto alto per il pranzo']},
      'Cibo freddo': {pizza: ['La pizza è arrivata tiepida', 'Pizza fredda al centro'], cucina: ['Il primo era freddo', 'Il secondo è arrivato tiepido']},
      'Qualità del cibo': {pizza: ['Pizza bruciata sotto', "Impasto un po' gommoso"], cucina: ['Risotto troppo salato', "Carne un po' gommosa"]},
      Porzioni: {pizza: ["Pizza un po' piccola per il prezzo"], cucina: ['Porzione di primo piccola']}, Rumore: ['Sala molto rumorosa il venerdì sera'], Pulizia: ['Bagno da sistemare'], Prenotazione: ['Al telefono non risponde nessuno la sera']},
    de: {Attesa: ['Lange Wartezeit auf die Pizza'], Prezzo: ['Etwas teuer'], 'Cibo freddo': ['Pizza war kalt']},
    en: {Attesa: ['Slow service on Saturday'], Rumore: ['Quite noisy']}, fr: {Attesa: ['Attente un peu longue'], Prezzo: ['Un peu cher']}};
  const PESI = {Attesa: 8, Servizio: 3, Prezzo: 3, 'Cibo freddo': 3, 'Qualità del cibo': 3, Porzioni: 1, Rumore: 2, Pulizia: 1, Prenotazione: 2};
  const MID = ['Tutto bene, ma il dolce mancava', "Buono, ma la musica era un po' alta", "Ottimo, solo un po' di attesa per il conto", 'Mettereste più opzioni senza glutine?'];
  const WISH = ['Una pizza con la burrata e le alici', 'Più pizze bianche', 'Un menù degustazione di pesce', 'Birra artigianale locale', 'Pizza senza glutine', "Un'insalatona a pranzo", 'Più vini al calice'];
  const NOTE = {Attesa: ['Aggiunto un pizzaiolo il venerdì e il sabato', 'Nuovo giro comande: antipasti e primi separati'], Prenotazione: ['Attivata la prenotazione online dal sito'], 'Cibo freddo': ['Le pizze escono insieme per tavolo']};
  const oggi = new Date(), inizio = new Date(oggi.getTime() - 365 * 864e5), righe = [];
  for (let d = new Date(inizio); d < oggi; d = new Date(d.getTime() + 864e5)) {
    const wd = d.getDay(), m = d.getMonth() + 1, prog = (d - inizio) / (365 * 864e5);
    let base = {5: 11, 6: 14, 0: 11}[wd] || 5;
    if (m === 12) base *= 1.6; if (m === 7 || m === 8) base *= 1.25; if (m <= 2) base *= .75; if (m === 8 && d.getDate() >= 10 && d.getDate() <= 20) base = 0;
    const n = Math.max(0, Math.round(base * .65 + (Math.random() - .5) * 3));
    for (let k = 0; k < n; k++) {
      let [tipo, voci] = P(TIPI, TIPI.map(t => t[2]));
      if (tipo === 'Pranzo di lavoro' && wd === 0) [tipo, voci] = TIPI[0];
      const lang = P(['it', 'de', 'en', 'fr'], [80, 12, 5, 3]), q = Math.random(), bad = .17 - .08 * prog;
      const kind = q < bad ? 'neg' : q < bad + .22 ? 'mid' : 'pos';
      const pool = NEG[lang], temi = Object.keys(pool).filter(x => tipo !== 'Asporto' || ['Attesa', 'Cibo freddo', 'Qualità del cibo', 'Prezzo', 'Prenotazione'].indexOf(x) >= 0);
      const tema = kind === 'neg' ? P(temi, temi.map(x => PESI[x] || 2)) : '';
      const daPizza = tipo === 'Pizza' || tipo === 'Asporto' || (tipo === 'Pizza e cucina' && Math.random() < .5);
      const frasi = t => { const f = pool[t]; return Array.isArray(f) ? f : f[daPizza ? 'pizza' : 'cucina']; };
      const v = {};
      voci.forEach(c => {
        let x = kind === 'pos' ? P([5, 4, 3], [65, 30, 5]) : kind === 'mid' ? P([5, 4, 3, 2], [20, 45, 30, 5]) : P([4, 3, 2, 1], [20, 35, 30, 15]);
        if (kind === 'neg' && tema === 'Attesa' && (c === 'attesa' || c === 'ritiro')) x = R([1, 2]);
        if (kind === 'neg' && tema === 'Servizio' && c === 'sala') x = R([1, 2]);
        if (kind === 'neg' && (tema === 'Cibo freddo' || tema === 'Qualità del cibo') && (c === 'pizza' || c === 'cucina')) x = R([1, 2]);
        if (kind === 'neg' && tema === 'Rumore' && c === 'ambiente') x = 2;
        if (!(kind === 'pos' && Math.random() < .06)) v[c] = x;
      });
      if (!Object.keys(v).length) v[voci[0]] = 5;
      const vals = Object.values(v), media = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10;
      const gruppo = lang !== 'it' ? lang : tipo === 'Asporto' ? 'asporto' : tipo === 'Pranzo di lavoro' ? 'pranzo' : tipo === 'Pizza' ? 'pizza' : tipo === 'Piatti della cucina' ? 'cucina' : R(['pizza', 'cucina']);
      let best = (kind !== 'neg' || Math.random() < .3) && Math.random() < .7 ? R(Math.random() < .3 && lang === 'it' ? BEST.sala : BEST[gruppo]) : '';
      const better = kind === 'neg' ? (tipo === 'Asporto' && tema === 'Attesa' && lang === 'it' ? R(["Pizza pronta 15 minuti dopo l'orario concordato", 'Al ritiro abbiamo aspettato più del previsto']) : R(frasi(tema))) : kind === 'mid' && lang === 'it' && tipo !== 'Asporto' && Math.random() < .6 ? R(MID) : '';
      const wish = lang === 'it' && Math.random() < .22 ? R(WISH) : '';
      const pranzo = tipo === 'Pranzo di lavoro' || (tipo !== 'Asporto' && Math.random() < .2);
      const h = pranzo ? R([12, 12, 13, 13, 13, 14]) : R([19, 20, 20, 21, 21, 22]), ora = ('0' + h).slice(-2) + ':' + ('0' + Math.floor(Math.random() * 60)).slice(-2);
      const eta = (oggi - d) / 864e5;
      let stato = '', nota = '';
      if (kind === 'neg' && eta > 45) stato = P(['Risolta', 'In lavorazione', ''], [70, 15, 15]); else if (kind === 'neg' && eta > 10) stato = P(['In lavorazione', ''], [50, 50]);
      if (stato) nota = NOTE[tema] && stato === 'Risolta' ? R(NOTE[tema]) : R(['Parlato con lo staff in riunione', 'Da verificare con lo chef', '']);
      const TRD = {'Sehr gute Pizza, leichter Teig': 'Pizza molto buona, impasto leggero', 'Freundliche Bedienung': 'Servizio cordiale', 'Schönes Ambiente, gute Weine': 'Bell’ambiente, buoni vini',
        'Great pizza and friendly staff': 'Ottima pizza e personale cordiale', 'Lovely place, good wine list': 'Locale delizioso, buona carta dei vini', 'Très bonne pizza, pâte légère': 'Pizza molto buona, impasto leggero',
        'Accueil chaleureux': 'Accoglienza calorosa', 'Lange Wartezeit auf die Pizza': 'Lunga attesa per la pizza', 'Etwas teuer': 'Un po’ caro', 'Pizza war kalt': 'La pizza era fredda',
        'Slow service on Saturday': 'Servizio lento il sabato', 'Quite noisy': 'Piuttosto rumoroso', 'Attente un peu longue': 'Attesa un po’ lunga', 'Un peu cher': 'Un po’ caro'};
      const tr = x => lang !== 'it' && x ? (TRD[x] || '') : '';
      righe.push([d.getTime() + h * 36e5, Utilities.formatDate(d, TZ, 'dd/MM/yyyy'), ora, tipo].concat(COL.map(c => v[c] === undefined ? '' : String(v[c])),
        [String(media).replace('.', ','), best, better, wish, lang, stato, nota, tr(best), tr(better), tr(wish)]));
    }
  }
  righe.sort((a, b) => a[0] - b[0]);
  const out = [['Data', 'Ora', 'Cosa ha preso', 'Cucina', 'Pizza', 'Servizio in sala', 'Ambiente', 'Tempi di attesa', 'Puntualità al ritiro', 'Media', 'Cosa è piaciuto', 'Cosa migliorare', 'Vorrebbe trovare', 'Lingua', 'Stato', 'Nota interna', 'Piaciuto (italiano)', 'Da migliorare (italiano)', 'Vorrebbe (italiano)']]
    .concat(righe.map(r => r.slice(1)));
  sh.getRange(1, 1, out.length, 19).setNumberFormat('@').setValues(out);
  sh.getRange('A1:P1').setFontWeight('bold'); sh.setFrozenRows(1);
  PROP.setProperty('OPINIONI_DEMO', ss.getId());
  Logger.log('Pronte ' + righe.length + ' opinioni di prova. Apri la sezione Opinioni del pannello (ricarica la pagina). Finita la demo esegui "fineDemo".');
}
function fineDemo() { soloTitolare_();
  const id = PROP.getProperty('OPINIONI_DEMO');
  if (!id) { Logger.log('Nessuna demo attiva: il pannello mostra già le opinioni vere.'); return; }
  PROP.deleteProperty('OPINIONI_DEMO');
  try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  Logger.log('Fatto: il pannello mostra di nuovo le opinioni vere. Il foglio di prova è nel cestino.');
}

/* =========================== DEMO DEL SITO (per il ristoratore) =========================== */
// «Avvia la demo»: si fa una copia nascosta dei fogli Eventi e Avvisi, poi si accendono OGGI promozioni con grafiche diverse,
// tema di Natale, menù speciali, avviso, chiusura annunciata e pizza della settimana. «Finisci la demo»: si rimette la copia,
// si cancella e si rimettono le date giuste alle feste già pronte. Le prenotazioni, il menù e i vini non vengono toccati.
const DEMO_TAB_ = 'Copia prima della demo (non toccare)';
function copiaDemo_(id) {
  const ss = SpreadsheetApp.openById(id);
  if (ss.getSheetByName(DEMO_TAB_)) return;                 // c'è già una copia (demo interrotta): si tiene quella, è lo stato vero
  const c = ss.getSheets()[0].copyTo(ss); c.setName(DEMO_TAB_); try { c.hideSheet(); } catch (e) {}
}
function ripristinaDemo_(id) {
  const ss = SpreadsheetApp.openById(id), bk = ss.getSheetByName(DEMO_TAB_); if (!bk) return false;
  const sh = ss.getSheets()[0]; if (sh.getName() === DEMO_TAB_) return false;
  sh.clearContents(); bk.getDataRange().copyTo(sh.getRange(1, 1)); ss.deleteSheet(bk); return true;
}
function demoMetti_() {
  const oggi = adessoPr_().g, da = dmyDaG_(oggi), a = dmyDaG_(oggi + 14);
  // avvisi
  pulisci_('avvisi');
  const d = leggi_('avvisi'), old = d.rows.length, h = d.cols.map(c => c.h), k = t => h.find(x => x.toLowerCase().indexOf(t) === 0);
  const kT = k('tipo'), kDa = k('dal'), kA = k('al'), kX = k('testo'), kOn = k('attivo'), kTe = k('tema'), kQ = k('quando'), kPz = k('pizza'), kGr = k('grafica');
  const PROMO = ['Cene di Natale', 'Festa della donna', 'Halloween', 'San Valentino'];
  const nuova = o => { const r = {}; h.forEach(x => r[x] = ''); Object.keys(o).forEach(x => { if (x) r[x] = o[x]; }); return r; };
  d.rows.forEach(r => {
    const t = String(r[kT] || '');
    if (/^promo/i.test(t)) { const on = PROMO.indexOf(String(r[kX]).trim()) >= 0; r[kOn] = on ? 'SÌ' : 'NO'; if (on) { r[kDa] = da; r[kA] = a; if (kGr) r[kGr] = ''; } }
    else if (/^tema/i.test(t)) { const on = /natal/i.test(String(r[kTe] || r[kX])); r[kOn] = on ? 'SÌ' : 'NO'; if (on) { r[kDa] = da; r[kA] = a; } }
  });
  const rows = d.rows.slice();
  if (!rows.some(r => /^tema/i.test(r[kT]) && /natal/i.test(String(r[kTe] || r[kX])))) rows.push(nuova({[kT]: 'Tema del sito', [kDa]: da, [kA]: a, [kX]: 'Natale', [kTe]: 'Natale', [kOn]: 'SÌ'}));
  PROMO.forEach(n => { if (!rows.some(r => /^promo/i.test(r[kT]) && String(r[kX]).trim() === n)) rows.push(nuova({[kT]: 'Promozione', [kDa]: da, [kA]: a, [kX]: n, [kOn]: 'SÌ'})); });
  rows.push(nuova({[kT]: 'Avviso', [kDa]: da, [kA]: dmyDaG_(oggi + 7), [kX]: 'DEMO · Questo avviso in alto si scrive dal pannello', [kOn]: 'SÌ'}));
  rows.push(nuova({[kT]: 'Chiusura', [kDa]: dmyDaG_(oggi + 10), [kA]: dmyDaG_(oggi + 10), [kQ]: 'Chiuso a pranzo', [kX]: 'DEMO · Inventario', [kOn]: 'SÌ'}));
  let pizza = ''; try { const m = leggi_('piatti'), mh = m.cols.map(c => c.h), mc = mh.find(x => /^categoria/i.test(x)), mp = mh.find(x => /^piatto/i.test(x)); const r = m.rows.find(x => /^pizze speciali/i.test(x[mc]) && x[mp]) || m.rows.find(x => /^pizz/i.test(x[mc]) && x[mp]); pizza = r ? String(r[mp]).trim() : ''; } catch (e) {}
  if (pizza && kPz) rows.push(nuova({[kT]: 'Pizza della settimana', [kDa]: da, [kA]: dmyDaG_(oggi + 6), [kPz]: pizza, [kX]: 'DEMO · La pizza della settimana si sceglie dal pannello', [kOn]: 'SÌ'}));
  scrivi_(d, rows, old); pulisci_('avvisi');
  // menù speciali degli eventi
  pulisci_('eventi');
  const e = leggi_('eventi'), eh = e.cols.map(c => c.h), ek = t => eh.find(x => x.toLowerCase().indexOf(t) === 0);
  const eOn = ek('attivo'), eEv = ek('evento'), eDa = ek('dal'), eA = ek('al'), eBg = ek('sfondo'), MENU = ['Pranzo di Natale', 'Cenone di Capodanno'];
  if (!e.rows.some(r => MENU.indexOf(String(r[eEv]).trim()) >= 0)) { const p = e.rows.find(r => String(r[eEv]).trim()); if (p) MENU.push(String(p[eEv]).trim()); }   // nomi diversi: si usa il primo evento
  e.rows.forEach(r => { const i = MENU.indexOf(String(r[eEv]).trim()); r[eOn] = i >= 0 ? 'SÌ' : 'NO'; if (i >= 0) { r[eDa] = da; r[eA] = a; if (eBg) r[eBg] = i === 1 ? 'Sala con archi' : ''; } });
  scrivi_(e, e.rows, e.rows.length); pulisci_('eventi');
}
// date giuste per le feste già pronte (promozioni e temi): calcolate dal calendario, come quando sono state create
function dateFeste_() {
  pulisci_('avvisi');
  const d = leggi_('avvisi'), h = d.cols.map(c => c.h), k = t => h.find(x => x.toLowerCase().indexOf(t) === 0);
  const kT = k('tipo'), kDa = k('dal'), kA = k('al'), kX = k('testo'), kTe = k('tema');
  const oggi = adessoPr_().g, anno = new Date(oggi * 864e5).getUTCFullYear(); let n = 0;
  FESTE_.forEach(f => {
    let ev = f[6](anno); if (ev + f[8] < oggi) ev = f[6](anno + 1);
    const nome = f[0] === 'Tema del sito' ? f[5] : f[1], dDa = dmyDaG_(ev + f[7]), dA = dmyDaG_(ev + f[8]);
    d.rows.forEach(r => {
      if (r[kT] !== f[0]) return;
      const chi = f[0] === 'Tema del sito' ? String(r[kTe] || r[kX]).trim() : String(r[kX]).trim();
      if (chi !== nome) return;
      if (r[kDa] !== dDa || r[kA] !== dA) { r[kDa] = dDa; r[kA] = dA; n++; }
    });
  });
  if (n) scrivi_(d, d.rows, d.rows.length);
  pulisci_('avvisi');
  return n;
}
// dall'editor di Apps Script, come «demoOpinioni»: scegli la funzione in alto e premi Esegui
function demoSito() { soloTitolare_();
  if (PROP.getProperty('DEMO-SITO')) { Logger.log('La demo è già in corso (dal ' + PROP.getProperty('DEMO-SITO') + '). Per finirla esegui «fineDemoSito».'); return; }
  conLock_(() => {
    copiaDemo_(FOGLI.avvisi); copiaDemo_(FOGLI.speciali);
    PROP.setProperty('DEMO-SITO', Utilities.formatDate(new Date(), TZ, 'dd/MM/yyyy HH:mm'));
    demoMetti_();
  });
  Logger.log('Demo pronta. Sul sito (ricaricalo tra qualche minuto): 4 promozioni con grafiche diverse, tema di Natale, menù speciali, avviso in alto, chiusura annunciata e pizza della settimana. Menù, vini e prenotazioni non sono stati toccati. Finita la presentazione esegui «fineDemoSito».');
}
function fineDemoSito() { soloTitolare_();
  let n = 0, rip = false;
  conLock_(() => {
    rip = ripristinaDemo_(FOGLI.avvisi); rip = ripristinaDemo_(FOGLI.speciali) || rip;
    PROP.deleteProperty('DEMO-SITO'); pulisci_('avvisi'); pulisci_('eventi');
    n = dateFeste_(); pulisci_('avvisi'); pulisci_('eventi');
  });
  Logger.log((rip ? 'Fatto: eventi e avvisi sono tornati com’erano prima della demo. ' : 'Nessuna demo da finire. ') + (n ? 'Sistemate le date di ' + n + ' feste pronte.' : 'Le date delle feste erano già giuste.'));
}
function rimettiDateFeste() { soloTitolare_();
  let n = 0; conLock_(() => { n = dateFeste_(); });
  Logger.log(n ? 'Fatto: sistemate le date di ' + n + ' feste pronte (accese e spente restano come sono).' : 'Le date delle feste erano già giuste.');
}

/* =========================== CONTROLLO CON L'IA (facoltativo) =========================== */
// Se in Persone.gs c'è CHIAVE_IA (chiave gratuita di Google AI Studio), prima di salvare il pannello fa rileggere
// la voce a Gemini: ortografia, se il nome ha senso per la sezione, regione, categoria, allergeni, prezzo.
// la chiave così come incollata, ripulita da spazi, a capo e virgolette "storte" copiate per sbaglio
function chiaveIA_() { return String((AMB.env && AMB.env.GEMINI_API_KEY) || '').replace(/[\s'"‘’“”`]/g, ''); }
function iaAttiva_() { return chiaveIA_().length >= 20; }
// Modelli in ordine di velocità: i «Flash-Lite» rispondono in 1-2 secondi e nel piano gratuito hanno molte più richieste al giorno
// (i «Flash» normali ne hanno circa 20 e ragionano a lungo prima di rispondere: per questo l'IA «non rispondeva quasi mai»).
const MODELLI_IA_ = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
async function chiediIA_(prompt, tempoMax) {
  const c = cache_(), t0 = Date.now(), limite = tempoMax || 20000;
  let modelli = (typeof MODELLO_IA !== 'undefined' && MODELLO_IA ? [MODELLO_IA] : []).concat(MODELLI_IA_);
  const buono = c.get('ia-ok'); if (buono) modelli = [buono].concat(modelli.filter(m => m !== buono));   // quello che ha funzionato l'ultima volta, per primo
  modelli = modelli.filter((m, k) => modelli.indexOf(m) === k);
  let ultimo = '', provati = 0;
  for (const m of modelli) {
    if (Date.now() - t0 > limite) break;
    if (c.get('ia-no-' + m)) { ultimo = m + ' in pausa'; continue; }               // esaurito o sovraccarico poco fa: non si perde tempo
    for (const pensiero of [true, false]) {
      const gc = {temperature: 0.1, responseMimeType: 'application/json'};
      if (pensiero && !/2\.5/.test(m)) gc.thinkingConfig = {thinkingLevel: 'minimal'};   // niente «ragionamento lungo»: risposta subito
      if (pensiero && /2\.5-flash(?!-lite)/.test(m)) gc.thinkingConfig = {thinkingBudget: 0};
      let r;
      try {
        r = await UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {
          method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: {'x-goog-api-key': chiaveIA_()},
          payload: JSON.stringify({contents: [{parts: [{text: prompt}]}], generationConfig: gc})});
      } catch (e) { ultimo = m + ' irraggiungibile'; break; }
      provati++;
      const code = r.getResponseCode(), txt0 = r.getContentText();
      if (code === 400 && gc.thinkingConfig && /thinking/i.test(txt0)) continue;    // questo modello non accetta l'impostazione: si riprova senza
      if (code === 404 || code === 400 && /not found|not supported|is not available/i.test(txt0)) { c.put('ia-no-' + m, '404', 21600); ultimo = m + ' non disponibile'; break; }
      if (code === 429) { c.put('ia-no-' + m, '429', /PerDay|per day|daily/i.test(txt0) ? 21600 : 120); ultimo = m + ' ha finito le richieste gratuite'; break; }
      if (code === 503 || code === 500 || code === 502 || code === 504) { c.put('ia-no-' + m, String(code), 60); ultimo = m + ' sovraccarico (' + code + ')'; break; }
      if (code !== 200) throw new Error('IA non raggiungibile (' + code + '): ' + txt0.slice(0, 200));
      const j = JSON.parse(txt0), t = ((j.candidates || [])[0] || {}).content;
      const txt = t && t.parts ? t.parts.map(p => p.text || '').join('') : '';
      if (!txt) { ultimo = m + ' risposta vuota'; break; }
      try { c.put('ia-ok', m, 21600); } catch (e) {}
      return JSON.parse(txt.replace(/^\s*```(json)?/i, '').replace(/```\s*$/, ''));
    }
  }
  throw new Error('Nessun modello disponibile' + (provati ? '' : ' (tutti in pausa)') + ': ' + ultimo);
}
const SEZ_NOMI = {piatti: 'piatti e pizze del menù', vini: 'carta dei vini', bevande: 'bevande (acqua, bibite, birre, caffetteria, cocktail, distillati e amari)',
  eventi: 'menù speciali per eventi', faq: 'domande frequenti del sito', avvisi: 'avvisi, chiusure e promozioni del sito'};
async function apiControllaIA_(sez, voce, contesto, giaSegnalati) {
  ammesso_();
  if (!iaAttiva_()) return null;
  const prompt = [
    'Sei il responsabile qualità del menù del ristorante-pizzeria Oltreconfini (Bisuschio, provincia di Varese).',
    'Un collaboratore sta salvando una voce nella sezione: ' + (SEZ_NOMI[sez] || sez) + '.',
    'Controlla SOLO questa voce, con il buon senso di un ristoratore italiano esperto:',
    '1. Ortografia e maiuscole di nomi di piatti, ingredienti, vini, produttori, denominazioni (DOC/DOCG/IGT), marchi di bevande.',
    '2. Che il nome abbia senso per QUESTA sezione: in una carta dei vini deve essere un vino reale o plausibile, tra le bevande una bevanda, tra i piatti un piatto.',
    '3. Coerenza tra categoria o gruppo scelti, regione di origine della denominazione e tipo (rosso, bianco, bollicine, rosato).',
    '4. Solo per i piatti: allergeni UE coerenti con gli ingredienti (1 glutine, 2 crostacei, 3 uova, 4 pesce, 5 arachidi, 6 soia, 7 latte, 8 frutta a guscio, 9 sedano, 10 senape, 11 sesamo, 12 solfiti, 13 lupini, 14 molluschi).',
    '5. Prezzo plausibile per un ristorante-pizzeria in provincia di Varese.',
    'Non inventare: segnala solo ciò di cui sei ragionevolmente sicuro. Non ripetere questi punti, già segnalati: ' + JSON.stringify(giaSegnalati || []),
    'Voce (campo: valore): ' + JSON.stringify(voce),
    'Valori già usati in questa sezione: ' + JSON.stringify(contesto || {}),
    'Rispondi solo con JSON: {"avvisi":["frase breve in italiano"],"correzioni":{"nome esatto del campo":"valore corretto"}}. Al massimo 5 avvisi. Se è tutto giusto: {"avvisi":[],"correzioni":{}}.'
  ].join('\n');
  try {
    const r = await chiediIA_(prompt, 10000), corr = {};
    Object.keys(r.correzioni || {}).forEach(k => { if (Object.prototype.hasOwnProperty.call(voce, k) && String(r.correzioni[k]) !== String(voce[k])) corr[k] = String(r.correzioni[k]).slice(0, 300); });
    return {avvisi: (r.avvisi || []).slice(0, 5).map(x => String(x).slice(0, 300)), correzioni: corr};
  } catch (e) { return {errore: String(e.message || e).slice(0, 200)}; }
}
// menù della settimana: un solo controllo dell'IA per tutti i giorni (in memoria 6 ore: la seconda volta è immediato)
async function apiControllaSettIA_(giorni) {
  ammesso_();
  if (!iaAttiva_()) return null;
  const G = (Array.isArray(giorni) ? giorni : []).slice(0, 6).map(d => ({giorno: String(d.giorno || '').slice(0, 20), primi: (d.primi || []).slice(0, 8).map(x => String(x).slice(0, 120)), secondi: (d.secondi || []).slice(0, 8).map(x => String(x).slice(0, 120))})).filter(d => d.primi.length || d.secondi.length);
  if (!G.length) return {avvisi: [], correzioni: []};
  const js = JSON.stringify(G); let hh = 5381; for (let i = 0; i < js.length; i++) hh = ((hh * 33) ^ js.charCodeAt(i)) >>> 0;
  const chiave = 'ia-sett-' + hh.toString(36) + '-' + js.length;
  try { const c = cache_().get(chiave); if (c) return JSON.parse(c); } catch (e) {}
  const prompt = [
    'Sei lo chef di un ristorante italiano (Oltreconfini, Bisuschio, provincia di Varese). Rileggi il menù del pranzo della settimana scritto da un collaboratore.',
    'Segnala SOLO errori veri: parole scritte male (es. «fornoo»), un secondo messo tra i primi o il contrario, un piatto ripetuto nello stesso giorno, nomi che non hanno senso.',
    'NON segnalare termini di cucina italiana corretti anche se poco comuni (trancio, fagiolini, friarielli, scamorza, pizzoccheri, ecc.), né nomi di piatti regionali corretti.',
    'Non parlare di prezzi, allergeni o surgelati: li controlla già il programma.',
    'Menù (JSON): ' + JSON.stringify(G),
    'Rispondi solo con JSON: {"avvisi":[{"giorno":"Lunedì","testo":"frase breve in italiano"}],"correzioni":[{"giorno":"Lunedì","da":"testo sbagliato esatto","a":"testo corretto"}]}. Al massimo 8 avvisi. Se è tutto giusto: {"avvisi":[],"correzioni":[]}.'
  ].join('\n');
  try {
    const r = await chiediIA_(prompt), out = {
      avvisi: (r.avvisi || []).slice(0, 8).map(x => ({giorno: String(x.giorno || '').slice(0, 20), testo: String(x.testo || x).slice(0, 250)})),
      correzioni: (r.correzioni || []).slice(0, 12).filter(x => x && x.da && x.a && String(x.da) !== String(x.a)).map(x => ({giorno: String(x.giorno || '').slice(0, 20), da: String(x.da).slice(0, 120), a: String(x.a).slice(0, 120)}))};
    try { cache_().put(chiave, JSON.stringify(out), 21600); } catch (e) {}
    return out;
  } catch (e) { return {errore: String(e.message || e).slice(0, 200)}; }
}
// parole confermate dal personale («Pubblica/Salva lo stesso»): il controllo non le segnala più, per nessuno
function apiParoleOk_(lista) {
  ammesso_();
  return conLock_(() => {
    let p = []; try { p = JSON.parse(PROP.getProperty('PAROLE-OK') || '[]'); } catch (e) {}
    (Array.isArray(lista) ? lista : []).slice(0, 40).forEach(w => { w = String(w || '').toLowerCase().replace(/[^a-zà-ÿ’']/g, '').slice(0, 30); if (w.length >= 3 && p.indexOf(w) < 0) p.push(w); });
    p = p.slice(-3000); PROP.setProperty('PAROLE-OK', JSON.stringify(p)); return p;
  });
}
// da eseguire una volta dall'editor dopo aver messo la chiave in Persone.gs: verifica che funzioni

/* =========================== PERSONE (dal pannello) =========================== */
function salvaPersone_(p) { PROP.setProperty('PERSONE', JSON.stringify(p)); }
function apiPersone_() { soloGestore_(); const o = proprietario_(), ch = chiavi_();
  return {io: CHI.email, mioRuolo: CHI.ruolo, nomi: SEZIONI_PANNELLO, persone: persone_().map(x => ({email: x.email, nome: x.nome || '', ruolo: x.ruolo, sezioni: x.sezioni, promemoria: !!x.promemoria, titolare: x.email === o, link: !!ch[x.email], io: CHI.email === x.email}))}; }
// chi può toccare chi: il titolare tutti (tranne diventare un secondo titolare), il vice solo il personale
function puoGestire_(x) { if (!x) return true; if (CHI.ruolo === 'admin') return x.ruolo !== 'admin' || x.email === CHI.email; return x.ruolo === 'personale' || x.email === CHI.email; }
function apiPersonaSalva_(email, dati) {
  soloGestore_(); dati = dati || {};
  email = String(email || '').toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) throw new Error('Email non valida.');
  const nome = String(dati.nome || '').replace(/[<>=]/g, '').trim().slice(0, 40);
  let ruolo = ['vice', 'personale'].indexOf(dati.ruolo) >= 0 ? dati.ruolo : 'personale';
  const sezioni = (Array.isArray(dati.sezioni) ? dati.sezioni : SEZ_PREDEFINITE).filter((k, i, a) => SEZIONI_PANNELLO[k] && a.indexOf(k) === i);
  return conLock_(() => {
    const p = persone_(), x = p.find(y => y.email === email), nuovo = !x;
    if (!puoGestire_(x)) throw new Error('Il vice può gestire solo il personale.');
    if (x && x.email === CHI.email && x.ruolo !== (x.ruolo === 'admin' ? 'admin' : ruolo)) throw new Error('Non puoi cambiare il tuo ruolo.');
    if (ruolo === 'vice' && CHI.ruolo !== 'admin') throw new Error('Solo il titolare può nominare un vice.');
    if (x && x.ruolo === 'admin') ruolo = 'admin';
    if (ruolo === 'personale' && !sezioni.length) throw new Error('Scegli almeno una sezione.');
    const v = {email, nome, ruolo, sezioni: ruolo === 'personale' ? sezioni : Object.keys(SEZIONI_PANNELLO), promemoria: !!dati.promemoria};
    if (x) Object.assign(x, v); else p.push(v);
    salvaPersone_(p);
    if (nuovo) mandaLink_(false, false, email);
    return apiPersone_();
  });
}
function apiPersonaTogli_(email) {
  soloGestore_();
  email = String(email || '').toLowerCase().trim();
  if (email === proprietario_()) throw new Error('Il titolare non si può togliere.');
  if (CHI && CHI.email === email) throw new Error('Non puoi togliere te stesso.');
  return conLock_(() => {
    const x = persone_().find(y => y.email === email); if (!puoGestire_(x)) throw new Error('Il vice può togliere solo il personale.');
    salvaPersone_(persone_().filter(x => x.email !== email));
    const ch = chiavi_(); delete ch[email]; PROP.setProperty('CHIAVI', JSON.stringify(ch));     // il suo link smette subito di funzionare
    return apiPersone_();
  });
}
function apiPersonaLink_(email, nuovo) {
  soloGestore_();
  email = String(email || '').toLowerCase().trim();
  const x = persone_().find(y => y.email === email); if (!x) throw new Error('Persona non trovata.');
  if (!puoGestire_(x)) throw new Error('Il vice può gestire solo il personale.');
  if (nuovo) { const ch = chiavi_(); delete ch[email]; PROP.setProperty('CHIAVI', JSON.stringify(ch)); }
  mandaLink_(false, true, email);
  return apiPersone_();
}

/* =========================== LINK PERSONALI =========================== */
function chiavi_() { try { return JSON.parse(PROP.getProperty('CHIAVI') || '{}'); } catch (e) { return {}; } }
const nuovaChiave_ = () => (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
function linkDi_(email) { return PROP.getProperty('PANNELLO') + '?k=' + chiavi_()[String(email).toLowerCase()]; }
// l'email con il link parte solo a chi è nuovo, a meno che i link siano cambiati (nuoviLink o nuovo indirizzo del pannello)
function mandaLink_(rinnova, aTutti, solo) {
  const P = persone_(), ch = rinnova ? {} : chiavi_(), tutti = P.map(x => x.email).filter(m => !solo || m === solo), nuovi = [];
  tutti.forEach(m => { if (!ch[m]) { ch[m] = nuovaChiave_(); nuovi.push(m); } });
  PROP.setProperty('CHIAVI', JSON.stringify(Object.assign(chiavi_(), ch)));
  tutti.filter(m => rinnova || aTutti || nuovi.indexOf(m) >= 0).forEach(m => {
    const px = P.find(x => x.email === m) || {}, lettore = px.ruolo === 'personale' && px.sezioni && px.sezioni.length === 1 && px.sezioni[0] === 'opinioni';
    MailApp.sendEmail({
      to: m,
      subject: rinnova ? 'Oltreconfini: il tuo nuovo link al pannello' : 'Il pannello di Oltreconfini è pronto',
      htmlBody: '<p>' + (lettore ? 'Da qui vedi le opinioni dei clienti:' : 'Da oggi il sito si aggiorna da qui:') + '</p><p>' + bottone(linkDi_(m), lettore ? 'Apri le opinioni' : 'Apri il pannello') + '</p>' +
        '<p>Aprilo dal telefono e aggiungilo alla schermata Home (iPhone: Condividi → Aggiungi alla schermata Home; Android: ⋮ → Aggiungi a schermata Home): si apre con un tocco, come un\'app.</p>' +
        '<p><b>Il link è personale: non inoltrarlo.</b> Chi lo ha può modificare il sito.' + (rinnova ? ' Il link precedente non funziona più.' : '') + '</p>' +
        (px.ruolo === 'personale' ? '<p>Vedi solo le sezioni che ti sono state assegnate. Le azioni fatte dal pannello vengono registrate con il tuo nome.</p>' : '<p>Le impostazioni (persone e permessi, promemoria, sito, prenotazioni) sono nella sezione «Impostazioni» del pannello.</p>')
    });
  });
}
function disinstalla() { soloTitolare_();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Promemoria e copie di riserva disattivati. Il pannello si spegne da Esegui il deployment → Gestisci deployment → Archivia.');
}

/* =========================== PANNELLO =========================== */
// chi sta usando il pannello: lo dice la chiave del suo link personale
let CHI = null;
function chi_(k) {
  k = String(k || '');
  if (!/^[a-f0-9]{64}$/.test(k)) throw new Error('Link non valido.');
  const ch = chiavi_(), email = Object.keys(ch).find(m => ch[m] === k);
  const p = email ? persone_().find(x => x.email === email) : null;
  if (p) return {email, ruolo: p.ruolo, sezioni: p.ruolo === 'personale' ? p.sezioni.slice() : Object.keys(SEZIONI_PANNELLO), nome: p.nome || ''};
  throw new Error('Questo link non è più valido.');
}
function ruolo_() { if (!CHI) throw new Error('Accesso non consentito.'); return CHI.ruolo; }
function ammesso_() { ruolo_(); }                       // i permessi per sezione li controlla api() prima di ogni operazione
const gestore_ = () => !!CHI && (CHI.ruolo === 'admin' || CHI.ruolo === 'vice');
const puo_ = sez => !!CHI && (gestore_() || CHI.sezioni.indexOf(sez) >= 0);
function soloGestore_() { if (!gestore_()) throw new Error('Solo il titolare o il vice possono farlo.'); }
function doGet(e) {
  const P = e && e.parameter || {};
  // dal sito: posti liberi e stato di una prenotazione (dal link dell'email)
  if (P.a === 'disp') { try { return jsonPr_(prDisp_(String(P.d || ''), P.n)); } catch (err) { return jsonPr_({ok: false, err: 'occupato'}); } }
  if (P.a === 'pren') { try { return jsonPr_(prStato_(P.t)); } catch (err) { return jsonPr_({ok: false, err: 'occupato'}); } }
  if (P.a === 'ping') return jsonPr_({ok: true, v: 3});
  const k = String(P.k || '');
  // link sbagliato: semplice testo (nessuna pagina interattiva per chi non ha un link valido)
  try { CHI = chi_(k); } catch (err) {
    return ContentService.createTextOutput(err.message + '\nUsa il link personale che hai ricevuto per email (oggetto «Il pannello di Oltreconfini è pronto»).');
  }
  // apertura veloce: i controlli di manutenzione (indirizzo, fogli) si fanno dopo, in sottofondo (apiTutto)
  return HtmlService.createHtmlOutput(PAGINA.replace('__RUOLO__', CHI.ruolo).replace('__PERM__', JSON.stringify({ruolo: CHI.ruolo, sezioni: CHI.sezioni, email: CHI.email, nome: CHI.nome, nomi: SEZIONI_PANNELLO})).replace('__SITO__', sito_()).replace('__CHIAVE__', k).replace('__IA__', iaAttiva_() ? '1' : '').replace('__TAB__', P.t === 'oggi' ? 'oggi' : P.t === 'pren' ? 'pren' : '').replace('__PRRIGHE__', JSON.stringify(PR_RIGHE)).replace('__PREN0__', () => { if (!puo_('pren')) return 'null'; try { return JSON.stringify(apiPren_('')).replace(/</g, '\\u003c'); } catch (e) { return 'null'; } })).setTitle('Oltreconfini · Pannello')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
// unica porta d'ingresso per il pannello: controlla la chiave, poi esegue
const API = {
  apiLeggi: (...a) => apiLeggi_(...a), apiSalva: (...a) => apiSalva_(...a), apiElimina: (...a) => apiElimina_(...a), apiSposta: (...a) => apiSposta_(...a),
  apiPizze: (...a) => apiPizze_(...a), apiSettLeggi: (...a) => apiSettLeggi_(...a), apiSettPubblica: (...a) => apiSettPubblica_(...a),
  apiCaricaFoto: (...a) => apiCaricaFoto_(...a), apiImpostazione: (...a) => apiImpostazione_(...a), apiPersone: (...a) => apiPersone_(...a), apiPersonaSalva: (...a) => apiPersonaSalva_(...a), apiPersonaTogli: (...a) => apiPersonaTogli_(...a), apiPersonaLink: (...a) => apiPersonaLink_(...a), apiTutto: (...a) => apiTutto_(...a), apiControllaIA: (...a) => apiControllaIA_(...a), apiOpinioni: (...a) => apiOpinioni_(...a), apiOpinioneStato: (...a) => apiOpinioneStato_(...a),
  apiEsporta: (...a) => apiEsporta_(...a), apiPren: (...a) => apiPren_(...a), apiPrenSalva: (...a) => apiPrenSalva_(...a), apiPrenStato: (...a) => apiPrenStato_(...a), apiPrenAvvisi: (...a) => apiPrenAvvisi_(...a), apiRegistro: (...a) => apiRegistro_(...a), apiRegistroGiorni: (...a) => apiRegistroGiorni_(...a), apiStato: (...a) => apiStato_(...a), apiControllaSettIA: (...a) => apiControllaSettIA_(...a), apiParoleOk: (...a) => apiParoleOk_(...a), apiPrenStoria: (...a) => apiPrenStoria_(...a), apiImpostaUrl: (...a) => apiImpostaUrl_(...a), apiPrenPeriodo: (...a) => apiPrenPeriodo_(...a)
};
// quale sezione serve per ogni operazione (null = basta essere nel pannello, 'G' = solo titolare o vice)
const SEZ_DI = {piatti: 'piatti', categorie: 'piatti', eventi: 'eventi', avvisi: 'avvisi', vini: 'vini', bevande: 'bevande', faq: 'faq', prezzi: 'oggi', orari: 'orari', regole: 'orari'};
function permessoPer_(fn, a) {
  switch (fn) {
    case 'apiLeggi': return a[0] === 'regole' ? null : SEZ_DI[a[0]] || 'G';
    case 'apiSalva': case 'apiElimina': case 'apiSposta': return SEZ_DI[a[0]] || 'G';
    case 'apiControllaIA': return SEZ_DI[a[0]] || 'G';
    case 'apiSettLeggi': case 'apiSettPubblica': case 'apiControllaSettIA': return 'oggi';
    case 'apiParoleOk': return null;
    case 'apiPizze': return puo_('piatti') ? 'piatti' : puo_('avvisi') ? 'avvisi' : 'oggi';
    case 'apiCaricaFoto': return puo_('piatti') ? 'piatti' : 'avvisi';
    case 'apiImpostazione': return a[0] === 'Promemoria menù del giorno' ? 'oggi' : 'G';
    case 'apiOpinioni': case 'apiOpinioneStato': case 'apiEsporta': return 'opinioni';
    case 'apiPren': case 'apiPrenSalva': case 'apiPrenStato': case 'apiPrenPeriodo': return 'pren';
    case 'apiTutto': return null;
    default: return 'G';            // persone, WhatsApp, avvisi, registro: solo titolare e vice
  }
}
async function api(k, fn, args) {
  CHI = chi_(k);
  if (!Object.prototype.hasOwnProperty.call(API, fn)) throw new Error('Operazione non valida.');
  args = Array.isArray(args) ? args : [];
  const serve = permessoPer_(fn, args);
  if (serve === 'G' ? !gestore_() : serve && !puo_(serve)) {
    throw new Error('Non hai il permesso per questa sezione: chiedilo al titolare o al vice.');
  }
  const prima = REG_PRIMA[fn] ? (() => { try { return REG_PRIMA[fn](args); } catch (e) { return null; } })() : null;
  let r = API[fn].apply(null, args);
  if (r && typeof r.then === 'function') { r = await r; CHI = chi_(k); }   // dopo un'attesa (IA, controllo email) si ristabilisce chi sta lavorando
  if (REG_DOPO[fn]) { try { const d = REG_DOPO[fn](args, r, prima); if (d) registra_(d[1], d[0], d[2]); } catch (e) {} }
  return r;
}

/* =========================== OPINIONI =========================== */
// il sito manda qui i voti (stesso deployment del pannello: esegui come me, accesso: chiunque)
const VOCI = ['cucina', 'pizza', 'sala', 'ambiente', 'attesa', 'ritiro'];
const TIPI = {pizza: 'Pizza', cucina: 'Piatti della cucina', entrambi: 'Pizza e cucina', pranzo: 'Pranzo di lavoro', asporto: 'Asporto'};
async function doPost(e) {
  const ok = ContentService.createTextOutput('ok');
  try {
    const d = JSON.parse(String(e.postData && e.postData.contents || '').slice(0, 4000));
    if (d && d.a === 'prenota') return jsonPr_(await prPrenota_(d));
    if (d && (d.a === 'annulla' || d.a === 'arrivo' || d.a === 'qui')) return jsonPr_(prAzione_(d));
    if (d.hp) return ok;                                           // trappola per i robot
    const tipo = TIPI[d.t] ? d.t : '';
    const v = VOCI.map(k => { const n = Math.round(+(d.r || {})[k]); return n >= 1 && n <= 5 ? n : ''; });
    const voti = v.filter(x => x !== '');
    if (!voti.length) return ok;
    const txt = x => String(x || '').replace(/[\r\n]+/g, ' ').replace(/^[=+\-@]/, "'").trim().slice(0, 300);
    // limiti contro lo spam: stesso messaggio una volta sola, massimo 40 opinioni l'ora
    const cache = CacheService.getScriptCache(), firma = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(d)));
    if (cache.get('o-' + firma)) return ok;
    const ora = 'n-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH'), n = +(cache.get(ora) || 0);
    if (n >= 40) return ok;
    cache.put('o-' + firma, '1', 3600); cache.put(ora, String(n + 1), 3700);
    const media = Math.round(voti.reduce((a, b) => a + b, 0) / voti.length * 10) / 10;
    const now = new Date(), lingua = /^(it|en|de|fr)$/.test(d.l) ? d.l : '', testi = [txt(d.best), txt(d.better), txt(d.wish)];
    // scritto in un'altra lingua: si traduce. Anche dalla pagina italiana (es. spagnolo, inglese): Google riconosce la lingua da solo
    let it = lingua && lingua !== 'it' ? testi.map(x => txt(traduci_(x, lingua))) : ['', '', ''];
    if (!it.some(Boolean) && testi.some(Boolean)) {
      const auto = testi.map(x => txt(traduci_(x, '')));
      const pulito = x => String(x || '').toLowerCase().replace(/[^a-zà-ÿ]/g, '');
      if (auto.some((x, i) => x && pulito(x) !== pulito(testi[i]))) it = auto;
    }
    conLock_(() => foglioOpinioni_().appendRow([
      Utilities.formatDate(now, TZ, 'dd/MM/yyyy'), Utilities.formatDate(now, TZ, 'HH:mm'), TIPI[tipo] || '',
      ...v, media, ...testi, lingua, '', ''].concat(it)));
  } catch (err) {}
  return ok;
}
// traduzione in italiano dei commenti scritti in un'altra lingua (servizio di Google già incluso, gratuito)
function traduci_(t, da) { t = String(t || '').trim(); if (!t) return ''; try { return LanguageApp.translate(t, da || '', 'it'); } catch (e) { return ''; } }
function apiOpinioni_() {
  const r = ruolo_() ? 'editor' : '';           // chi arriva qui ha il permesso «Opinioni»: può anche cambiarne lo stato
  const sh = foglioOpinioni_();
  const n = sh.getLastRow(); if (n < 2) return {ruolo: r, righe: []};
  const v = sh.getRange(2, 1, n - 1, 19).getDisplayValues();
  // opinioni straniere ancora senza traduzione (arrivate prima di questa funzione): se ne traducono fino a 40 per volta
  let fatte = 0;
  v.forEach((x, i) => {
    if (fatte >= 40 || !x[13] || x[13] === 'it' || (!x[10] && !x[11] && !x[12]) || x[16] || x[17] || x[18]) return;
    const t = [x[10], x[11], x[12]].map(y => traduci_(y, x[13]).slice(0, 300));
    if (!t.some(Boolean)) return;
    try { sh.getRange(i + 2, 17, 1, 3).setNumberFormat('@').setValues([t]); } catch (e) {}
    x[16] = t[0]; x[17] = t[1]; x[18] = t[2]; fatte++;
  });
  if (!String(sh.getRange(1, 17).getDisplayValue())) try { sh.getRange(1, 17, 1, 3).setValues([['Piaciuto (italiano)', 'Da migliorare (italiano)', 'Vorrebbe (italiano)']]); } catch (e) {}
  return {ruolo: r, righe: v.map((x, i) => [i + 2].concat(x)).filter(x => x[1])};
}
// stato di lavorazione e nota interna di un'opinione (colonne O e P)
function apiOpinioneStato_(riga, stato, nota) {
  ammesso_();
  if (['Nuova', 'In lavorazione', 'Risolta'].indexOf(stato) < 0) throw new Error('Stato non valido');
  const sh = foglioOpinioni_();
  if (!sh.getRange(1, 15).getValue()) sh.getRange(1, 15, 1, 2).setValues([['Stato', 'Nota interna']]);
  sh.getRange(+riga, 15, 1, 2).setNumberFormat('@').setValues([[stato, String(nota || '').slice(0, 500)]]);
  return true;
}
// esporta le opinioni filtrate in una nuova scheda, per lavorarci sopra
function apiEsporta_(righe) {
  ammesso_();
  const rows = [['Data', 'Cosa ha preso', 'Media', 'Giudizio', 'Temi', 'Voti bassi', 'Cosa è piaciuto', 'Cosa migliorare', 'Vorrebbe trovare', 'Stato', 'Nota interna']]
    .concat((righe || []).slice(0, 20000).map(r => r.slice(0, 11).map(x => String(x == null ? '' : x).replace(/^[=+\-@]/, "'"))));
  // file per Excel / Numbers / Fogli Google, mandato per email a chi lo chiede (i fogli restano privati)
  const csv = '\ufeff' + rows.map(r => r.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';')).join('\r\n');
  const nome = 'Opinioni Oltreconfini ' + Utilities.formatDate(new Date(), TZ, 'dd-MM-yyyy') + '.csv';
  MailApp.sendEmail({to: CHI.email, subject: nome, htmlBody: '<p>In allegato le ' + (rows.length - 1) + ' opinioni che hai filtrato nel pannello. Si apre con Excel, Numbers o Fogli Google.</p>',
    attachments: [Utilities.newBlob(csv, 'text/csv', nome)]});
  return CHI.email;
}

function foglio_(sez) {
  const c = SEZ[sez]; if (!c) throw new Error('Sezione sconosciuta');
  const ss = SpreadsheetApp.openById(c.id);
  if (!c.tab) return ss.getSheets()[0];
  let sh = ss.getSheetByName(c.tab);
  if (!sh && sez === 'categorie') {           // categorie del menù aggiunte dal pannello (es. Dolci), con le traduzioni per il sito
    sh = ss.insertSheet('Categorie'); sh.getRange(1, 1, 1, 5).setValues([['Categoria', 'EN', 'DE', 'FR', 'Prezzi sul sito']]);
  }
  return sh;
}
const CAT_BASE = ['dolci', 'antipasti', 'primi', 'secondi', 'contorni', 'menù bimbi', 'menu bimbi', 'bimbi', 'pizze', 'pizze speciali', 'pizza speciali'];
// una categoria nuova scritta in un piatto: si aggiunge alla scheda Categorie, tradotta in automatico (poi si corregge dal pannello)
function catAssicura_(nome) {
  nome = String(nome || '').replace(/\s+/g, ' ').trim(); if (!nome || CAT_BASE.indexOf(nome.toLowerCase()) >= 0) return;
  conLock_(() => {
    const sh = foglio_('categorie'), v = sh.getDataRange().getDisplayValues();
    if (v.slice(1).some(r => String(r[0]).trim().toLowerCase() === nome.toLowerCase())) return;
    const tr = l => { try { return LanguageApp.translate(nome, 'it', l) || nome; } catch (e) { return nome; } };
    sh.getRange(sh.getLastRow() + 1, 1, 1, 5).setNumberFormat('@').setValues([[nome, tr('en'), tr('de'), tr('fr'), 'no']]);
  });
  pulisci_('categorie');
}
// colonne da scrivere: quelle con un titolo e senza "(auto)" (le traduzioni automatiche non si toccano)
function colonne_(sh) {
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  return h.map((x, i) => ({n: i + 1, h: String(x).trim()})).filter(c => c.h && !/\(auto\)/i.test(c.h));
}
function ultima_(sh) {
  const v = sh.getRange(1, 1, Math.max(sh.getLastRow(), 1), 1).getDisplayValues();
  let n = 1; v.forEach((r, i) => { if (String(r[0]).trim()) n = i + 1; }); return n;
}
// tutto il foglio in una sola lettura (molto più veloce che colonna per colonna)
function leggi_(sez) {
  const sh = foglio_(sez), all = sh.getDataRange().getDisplayValues(), head = all[0] || [];
  const cols = head.map((x, i) => ({n: i + 1, h: String(x).trim()})).filter(c => c.h && !/\(auto\)/i.test(c.h));
  let last = 1; all.forEach((r, i) => { if (String(r[0]).trim()) last = i + 1; });
  const rows = all.slice(1, last).map(r => { const o = {}; cols.forEach(c => { o[c.h] = r[c.n - 1] == null ? '' : r[c.n - 1]; }); return o; });
  return {sh, cols, rows};
}
// scrive le colonne vicine tutte insieme (le traduzioni automatiche restano intatte)
function scrivi_(d, rows, oldLen) {
  const n = Math.max(rows.length, oldLen);
  if (!n) return;
  const gruppi = [];
  d.cols.forEach(c => { const g = gruppi[gruppi.length - 1]; if (g && g[g.length - 1].n === c.n - 1) g.push(c); else gruppi.push([c]); });
  gruppi.forEach(g => {
    const v = []; for (let i = 0; i < n; i++) v.push(g.map(c => { const x = rows[i] ? String(rows[i][c.h] == null ? '' : rows[i][c.h]) : ''; return /^=/.test(x) ? "'" + x : x; }));
    d.sh.getRange(2, g[0].n, n, g.length).setNumberFormat('@').setValues(v);
  });
}
function conLock_(f) {
  const l = LockService.getScriptLock(); l.waitLock(15000);
  try { return f(); } finally { l.releaseLock(); }
}

// --- foto dei piatti: caricate dal telefono, salvate in Drive, visibili sul sito ---
function cartellaFoto_() {
  const id = PROP.getProperty('CARTELLA_FOTO');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
  const c = DriveApp.createFolder('Oltreconfini · Foto dei piatti');
  PROP.setProperty('CARTELLA_FOTO', c.getId());
  return c;
}
function apiCaricaFoto_(b64, nome) {
  ammesso_();
  if (!b64 || String(b64).length > 8000000) throw new Error('Foto troppo grande');
  const n = String(nome || 'piatto').replace(/[^\w àèéìòù'-]/gi, '').slice(0, 60) || 'piatto';
  const f = cartellaFoto_().createFile(Utilities.newBlob(Utilities.base64Decode(b64), 'image/jpeg', n + '.jpg'));
  f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return f.getId();
}

// --- API usate dal pannello ---
// le sezioni lette di recente restano in memoria 5 minuti: si aprono subito (ogni modifica dal pannello la aggiorna)
const cache_ = () => CacheService.getScriptCache();
function pulisci_(sez) { try { cache_().remove('sez-' + sez); cache_().remove('pr-cfg'); } catch (e) {} }
function apiLeggi_(sez) {
  ammesso_();
  try { const c = cache_().get('sez-' + sez); if (c) return JSON.parse(c); } catch (e) {}
  const d = leggi_(sez), out = {headers: d.cols.map(c => c.h), rows: d.rows};
  try { const j = JSON.stringify(out); if (j.length < 90000) cache_().put('sez-' + sez, j, 300); } catch (e) {}
  return out;
}
// La riga da cambiare si ritrova confrontando il contenuto, non solo la posizione: se nel frattempo qualcuno
// ha aggiunto, spostato o cancellato righe (dal pannello o nel foglio), si modifica comunque quella giusta.
function stessa_(a, b, cols) { return cols.every(c => String(a[c.h] == null ? '' : a[c.h]).trim() === String(b[c.h] == null ? '' : b[c.h]).trim()); }
function trova_(d, i, orig) {
  const n = Number(i);
  if (!orig || typeof orig !== 'object') { if (!(n >= 0 && n < d.rows.length)) throw new Error('Questa voce non c’è più: ricarica il pannello.'); return n; }
  const cols = d.cols.filter(c => Object.prototype.hasOwnProperty.call(orig, c.h));
  if (d.rows[n] && stessa_(d.rows[n], orig, cols)) return n;
  const j = d.rows.findIndex(r => stessa_(r, orig, cols));
  if (j < 0) throw new Error('Nel frattempo questa voce è stata cambiata o eliminata (forse da un’altra persona). Ricarica il pannello e riprova.');
  return j;
}
function voce_(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) throw new Error('Dati non validi.');
  const o = {}; Object.keys(obj).slice(0, 60).forEach(k => { o[String(k)] = String(obj[k] == null ? '' : obj[k]).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 5000); }); return o;
}
function apiSalva_(sez, i, obj, dopo, orig) {        // i = indice della riga (null = nuova); dopo = dove inserire una riga nuova; orig = la riga com'era
  ammesso_(); pulisci_(sez); obj = voce_(obj);
  const r = conLock_(() => {
    const d = leggi_(sez), old = d.rows.length, rows = d.rows.slice();
    if (i === null || i === undefined) { const p = Number(dopo); rows.splice(dopo == null || !(p >= 0) || p >= rows.length ? rows.length : p + 1, 0, obj); }
    else { const n = trova_(d, i, orig); rows[n] = Object.assign({}, rows[n], obj); }
    scrivi_(d, rows, old); pulisci_(sez);
    return apiLeggi_(sez);
  });
  if (sez === 'piatti') { const kc = Object.keys(obj).find(k => /^categoria/i.test(k)); if (kc) catAssicura_(obj[kc]); }
  return r;
}
function apiElimina_(sez, i, orig) {
  ammesso_(); pulisci_(sez);
  return conLock_(() => { const d = leggi_(sez), old = d.rows.length, rows = d.rows.slice(); rows.splice(trova_(d, i, orig), 1); scrivi_(d, rows, old); pulisci_(sez); return apiLeggi_(sez); });
}
function apiSposta_(sez, i, dir, orig) {
  ammesso_(); pulisci_(sez);
  return conLock_(() => {
    const d = leggi_(sez), rows = d.rows.slice(), a = trova_(d, i, orig), j = a + (Number(dir) > 0 ? 1 : -1);
    if (j < 0 || j >= rows.length) return apiLeggi_(sez);
    const t = rows[a]; rows[a] = rows[j]; rows[j] = t; scrivi_(d, rows, rows.length); pulisci_(sez); return apiLeggi_(sez);
  });
}
// all'apertura il pannello si fa dare tutte le sezioni insieme: poi si passa da una all'altra senza attese
function apiTutto_() {
  ammesso_();
  if (gestore_()) { sincronizzaUrl_(); try { aggiornaFogli_(); } catch (e) {} }
  const out = {};
  ['piatti', 'categorie', 'eventi', 'avvisi', 'vini', 'bevande', 'faq', 'prezzi', 'orari', 'regole'].forEach(k => { if (k !== 'regole' && !puo_(SEZ_DI[k])) return; try { out[k] = apiLeggi_(k); } catch (e) {} });
  if (puo_('oggi')) try { out.__oggi = apiSettLeggi_(); } catch (e) {}
  try { out.__parole = JSON.parse(PROP.getProperty('PAROLE-OK') || '[]'); } catch (e) {}
  out.__demo = PROP.getProperty('DEMO-SITO') || '';
  const p = out.piatti;
  out.__pizze = p ? p.rows.filter(r => /^pizz/i.test(String(r[p.headers[0]] || '').trim()) && String(r[p.headers[1]] || '').trim()).map(r => String(r[p.headers[1]]).trim()) : [];
  return out;
}
function apiPizze_() {
  ammesso_();
  const v = SpreadsheetApp.openById(FOGLI.menu).getSheets()[0].getDataRange().getDisplayValues();
  return v.slice(1).filter(r => /^pizz/i.test(String(r[0]).trim()) && String(r[1]).trim()).map(r => String(r[1]).trim());
}
// menù del giorno: primo foglio di "3 · Oggi in cucina"
// MENÙ DELLA SETTIMANA (pranzo, dal lunedì al sabato, piatti diversi ogni giorno)
// primo foglio di "3 · Oggi in cucina": colonne Data | Portata | Piatto, una riga per piatto (il sito lo legge da lì)
const SETT_GIORNI = ['Lunedì', 'Martedì', 'Mercoledì', 'Giovedì', 'Venerdì', 'Sabato'];
const lunediDi_ = g => g - ((new Date(g * 864e5).getUTCDay() + 6) % 7);
const dmyDaG_ = g => { const d = new Date(g * 864e5); return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear(); };
// la settimana da mostrare di solito: quella in corso; di domenica la prossima
const settCorrente_ = () => { const g = adessoPr_().g; return (new Date(g * 864e5).getUTCDay() === 0) ? g + 1 : lunediDi_(g); };
function settLeggiRighe_() {
  const sh = SpreadsheetApp.openById(FOGLI.oggi).getSheets()[0], v = sh.getDataRange().getDisplayValues(), out = [];
  if (!v.length) return out;
  if (/^portata$/i.test(String((v[0] || [])[1] || '').trim())) {
    v.slice(1).forEach(r => { const g = dmyPr_(r[0]), k = /^sec/i.test(r[1]) ? 'secondi' : 'primi', p = String(r[2] || '').trim(); if (!isNaN(g) && p) out.push({g, k, p}); });
  } else {                                                  // formato vecchio (un giorno solo): lo converto
    const g = dmyPr_((v[0] || [])[1]); let cur = 'primi';
    if (!isNaN(g)) v.slice(1).forEach(r => { const x = String(r[0]).trim(); if (/^primi$|^piatti$/i.test(x)) cur = 'primi'; else if (/^secondi$/i.test(x)) cur = 'secondi'; else if (x) out.push({g, k: cur, p: x}); });
  }
  return out;
}
function apiSettLeggi_(lun) {
  ammesso_();
  const g0 = lun ? lunediDi_(giornoPr_(lun)) : settCorrente_();
  if (isNaN(g0)) throw new Error('Data non valida.');
  const R = settLeggiRighe_(), giorni = SETT_GIORNI.map((n, i) => {
    const g = g0 + i, r = R.filter(x => x.g === g);
    return {iso: isoPr_(g), nome: n, primi: r.filter(x => x.k === 'primi').map(x => x.p), secondi: r.filter(x => x.k === 'secondi').map(x => x.p)};
  });
  return {lun: isoPr_(g0), oggi: isoPr_(adessoPr_().g), corrente: isoPr_(settCorrente_()), giorni, pubblicata: giorni.some(x => x.primi.length || x.secondi.length)};
}
// salva la settimana intera; le altre settimane restano (quelle passate da più di due settimane si cancellano)
function apiSettPubblica_(lun, giorni) {
  ammesso_();
  const g0 = lunediDi_(giornoPr_(lun)); if (isNaN(g0)) throw new Error('Data non valida.');
  if (!Array.isArray(giorni)) throw new Error('Dati non validi.');
  const pulisci = a => String(a || '').split(/\r?\n/).map(x => x.replace(/^[\s•·\-–*]+/, '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/^[=+\-@]+/, '').trim().slice(0, 120)).filter(x => x).slice(0, 8);
  return conLock_(() => {
    const oggiG = adessoPr_().g;
    const R = settLeggiRighe_().filter(x => (x.g < g0 || x.g > g0 + 5) && x.g >= oggiG - 14);
    SETT_GIORNI.forEach((n, i) => { const d = giorni[i] || {}; pulisci(d.primi).forEach(p => R.push({g: g0 + i, k: 'primi', p})); pulisci(d.secondi).forEach(p => R.push({g: g0 + i, k: 'secondi', p})); });
    R.sort((a, b) => a.g - b.g || (a.k === b.k ? 0 : a.k === 'primi' ? -1 : 1));
    const sh = SpreadsheetApp.openById(FOGLI.oggi).getSheets()[0];
    const rows = [['Data', 'Portata', 'Piatto']].concat(R.map(x => [dmyDaG_(x.g), x.k === 'primi' ? 'Primi' : 'Secondi', x.p]));
    sh.clearContents();
    sh.getRange(1, 1, rows.length, 3).setNumberFormat('@').setValues(rows);
    return apiSettLeggi_(isoPr_(g0));
  });
}
function stessoGiorno_(s) {
  const d = String(s).match(/(\d{1,2})\D(\d{1,2})\D(\d{2,4})/), o = oggiTesto().split('/').map(Number);
  return !!(d && +d[1] === o[0] && +d[2] === o[1] && (+d[3] % 100) === (o[2] % 100));
}

/* =========================== PROMEMORIA E RISERVA =========================== */
const PROM_GIORNI = 'sab,dom,lun';
const IMPOSTAZIONI = ['Temi automatici', 'Promemoria menù del giorno', 'Promemoria dalle', 'Promemoria alle', 'Promemoria giorni', 'Indirizzo del sito', 'Link recensioni Google'].concat(Object.keys(PR_IMP).map(k => PR_IMP[k]));
// interruttore dal pannello (Oggi): scheda Impostazioni, riga "Promemoria menù del giorno"
function impostazione_(chiave) {
  try { const v = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni').getDataRange().getDisplayValues();
    const r = v.find(x => String(x[0]).trim().toLowerCase() === chiave.toLowerCase()); return r ? String(r[1]).trim() : ''; } catch (e) { return ''; }
}
function apiImpostazione_(chiave, valore) {
  ammesso_(); pulisci_('regole');
  chiave = String(chiave || '').slice(0, 80); valore = String(valore == null ? '' : valore).slice(0, 200);
  if (IMPOSTAZIONI.indexOf(chiave) < 0) throw new Error('Impostazione non valida.');
  if (chiave === 'Indirizzo del sito' && valore && !/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(valore)) throw new Error('Scrivi l’indirizzo completo, es. https://oltreconfini.it');
  const prK = Object.keys(PR_IMP).find(x => PR_IMP[x] === chiave), tipo = prK ? PR_RIGHE[prK][2] : null;
  if (Array.isArray(tipo)) { if (!/^\d{1,6}$/.test(valore)) throw new Error('«' + chiave + '»: scrivi solo un numero.'); if (+valore < tipo[0] || +valore > tipo[1]) throw new Error('«' + chiave + '»: scegli un numero tra ' + tipo[0] + ' e ' + tipo[1] + '.'); }
  if (tipo === 's' && !/^(sì|si|no)$/i.test(valore)) throw new Error('Valore non valido.');
  if (tipo === 'e' && valore && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(valore)) throw new Error('«' + chiave + '»: email non valida.');
  if (tipo === 't' && /[<>]/.test(valore)) throw new Error('«' + chiave + '»: niente simboli < >.');
  if (prK === 'telLoc' && valore.replace(/\D/g, '').length < 6) throw new Error('Scrivi il telefono completo, es. +39 0332 475287');
  if (chiave === 'Link recensioni Google' && valore && !/^https:\/\/(g\.page|www\.google\.|maps\.app\.goo\.gl|search\.google\.com|goo\.gl)/i.test(valore)) throw new Error('Il link deve essere quello di Google (inizia con https://g.page, https://maps.app.goo.gl o https://search.google.com).');
  return conLock_(() => {
    const sh = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni'); if (!sh) throw new Error('Manca la scheda Impostazioni: esegui «installa».');
    const v = sh.getDataRange().getDisplayValues(), i = v.findIndex(x => String(x[0]).trim().toLowerCase() === chiave.toLowerCase());
    if (i >= 0) sh.getRange(i + 1, 2).setNumberFormat('@').setValue(valore); else sh.getRange(sh.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([[chiave, valore]]);
    pulisci_('regole'); return apiLeggi_('regole');
  });
}
// promemoria per preparare il menù del giorno della settimana: un'email al giorno, nei giorni scelti (di base sabato, domenica e lunedì)
function promemoria() {
  if (/^(no|spent|off)/i.test(impostazione_('Promemoria menù del giorno'))) return;   // spento dal pannello
  const now = new Date(), oggi = Utilities.formatDate(now, TZ, 'yyyy-MM-dd');
  const giorno = +Utilities.formatDate(now, TZ, 'u'), ora = +Utilities.formatDate(now, TZ, 'HHmm');
  const hm = (s, d) => { const m = String(s || '').match(/(\d{1,2})[:.](\d{2})/); return m ? +m[1] * 100 + +m[2] : d; };
  const da = hm(impostazione_('Promemoria dalle'), 930), a = hm(impostazione_('Promemoria alle'), 1200);
  const GG = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'], gg = (impostazione_('Promemoria giorni') || PROM_GIORNI).toLowerCase();
  if (gg.indexOf(GG[giorno - 1]) < 0 || ora < da || ora >= a) return;
  if (PROP.getProperty('PROM-INVIATO') === oggi) return;                  // già mandato oggi
  // la settimana da preparare: quella che inizia lunedì prossimo (di lunedì: quella di oggi). Se è già scritta, niente email
  const gOggi = adessoPr_().g, lunSett = (giorno === 1 ? gOggi : gOggi + (8 - giorno));
  try { if (settLeggiRighe_().some(x => x.g >= lunSett && x.g <= lunSett + 5)) return; } catch (e) {}
  PROP.setProperty('PROM-INVIATO', oggi);
  persone_().filter(x => x.promemoria && puoP_(x, 'oggi')).map(x => x.email).forEach(m => { try { MailApp.sendEmail({
    to: m,
    subject: 'Promemoria: prepara il menù della settimana (dal ' + dmyDaG_(lunSett).slice(0, 5) + ')',
    htmlBody: '<p>Il menù del pranzo della settimana che inizia lunedì ' + dmyDaG_(lunSett) + ' non è ancora sul sito.</p><p>' + bottone(linkDi_(m) + '&t=oggi', 'Scrivi il menù della settimana') + '</p>' +
      '<p style="color:#777">Arriva una volta al giorno, solo nei giorni scelti (Configurazione → Promemoria).</p>'
  }); } catch (e) {} });
}
function copiaRiserva() {
  const copia = (da, a, sano) => {
    try {
      const v = SpreadsheetApp.openById(da).getSheets()[0].getDataRange().getDisplayValues();
      if (!v.length || !sano(v)) return;
      const sh = SpreadsheetApp.openById(a).getSheets()[0];
      sh.clearContents();
      sh.getRange(1, 1, v.length, v[0].length).setNumberFormat('@').setValues(v);
    } catch (e) {}
  };
  copia(FOGLI.menu, RISERVA.menu, v => String(v[0][0]).toLowerCase().startsWith('categoria') && v.slice(1).filter(r => r[0] && r[1]).length >= 8);
  if (!PROP.getProperty('DEMO-SITO')) copia(FOGLI.speciali, RISERVA.speciali, v => String(v[0][0]).toLowerCase().startsWith('attivo') && v[0].some(x => String(x).toLowerCase().startsWith('evento')));
}

/* =========================== PRENOTAZIONI =========================== */
// Tutte le prenotazioni (dal sito e dal pannello) passano da qui.
// I dati personali restano SOLO nelle proprietà di questo script (niente fogli: nessuna cronologia delle versioni)
// e vengono cancellati ogni notte alle 3 per i giorni passati. Restano solo numeri anonimi per le statistiche.
const PR_STATI = {ok: 'Confermata', arr: 'Arrivati', ann: 'Annullata dal cliente', annR: 'Annullata', lib: 'Liberata per ritardo'};
const PR_ATTIVA = s => s === 'ok' || s === 'arr';
const PR_MARCA = 'Rif. OCPREN';                 // per ritrovare (e cancellare) le copie delle email inviate
// --- controlli su telefono ed email del cliente (sito e pannello) ---
// telefono: italiano (cellulare 3xx o fisso 0xx) oppure estero con il prefisso (+41…, 0049…)
function telValido_(t) {
  let s = String(t || '').replace(/[\s.\/()\-]/g, '');
  if (!/^\+?\d+$/.test(s)) return false;
  if (s.indexOf('00') === 0) s = '+' + s.slice(2);
  let naz = s;
  if (s[0] === '+') { if (s.indexOf('+39') !== 0) { const d = s.slice(1); return d.length >= 8 && d.length <= 15 && !/^(\d)\1+$/.test(d.slice(2)); } naz = s.slice(3); }
  if (/^(\d)\1+$/.test(naz.slice(1))) return false;          // es. 3333333333
  return /^3\d{8,9}$/.test(naz) || /^0\d{5,10}$/.test(naz);
}
const MAIL_USA_E_GETTA = ['mailinator.com', 'yopmail.com', 'yopmail.fr', 'guerrillamail.com', 'guerrillamail.net', '10minutemail.com', 'temp-mail.org', 'tempmail.com', 'trashmail.com', 'getnada.com', 'sharklasers.com', 'dispostable.com', 'maildrop.cc', 'mohmal.com', 'emailondeck.com', 'throwawaymail.com', 'fakeinbox.com'];
const MAIL_NOTI = ['gmail.com', 'googlemail.com', 'hotmail.com', 'hotmail.it', 'outlook.com', 'outlook.it', 'live.com', 'live.it', 'msn.com', 'libero.it', 'yahoo.com', 'yahoo.it', 'icloud.com', 'me.com', 'virgilio.it', 'tiscali.it', 'alice.it', 'tim.it', 'fastwebnet.it', 'email.it', 'gmx.ch', 'gmx.de', 'gmx.net', 'bluewin.ch', 'web.de', 't-online.de', 'orange.fr', 'free.fr', 'sunrise.ch', 'proton.me', 'protonmail.com'];
// 'ok' | 'sintassi' | 'usaegetta' | 'dominio' (il dominio non esiste o non riceve email: di solito un errore di battitura)
async function emailValida_(em) {
  em = String(em || '').trim().toLowerCase();
  if (em.length > 100 || em.indexOf('..') >= 0 || !/^[a-z0-9._%+'-]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(em)) return 'sintassi';
  const dom = em.split('@')[1];
  if (MAIL_USA_E_GETTA.indexOf(dom) >= 0) return 'usaegetta';
  if (MAIL_NOTI.indexOf(dom) >= 0) return 'ok';
  const ck = 'mx-' + dom; try { const c = cache_().get(ck); if (c) return c; } catch (e) {}
  let r = 'ok';
  try {
    const q = async t => JSON.parse((await UrlFetchApp.fetch('https://dns.google/resolve?name=' + encodeURIComponent(dom) + '&type=' + t, {muteHttpExceptions: true})).getContentText());
    const mx = await q('MX');
    if (mx.Status === 3) r = 'dominio';
    else if (mx.Status === 0 && !(mx.Answer || []).some(a => a.type === 15)) { const a = await q('A'); if (!(a.Answer || []).some(x => x.type === 1)) r = 'dominio'; }
  } catch (e) { r = 'ok'; }          // controllo non raggiungibile: non si blocca la prenotazione
  try { cache_().put(ck, r, 21600); } catch (e) {}
  return r;
}
const normPr_ = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const hmPr_ = s => { const m = String(s || '').match(/(\d{1,2})[:.,h](\d{2})/) || String(s || '').match(/^(\d{1,2})$/); return m ? +m[1] * 60 + +(m[2] || 0) : null; };
const spanPr_ = (a, b) => { a = hmPr_(a); b = hmPr_(b); if (a === null || b === null) return null; if (b <= a) b += 1440; return [a, b]; };
const labPr_ = m => ('0' + Math.floor(m / 60) % 24).slice(-2) + ':' + ('0' + m % 60).slice(-2);
const giornoPr_ = iso => { const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})$/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN; };
const isoPr_ = g => new Date(g * 864e5).toISOString().slice(0, 10);
const dmyPr_ = s => { const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) / 864e5 : NaN; };
function adessoPr_() { const s = Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'); const g = giornoPr_(s.slice(0, 10)), m = hmPr_(s.slice(11)); return {g, m, abs: g * 1440 + m}; }
function jsonPr_(o) { const t = ContentService.createTextOutput(JSON.stringify(o)); try { t.setMimeType(ContentService.MimeType.JSON); } catch (e) {} return t; }

// --- regole: orari della settimana, chiusure e orari speciali, impostazioni (in memoria 5 minuti) ---
function prCfg_() {
  try { const s = cache_().get('pr-cfg'); if (s) return JSON.parse(s); } catch (e) {}
  const ss = SpreadsheetApp.openById(FOGLI.oggi), imp = {};
  try { ss.getSheetByName('Impostazioni').getDataRange().getDisplayValues().forEach(r => { if (r[0]) imp[normPr_(r[0])] = String(r[1]).trim(); }); } catch (e) {}
  const val = k => { const v = imp[normPr_(PR_IMP[k])]; return v === undefined || v === '' ? PR_DEF[k] : v; };
  const num = (k, a, b) => { const v = parseInt(String(val(k)).replace(/\D/g, ''), 10); return isNaN(v) ? +PR_DEF[k] : Math.min(b, Math.max(a, v)); };
  const regola = (re, d, a, b) => { const k = Object.keys(imp).find(x => re.test(x)); const v = k ? parseInt(String(imp[k]).replace(/\D/g, ''), 10) : NaN; return isNaN(v) ? d : Math.min(b, Math.max(a, v)); };
  const week = Array.from({length: 7}, () => [[720, 870], [1140, 1350]]);
  try {
    const v = ss.getSheetByName('Orari').getDataRange().getDisplayValues(), h = v[0].map(normPr_), c = t => h.findIndex(x => x.indexOf(t) === 0);
    const I = {g: c('giorno'), la: c('pranzo dal'), lb: c('pranzo al'), da: c('cena dal'), db: c('cena al')}, DAYS = ['lun', 'mar', 'mer', 'gio', 'ven', 'sab', 'dom'];
    if (I.g >= 0 && I.la >= 0 && I.da >= 0) v.slice(1).forEach(r => { const k = DAYS.indexOf(normPr_(r[I.g]).slice(0, 3)); if (k >= 0) week[k] = [spanPr_(r[I.la], r[I.lb]), spanPr_(r[I.da], r[I.db])]; });
  } catch (e) {}
  const ann = [];
  try {
    const v = SpreadsheetApp.openById(FOGLI.avvisi).getSheets()[0].getDataRange().getDisplayValues(), h = v[0].map(normPr_), c = t => h.findIndex(x => x.indexOf(t) === 0);
    const I = {t: c('tipo'), a: c('dal'), b: c('al'), q: c('quando'), la: c('pranzo dal'), lb: c('pranzo al'), da: c('cena dal'), db: c('cena al')};
    const g = (r, i) => i >= 0 ? r[i] : '';
    v.slice(1).forEach(r => {
      const t = normPr_(g(r, I.t)), tipo = t.indexOf('chius') === 0 ? 'c' : t.indexOf('orario') === 0 ? 'h' : ''; if (!tipo) return;
      const a = dmyPr_(g(r, I.a)); let b = dmyPr_(g(r, I.b)); if (isNaN(a)) return; if (isNaN(b) || b < a) b = a;
      const q = normPr_(g(r, I.q));
      ann.push({t: tipo, a, b, q: /pranzo/.test(q) ? 'l' : /cena/.test(q) ? 'd' : 'a', lun: spanPr_(g(r, I.la), g(r, I.lb)), din: spanPr_(g(r, I.da), g(r, I.db))});
    });
  } catch (e) {}
  // tutte le impostazioni della tabella PR_RIGHE: numeri dentro i limiti, interruttori, testi
  const cfg = {week, ann, book: regola(/^ultima prenot/, 45, 0, 240), lead: regola(/^preavviso prenot/, 60, 0, 1440), days: regola(/^prenotazioni fino/, 60, 1, 365)};
  Object.keys(PR_RIGHE).forEach(k => { const t = PR_RIGHE[k][2];
    cfg[k] = Array.isArray(t) ? num(k, t[0], t[1]) : t === 's' ? !/^(no|off|spent)/i.test(val(k)) : String(val(k)).replace(/[<>]/g, '').slice(0, 200); });
  cfg.cop = [cfg.copL, cfg.copD]; cfg.dur = [cfg.durL, cfg.durD];
  if (cfg.lib <= cfg.avv) cfg.lib = cfg.avv + 5;
  if (cfg.telLoc.replace(/\D/g, '').length < 6) cfg.telLoc = PR_DEF.telLoc;
  try { cache_().put('pr-cfg', JSON.stringify(cfg), 300); } catch (e) {}
  return cfg;
}
// servizi aperti in un giorno: [pranzo, cena], ognuno [inizio, fine] in minuti oppure null (chiuso)
function serviziPr_(cfg, g) {
  const sp = cfg.ann.filter(a => a.t === 'h' && g >= a.a && g <= a.b).sort((x, y) => y.a - x.a)[0];
  const s = sp ? [sp.lun, sp.din] : cfg.week[(new Date(g * 864e5).getUTCDay() + 6) % 7];
  return s.map((x, k) => x && !cfg.ann.some(a => a.t === 'c' && g >= a.a && g <= a.b && (a.q === 'a' || (a.q === 'l' && k === 0) || (a.q === 'd' && k === 1))) ? x : null);
}
// orari prenotabili online: ogni quarto d'ora, fino a "ultima prenotazione" prima della chiusura, con il preavviso per oggi
function orariPr_(cfg, g, now, perPannello) {
  const out = [];
  if (!perPannello && (g < now.g || g > now.g + cfg.days)) return out;
  serviziPr_(cfg, g).forEach((s, k) => { if (!s) return;
    const st = cfg.step || 15;
    for (let m = Math.ceil(s[0] / st) * st; m <= s[1] - (perPannello ? 0 : cfg.book); m += st) {
      if (!perPannello && g === now.g && m < now.m + cfg.lead) continue;
      out.push({m, k});
    } });
  return out;
}
// posti liberi per un arrivo alle m (servizio k): il tavolo resta occupato per la "durata del tavolo"
function liberiPr_(cfg, lista, m, k, salta) {
  const att = lista.filter(b => PR_ATTIVA(b.s) && b.id !== salta);
  let max = 0;
  for (let t = m; t < m + cfg.dur[k]; t += 15) {
    const occ = att.reduce((a, b) => a + (b.m <= t && t < b.m + cfg.dur[b.k] ? b.n : 0), 0);
    if (occ > max) max = occ;
  }
  return cfg.cop[k] - max;
}
function statoPr_(cfg, liberi, n, k) {
  if (liberi < n) return 'pieno';
  return liberi - n < cfg.pochi ? 'pochi' : 'ok';
}

// --- archivio: un elenco per giorno, a pezzi da 8,5 KB (limite di Google per ogni voce) ---
function prTutte_() { return PROP.getProperties(); }
function prLeggi_(iso, tutte) {
  tutte = tutte || prTutte_(); let out = [];
  Object.keys(tutte).filter(k => k.indexOf('PR:' + iso + ':') === 0).sort((a, b) => +a.split(':')[2] - +b.split(':')[2])
    .forEach(k => { try { out = out.concat(JSON.parse(tutte[k])); } catch (e) {} });
  return out;
}
function prScrivi_(iso, lista) {
  const vecchie = Object.keys(prTutte_()).filter(k => k.indexOf('PR:' + iso + ':') === 0), pezzi = [];
  let cur = [];
  const byte = x => unescape(encodeURIComponent(x)).length;     // Google conta i byte (le lettere accentate valgono 2)
  lista.forEach(b => { const t = cur.concat([b]); if (byte(JSON.stringify(t)) > 8000 && cur.length) { pezzi.push(cur); cur = [b]; } else cur = t; });
  if (cur.length) pezzi.push(cur);
  const set = {}; pezzi.forEach((p, i) => { set['PR:' + iso + ':' + i] = JSON.stringify(p); });
  if (pezzi.length) PROP.setProperties(set);
  vecchie.forEach(k => { if (!(k in set)) PROP.deleteProperty(k); });
  try { for (let n = 1; n <= 30; n++) cache_().remove('pd-' + iso + '-' + n); } catch (e) {}
}
function prSpazio_(tutte) { return Object.keys(tutte).filter(k => k.indexOf('PR:') === 0).reduce((a, k) => a + String(tutte[k]).length, 0); }
const prToken_ = (iso, id) => iso.replace(/-/g, '') + id;
function prDaToken_(t) { const m = String(t || '').match(/^(\d{4})(\d{2})(\d{2})([a-f0-9]{32})$/); return m ? {iso: m[1] + '-' + m[2] + '-' + m[3], id: m[4]} : null; }

// --- le email al cliente, nella sua lingua ---
const PR_TXT = {
  it: {recensione: 'Grazie della visita', b_recensione: 'grazie per essere stati da noi! Se vi siete trovati bene, una recensione su Google ci aiuta tantissimo: bastano un minuto e qualche stella.', rev: 'Lascia una recensione su Google', conferma: 'Prenotazione confermata', modifica: 'Prenotazione modificata', promemoria: 'Ti aspettiamo', ritardo: 'Stai arrivando?', liberata: 'Tavolo liberato', annullata: 'Prenotazione annullata',
    ciao: 'Ciao', persone: 'persone', persona: 'persona', alle: 'alle',
    b_conferma: 'la tua prenotazione è confermata:', b_modifica: 'abbiamo aggiornato la tua prenotazione:', b_promemoria: 'ti ricordiamo la prenotazione di oggi:',
    b_ritardo: 'ti stiamo aspettando. Se stai arrivando, confermacelo con un tocco: teniamo il tavolo fino all’orario che ci indichi. Senza conferma il tavolo viene liberato {m} minuti dopo l’orario prenotato.',
    b_ritardo_m: 'ti stiamo aspettando. Se stai arrivando dicci tra quanto con un tocco; se sei già da noi tocca «Siamo già qui». Se non riusciamo a sentirti, ti chiameremo al numero che ci hai lasciato.',
    b_liberata: 'non avendo tue notizie abbiamo liberato il tavolo prenotato. Se sei già da noi, ignora questo messaggio.', b_annullata: 'la prenotazione è stata annullata:',
    gest: 'Annulla la prenotazione', arr: 'Rispondi: arrivo o sono già qui', cambia: 'Per cambiare giorno o orario annulla e prenota di nuovo, oppure chiamaci al {tel}.',
    priv: 'Usiamo questi dati solo per la tua prenotazione (e, dopo la visita, per chiederti un parere) e li cancelliamo la notte dopo. Informativa:'},
  en: {recensione: 'Thank you for visiting', b_recensione: 'thank you for dining with us! If you enjoyed your visit, a Google review helps us a lot: it only takes a minute and a few stars.', rev: 'Leave a Google review', conferma: 'Booking confirmed', modifica: 'Booking updated', promemoria: 'See you soon', ritardo: 'Are you on your way?', liberata: 'Table released', annullata: 'Booking cancelled',
    ciao: 'Hello', persone: 'people', persona: 'person', alle: 'at',
    b_conferma: 'your booking is confirmed:', b_modifica: 'we have updated your booking:', b_promemoria: 'a reminder of your booking for today:',
    b_ritardo: 'we are waiting for you. If you are on your way, let us know with one tap: we will keep the table until the time you choose. Without a reply the table is released {m} minutes after the booked time.',
    b_ritardo_m: 'we are waiting for you. If you are on your way, tell us when with one tap; if you are already here, tap «We are already here». If we do not hear from you, we will call the number you gave us.',
    b_liberata: 'as we have not heard from you, we have released your table. If you are already here, please ignore this message.', b_annullata: 'the booking has been cancelled:',
    gest: 'Cancel your booking', arr: 'Reply: on my way or already here', cambia: 'To change day or time, cancel and book again, or call us on {tel}.',
    priv: 'We use these details only for your booking (and, after your visit, to ask for your feedback) and delete them the following night. Privacy notice:'},
  de: {recensione: 'Danke für Ihren Besuch', b_recensione: 'vielen Dank für Ihren Besuch! Wenn es Ihnen gefallen hat, hilft uns eine Google-Bewertung sehr: Es dauert nur eine Minute.', rev: 'Auf Google bewerten', conferma: 'Reservierung bestätigt', modifica: 'Reservierung geändert', promemoria: 'Wir freuen uns auf Sie', ritardo: 'Sind Sie unterwegs?', liberata: 'Tisch freigegeben', annullata: 'Reservierung storniert',
    ciao: 'Guten Tag', persone: 'Personen', persona: 'Person', alle: 'um',
    b_conferma: 'Ihre Reservierung ist bestätigt:', b_modifica: 'wir haben Ihre Reservierung geändert:', b_promemoria: 'wir erinnern Sie an Ihre heutige Reservierung:',
    b_ritardo: 'wir warten auf Sie. Wenn Sie unterwegs sind, bestätigen Sie es mit einem Tipp: Wir halten den Tisch bis zur angegebenen Zeit frei. Ohne Antwort wird der Tisch {m} Minuten nach der reservierten Zeit freigegeben.',
    b_ritardo_m: 'wir warten auf Sie. Wenn Sie unterwegs sind, sagen Sie uns mit einem Tipp, wann Sie da sind; wenn Sie schon hier sind, tippen Sie auf «Wir sind schon da». Wenn wir nichts hören, rufen wir Sie an.',
    b_liberata: 'da wir nichts von Ihnen gehört haben, haben wir den Tisch freigegeben. Falls Sie schon bei uns sind, ignorieren Sie diese Nachricht.', b_annullata: 'die Reservierung wurde storniert:',
    gest: 'Reservierung stornieren', arr: 'Antworten: unterwegs oder schon da', cambia: 'Um Tag oder Uhrzeit zu ändern, stornieren und neu reservieren oder anrufen: {tel}.',
    priv: 'Wir verwenden diese Daten nur für Ihre Reservierung (und nach dem Besuch für eine kurze Bitte um Ihre Meinung) und löschen sie in der folgenden Nacht. Datenschutz:'},
  fr: {recensione: 'Merci de votre visite', b_recensione: 'merci d’être venus chez nous ! Si vous avez aimé, un avis sur Google nous aide beaucoup : il suffit d’une minute et de quelques étoiles.', rev: 'Laisser un avis sur Google', conferma: 'Réservation confirmée', modifica: 'Réservation modifiée', promemoria: 'À tout à l’heure', ritardo: 'Êtes-vous en route ?', liberata: 'Table libérée', annullata: 'Réservation annulée',
    ciao: 'Bonjour', persone: 'personnes', persona: 'personne', alle: 'à',
    b_conferma: 'votre réservation est confirmée :', b_modifica: 'nous avons modifié votre réservation :', b_promemoria: 'nous vous rappelons votre réservation d’aujourd’hui :',
    b_ritardo: 'nous vous attendons. Si vous êtes en route, confirmez-le d’un geste : nous gardons la table jusqu’à l’heure indiquée. Sans réponse, la table est libérée {m} minutes après l’heure réservée.',
    b_ritardo_m: 'nous vous attendons. Si vous êtes en route, dites-nous dans combien de temps d’un geste ; si vous êtes déjà là, touchez «Nous sommes déjà là». Sans nouvelles, nous vous appellerons.',
    b_liberata: 'sans nouvelles de votre part, nous avons libéré la table. Si vous êtes déjà chez nous, ignorez ce message.', b_annullata: 'la réservation a été annulée :',
    gest: 'Annuler la réservation', arr: 'Répondre : en route ou déjà là', cambia: 'Pour changer de jour ou d’heure, annulez et réservez à nouveau, ou appelez le {tel}.',
    priv: 'Nous utilisons ces données uniquement pour votre réservation (et, après votre visite, pour vous demander votre avis) et les supprimons la nuit suivante. Confidentialité :'}
};
const PR_GG = {it: ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'], en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  de: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'], fr: ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']};
const PR_MESI = {it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']};
function dataPr_(g, lg) { lg = PR_GG[lg] ? lg : 'it'; const d = new Date(g * 864e5), w = PR_GG[lg][d.getUTCDay()], n = d.getUTCDate(), mo = PR_MESI[lg][d.getUTCMonth()];
  return lg === 'de' ? w + ', ' + n + '. ' + mo : lg === 'en' ? w + ' ' + n + ' ' + mo : w + ' ' + n + ' ' + mo; }
function prMail_(b, iso, tipo, cfg) {
  if (!b.em) return true;
  cfg = cfg || prCfg_();
  try { if (MailApp.getRemainingDailyQuota && MailApp.getRemainingDailyQuota() < 1) return false; } catch (e) {}
  const L = PR_TXT[b.lg] || PR_TXT.it, sito = sito_(), link = sito + 'prenotazione/?t=' + prToken_(iso, b.id);
  const data = dataPr_(giornoPr_(iso), b.lg);
  const riga = '<p style="font:600 18px Georgia,serif;margin:14px 0">' + esc(data) + ' ' + L.alle + ' ' + labPr_(b.m) + ' · ' + b.n + ' ' + (b.n === 1 ? L.persona : L.persone) + '</p>';
  const corpo = tipo === 'ritardo' ? (cfg.libAuto ? L.b_ritardo.replace('{m}', cfg.lib) : L.b_ritardo_m) : L['b_' + tipo];
  const nome = String(b.nm || '').split(/\s+/)[0];
  const html = '<div style="font:16px/1.5 Arial,sans-serif;color:#1b2430;max-width:520px">' +
    '<p style="font:italic 26px Georgia,serif;color:#0b121c;margin:0 0 12px">' + esc(cfg.nomeLoc) + '</p>' +
    '<p>' + L.ciao + ' ' + esc(nome) + ', ' + esc(corpo) + '</p>' + (tipo === 'liberata' || tipo === 'recensione' ? '' : riga) +
    (tipo === 'annullata' || tipo === 'liberata' ? '' : tipo === 'recensione' ? '<p>' + bottone(impostazione_('Link recensioni Google'), '★★★★★ ' + L.rev) + '</p>' : '<p>' + bottone(link, tipo === 'ritardo' ? L.arr : L.gest) + '</p>') +
    (tipo === 'conferma' || tipo === 'modifica' ? '<p style="color:#555">' + esc(L.cambia.replace('{tel}', cfg.telLoc)) + '</p>' : '') +
    (cfg.notaMail ? '<p>' + esc(cfg.notaMail) + '</p>' : '') +
    '<p style="color:#555">' + esc(cfg.nomeLoc) + ' · ' + esc(cfg.indLoc) + ' · ' + esc(cfg.telLoc) + '</p>' +
    '<p style="color:#888;font-size:12px">' + esc(L.priv) + ' <a href="' + sito + '#privacy">' + sito.replace(/^https?:\/\//, '').replace(/\/$/, '') + '</a><br>' + PR_MARCA + '</p></div>';
  const o = {to: b.em, subject: cfg.nomeLoc + ' · ' + L[tipo], htmlBody: html, name: cfg.nomeLoc}; if (cfg.mailLoc) o.replyTo = cfg.mailLoc;
  try { MailApp.sendEmail(o); return true; } catch (e) { return false; }
}
// avviso al locale (senza dati personali: solo giorno, ora e numero di persone)
function prAvvisaLocale_(iso, b, cosa) { prCoda_({c: 'loc', iso, id: b.id, t: cosa}); }
function prAvvisaLocaleOra_(iso, b, cosa) {
  try {
    let a = []; try { a = JSON.parse(PROP.getProperty('PR-AVVISI') || '[]'); } catch (e) {}
    if (!a.length) a = editori_().filter(x => x.promemoria).map(x => x.email);      // nessun indirizzo scelto: chi ha il promemoria
    if (!a.length) return;
    MailApp.sendEmail({to: a.join(','), subject: 'Prenotazioni · ' + cosa + ' per oggi alle ' + labPr_(b.m),
      htmlBody: '<p>' + esc(cosa) + ': oggi alle <b>' + labPr_(b.m) + '</b>, ' + b.n + ' persone.</p><p>I dettagli sono nel pannello, sezione Prenotazioni.</p><p style="color:#888;font-size:12px">' + PR_MARCA + '</p>'});
  } catch (e) {}
}

// avviso al personale per un cliente in ritardo: qui servono nome e telefono, per poterlo richiamare subito
function prPersonale_(iso, b, tipo) { prCoda_({c: 'pers', iso, id: b.id, t: tipo}); }
function prPersonaleOra_(iso, b, tipo) {
  try {
    let a = []; try { a = JSON.parse(PROP.getProperty('PR-AVVISI') || '[]'); } catch (e) {}
    if (!a.length) a = editori_().filter(x => x.promemoria).map(x => x.email);
    if (!a.length) a = [proprietario_()].filter(Boolean);
    const ora = labPr_(b.m), chi = esc(b.nm) + ' · ' + b.n + (b.n === 1 ? ' persona' : ' persone') + ' · prenotazione delle ' + ora;
    const tel = '<a href="tel:' + String(b.tel).replace(/[^\d+]/g, '') + '" style="font-size:20px">📞 ' + esc(b.tel) + '</a>';
    const T = {
      dac: ['Da contattare: ' + b.nm + ' (' + ora + ')', '<p><b>' + chi + '</b></p><p>Non è arrivato e non ha risposto all’email. Chiamalo per sapere se arriva:</p><p>' + tel + '</p><p>Poi nel pannello tocca «Arrivati», «Sta arrivando» oppure «Libera il tavolo».</p>'],
      liberata: ['Tavolo liberato in automatico: ' + b.nm + ' (' + ora + ')', '<p><b>' + chi + '</b></p><p>Non è arrivato e non ha risposto: il tavolo è stato liberato. Se arriva lo stesso, nel pannello tocca «Riattiva».</p><p>' + tel + '</p>'],
      risposto: ['Ha risposto: ' + b.nm + ' arriva alle ' + (b.eta ? labPr_(b.eta % 1440) : '?'), '<p><b>' + chi + '</b></p><p>Il cliente ha confermato che sta arrivando: non serve chiamarlo.</p>'],
      qui: ['Già al tavolo: ' + b.nm + ' (' + ora + ')', '<p><b>' + chi + '</b></p><p>Il cliente ha segnalato che è già al ristorante: è stato segnato come arrivato. Non serve chiamarlo.</p>']
    }[tipo]; if (!T) return;
    a.forEach(m => {
      let link = ''; try { const k = chiavi_()[m]; if (k && PROP.getProperty('PANNELLO')) link = '<p>' + bottone(linkDi_(m) + '&t=pren', 'Apri le prenotazioni') + '</p>'; } catch (e) {}
      try { MailApp.sendEmail({to: m, subject: T[0], htmlBody: T[1] + link + '<p style="color:#888;font-size:12px">' + PR_MARCA + '</p>'}); } catch (e) {}
    });
  } catch (e) {}
}

// le email partono in sottofondo (entro un minuto): salvare una prenotazione non aspetta l'invio.
// In coda ci sono solo giorno, codice e tipo: i dati veri si rileggono al momento dell'invio.
function prCoda_(voce) {
  try { conLock_(() => { let q = []; try { q = JSON.parse(PROP.getProperty('PR-CODA') || '[]'); } catch (e) {} q.push(voce); PROP.setProperty('PR-CODA', JSON.stringify(q.slice(-300))); }); } catch (e) {}
}
function prAvvisa_(b, iso, tipo) { prCoda_({c: 'cli', iso, id: b.id, t: tipo}); }
function prInvia() {
  registroScarica_();
  let q = [];
  try { conLock_(() => { try { q = JSON.parse(PROP.getProperty('PR-CODA') || '[]'); } catch (e) {} if (q.length) PROP.deleteProperty('PR-CODA'); }); } catch (e) { return; }
  if (!q.length) return;
  const cfg = prCfg_(), giorni = {};
  q.forEach(v => {
    try {
      const L = giorni[v.iso] = giorni[v.iso] || prLeggi_(v.iso), b = L.find(x => x.id === v.id); if (!b) return;    // cancellata nel frattempo
      if (v.c === 'cli') { if (!prMail_(b, v.iso, v.t, cfg) && !b.mf) prSegna_(v.iso, b.id, {mf: 1}); }
      else if (v.c === 'pers') prPersonaleOra_(v.iso, b, v.t);
      else if (v.c === 'loc') prAvvisaLocaleOra_(v.iso, b, v.t);
    } catch (e) {}
  });
}

// pannello: a chi arrivano gli avvisi delle prenotazioni del giorno (indirizzi privati: non vanno nel foglio pubblico)
function apiPrenAvvisi_(lista) {
  ammesso_();
  if (Array.isArray(lista)) {
    const m = lista.map(x => String(x || '').trim().toLowerCase()).filter(Boolean);
    m.forEach(x => { if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(x)) throw new Error('Email non valida: ' + x); });
    PROP.setProperty('PR-AVVISI', JSON.stringify(m.slice(0, 10)));
  }
  let a = []; try { a = JSON.parse(PROP.getProperty('PR-AVVISI') || '[]'); } catch (e) {}
  return a;
}

// --- per il sito: posti liberi, prenotazione, gestione dal link dell'email ---
function prDisp_(iso, n) {
  const cfg = prCfg_(), g = giornoPr_(iso); n = Math.round(+n) || 2;
  if (!cfg.on) return {ok: true, on: false, tel: cfg.telLoc};
  if (isNaN(g) || n < 1) return {ok: false, err: 'dati'};
  if (n > cfg.maxN) return {ok: true, on: true, maxN: cfg.maxN, troppi: true, slots: []};
  const ck = 'pd-' + iso + '-' + n; try { const c = cache_().get(ck); if (c) return JSON.parse(c); } catch (e) {}
  // protezione contro chi interroga di continuo: al massimo 150 richieste nuove al minuto
  try { const mk = 'pd-min-' + Utilities.formatDate(new Date(), TZ, 'HHmm'), q = +(cache_().get(mk) || 0); if (q >= 150) return {ok: false, err: 'occupato'}; cache_().put(mk, String(q + 1), 120); } catch (e) {}
  const now = adessoPr_(), lista = prLeggi_(iso);
  const slots = orariPr_(cfg, g, now).map(s => [labPr_(s.m), statoPr_(cfg, liberiPr_(cfg, lista, s.m, s.k), n, s.k)]);
  const out = {ok: true, on: true, maxN: cfg.maxN, slots, tel: cfg.telLoc, conserva: cfg.conserva};
  try { cache_().put(ck, JSON.stringify(out), 30); } catch (e) {}
  return out;
}
async function prPrenota_(d) {
  if (d.hp) return {ok: true, code: '------'};                                   // trappola per i robot
  const cfg = prCfg_(); if (!cfg.on) return {ok: false, err: 'spente'};
  const iso = String(d.d || ''), g = giornoPr_(iso), n = Math.round(+d.n), lg = /^(it|en|de|fr)$/.test(d.lg) ? d.lg : 'it';
  const pulito = (x, l) => String(x || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, l);
  const nm = pulito(d.nm, 60), tel = String(d.tel || '').replace(/[^\d+\s.\/()\-]/g, '').trim().slice(0, 20), em = pulito(d.em, 100).toLowerCase(), no = pulito(d.no, 300);
  if (isNaN(g) || !(n >= 1)) return {ok: false, err: 'dati'};
  if (n > cfg.maxN) return {ok: false, err: 'troppi', maxN: cfg.maxN};
  if (nm.length < 2 || !/[a-zà-ÿ]/i.test(nm)) return {ok: false, err: 'nome'};
  if (!telValido_(tel)) return {ok: false, err: 'tel'};
  if (em) { const ev = await emailValida_(em); if (ev !== 'ok') return {ok: false, err: 'email', why: ev}; }   // dal sito l'email è facoltativa (consigliata)
  const now = adessoPr_(), slot = orariPr_(cfg, g, now).find(s => labPr_(s.m) === String(d.h || ''));
  if (!slot) return {ok: false, err: 'orario'};
  // limiti contro gli abusi: massimo 30 prenotazioni online l'ora
  const ora = 'pr-h-' + Utilities.formatDate(new Date(), TZ, 'yyyyMMddHH'); let quante = 0;
  try { quante = +(cache_().get(ora) || 0); } catch (e) {}
  if (quante >= cfg.oraMax) return {ok: false, err: 'occupato'};
  let b;
  try {
    b = conLock_(() => {
      const tutte = prTutte_(); if (prSpazio_(tutte) > 380000) return {err: 'occupato'};
      const lista = prLeggi_(iso, tutte), cifre = x => String(x || '').replace(/\D/g, '').slice(-9);
      if (cfg.doppia > 0 && lista.some(x => PR_ATTIVA(x.s) && ((em && x.em === em) || cifre(x.tel) === cifre(tel)) && Math.abs(x.m - slot.m) < cfg.doppia * 60)) return {err: 'doppia'};
      if (statoPr_(cfg, liberiPr_(cfg, lista, slot.m, slot.k), n, slot.k) === 'pieno') return {err: 'pieno'};
      const nuova = {id: Utilities.getUuid().replace(/-/g, '').toLowerCase().slice(0, 32), m: slot.m, k: slot.k, n, nm, tel, em, no, al: !!d.al, lg, o: 's', s: 'ok', ca: now.abs, r: 0, w: 0, eta: 0, tv: ''};
      lista.push(nuova); prScrivi_(iso, lista); return nuova;
    });
  } catch (e) { return {ok: false, err: 'occupato'}; }
  if (b.err) return b.err === 'pieno' ? {ok: false, err: 'pieno', slots: prDisp_(iso, n).slots} : {ok: false, err: b.err};
  try { cache_().put(ora, String(quante + 1), 3700); } catch (e) {}
  if (em) prAvvisa_(b, iso, 'conferma'); const inviata = em ? true : 'no';
  if (g === now.g && cfg.avvisa) prAvvisaLocale_(iso, b, 'Nuova prenotazione dal sito');
  prStatisticaInc_(iso, 'sito');
  registra_('Nuova prenotazione dal sito', 'Prenotazioni', codPr_(b.id) + ' · ' + iso.split('-').reverse().join('/') + ' ' + labPr_(b.m) + ' · ' + n + ' persone', ['Cliente (sito)', '']);
  return {ok: true, d: iso, h: labPr_(b.m), n, code: b.id.slice(0, 6).toUpperCase(), mail: inviata};
}
function prSegna_(iso, id, campi) {
  try { conLock_(() => { const l = prLeggi_(iso), b = l.find(x => x.id === id); if (!b) return; Object.keys(campi).forEach(k => { b[k] = campi[k]; }); prScrivi_(iso, l); }); } catch (e) {}
}
function prStato_(t) {
  const p = prDaToken_(t); if (!p) return {ok: false, err: 'link'};
  const b = prLeggi_(p.iso).find(x => x.id === p.id); if (!b) return {ok: false, err: 'link'};
  const cfg = prCfg_(), now = adessoPr_(), inizio = giornoPr_(p.iso) * 1440 + b.m;
  return {ok: true, d: p.iso, h: labPr_(b.m), n: b.n, nm: String(b.nm || '').split(/\s+/)[0], s: b.s, eta: b.eta ? labPr_(b.eta % 1440) : '',
    arrivo: b.s === 'ok' && now.abs >= inizio - 30 && now.abs < prFine_(cfg, inizio), qui: b.s === 'ok' && now.abs >= inizio - 30 && now.abs < prFine_(cfg, inizio),
    annullabile: b.s === 'ok' && now.abs < prFine_(cfg, inizio), lg: b.lg,
    minuti: [10, 15, 20, 30, 45, 60, 90, 120, 180].filter(x => now.abs + x <= inizio + cfg.etaMax).slice(0, 4), telLoc: cfg.telLoc,
    rec: b.s === 'arr' || (b.s === 'ok' && now.abs >= inizio + 60), rev: impostazione_('Link recensioni Google')};   // dopo la visita la pagina invita alla recensione Google
}
// fino a quando il cliente può rispondere dal link (dopo, solo al telefono)
const prFine_ = (cfg, inizio) => inizio + (cfg.libAuto ? cfg.lib : Math.max(cfg.lib, cfg.etaMax) + 60);
function prAzione_(d) {
  const p = prDaToken_(d.t); if (!p) return {ok: false, err: 'link'};
  const cfg = prCfg_(), now = adessoPr_(), g = giornoPr_(p.iso);
  let res;
  try {
    res = conLock_(() => {
      const l = prLeggi_(p.iso), b = l.find(x => x.id === p.id); if (!b) return {err: 'link'};
      const inizio = g * 1440 + b.m;
      if (b.s !== 'ok') return {err: 'stato'};
      const eraDac = !!b.dac, fine = prFine_(cfg, inizio);
      if (d.a === 'annulla') { if (now.abs >= fine) return {err: 'tardi'}; b.s = 'ann'; b.x = now.abs; }
      else if (d.a === 'arrivo') {
        const min = Math.round(+d.min / 5) * 5;
        if (!(min >= 5 && min <= 180)) return {err: 'dati'};
        if (now.abs < inizio - 30 || now.abs >= fine) return {err: 'tardi'};
        b.eta = Math.min(inizio + cfg.etaMax, Math.max(inizio, now.abs + min)) - g * 1440; b.dac = 0;
      } else if (d.a === 'qui') {                  // «siamo già al ristorante»: si segna da solo come arrivato
        if (now.abs < inizio - 30 || now.abs >= fine) return {err: 'tardi'};
        b.s = 'arr'; b.ac = 1; b.dac = 0; b.x = now.abs;
      } else return {err: 'dati'};
      prScrivi_(p.iso, l); return {b, eraDac};
    });
  } catch (e) { return {ok: false, err: 'occupato'}; }
  if (res.err) return {ok: false, err: res.err};
  if (d.a === 'annulla') { prAvvisa_(res.b, p.iso, 'annullata', cfg); if (g === now.g && cfg.avvisa) prAvvisaLocale_(p.iso, res.b, 'Prenotazione annullata dal cliente'); }
  else if (res.eraDac) prPersonale_(p.iso, res.b, d.a === 'qui' ? 'qui' : 'risposto');
  registra_({annulla: 'Annullata dal cliente', arrivo: 'Il cliente ha risposto: sta arrivando', qui: 'Il cliente ha segnalato: già al ristorante'}[d.a], 'Prenotazioni', codPr_(res.b.id) + ' · ' + p.iso.split('-').reverse().join('/') + ' ' + labPr_(res.b.m) + ' · ' + res.b.n + ' persone', ['Cliente (link dell’email)', '']);
  return Object.assign(prStato_(d.t), {fatto: d.a});
}

// --- controlli automatici ogni 5 minuti: promemoria, ritardi, tavoli liberati ---
function prControlla() {
  try { prInvia(); } catch (e) {}
  const cfg = prCfg_(), now = adessoPr_();
  [now.g - 1, now.g, now.g + 1].forEach(g => {
    const iso = isoPr_(g), lista = prLeggi_(iso); if (!lista.length) return;
    const mail = [], staff = [], cambi = {};
    const serv = serviziPr_(cfg, g);
    lista.forEach(b => {
      if (b.s !== 'ok') return;
      // servizio finito da più di mezz'ora: niente email di ritardo o «tavolo liberato» a cose fatte (es. se i controlli si erano fermati)
      const sv = serv[b.k != null ? b.k : (b.m < 960 ? 0 : 1)], fineS = g * 1440 + (sv ? sv[1] : b.m + 180);
      if (now.abs > fineS + 30) return;
      const inizio = g * 1440 + b.m, c = {};
      if (!b.r && cfg.prom > 0) { const quando = inizio - cfg.prom * 60;
        if (now.abs >= quando && now.abs < inizio) { if (b.ca > quando - 30) c.r = 2; else { c.r = 1; mail.push([b, 'promemoria']); } } }
      const limite = b.eta ? g * 1440 + b.eta + cfg.etaMarg : inizio + cfg.lib;
      if (!b.fx && !b.dac && now.abs >= limite) {
        if (cfg.libAuto) { c.s = 'lib'; c.x = now.abs; c.w = 1; mail.push([b, 'liberata']); staff.push([b, 'liberata']); }
        else { c.dac = now.abs; c.w = 1; staff.push([b, 'dac']); }          // non libera da solo: «da contattare» + avviso al personale
      }
      else if (!b.w && !b.eta && !b.fx && !b.dac && now.abs >= inizio + cfg.avv) { c.w = 1;
        if (b.em || cfg.libAuto) mail.push([b, 'ritardo']); else { c.dac = now.abs; staff.push([b, 'dac']); } }   // senza email il cliente non può rispondere: lo chiama subito il personale
      if (Object.keys(c).length) cambi[b.id] = c;
    });
    if (!Object.keys(cambi).length) return;
    let fatti = {};
    try {
      conLock_(() => {
        const l = prLeggi_(iso);
        l.forEach(b => { const c = cambi[b.id]; if (!c || b.s !== 'ok') return; Object.keys(c).forEach(k => { b[k] = c[k]; }); fatti[b.id] = 1; });
        prScrivi_(iso, l);
      });
    } catch (e) { return; }
    mail.forEach(([b, tipo]) => { if (fatti[b.id]) prAvvisa_(b, iso, tipo, cfg); });
    staff.forEach(([b, tipo]) => { if (fatti[b.id]) { prPersonale_(iso, b, tipo); registra_(tipo === 'dac' ? 'Da contattare (ritardo senza risposta)' : 'Tavolo liberato in automatico', 'Prenotazioni', codPr_(b.id) + ' · ' + iso.split('-').reverse().join('/') + ' ' + labPr_(b.m) + ' · ' + b.n + ' persone', ['Sistema (controllo automatico)', '']); } });
  });
}
// --- ogni notte: si cancellano i giorni passati (restano solo numeri anonimi) e le copie delle email ---
function prNotte() {
  const now = adessoPr_(), tutte = prTutte_(), cfgN = prCfg_();
  prTrigger_(); registroPulisci_(); prInvia();
  const giorni = {}; Object.keys(tutte).forEach(k => { const m = k.match(/^PR:(\d{4}-\d{2}-\d{2}):/); if (m && giornoPr_(m[1]) < now.g - cfgN.conserva) giorni[m[1]] = 1; });
  Object.keys(giorni).forEach(iso => {
    const l = prLeggi_(iso, tutte), st = prStatistiche_(), mese = iso.slice(0, 7), s = st[mese] = st[mese] || {pren: 0, coperti: 0, arr: 0, lib: 0, ann: 0};
    l.forEach(b => { if (PR_ATTIVA(b.s) || b.s === 'lib') { s.pren++; s.coperti += b.n; } if (b.s === 'arr') s.arr++; if (b.s === 'ok') s.ns = (s.ns || 0) + 1; if (b.s === 'lib') s.lib++; if (b.s === 'ann' || b.s === 'annR') s.ann++; });
    PROP.setProperty('PR-STAT', JSON.stringify(st));
    Object.keys(tutte).filter(k => k.indexOf('PR:' + iso + ':') === 0).forEach(k => PROP.deleteProperty(k));
  });
  // copie delle email di prenotazione nella posta inviata: nel cestino (Gmail le elimina del tutto dopo 30 giorni)
  try { for (let i = 0; i < 5; i++) { const t = GmailApp.search('"OCPREN" older_than:' + (cfgN.conserva + 1) + 'd -in:trash', 0, 100); if (!t.length) break; GmailApp.moveThreadsToTrash(t); } } catch (e) {}
}
// dopo la visita: una sola email per chiedere la recensione su Google, solo a chi è stato segnato «Arrivati» e ha lasciato l'email
function prRecensioni_() {
  if (!/^https:\/\//.test(impostazione_('Link recensioni Google'))) return;
  const cfg = prCfg_(), now = adessoPr_();
  if (now.m < 540 || now.m > 1380) return;                       // mai di notte: dalle 9 alle 23
  [now.g - 1, now.g].forEach(g => {
    const iso = isoPr_(g), da = [];
    prLeggi_(iso).forEach(b => {
      if (b.s !== 'arr' || !b.em || b.rv) return;
      const fine = g * 1440 + b.m + cfg.dur[b.k != null ? b.k : (b.m < 960 ? 0 : 1)] + 15;   // fine del tavolo + un quarto d'ora
      if (now.abs >= fine && now.abs < fine + 720) da.push(b.id);
    });
    if (!da.length) return;
    let inviate = [];
    conLock_(() => { const l = prLeggi_(iso); l.forEach(b => { if (da.indexOf(b.id) >= 0 && !b.rv) { b.rv = 1; inviate.push(b); } }); prScrivi_(iso, l); });
    inviate.forEach(b => prAvvisa_(b, iso, 'recensione'));
  });
}
function prStatistiche_() { try { return JSON.parse(PROP.getProperty('PR-STAT') || '{}'); } catch (e) { return {}; } }
function prStatisticaInc_(iso, k) {
  try { const st = prStatistiche_(), m = iso.slice(0, 7), s = st[m] = st[m] || {pren: 0, coperti: 0, arr: 0, lib: 0, ann: 0}; s[k] = (s[k] || 0) + 1; PROP.setProperty('PR-STAT', JSON.stringify(st)); } catch (e) {}
}
// i due controlli automatici si attivano da soli alla prima apertura della sezione Prenotazioni
function prTrigger_() {
  let ora = 3; try { ora = prCfg_().oraPul; } catch (e) {}
  if (PROP.getProperty('PR-TRIG') === 'v3-' + ora) return;
  try {
    const tt = ScriptApp.getProjectTriggers(), h = tt.map(t => t.getHandlerFunction());
    if (h.indexOf('prControlla') < 0) ScriptApp.newTrigger('prControlla').timeBased().everyMinutes(5).create();
    if (h.indexOf('prInvia') < 0) ScriptApp.newTrigger('prInvia').timeBased().everyMinutes(1).create();
    tt.filter(t => t.getHandlerFunction() === 'prNotte').forEach(t => ScriptApp.deleteTrigger(t));      // l'ora si cambia dal pannello
    ScriptApp.newTrigger('prNotte').timeBased().everyDays(1).atHour(ora).inTimezone(TZ).create();
    PROP.setProperty('PR-TRIG', 'v3-' + ora);
  } catch (e) {}
}

// --- per il pannello ---
function apiPren_(iso) {
  ammesso_(); prTrigger_();
  const cfg = prCfg_(), now = adessoPr_(); if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) iso = isoPr_(now.g);
  const g = giornoPr_(iso), lista = prLeggi_(iso).sort((a, b) => a.m - b.m);
  const serv = serviziPr_(cfg, g), slot = orariPr_(cfg, g, now, true).map(s => ({h: labPr_(s.m), k: s.k, liberi: liberiPr_(cfg, lista, s.m, s.k)}));
  const occ = [0, 1].map(k => lista.filter(b => b.k === k && PR_ATTIVA(b.s)).reduce((a, b) => a + b.n, 0));
  let quota = null; try { const qc = cache_().get('quota'); if (qc) quota = +qc; else { quota = MailApp.getRemainingDailyQuota(); cache_().put('quota', String(quota), 600); } } catch (e) {}
  const giorniCon = {}; Object.keys(prTutte_()).forEach(k => { const m = k.match(/^PR:(\d{4}-\d{2}-\d{2}):/); if (m) giorniCon[m[1]] = 1; });
  return {iso, oggi: isoPr_(now.g), ora: now.m, cfg: {on: cfg.on, cop: cfg.cop, dur: cfg.dur, maxN: cfg.maxN, lib: cfg.lib, avv: cfg.avv, libAuto: cfg.libAuto, emObbl: cfg.emObbl},
    servizi: serv.map(s => s ? labPr_(s[0]) + '–' + labPr_(s[1]) : ''), fine: serv.map(s => s ? s[1] : null), occ, slot, quota, giorni: Object.keys(giorniCon).sort(), stat: prStatistiche_()[iso.slice(0, 7)] || null,
    lista: lista.map(b => ({id: b.id, h: labPr_(b.m), m: b.m, k: b.k, n: b.n, nm: b.nm, tel: b.tel, em: b.em, no: b.no, al: b.al, o: b.o, s: b.s, eta: b.eta ? labPr_(b.eta % 1440) : '', tv: b.tv, w: b.w, mf: b.mf, fx: b.fx, dac: b.dac ? 1 : 0, ac: b.ac, by: b.by}))};
}
async function apiPrenSalva_(iso, r, id, forza) {
  ammesso_();
  const cfg = prCfg_(), now = adessoPr_(), g = giornoPr_(iso); r = r || {};
  const pulito = (x, l) => String(x == null ? '' : x).replace(/[\u0000-\u001f<>]/g, ' ').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, l);
  const nm = pulito(r.nm, 60), tel = String(r.tel == null ? '' : r.tel).replace(/[^\d+\s.\/()\-]/g, '').trim().slice(0, 20), em = pulito(r.em, 100).toLowerCase(), no = pulito(r.no, 300), tv = pulito(r.tv, 20), n = Math.round(+r.n), m = hmPr_(r.h);
  if (isNaN(g)) throw new Error('Scegli il giorno.');
  if (m === null) throw new Error('Scegli l’orario.');
  if (!(n >= 1 && n <= 300)) throw new Error('Indica quante persone.');
  if (nm.length < 2) throw new Error('Scrivi il nome di chi prenota.');
  if (!telValido_(tel)) throw new Error('Il telefono non sembra valido: cellulare (3…) o fisso (0…); se è estero scrivi il prefisso, es. +41 79 123 45 67.');
  if (em) { const ev = await emailValida_(em); if (ev !== 'ok') throw new Error(ev === 'usaegetta' ? 'È un’email «usa e getta»: chiedi al cliente un indirizzo vero.' : ev === 'dominio' ? 'L’email non può ricevere messaggi (dopo la @ c’è un errore?): ricontrollala con il cliente.' : 'L’email non è scritta correttamente.'); }
  if (g < now.g) throw new Error('Quel giorno è già passato.');
  const serv = serviziPr_(cfg, g);
  // l'orario può essere dopo mezzanotte se la cena finisce dopo (es. 00:30 di una cena fino all'1)
  let mm = m, k = serv[1] && m >= serv[1][0] - 60 ? 1 : 0;
  if (serv[1] && serv[1][1] > 1440 && m + 1440 <= serv[1][1]) { mm = m + 1440; k = 1; }
  const avvisi = [];
  if (!serv[k] || mm < serv[k][0] || mm > serv[k][1]) avvisi.push(serv.some(Boolean) ? 'L’orario ' + labPr_(m) + ' è fuori dall’orario di apertura di quel giorno.' : 'Quel giorno risulta chiuso (scheda Orari o chiusure).');
  const res = conLock_(() => {
    const lista = prLeggi_(iso), vecchia = id ? lista.find(x => x.id === id) : null;
    if (id && !vecchia) throw new Error('Questa prenotazione non c’è più: ricarica la pagina.');
    const liberi = liberiPr_(cfg, lista, mm, k, id);
    if (liberi < n) avvisi.push('Alle ' + labPr_(m) + ' restano ' + Math.max(0, liberi) + ' posti su ' + cfg.cop[k] + ': con questa prenotazione il locale va oltre i coperti.');
    const cifre = x => String(x || '').replace(/\D/g, '').slice(-9);
    const doppia = cfg.doppia > 0 && lista.find(x => x.id !== id && PR_ATTIVA(x.s) && cifre(x.tel) && cifre(x.tel) === cifre(tel) && Math.abs(x.m - mm) < cfg.doppia * 60);
    if (doppia) avvisi.push('C’è già una prenotazione con questo telefono alle ' + labPr_(doppia.m) + ' (' + doppia.nm + ').');
    if (avvisi.length && !forza) return {avvisi};
    let b;
    if (vecchia) { b = vecchia; const cambia = b.m !== mm || b.n !== n; Object.assign(b, {m: mm, k, n, nm, tel, em, no, al: !!r.al, tv}); if (cambia) { b.r = 0; b.w = 0; b.eta = 0; } b.cambiata = cambia; }
    else { b = {id: Utilities.getUuid().replace(/-/g, '').toLowerCase().slice(0, 32), m: mm, k, n, nm, tel, em, no, al: !!r.al, lg: 'it', o: 'p', s: 'ok', ca: now.abs, r: 0, w: 0, eta: 0, tv, by: CHI ? CHI.email : ''}; lista.push(b); }
    prScrivi_(iso, lista); return {b, nuova: !vecchia};
  });
  if (res.avvisi) return {avvisi: res.avvisi};
  if (res.nuova || res.b.cambiata) prAvvisa_(res.b, iso, res.nuova ? 'conferma' : 'modifica', cfg);
  if (res.nuova) prStatisticaInc_(iso, 'pannello');
  return apiPren_(iso);
}
function apiPrenStato_(iso, id, s, opz) {
  opz = opz || {};
  ammesso_();
  if (['ok', 'arr', 'annR', 'lib'].indexOf(s) < 0) throw new Error('Operazione non valida.');
  const cfg = prCfg_(), now = adessoPr_();
  const b = conLock_(() => {
    const l = prLeggi_(iso), x = l.find(y => y.id === id); if (!x) throw new Error('Questa prenotazione non c’è più: ricarica la pagina.');
    if (s === 'ok' && !PR_ATTIVA(x.s)) {             // riattivare una prenotazione annullata o liberata: solo se c'è posto
      if (liberiPr_(cfg, l, x.m, x.k, x.id) < x.n && !opz.forza) throw new Error('Non c’è più posto per riattivarla a quell’ora: modificala.');
    }
    x.s = s; x.x = now.abs; x.dac = 0;
    if (s === 'ok' && +opz.arriva > 0) {            // «sta arrivando» detto al telefono: nuovo orario, poi di nuovo controllato
      const g = giornoPr_(iso), min = Math.min(180, Math.max(5, Math.round(+opz.arriva)));
      x.eta = Math.max(g * 1440 + x.m, now.abs + min) - g * 1440; x.w = 1;
    } else if (s === 'ok') { x.w = 1; x.fx = 1; }    // rimessa «confermata» a mano: niente più controlli automatici
    prScrivi_(iso, l); return x;
  });
  if (s === 'annR' && opz.mail) prAvvisa_(b, iso, 'annullata', cfg);
  if (s === 'lib' && opz.mail) prAvvisa_(b, iso, 'liberata', cfg);
  return apiPren_(iso);
}

/* =========================== MANUTENZIONE AUTOMATICA =========================== */
// Il sito manda prenotazioni e opinioni all'indirizzo scritto nel foglio Impostazioni (riga «opinioni»).
// Se lo script viene ripubblicato con un indirizzo diverso, qui si riallinea da solo ad ogni apertura del pannello.
function sincronizzaUrl_() {
  try {
    if (cache_().get('url-ok')) return;
    const imp = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni'); if (!imp) return;
    const v = imp.getDataRange().getDisplayValues(), i = v.findIndex(r => String(r[0]).trim().toLowerCase() === 'opinioni');
    const ora = i >= 0 ? String(v[i][1]).trim() : '';
    if (ora && provaUrl_(ora).ok) { cache_().put('url-ok', '1', 21600); return; }        // funziona: non si tocca
    const cand = ScriptApp.getService().getUrl();
    if (!cand || cand === ora || !provaUrl_(cand).ok) { cache_().put('url-ok', '1', 900); return; }   // niente di meglio: lo dirà «Controllo del sistema»
    scriviUrl_(cand);
    cache_().put('url-ok', '1', 21600);
  } catch (e) {}
}
// l'indirizzo che il sito usa per prenotazioni e opinioni (riga «opinioni» della scheda Impostazioni)
function urlSito_() {
  try { const v = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni').getDataRange().getDisplayValues();
    return ((v.find(r => String(r[0]).trim().toLowerCase() === 'opinioni') || [])[1] || '').trim(); } catch (e) { return ''; }
}
function scriviUrl_(url) {
  const imp = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni');
  const v = imp.getDataRange().getDisplayValues(), i = v.findIndex(r => String(r[0]).trim().toLowerCase() === 'opinioni');
  if (i < 0) imp.getRange(imp.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([['opinioni', url]]);
  else imp.getRange(i + 1, 2).setNumberFormat('@').setValue(url);
  PROP.setProperty('PANNELLO', url);
}
// prova un indirizzo come lo usa il sito (da fuori, senza essere collegati): risponde davvero?
function provaUrl_(u) { if (String(u || '').trim()) return {ok: true};
  u = String(u || '').trim();
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u)) return {ok: false, perche: /\/dev$/.test(u) ? 'dev' : 'formato'};
  try {
    const r = UrlFetchApp.fetch(u + '?a=ping', {muteHttpExceptions: true, followRedirects: true}), c = r.getResponseCode(), t = String(r.getContentText() || '').slice(0, 5000);
    let j = null; try { j = JSON.parse(t); } catch (e) {}
    if (j && j.ok && j.v >= 3) return {ok: true};
    if (c === 404) return {ok: false, perche: '404'};
    if (/accounts\.google\.com|ServiceLogin|identifier|signin/i.test(t) || c === 401 || c === 403) return {ok: false, perche: 'accesso'};
    return {ok: false, perche: 'vecchio'};
  } catch (e) { return {ok: false, perche: 'rete'}; }
}
const URL_PERCHE = {
  formato: 'Non è l’indirizzo di un’App web: deve iniziare con https://script.google.com/macros/s/ e finire con /exec.',
  dev: 'Questo è l’indirizzo «di prova» (finisce con /dev) e funziona solo per te: serve quello che finisce con /exec.',
  '404': 'A questo indirizzo non c’è più niente: il deployment è stato archiviato o cancellato. Copia l’URL del deployment attivo.',
  accesso: 'Google chiede di accedere: in Gestisci deployment → matita, «Esegui come» deve essere «Me» e «Chi ha accesso» deve essere «Chiunque» (non «Chiunque abbia un account Google»).',
  vecchio: 'Risponde, ma con il codice vecchio: Gestisci deployment → matita → Versione «Nuova versione» → Esegui il deployment.',
  rete: 'Google non ha risposto alla prova: riprova tra un minuto.'};
// Configurazione → Controllo del sistema: incolla l'URL dell'App web, si prova e si salva solo se funziona
function apiImpostaUrl_(u) { throw new Error('Non serve più: il sistema gira su Cloudflare.');
  soloGestore_();
  u = String(u || '').trim().replace(/\?.*$/, '');
  const r = provaUrl_(u); if (!r.ok) return {ok: false, msg: URL_PERCHE[r.perche] || 'Non risponde.'};
  scriviUrl_(u); cache_().put('url-ok', '1', 21600);
  return {ok: true};
}
// aggiornamenti dei fogli fatti una volta sola per versione (colonne nuove, valori iniziali, festività pronte)
const VERSIONE_FOGLI = '8';
function aggiornaFogli_() {
  if (PROP.getProperty('FOGLI-V') === VERSIONE_FOGLI) return;
  try {
    conLock_(() => {
      if (PROP.getProperty('FOGLI-V') === VERSIONE_FOGLI) return;
      const imp = SpreadsheetApp.openById(FOGLI.oggi).getSheetByName('Impostazioni'), v = imp.getDataRange().getDisplayValues();
      const riga = k => v.findIndex(r => String(r[0]).trim().toLowerCase() === k.toLowerCase());
      // promemoria: ora solo sabato, domenica e lunedì (se c'era il vecchio valore iniziale)
      const ig = riga('Promemoria giorni');
      if (ig < 0) imp.getRange(imp.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([['Promemoria giorni', PROM_GIORNI]]);
      else if (/^(lun,mar,mer,gio,ven,sab|)$/.test(String(v[ig][1]).replace(/\s/g, ''))) imp.getRange(ig + 1, 2).setNumberFormat('@').setValue(PROM_GIORNI);
      // temi: solo quelli attivati dal pannello (le righe pronte qui sotto)
      if (riga('Temi automatici') < 0) imp.getRange(imp.getLastRow() + 1, 1, 1, 2).setNumberFormat('@').setValues([['Temi automatici', 'no']]);
      festivita_();
      try { viniMezza_(); } catch (e) {}
      try { eventiSfondo_(); } catch (e) {}
      try { avvisiGrafica_(); } catch (e) {}
      try { menuSistema_(); } catch (e) {}
      PROP.setProperty('FOGLI-V', VERSIONE_FOGLI);
    });
    pulisci_('avvisi'); pulisci_('regole'); pulisci_('vini'); pulisci_('eventi');
  } catch (e) {}
}
// avvisi: niente righe vuote in mezzo (il sito legge solo le righe compilate di seguito) e colonna «Grafica» per le promozioni
function avvisiGrafica_() {
  const sh = SpreadsheetApp.openById(FOGLI.avvisi).getSheets()[0];
  compatta_(sh);
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  if (!h.some(x => /^grafica/i.test(String(x).trim()))) sh.getRange(1, h.length + 1).setValue('Grafica');
}
// toglie le righe vuote rimaste in mezzo e svuota quello che c'è sotto l'ultima riga vera (es. «sì» rimasti nella colonna Attivo)
function compatta_(sh) {
  const n = sh.getLastRow(); if (n < 2) return 0;
  const a = sh.getRange(1, 1, n, 1).getDisplayValues(), piena = i => String((a[i - 1] || [''])[0]).trim() !== '';
  let last = 1; for (let i = 2; i <= n; i++) if (piena(i)) last = i;
  if (n > last) sh.getRange(last + 1, 1, n - last, Math.max(1, sh.getLastColumn())).clearContent();
  let tolte = 0;
  for (let i = last; i >= 2; i--) {
    if (piena(i)) continue;
    let j = i; while (j > 2 && !piena(j - 1)) j--;
    sh.deleteRows(j, i - j + 1); tolte += i - j + 1; i = j;
  }
  return tolte;
}
// allergeni mancanti nel menù (7 novembre 2026): solo quelli sicuri dagli ingredienti; si cambia solo se il valore è ancora quello di prima
const ALLERGENI_FIX_ = [
  ['Girello di manzo al punto rosa', '', '12'],
  ['Caciocavallo alla piastra', '', '7'],
  ['Gnocchi di zucca', '', '1 e 7'],
  ['Pappardelle alla farina di castagne', '', '1'],
  ['Ravioli del plin al vitello e scarola', '1, 3, 7 e 9', '1, 3, 7, 9 e 12'],
  ['Fileja al polipo*', '1, 3, 4 e 9', '1, 3, 4, 9 e 14'],
  ['Guancetta di maiale brasata al Magliocco', '7 e 9', '7, 9 e 12'],
  ['Tagliata di cervo ai mirtilli rossi', '', '3 e 7'],
  ['Cordon bleu di tacchino', '', '1, 3 e 7'],
  ['Cacciucco', '1, 2 e 4', '1, 2, 4 e 14'],
  ['Polipo scottato', '', '3 e 14'],
  ['Focaccia', '', '1'],
  ['Margherita', '', '1 e 7'],
  ['Marinara', '', '1'],
  ['Baciami', '', '1 e 7'],
  ['Quattro stagioni', '', '1 e 7'],
  ['Napoli', '', '1, 4 e 7'],
  ['Calabrese', '', '1 e 7'],
  ['Ionio', '', '1, 4 e 7'],
  ['Pugliese', '', '1 e 7'],
  ['Quattro formaggi', '', '1 e 7'],
  ['Ticino', '', '1 e 7'],
  ['Delizia', '', '1 e 7'],
  ['Valtellina', '', '1 e 7'],
  ['Bufalina', '', '1 e 7'],
  ['Dall’orto', '', '1 e 7'],
  ['Tirolese', '', '1 e 7'],
  ['Diavola', '', '1 e 7'],
  ['La tedesca', '', '1 e 7'],
  ['Calzone fritto', '', '1 e 7'],
  ['Bologna', '', '1, 7 e 8'],
  ['Autunno', '', '1 e 7'],
  ['Sila', '', '1 e 7'],
  ['Manzo', '', '1 e 7'],
  ['Carbonara', '', '1, 3 e 7'],
  ['Mare nostro', '', '1, 2 e 14'],
  ['Roma-Calabria', '', '1, 2 e 7'],
  ['Oltreconfini', '', '1, 2 e 7'],
  ['La fritta', '', '1 e 7'],
  ['Milanese di pollo e patatine fritte*', '1', '1 e 3']];
const CONTORNI_BASE_ = [['Verdure di stagione ripassate', 7], ['Verdure alla griglia', 6], ['Patate al forno', 6], ['Patatine fritte*', 5], ['Insalata mista', 6], ['Insalata verde', 5]];
function menuSistema_() {
  pulisci_('piatti');                       // gira dentro aggiornaFogli_, che ha già il lucchetto
  (() => {
    const d = leggi_('piatti'), old = d.rows.length, h = d.cols.map(c => c.h), col = t => h.find(x => x.toLowerCase().indexOf(t) === 0);
    const kC = col('categoria'), kP = col('piatto'), kA = col('allergeni'), kPr = col('prezzo');
    if (!kC || !kP || !kA) return;
    const nn = v => String(v || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    let cambiati = 0;
    ALLERGENI_FIX_.forEach(f => { d.rows.forEach(r => { if (String(r[kP]).trim() === f[0] && nn(r[kA]) === nn(f[1])) { r[kA] = f[2]; cambiati++; } }); });
    // contorni: sul sito c'erano, nel foglio no (quindi nel pannello non si potevano cambiare): ora sono nel foglio
    const rows = d.rows.slice();
    if (!rows.some(r => /^contorn/i.test(String(r[kC]).trim()))) CONTORNI_BASE_.forEach(([n, p]) => { const r = {}; h.forEach(x => r[x] = ''); r[kC] = 'Contorni'; r[kP] = n; if (kPr) r[kPr] = String(p); rows.push(r); });
    if (cambiati || rows.length !== old) scrivi_(d, rows, old);
  })();
  pulisci_('piatti');
}
// eventi: colonna «Sfondo» (foto dietro al menù speciale sul sito)
function eventiSfondo_() {
  const sh = SpreadsheetApp.openById(FOGLI.speciali).getSheets()[0];
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  if (!h.some(x => /^sfondo/i.test(String(x).trim()))) sh.getRange(1, h.length + 1).setValue('Sfondo');
}
// vini: colonna «Prezzo mezza» (bottiglia da 37,5 cl). Chi aveva scritto «27 · 37,5 cl 18» nel prezzo della bottiglia viene diviso da solo
function viniMezza_() {
  const sh = SpreadsheetApp.openById(FOGLI.vini).getSheets()[0];
  let h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  let cm = h.findIndex(x => /^prezzo mezza/i.test(String(x).trim()));
  if (cm < 0) { cm = h.length; sh.getRange(1, cm + 1).setValue('Prezzo mezza'); }
  const cb = h.findIndex(x => /^prezzo bott/i.test(String(x).trim())); if (cb < 0 || sh.getLastRow() < 2) return;
  const n = sh.getLastRow() - 1, vb = sh.getRange(2, cb + 1, n, 1).getDisplayValues(), vm = sh.getRange(2, cm + 1, n, 1).getDisplayValues();
  let cambiato = false;
  vb.forEach((r, i) => { const m = String(r[0]).match(/^\s*([\d.,]+)\s*€?\s*[·\-\/|,;]?\s*(?:mezza|½|1\/2|0?[.,]375|37[.,]5\s*cl)\D*([\d.,]+)/i);
    if (m && !String(vm[i][0]).trim()) { vb[i][0] = m[1]; vm[i][0] = m[2]; cambiato = true; } });
  if (cambiato) { sh.getRange(2, cb + 1, n, 1).setNumberFormat('@').setValues(vb); sh.getRange(2, cm + 1, n, 1).setNumberFormat('@').setValues(vm); }
}
// Pasqua (calendario gregoriano)
function pasqua_(y) { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
  h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31);
  return Date.UTC(y, mo - 1, ((h + l - 7 * m + 114) % 31) + 1) / 864e5; }
const FISSA_ = (mo, d) => y => Date.UTC(y, mo - 1, d) / 864e5;
const MAMMA_ = y => { const p = new Date(Date.UTC(y, 4, 1)).getUTCDay(); return Date.UTC(y, 4, 1 + ((7 - p) % 7) + 7) / 864e5; };   // seconda domenica di maggio
// festività pronte (spente): il giorno dell'evento, da quanti giorni prima a quanti dopo si vedono
const FESTE_ = [
  ['Tema del sito', '', '', '', '', 'Natale', FISSA_(12, 25), -17, 1], ['Tema del sito', '', '', '', '', 'Capodanno', FISSA_(1, 1), -5, 5],
  ['Tema del sito', '', '', '', '', 'San Valentino', FISSA_(2, 14), -7, 0], ['Tema del sito', '', '', '', '', 'Pasqua', pasqua_, -6, 1],
  ['Promozione', 'Cene di Natale', 'La sala per il tuo team, gli amici, la famiglia', 'Menù su misura · Sala riservata · Cucina & Pizzeria', 'Sala con archi', '', FISSA_(12, 22), -37, 0],
  ['Promozione', 'Pranzo di Natale', 'Il 25 dicembre a tavola con noi: prenota per tempo', 'Menù della tradizione · Posti limitati', 'Calici', '', FISSA_(12, 25), -24, -1],
  ['Promozione', 'Pranzo di Santo Stefano', 'Il 26 dicembre, tutti insieme', 'Cucina & Pizzeria · Prenota il tavolo', 'Sala', '', FISSA_(12, 26), -16, -1],
  ['Promozione', 'Cenone di San Silvestro', 'Salutiamo il nuovo anno insieme', 'Menù speciale · Brindisi a mezzanotte', 'Calici', '', FISSA_(12, 31), -30, -1],
  ['Promozione', 'Pranzo dell’Epifania', 'Il 6 gennaio, l’ultima festa delle feste', 'Cucina & Pizzeria · Prenota il tavolo', 'Sala', '', FISSA_(1, 6), -9, -1],
  ['Promozione', 'San Valentino', 'Una cena a due, senza pensieri', 'Tavoli per due · Menù dedicato · Vini scelti', 'Calici', '', FISSA_(2, 14), -14, -1],
  ['Promozione', 'Festa della donna', 'Una serata tra amiche, ci pensiamo noi', 'Tavoli per gruppi · Pizza & Cucina', 'Seconda sala', '', FISSA_(3, 8), -14, -1],
  ['Promozione', 'Festa del papà', 'Porta il papà a tavola', 'Cucina & Pizzeria · Prenota il tavolo', 'Pizze nel forno', '', FISSA_(3, 19), -11, -1],
  ['Promozione', 'Pranzo di Pasqua', 'La domenica di Pasqua a tavola con noi', 'Menù della tradizione · Posti limitati', 'Sala con archi', '', pasqua_, -14, -1],
  ['Promozione', 'Pasquetta', 'Il lunedì dell’Angelo, in compagnia', 'Cucina & Pizzeria · Prenota il tavolo', 'Sala', '', y => pasqua_(y) + 1, -10, -1],
  ['Promozione', 'Festa della Liberazione', 'Il 25 aprile siamo aperti: prenota il tavolo', 'Pranzo e cena · Cucina & Pizzeria', 'Sala', '', FISSA_(4, 25), -14, -1],
  ['Promozione', 'Primo maggio', 'Il 1° maggio pranzo e cena insieme', 'Cucina & Pizzeria · Prenota il tavolo', 'Pizze nel forno', '', FISSA_(5, 1), -14, -1],
  ['Promozione', 'Festa della mamma', 'Un pranzo per dirle grazie', 'Menù dedicato · Prenota il tavolo', 'Calici', '', MAMMA_, -14, -1],
  ['Promozione', 'Festa della Repubblica', 'Il 2 giugno siamo aperti', 'Pranzo e cena · Cucina & Pizzeria', 'Sala', '', FISSA_(6, 2), -14, -1],
  ['Promozione', 'Ferragosto', 'Il 15 agosto da noi', 'Pranzo e cena · Prenota il tavolo', 'Ingresso', '', FISSA_(8, 15), -14, -1],
  ['Promozione', 'Halloween', 'Una serata da brivido, pizza compresa', 'Per grandi e piccoli · Prenota il tavolo', 'Pizze nel forno', '', FISSA_(10, 31), -14, -1]
];
function festivita_() {
  const sh = SpreadsheetApp.openById(FOGLI.avvisi).getSheets()[0];
  let h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  // colonna «Attivo»: le righe che c'erano restano attive, quelle pronte nascono spente
  if (!h.some(x => /^attivo/i.test(x))) {
    const c = sh.getLastColumn() + 1; sh.getRange(1, c).setValue('Attivo');
    const u = ultima_(sh); if (u > 1) sh.getRange(2, c, u - 1, 1).setValue('sì');
    h = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0];
  }
  const col = t => h.findIndex(x => String(x).trim().toLowerCase().indexOf(t) === 0);
  const I = {t: col('tipo'), a: col('dal'), b: col('al'), x: col('testo'), s: col('sottotitolo'), p: col('punti'), f: col('foto'), tema: col('tema'), on: col('attivo')};
  compatta_(sh);
  const fine = ultima_(sh), esistenti = fine > 1 ? sh.getRange(2, 1, fine - 1, h.length).getDisplayValues() : [];
  const oggi = adessoPr_().g, dmy = g => { const d = new Date(g * 864e5); return ('0' + d.getUTCDate()).slice(-2) + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + d.getUTCFullYear(); };
  const anno = new Date(oggi * 864e5).getUTCFullYear(), nuove = [];
  FESTE_.forEach(f => {
    let ev = f[6](anno); if (ev + f[8] < oggi) ev = f[6](anno + 1);        // prossima volta che arriva
    const nome = f[0] === 'Tema del sito' ? f[5] : f[1];
    if (esistenti.some(r => r[I.t] === f[0] && (r[I.x] === nome || (I.tema >= 0 && r[I.tema] === nome)))) return;
    const r = h.map(() => '');
    r[I.t] = f[0]; r[I.a] = dmy(ev + f[7]); r[I.b] = dmy(ev + f[8]); r[I.on] = 'no';
    if (f[0] === 'Tema del sito') { if (I.tema >= 0) r[I.tema] = f[5]; if (I.x >= 0) r[I.x] = f[5]; }
    else { r[I.x] = f[1]; if (I.s >= 0) r[I.s] = f[2]; if (I.p >= 0) r[I.p] = f[3]; if (I.f >= 0) r[I.f] = f[4]; }
    nuove.push(r);
  });
  if (nuove.length) sh.getRange(fine + 1, 1, nuove.length, h.length).setNumberFormat('@').setValues(nuove);
  pulisci_('avvisi');            // il pannello deve vedere subito la colonna «Attivo» e le righe pronte
}
// controllo del sistema (Configurazione): cosa funziona e cosa no, in parole semplici
function apiStato_() {
  soloGestore_();
  const out = [], ok = (b, t, aiuto) => out.push({ok: !!b, t, aiuto: b ? '' : aiuto || ''});
  const env = AMB.env || {}, c = k => !!String(env[k] || '').trim();
  let prova = null; try { prova = prDisp_(isoPr_(adessoPr_().g + 1), 2); } catch (e) {}
  ok(prova && prova.ok, 'Il sito risponde e le prenotazioni online funzionano' + (prova && prova.on === false ? ' (prenotazioni online spente nelle impostazioni)' : ''), 'Il sistema delle prenotazioni non risponde: avvisa l’amministratore del sito.');
  const u = +(PROP.getProperty('ULTIMO-CONTROLLO') || 0), min = u ? Math.round((Date.now() - u) / 60000) : null;
  ok(u && Date.now() - u < 10 * 60000, 'Controlli automatici attivi (ritardi, promemoria, invio email, pulizia notturna)' + (min !== null ? ' · ultimo ' + (min < 1 ? 'meno di un minuto fa' : min + ' min fa') : ''), 'I controlli automatici non girano da più di 10 minuti: avvisa l’amministratore del sito.');
  ok(c('RESEND_API_KEY'), 'Email ai clienti e al personale attive', 'Manca la chiave del servizio email: le conferme di prenotazione non partono.');
  let coda = 0; try { coda = AMB.sql.exec('SELECT COUNT(*) n FROM posta').toArray()[0].n; } catch (e) {}
  let pc = []; try { pc = JSON.parse(PROP.getProperty('PR-CODA') || '[]'); } catch (e) {}
  ok(coda + pc.length < 20, 'Email in attesa di invio: ' + (coda + pc.length), 'Le email non stanno partendo: avvisa l’amministratore del sito.');
  ok(c('GEMINI_API_KEY'), 'IA attiva: traduzioni in inglese, tedesco e francese e controllo dei testi', 'Manca la chiave dell’IA: i piatti nuovi non vengono tradotti.');
  ok(c('GOOGLE_CLIENT_ID') && c('GOOGLE_CLIENT_SECRET'), 'Accesso al pannello con Google attivo', 'Accesso con Google non configurato: si entra solo con il link personale.');
  ok(/^https:\/\//.test(sito_()), 'Indirizzo del sito: ' + sito_(), 'Correggi «Indirizzo del sito» qui sotto: i link nelle email ai clienti portano lì.');
  return out;
}
// prenotazioni di un periodo (vista settimana / mese): solo i totali per giorno
function apiPrenPeriodo_(da, giorni) {
  const cfg = prCfg_(), g0 = giornoPr_(da); giorni = Math.min(42, Math.max(1, Math.round(+giorni) || 7));
  if (isNaN(g0)) throw new Error('Data non valida.');
  const tutte = prTutte_(), now = adessoPr_(), out = [];
  for (let g = g0; g < g0 + giorni; g++) {
    const iso = isoPr_(g), L = prLeggi_(iso, tutte), att = L.filter(b => PR_ATTIVA(b.s)), serv = serviziPr_(cfg, g);
    out.push({iso, oggi: g === now.g, chiuso: !serv[0] && !serv[1], pren: att.length, pers: att.reduce((a, b) => a + b.n, 0),
      pranzo: att.filter(b => b.k === 0).reduce((a, b) => a + b.n, 0), cena: att.filter(b => b.k === 1).reduce((a, b) => a + b.n, 0),
      dac: g === now.g ? L.filter(b => b.s === 'ok' && b.dac).length : 0, cop: cfg.cop});
  }
  return out;
}

/* =========================== REGISTRO DELLE ATTIVITÀ =========================== */
// chi ha fatto cosa e quando, in un foglio privato (non condiviso, non letto dal sito). Si apre da Impostazioni → Registro.
// Per le prenotazioni si scrivono solo codice, giorno, ora e persone: niente nomi o telefoni dei clienti.
function registroSh_() {
  let id = PROP.getProperty('REGISTRO'), ss = null;
  if (id) { try { ss = SpreadsheetApp.openById(id); } catch (e) { ss = null; } }
  if (!ss) {
    ss = SpreadsheetApp.create('Oltreconfini · Registro attività del pannello (privato)'); PROP.setProperty('REGISTRO', ss.getId());
    ss.getSheets()[0].getRange(1, 1, 1, 7).setValues([['Data', 'Ora', 'Persona', 'Ruolo', 'Sezione', 'Azione', 'Dettaglio']]);
  }
  return ss.getSheets()[0];
}
const RUOLI_N = {admin: 'Titolare', vice: 'Vice', personale: 'Personale'};
function registra_(azione, sezione, dettaglio, chi) {
  try {
    const now = new Date(), c = chi || (CHI ? [(CHI.nome ? CHI.nome + ' · ' : '') + CHI.email, RUOLI_N[CHI.ruolo] || CHI.ruolo] : ['Sistema', '']);
    const pulito = x => String(x == null ? '' : x).replace(/^[=+\-@]/, "'").slice(0, 500);
    const riga = [Utilities.formatDate(now, TZ, 'dd/MM/yyyy'), Utilities.formatDate(now, TZ, 'HH:mm:ss'), pulito(c[0]), pulito(c[1]), pulito(sezione), pulito(azione), pulito(dettaglio)];
    // veloce: la riga va in coda e finisce nel foglio entro un minuto (la persona non aspetta Google Fogli)
    let piena = false;
    conLock_(() => { let q = []; try { q = JSON.parse(PROP.getProperty('REG-CODA') || '[]'); } catch (e) {} q.push(riga); PROP.setProperty('REG-CODA', JSON.stringify(q)); piena = q.length >= 25; });
    if (piena) registroScarica_();
  } catch (e) {}
}
// scrive nel foglio del registro le righe in coda (ogni minuto, e prima di mostrarlo)
function registroScarica_() {
  let q = [];
  try { conLock_(() => { try { q = JSON.parse(PROP.getProperty('REG-CODA') || '[]'); } catch (e) {} if (q.length) PROP.deleteProperty('REG-CODA'); }); } catch (e) { return; }
  if (!q.length) return;
  try { const sh = registroSh_(); sh.getRange(sh.getLastRow() + 1, 1, q.length, 7).setNumberFormat('@').setValues(q); }
  catch (e) { try { conLock_(() => { let r = []; try { r = JSON.parse(PROP.getProperty('REG-CODA') || '[]'); } catch (x) {} PROP.setProperty('REG-CODA', JSON.stringify(q.concat(r).slice(-200))); }); } catch (x) {} }
}
const titoloVoce_ = o => { o = o || {}; const k = Object.keys(o).find(x => /^(piatto|vino|bevanda|evento|domanda|testo|formula|giorno|categoria)/i.test(x) && String(o[x]).trim()); return k ? String(o[k]).trim() : String(Object.keys(o).map(x => o[x]).find(v => String(v).trim()) || '').slice(0, 60); };
const SEZ_NOMI_REG = {piatti: 'Piatti e pizze', categorie: 'Categorie del menù', eventi: 'Eventi', avvisi: 'Eventi in arrivo e avvisi', vini: 'Vini', bevande: 'Bevande', faq: 'Domande', prezzi: 'Prezzi delle formule', orari: 'Orari', regole: 'Regole prenotazioni'};
const corto_ = v => { v = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return v.length > 60 ? v.slice(0, 57) + '…' : v; };
const codPr_ = id => '#' + String(id || '').slice(0, 6).toUpperCase();
// la storia di una prenotazione (chi ha fatto cosa), dal registro: solo titolare e vice
function apiPrenStoria_(id) {
  soloGestore_();
  const cod = codPr_(id), out = [];
  const usa = r => { if (String(r[6] || '').indexOf(cod) === 0) out.push({d: String(r[0]).slice(0, 5), h: String(r[1]).slice(0, 5), chi: String(r[2] || ''), ruolo: String(r[3] || ''), az: String(r[5] || ''), det: String(r[6] || '').slice(cod.length + 3)}); };
  try { const sh = registroSh_(), n = sh.getLastRow(); if (n > 1) { const da = Math.max(2, n - 3000); sh.getRange(da, 1, n - da + 1, 7).getDisplayValues().forEach(usa); } } catch (e) {}
  try { JSON.parse(PROP.getProperty('REG-CODA') || '[]').forEach(usa); } catch (e) {}       // le righe appena fatte, non ancora nel foglio
  return out.slice(-40);
}
const STATI_N = {ok: 'Confermata', arr: 'Arrivati', ann: 'Annullata dal cliente', annR: 'Annullata', lib: 'Tavolo liberato'};
// cosa annotare prima (per poter scrivere «da… a…») e dopo ogni operazione: [sezione, azione, dettaglio]
const REG_PRIMA = {
  apiPrenStato: a => prLeggi_(a[0]).find(b => b.id === a[1]),
  apiPrenSalva: a => ({ids: prLeggi_(a[0]).map(b => b.id), vecchia: a[2] ? prLeggi_(a[0]).find(b => b.id === a[2]) : null}),
  apiPersone: () => null
};
// nel registro vanno solo le prenotazioni (chi le ha create, modificate, segnate come arrivate o liberate)
const REG_DOPO = {
  apiPrenSalva: (a, r, prima) => { if (!r || r.avvisi || !r.lista) return null;
    const nuova = r.lista.find(b => prima && prima.ids.indexOf(b.id) < 0), v = prima && prima.vecchia, giorno = a[0].split('-').reverse().join('/');
    if (nuova) return ['Prenotazioni', 'Nuova prenotazione', codPr_(nuova.id) + ' · ' + giorno + ' ' + nuova.h + ' · ' + nuova.n + ' persone' + (a[3] ? ' · salvata nonostante gli avvisi (pieno/orario/doppione)' : '')];
    if (v) { const b = r.lista.find(x => x.id === v.id) || {}, ch = [];
      if (labPr_(v.m) !== b.h) ch.push('ora ' + labPr_(v.m) + ' → ' + b.h); if (v.n !== b.n) ch.push('persone ' + v.n + ' → ' + b.n);
      if ((v.tv || '') !== (b.tv || '')) ch.push('tavolo «' + (v.tv || '') + '» → «' + (b.tv || '') + '»'); if ((v.no || '') !== (b.no || '')) ch.push('note cambiate');
      if ((v.tel || '') !== (b.tel || '') || (v.em || '') !== (b.em || '') || (v.nm || '') !== (b.nm || '')) ch.push('dati del cliente cambiati');
      return ['Prenotazioni', 'Modificata una prenotazione', codPr_(v.id) + ' · ' + giorno + ' · ' + (ch.join(' · ') || 'nessun cambiamento')]; }
    return null; },
  apiPrenStato: (a, r, prima) => prima ? ['Prenotazioni', 'Cambiato lo stato', codPr_(prima.id) + ' · ' + a[0].split('-').reverse().join('/') + ' ' + labPr_(prima.m) + ' · ' + prima.n + ' persone · ' +
    (STATI_N[prima.s] || prima.s) + (prima.dac ? ' (da contattare)' : '') + ' → ' + (a[2] === 'ok' && a[3] && a[3].arriva ? 'sta arrivando tra ' + a[3].arriva + ' min' : STATI_N[a[2]] || a[2]) + (a[3] && a[3].mail ? ' · cliente avvisato per email' : '')] : null
};
function apiRegistro_(f) {
  soloGestore_(); f = f || {}; registroScarica_();
  const sh = registroSh_(), n = sh.getLastRow(); if (n < 2) return {righe: [], giorni: +(PROP.getProperty('REG-GIORNI') || 365), url: registroUrl_()};
  const da = Math.max(2, n - 1999), v = sh.getRange(da, 1, n - da + 1, 7).getDisplayValues().reverse();
  const q = String(f.testo || '').toLowerCase();
  const righe = v.filter(r => (!f.persona || r[2].toLowerCase().indexOf(String(f.persona).toLowerCase()) >= 0) && (!f.sezione || r[4] === f.sezione) && (!q || r.join(' ').toLowerCase().indexOf(q) >= 0)).slice(0, 300);
  return {righe, persone: Array.from(new Set(v.map(r => r[2]))).sort(), sezioni: Array.from(new Set(v.map(r => r[4]))).sort(), giorni: +(PROP.getProperty('REG-GIORNI') || 365), url: registroUrl_()};
}
function registroUrl_() { try { return CHI && CHI.ruolo === 'admin' ? SpreadsheetApp.openById(PROP.getProperty('REGISTRO')).getUrl() : ''; } catch (e) { return ''; } }
function apiRegistroGiorni_(g) { soloGestore_(); g = Math.round(+g); if (!(g >= 30 && g <= 730)) throw new Error('Scegli tra 30 e 730 giorni.'); PROP.setProperty('REG-GIORNI', String(g)); return apiRegistro_({}); }
// ogni notte: si tolgono le righe più vecchie della conservazione scelta
function registroPulisci_() {
  try {
    const sh = registroSh_(), n = sh.getLastRow(); if (n < 3) return;
    const g = +(PROP.getProperty('REG-GIORNI') || 365), lim = new Date(Date.now() - g * 864e5);
    const date = sh.getRange(2, 1, n - 1, 1).getDisplayValues().map(r => { const m = String(r[0]).match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(+m[3], +m[2] - 1, +m[1]) : new Date(); });
    let k = 0; while (k < date.length && date[k] < lim) k++;
    if (k > 0) sh.deleteRows(2, k);
  } catch (e) {}
}

/* =========================== LA PAGINA DEL PANNELLO =========================== */
function oraRoma(d) { const s = Utilities.formatDate(d, TZ, 'HH:mm'); return {h: +s.slice(0, 2), m: +s.slice(3)}; }
function oraPulizia() { return prCfg_().oraPul; }
export { prRecensioni_, oraRoma, oraPulizia, doGet, doPost, api, promemoria, copiaRiserva, prControlla, prInvia, prNotte, registroScarica_, FOGLI, RISERVA, persone_, salvaPersone_, mandaLink_, chiavi_, proprietario_, aggiornaFogli_, PROP };
