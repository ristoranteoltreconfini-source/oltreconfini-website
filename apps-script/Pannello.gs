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
function chiaveIA_() { return typeof CHIAVE_IA === 'undefined' ? '' : String(CHIAVE_IA || '').replace(/[\s'"‘’“”`]/g, ''); }
function iaAttiva_() { return chiaveIA_().length >= 20; }
// Modelli in ordine di velocità: i «Flash-Lite» rispondono in 1-2 secondi e nel piano gratuito hanno molte più richieste al giorno
// (i «Flash» normali ne hanno circa 20 e ragionano a lungo prima di rispondere: per questo l'IA «non rispondeva quasi mai»).
const MODELLI_IA_ = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-2.5-flash-lite', 'gemini-flash-latest'];
function chiediIA_(prompt, tempoMax) {
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
        r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {
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
function apiControllaIA_(sez, voce, contesto, giaSegnalati) {
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
    const r = chiediIA_(prompt, 10000), corr = {};
    Object.keys(r.correzioni || {}).forEach(k => { if (Object.prototype.hasOwnProperty.call(voce, k) && String(r.correzioni[k]) !== String(voce[k])) corr[k] = String(r.correzioni[k]).slice(0, 300); });
    return {avvisi: (r.avvisi || []).slice(0, 5).map(x => String(x).slice(0, 300)), correzioni: corr};
  } catch (e) { return {errore: String(e.message || e).slice(0, 200)}; }
}
// menù della settimana: un solo controllo dell'IA per tutti i giorni (in memoria 6 ore: la seconda volta è immediato)
function apiControllaSettIA_(giorni) {
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
    const r = chiediIA_(prompt), out = {
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
function provaIA() { soloTitolare_();
  if (typeof CHIAVE_IA === 'undefined') { Logger.log('In Persone.gs manca la riga:  const CHIAVE_IA = \'la-tua-chiave\';'); return; }
  if (!iaAttiva_()) { Logger.log('CHIAVE_IA c\'è ma è vuota o troppo corta (' + chiaveIA_().length + ' caratteri): ricopia la chiave intera da aistudio.google.com.'); return; }
  Logger.log('Chiave letta: ' + chiaveIA_().slice(0, 6) + '…' + chiaveIA_().slice(-4) + ' (' + chiaveIA_().length + ' caratteri)');
  MODELLI_IA_.forEach(m => { try { cache_().remove('ia-no-' + m); } catch (e) {} }); try { cache_().remove('ia-ok'); } catch (e) {}
  // prova di ogni modello, così si vede quale risponde e quanto ci mette
  MODELLI_IA_.forEach(m => { const t = Date.now(); let esito;
    try { const gc = {temperature: 0, responseMimeType: 'application/json'}; if (!/2\.5/.test(m)) gc.thinkingConfig = {thinkingLevel: 'minimal'};
      const r = UrlFetchApp.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + m + ':generateContent', {method: 'post', contentType: 'application/json', muteHttpExceptions: true, headers: {'x-goog-api-key': chiaveIA_()}, payload: JSON.stringify({contents: [{parts: [{text: 'Rispondi solo con JSON {"ok":true}'}]}], generationConfig: gc})});
      const k = r.getResponseCode(); esito = k === 200 ? 'risponde ✓' : k === 429 ? 'richieste gratuite finite per oggi (429)' : k === 404 ? 'non esiste più (404)' : 'errore ' + k + ' ' + r.getContentText().slice(0, 120);
    } catch (e) { esito = 'errore: ' + e.message; }
    Logger.log(m + ': ' + esito + ' · ' + ((Date.now() - t) / 1000).toFixed(1) + ' s'); });
  try { Logger.log('Risposta dell\'IA: ' + JSON.stringify(chiediIA_('Rispondi solo con JSON {"ok":true}'))); Logger.log('Funziona ✓ (il pannello usa per primo il modello più veloce che risponde)'); }
  catch (e) {
    const m = String(e.message);
    Logger.log(/API_KEY_INVALID|API key not valid|401|403/.test(m) ? 'Google dice che la chiave non è valida: creane una nuova su aistudio.google.com (Get API key → Create API key), copiala con il pulsante Copia e incollala di nuovo.' :
      /429|503|occupato|RESOURCE_EXHAUSTED|UNAVAILABLE/.test(m) ? 'La chiave è giusta ✓ ma in questo momento i modelli di Google sono sovraccarichi: riprova tra qualche minuto. Nel pannello, quando succede, si salva con i controlli normali.' : 'Non funziona: ' + m);
  }
}

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
function api(k, fn, args) {
  CHI = chi_(k);
  if (!Object.prototype.hasOwnProperty.call(API, fn)) throw new Error('Operazione non valida.');
  args = Array.isArray(args) ? args : [];
  const serve = permessoPer_(fn, args);
  if (serve === 'G' ? !gestore_() : serve && !puo_(serve)) {
    throw new Error('Non hai il permesso per questa sezione: chiedilo al titolare o al vice.');
  }
  const prima = REG_PRIMA[fn] ? (() => { try { return REG_PRIMA[fn](args); } catch (e) { return null; } })() : null;
  const r = API[fn].apply(null, args);
  if (REG_DOPO[fn]) { try { const d = REG_DOPO[fn](args, r, prima); if (d) registra_(d[1], d[0], d[2]); } catch (e) {} }
  return r;
}

/* =========================== OPINIONI =========================== */
// il sito manda qui i voti (stesso deployment del pannello: esegui come me, accesso: chiunque)
const VOCI = ['cucina', 'pizza', 'sala', 'ambiente', 'attesa', 'ritiro'];
const TIPI = {pizza: 'Pizza', cucina: 'Piatti della cucina', entrambi: 'Pizza e cucina', pranzo: 'Pranzo di lavoro', asporto: 'Asporto'};
function doPost(e) {
  const ok = ContentService.createTextOutput('ok');
  try {
    const d = JSON.parse(String(e.postData && e.postData.contents || '').slice(0, 4000));
    if (d && d.a === 'prenota') return jsonPr_(prPrenota_(d));
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
function emailValida_(em) {
  em = String(em || '').trim().toLowerCase();
  if (em.length > 100 || em.indexOf('..') >= 0 || !/^[a-z0-9._%+'-]+@([a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(em)) return 'sintassi';
  const dom = em.split('@')[1];
  if (MAIL_USA_E_GETTA.indexOf(dom) >= 0) return 'usaegetta';
  if (MAIL_NOTI.indexOf(dom) >= 0) return 'ok';
  const ck = 'mx-' + dom; try { const c = cache_().get(ck); if (c) return c; } catch (e) {}
  let r = 'ok';
  try {
    const q = t => JSON.parse(UrlFetchApp.fetch('https://dns.google/resolve?name=' + encodeURIComponent(dom) + '&type=' + t, {muteHttpExceptions: true}).getContentText());
    const mx = q('MX');
    if (mx.Status === 3) r = 'dominio';
    else if (mx.Status === 0 && !(mx.Answer || []).some(a => a.type === 15)) { const a = q('A'); if (!(a.Answer || []).some(x => x.type === 1)) r = 'dominio'; }
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
  it: {conferma: 'Prenotazione confermata', modifica: 'Prenotazione modificata', promemoria: 'Ti aspettiamo', ritardo: 'Stai arrivando?', liberata: 'Tavolo liberato', annullata: 'Prenotazione annullata',
    ciao: 'Ciao', persone: 'persone', persona: 'persona', alle: 'alle',
    b_conferma: 'la tua prenotazione è confermata:', b_modifica: 'abbiamo aggiornato la tua prenotazione:', b_promemoria: 'ti ricordiamo la prenotazione di oggi:',
    b_ritardo: 'ti stiamo aspettando. Se stai arrivando, confermacelo con un tocco: teniamo il tavolo fino all’orario che ci indichi. Senza conferma il tavolo viene liberato {m} minuti dopo l’orario prenotato.',
    b_ritardo_m: 'ti stiamo aspettando. Se stai arrivando dicci tra quanto con un tocco; se sei già da noi tocca «Siamo già qui». Se non riusciamo a sentirti, ti chiameremo al numero che ci hai lasciato.',
    b_liberata: 'non avendo tue notizie abbiamo liberato il tavolo prenotato. Se sei già da noi, ignora questo messaggio.', b_annullata: 'la prenotazione è stata annullata:',
    gest: 'Annulla la prenotazione', arr: 'Rispondi: arrivo o sono già qui', cambia: 'Per cambiare giorno o orario annulla e prenota di nuovo, oppure chiamaci al {tel}.',
    priv: 'Usiamo questi dati solo per la tua prenotazione e li cancelliamo la notte dopo. Informativa:'},
  en: {conferma: 'Booking confirmed', modifica: 'Booking updated', promemoria: 'See you soon', ritardo: 'Are you on your way?', liberata: 'Table released', annullata: 'Booking cancelled',
    ciao: 'Hello', persone: 'people', persona: 'person', alle: 'at',
    b_conferma: 'your booking is confirmed:', b_modifica: 'we have updated your booking:', b_promemoria: 'a reminder of your booking for today:',
    b_ritardo: 'we are waiting for you. If you are on your way, let us know with one tap: we will keep the table until the time you choose. Without a reply the table is released {m} minutes after the booked time.',
    b_ritardo_m: 'we are waiting for you. If you are on your way, tell us when with one tap; if you are already here, tap «We are already here». If we do not hear from you, we will call the number you gave us.',
    b_liberata: 'as we have not heard from you, we have released your table. If you are already here, please ignore this message.', b_annullata: 'the booking has been cancelled:',
    gest: 'Cancel your booking', arr: 'Reply: on my way or already here', cambia: 'To change day or time, cancel and book again, or call us on {tel}.',
    priv: 'We use these details only for your booking and delete them the following night. Privacy notice:'},
  de: {conferma: 'Reservierung bestätigt', modifica: 'Reservierung geändert', promemoria: 'Wir freuen uns auf Sie', ritardo: 'Sind Sie unterwegs?', liberata: 'Tisch freigegeben', annullata: 'Reservierung storniert',
    ciao: 'Guten Tag', persone: 'Personen', persona: 'Person', alle: 'um',
    b_conferma: 'Ihre Reservierung ist bestätigt:', b_modifica: 'wir haben Ihre Reservierung geändert:', b_promemoria: 'wir erinnern Sie an Ihre heutige Reservierung:',
    b_ritardo: 'wir warten auf Sie. Wenn Sie unterwegs sind, bestätigen Sie es mit einem Tipp: Wir halten den Tisch bis zur angegebenen Zeit frei. Ohne Antwort wird der Tisch {m} Minuten nach der reservierten Zeit freigegeben.',
    b_ritardo_m: 'wir warten auf Sie. Wenn Sie unterwegs sind, sagen Sie uns mit einem Tipp, wann Sie da sind; wenn Sie schon hier sind, tippen Sie auf «Wir sind schon da». Wenn wir nichts hören, rufen wir Sie an.',
    b_liberata: 'da wir nichts von Ihnen gehört haben, haben wir den Tisch freigegeben. Falls Sie schon bei uns sind, ignorieren Sie diese Nachricht.', b_annullata: 'die Reservierung wurde storniert:',
    gest: 'Reservierung stornieren', arr: 'Antworten: unterwegs oder schon da', cambia: 'Um Tag oder Uhrzeit zu ändern, stornieren und neu reservieren oder anrufen: {tel}.',
    priv: 'Wir verwenden diese Daten nur für Ihre Reservierung und löschen sie in der folgenden Nacht. Datenschutz:'},
  fr: {conferma: 'Réservation confirmée', modifica: 'Réservation modifiée', promemoria: 'À tout à l’heure', ritardo: 'Êtes-vous en route ?', liberata: 'Table libérée', annullata: 'Réservation annulée',
    ciao: 'Bonjour', persone: 'personnes', persona: 'personne', alle: 'à',
    b_conferma: 'votre réservation est confirmée :', b_modifica: 'nous avons modifié votre réservation :', b_promemoria: 'nous vous rappelons votre réservation d’aujourd’hui :',
    b_ritardo: 'nous vous attendons. Si vous êtes en route, confirmez-le d’un geste : nous gardons la table jusqu’à l’heure indiquée. Sans réponse, la table est libérée {m} minutes après l’heure réservée.',
    b_ritardo_m: 'nous vous attendons. Si vous êtes en route, dites-nous dans combien de temps d’un geste ; si vous êtes déjà là, touchez «Nous sommes déjà là». Sans nouvelles, nous vous appellerons.',
    b_liberata: 'sans nouvelles de votre part, nous avons libéré la table. Si vous êtes déjà chez nous, ignorez ce message.', b_annullata: 'la réservation a été annulée :',
    gest: 'Annuler la réservation', arr: 'Répondre : en route ou déjà là', cambia: 'Pour changer de jour ou d’heure, annulez et réservez à nouveau, ou appelez le {tel}.',
    priv: 'Nous utilisons ces données uniquement pour votre réservation et les supprimons la nuit suivante. Confidentialité :'}
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
    '<p>' + L.ciao + ' ' + esc(nome) + ', ' + esc(corpo) + '</p>' + (tipo === 'liberata' ? '' : riga) +
    (tipo === 'annullata' || tipo === 'liberata' ? '' : '<p>' + bottone(link, tipo === 'ritardo' ? L.arr : L.gest) + '</p>') +
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
function prPrenota_(d) {
  if (d.hp) return {ok: true, code: '------'};                                   // trappola per i robot
  const cfg = prCfg_(); if (!cfg.on) return {ok: false, err: 'spente'};
  const iso = String(d.d || ''), g = giornoPr_(iso), n = Math.round(+d.n), lg = /^(it|en|de|fr)$/.test(d.lg) ? d.lg : 'it';
  const pulito = (x, l) => String(x || '').replace(/[\u0000-\u001f<>]/g, ' ').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, l);
  const nm = pulito(d.nm, 60), tel = String(d.tel || '').replace(/[^\d+\s.\/()\-]/g, '').trim().slice(0, 20), em = pulito(d.em, 100).toLowerCase(), no = pulito(d.no, 300);
  if (isNaN(g) || !(n >= 1)) return {ok: false, err: 'dati'};
  if (n > cfg.maxN) return {ok: false, err: 'troppi', maxN: cfg.maxN};
  if (nm.length < 2 || !/[a-zà-ÿ]/i.test(nm)) return {ok: false, err: 'nome'};
  if (!telValido_(tel)) return {ok: false, err: 'tel'};
  if (em) { const ev = emailValida_(em); if (ev !== 'ok') return {ok: false, err: 'email', why: ev}; }   // dal sito l'email è facoltativa (consigliata)
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
    minuti: [10, 15, 20, 30, 45, 60, 90, 120, 180].filter(x => now.abs + x <= inizio + cfg.etaMax).slice(0, 4), telLoc: cfg.telLoc};
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
function apiPrenSalva_(iso, r, id, forza) {
  ammesso_();
  const cfg = prCfg_(), now = adessoPr_(), g = giornoPr_(iso); r = r || {};
  const pulito = (x, l) => String(x == null ? '' : x).replace(/[\u0000-\u001f<>]/g, ' ').replace(/^[=+\-@]+/, '').replace(/\s+/g, ' ').trim().slice(0, l);
  const nm = pulito(r.nm, 60), tel = String(r.tel == null ? '' : r.tel).replace(/[^\d+\s.\/()\-]/g, '').trim().slice(0, 20), em = pulito(r.em, 100).toLowerCase(), no = pulito(r.no, 300), tv = pulito(r.tv, 20), n = Math.round(+r.n), m = hmPr_(r.h);
  if (isNaN(g)) throw new Error('Scegli il giorno.');
  if (m === null) throw new Error('Scegli l’orario.');
  if (!(n >= 1 && n <= 300)) throw new Error('Indica quante persone.');
  if (nm.length < 2) throw new Error('Scrivi il nome di chi prenota.');
  if (!telValido_(tel)) throw new Error('Il telefono non sembra valido: cellulare (3…) o fisso (0…); se è estero scrivi il prefisso, es. +41 79 123 45 67.');
  if (em) { const ev = emailValida_(em); if (ev !== 'ok') throw new Error(ev === 'usaegetta' ? 'È un’email «usa e getta»: chiedi al cliente un indirizzo vero.' : ev === 'dominio' ? 'L’email non può ricevere messaggi (dopo la @ c’è un errore?): ricontrollala con il cliente.' : 'L’email non è scritta correttamente.'); }
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
function provaUrl_(u) {
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
function apiImpostaUrl_(u) {
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
  const out = [], url = ScriptApp.getService().getUrl(), ok = (b, t, aiuto) => out.push({ok: !!b, t, aiuto: b ? '' : aiuto || ''});
  let riga = urlSito_(), pr = riga ? provaUrl_(riga) : {ok: false, perche: 'formato'}, sistemato = false;
  if (!pr.ok && url && url !== riga && provaUrl_(url).ok) { scriviUrl_(url); riga = url; pr = {ok: true}; sistemato = true; cache_().remove('url-ok'); }
  let prova = null;
  if (pr.ok) try { prova = JSON.parse(UrlFetchApp.fetch(riga + '?a=disp&n=2&d=' + isoPr_(adessoPr_().g), {muteHttpExceptions: true, followRedirects: true}).getContentText()); } catch (e) {}
  ok(pr.ok && prova && prova.ok, (sistemato ? 'Sistemato adesso: ' : '') + 'Il sito raggiunge il sistema delle prenotazioni', riga ? URL_PERCHE[pr.perche] || 'Il sistema risponde, ma non alle prenotazioni: riprova tra un minuto.' : 'Manca l’indirizzo del sistema: incollalo qui sotto.');
  out.push({url: riga, ok: pr.ok, campo: true});
  const tr = ScriptApp.getProjectTriggers().map(t => t.getHandlerFunction());
  ok(['prControlla', 'prInvia', 'prNotte'].every(x => tr.indexOf(x) >= 0), 'Controlli automatici attivi (ritardi, invio email, pulizia notturna)', 'Apri la sezione Prenotazioni: si attivano da soli. Oppure esegui «installa».');
  ok(tr.indexOf('promemoria') >= 0, 'Promemoria del menù della settimana attivo', 'Esegui «installa» dall’editor.');
  let q = null; try { q = MailApp.getRemainingDailyQuota(); } catch (e) {}
  ok(q === null || q > 20, 'Email disponibili oggi: ' + (q === null ? '?' : q), 'Il limite giornaliero di Google è quasi finito: le email ai clienti riprendono domani.');
  let coda = []; try { coda = JSON.parse(PROP.getProperty('PR-CODA') || '[]'); } catch (e) {}
  ok(coda.length < 20, 'Email in attesa di invio: ' + coda.length, 'Le email non stanno partendo: controlla i controlli automatici qui sopra.');
  const sito = sito_(); let sitoOk = false; try { sitoOk = UrlFetchApp.fetch(sito, {muteHttpExceptions: true}).getResponseCode() < 400; } catch (e) {}
  ok(sitoOk, 'Indirizzo del sito raggiungibile: ' + sito, 'Correggi «Indirizzo del sito» qui in Configurazione: i link nelle email ai clienti portano lì.');
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
const PAGINA = String.raw`<!DOCTYPE html><html lang="it"><head><meta charset="utf-8"><base target="_top">
<style>.sfn{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 0%,rgba(201,174,124,.35),transparent 60%),#0b121c;box-shadow:inset 0 0 0 4px #0b121c,inset 0 0 0 5px #c9ae7c}.mo-prev{background:#0b121c;color:#f3ead3;border-radius:10px;padding:14px;text-align:center;font:16px/1.35 Georgia,serif;margin:6px 0 10px}.mo-prev b{display:block;color:#c9ae7c;font:600 11px sans-serif;letter-spacing:.25em;text-transform:uppercase;margin:12px 0 4px}.mo-prev b:first-child{margin-top:0}.sf{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.sfo{position:relative;display:block;aspect-ratio:4/3;border:2px solid transparent;border-radius:10px;overflow:hidden;padding:0;background:#e9e2d6;cursor:pointer;font:inherit}.sfo img{width:100%;height:100%;object-fit:cover;display:block}.sfo span{position:absolute;left:0;right:0;bottom:0;padding:4px 6px;background:rgba(0,0,0,.55);color:#fff;font-size:12px;line-height:1.25;text-align:left}.sfo.on{border-color:#b08d4c;box-shadow:0 0 0 2px #b08d4c}.sfu{display:grid;place-items:center}.sfu span{position:static;background:none;color:inherit;text-align:center;font-size:13px}.sfu img+span{position:absolute;background:rgba(0,0,0,.55);color:#fff}
input[type=time]{font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:#fff;min-height:44px;box-sizing:border-box;min-width:0;flex:1}
input[type=email],input[type=url]{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:#fff;box-sizing:border-box;margin:4px 0 10px}.tg{position:relative;width:46px;height:26px;border-radius:13px;border:0;background:#d6cfbf;flex:none;cursor:pointer;margin-left:6px}.tg span{position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}.tg.on{background:#2f7a4a}.tg.on span{left:23px}.sw.big{display:flex;gap:12px;align-items:center;background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin:0 0 14px;cursor:pointer;position:relative}.sw.big input{position:absolute;opacity:0;width:1px;height:1px}.sw.big .tr{position:relative;width:46px;height:26px;border-radius:13px;background:#d6cfbf;flex:none}.sw.big .tr::after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}.sw.big input:checked+.tr{background:#2f7a4a}.sw.big input:checked+.tr::after{left:23px}.sw.big small{display:block;font-weight:400;color:var(--mist);font-size:13px;margin-top:2px}.sync{display:none;align-items:center;gap:10px;background:#0b121c;color:#f3ead3;border-radius:999px;padding:9px 16px;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.25);max-width:calc(100% - 24px)}.sync.ok{background:#2f7a4a}.sync.err{background:#b23a2e;border-radius:12px}.sync small{opacity:.8}.sync button{background:#fff;color:#0b121c;border:0;border-radius:999px;padding:5px 10px;font-weight:600}.spin{width:14px;height:14px;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;border-radius:50%;animation:sp 1s linear infinite}@keyframes sp{to{transform:rotate(360deg)}}.orr{border-bottom:1px solid var(--line);padding:10px 0}.orr b{display:block;margin-bottom:6px}.orc{display:flex;align-items:center;gap:6px;margin:4px 0;flex-wrap:wrap}.orc span{min-width:52px;font-size:14px}.orc input{width:auto;flex:1;min-width:92px}.orc .x{padding:6px 10px;font-size:13px}.cm .orig{font-size:12.5px;color:#7a705a;font-style:italic;margin-top:4px}.ck{border:1px solid #e0b25b;background:#fff8e8;border-radius:10px;padding:12px 14px;margin-bottom:14px}.ck ul{margin:8px 0 4px 18px;padding:0}.ck li{margin:4px 0}.ck li.e{color:#b23a2e;font-weight:600}.sugg{margin:2px 0 8px}.sugg a{color:#8a6a2a}.fprev img{max-width:100%;max-height:220px;border-radius:6px;display:block;margin:6px 0 10px}.foto .btn{margin:4px 6px 4px 0}
:root{--ink:#0b121c;--gold:#a8874e;--bg:#f6f2e9;--card:#fff;--line:#e3dccd;--mist:#6d6a63;--ok:#2f7a4a;--bad:#a8402f}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:17px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
header{background:var(--ink);color:#f3ead3;padding:14px 16px 0;position:sticky;top:0;z-index:5}
header h1{font:500 22px Georgia,serif;margin:0 0 10px;letter-spacing:.02em}header h1 small{color:#c9ae7c;font:13px sans-serif;letter-spacing:.12em;text-transform:uppercase;margin-left:8px}
nav{display:flex;gap:6px;overflow-x:auto;padding-bottom:10px;scrollbar-width:none}
nav button{flex:none;border:1px solid #c9ae7c55;background:none;color:#f3ead3;padding:9px 14px;border-radius:20px;font:15px sans-serif}
nav button.on{background:#c9ae7c;color:var(--ink);border-color:#c9ae7c}
main{padding:16px;max-width:760px;margin:0 auto 90px}
h2{font:500 21px Georgia,serif;margin:6px 0 12px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin-bottom:12px}
.hint{color:var(--mist);font-size:14.5px;margin:4px 0 12px}
label{display:block;font-weight:600;font-size:14.5px;margin:12px 0 5px}
input[type=text],input[type=date],input[type=number],textarea,select{width:100%;font:17px sans-serif;padding:11px 12px;border:1px solid #cfc6b4;border-radius:8px;background:#fff;color:var(--ink)}
textarea{min-height:96px;resize:vertical}
.btn{display:inline-block;border:0;border-radius:8px;padding:13px 18px;font:600 16px sans-serif;background:var(--ink);color:#f3ead3;cursor:pointer}
.pnav{display:flex;align-items:center;gap:10px;margin:0 0 12px}.pnav .btn{min-width:44px;min-height:44px;padding:0 14px;font-size:20px}.sw-t{flex:1;text-align:center;line-height:1.3}.sw-t b{display:block;font-size:17px}.sw-t span{font-size:13px;color:#6b6b6b}
.sw-g .sw-h{display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap}.sw-g .sw-h b{font-size:17px;flex:1}.sw-g .sw-h .btn.mini{float:none;margin:0}.sw-g textarea{min-height:64px}
.sw-g.pass{opacity:.6}.sw-g.oggiq{border:2px solid #c9ae7c}.sw-h .tag{background:#c9ae7c;color:var(--ink);margin:0}.sw-h .tag.grey{background:#e4e0d8;color:#555}
.sw-bar{position:sticky;bottom:10px;z-index:5;background:rgba(246,242,235,.95);padding:10px;border-radius:14px;box-shadow:0 4px 18px rgba(0,0,0,.12)}
.btn.gold{background:#c9ae7c;color:var(--ink)}.btn.danger{background:var(--bad);color:#fff}
.dlg{position:fixed;inset:0;z-index:40;background:rgba(11,18,28,.55);display:flex;align-items:flex-end;justify-content:center;padding:16px}
.dlg-b{background:#fff;color:var(--ink);width:100%;max-width:440px;border-radius:16px;padding:20px 18px 16px;box-shadow:0 10px 40px rgba(0,0,0,.3)}
.dlg-b>b{display:block;font-size:19px;margin-bottom:6px}.dlg-b p{margin:0 0 14px;line-height:1.45;white-space:pre-line}
.dlg-b input,.dlg-b textarea{width:100%;box-sizing:border-box;margin:0 0 14px;font-size:18px}
.dlg-r{display:flex;flex-direction:column-reverse;gap:8px}.dlg-r .btn{width:100%;min-height:48px}
@media(min-width:600px){.dlg{align-items:center}.dlg-r{flex-direction:row;justify-content:flex-end}.dlg-r .btn{width:auto}}.btn.light{background:#ece5d6;color:var(--ink)}.btn.bad{background:none;color:var(--bad);border:1px solid var(--bad)}
.row{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}.row .btn{flex:1}
.item{display:flex;align-items:center;gap:10px;padding:12px 10px;border-bottom:1px solid var(--line);cursor:pointer}
.item:last-child{border-bottom:0}.item .t{flex:1;min-width:0}.item b{display:block;font-weight:600}.item span{color:var(--mist);font-size:14px;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.item .mv{border:1px solid var(--line);background:#fff;border-radius:6px;width:34px;height:34px;font-size:16px}
.grp{font:600 12.5px sans-serif;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);margin:16px 4px 6px}
.badge{font:600 11px sans-serif;letter-spacing:.06em;padding:3px 7px;border-radius:10px;background:#ece5d6;color:var(--mist)}.badge.on{background:#dcefe2;color:var(--ok)}
.al{display:grid;grid-template-columns:1fr 1fr;gap:6px}.al label{font-weight:400;margin:0;display:flex;gap:8px;align-items:center;padding:8px;border:1px solid var(--line);border-radius:8px;font-size:14.5px}
.sw{display:flex;align-items:center;gap:10px;font-weight:600;margin-top:14px}.sw input{width:24px;height:24px}
.search{margin-bottom:10px}
#msgs{position:fixed;left:0;right:0;bottom:calc(14px + env(safe-area-inset-bottom,0px));z-index:80;display:flex;flex-direction:column;align-items:center;gap:8px;padding:0 12px;pointer-events:none;transition:bottom .2s}#msgs.alto{bottom:calc(96px + env(safe-area-inset-bottom,0px))}#msgs>*{pointer-events:auto}#toast{background:var(--ink);color:#f3ead3;padding:12px 18px;border-radius:24px;font-size:15px;display:none;max-width:100%;text-align:center;box-shadow:0 8px 24px rgba(0,0,0,.25);animation:tin .18s ease-out}#toast.err{background:#b23a2e;border-radius:12px}@keyframes tin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}input[type=date],input[type=time],select{-webkit-appearance:none;appearance:none;display:block;min-width:0;max-width:100%;min-height:46px}input[type=date]::-webkit-date-and-time-value,input[type=time]::-webkit-date-and-time-value{text-align:left}select{background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%230b121c' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 12px center;padding-right:34px}input,select,textarea{max-width:100%}.card{min-width:0;overflow-wrap:anywhere}html,body{overflow-x:hidden}a.btn.tel{text-decoration:none;text-align:center}
#busy{position:fixed;inset:0;background:transparent;color:transparent;display:none;align-items:center;justify-content:center;z-index:15;font:600 16px sans-serif;transition:background .15s,color .15s}#busy.vis{background:#f6f2e9aa;color:var(--ink)}
.state{padding:10px 12px;border-radius:8px;font-size:15px;margin-bottom:10px}.state.ok{background:#dcefe2;color:var(--ok)}.state.no{background:#f7e3dc;color:var(--bad)}
.kpis{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.kpi{background:#fff;border:1px solid var(--line);border-radius:10px;padding:12px 10px;text-align:center}
.kpi b{display:block;font:500 28px Georgia,serif}.kpi span{font-size:12.5px;color:var(--mist)}.kpi i{display:block;font-style:normal;font-size:12px;margin-top:2px;color:var(--mist)}
.seg{display:flex;gap:6px;margin:0 0 12px;flex-wrap:wrap}.seg button{border:1px solid #cfc6b4;background:#fff;border-radius:18px;padding:7px 12px;font:14px sans-serif}.seg button.on{background:var(--ink);color:#f3ead3;border-color:var(--ink)}
.hb{display:grid;grid-template-columns:118px 1fr 58px;align-items:center;gap:8px;margin:7px 0;font-size:14.5px}
.hb .tr{height:12px;background:#efe9dc;border-radius:2px;position:relative}.hb .fl{position:absolute;left:0;top:0;bottom:0;background:var(--ink);border-radius:0 4px 4px 0}
.hb em{font-style:normal;text-align:right;font-variant-numeric:tabular-nums}.hb small{color:var(--mist)}
.chart svg{width:100%;height:auto;display:block}.chart text{font:11px sans-serif;fill:#6d6a63}
.cm{border-bottom:1px solid var(--line);padding:10px 2px;font-size:15px}.cm:last-child{border-bottom:0}.cm .h{font-size:12.5px;color:var(--mist);margin-bottom:4px}.cm p{margin:3px 0}.cm b{font-weight:600}
table.tt{width:100%;border-collapse:collapse;font-size:14.5px}table.tt td,table.tt th{padding:7px 4px;border-bottom:1px solid var(--line);text-align:left}table.tt td+td,table.tt th+th{text-align:right;font-variant-numeric:tabular-nums}
.kpis.k4{grid-template-columns:repeat(2,1fr)}@media(min-width:600px){.kpis.k4{grid-template-columns:repeat(4,1fr)}}
.kpi.neg{border-color:#e5b8b0;background:#fdf3f1;cursor:pointer}.kpi.neg b,.kpi.neg span{color:#b23a2e}
.am{width:100%;height:260px}
.flt{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.flt select{font-size:15px;padding:9px}
.cmbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:12px 0 4px;font-size:14.5px}.cmbar .btn{padding:9px 12px;font-size:14px}
.cm{border-left:4px solid #d9d2c3;padding:10px 10px 10px 12px;margin:10px 0;background:#fffdf9;border-radius:0 8px 8px 0}
.cm.s-neg{border-left-color:#b23a2e;background:#fdf3f1}.cm.s-mid{border-left-color:#c08a1e}.cm.s-pos{border-left-color:#2f7a4a}
.tag{display:inline-block;font:600 11px sans-serif;letter-spacing:.06em;text-transform:uppercase;padding:3px 7px;border-radius:10px;margin-right:4px}
.t-neg{background:#b23a2e;color:#fff}.t-mid{background:#f4e6c6;color:#7a5510}.t-pos{background:#dcefe2;color:#2f7a4a}
.cmlist{max-height:min(68vh,620px);overflow-y:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:10px;padding:0 10px;margin-top:8px;background:#fbf8f2}
.cmlist .cm:first-child{margin-top:10px}
.cm .low{font-size:13.5px;color:#b23a2e;margin:4px 0}.cm mark{background:#f7d9d3;color:inherit;padding:0 2px;border-radius:2px}
.temi{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}.temi span{font-size:12px;border:1px solid #e5b8b0;color:#8c2f25;border-radius:10px;padding:2px 8px}
.act{display:flex;gap:8px;margin-top:8px}.act select{flex:1;font-size:14px;padding:8px}.act .btn{padding:8px 12px;font-size:14px}
.nota{font-size:14px;margin-top:6px;padding:6px 8px;background:#efe9dc;border-radius:6px}
.prnav{display:flex;gap:8px;align-items:center;margin-bottom:6px}.prnav input{flex:1}.prnav .btn{padding:11px 14px}
.prday{font:500 19px Georgia,serif;margin:4px 0 12px}.kpis.k2{grid-template-columns:1fr 1fr}.kpi b small{font:15px sans-serif;color:var(--mist)}
.prx .t span{white-space:normal}.prx .tag{margin-top:5px;display:inline-block}.prx.spenta{opacity:.55}.prx.spenta b{text-decoration:line-through}
.arrbtn{flex:none;min-width:96px;min-height:44px;border:1px solid var(--ok);color:var(--ok);background:#fff;border-radius:8px;font:600 14px sans-serif;cursor:pointer}.arrbtn.on{background:var(--ok);color:#fff}
.t-ok{background:#e8eef7;color:#2a4a7a}.t-off{background:#ece5d6;color:var(--mist)}
.sw2{display:flex;align-items:center;justify-content:space-between;gap:12px;font-weight:600;margin-top:4px}.tg.big{width:52px;height:30px;border-radius:15px}.tg.big span{width:24px;height:24px}.tg.big.on span{left:25px}
.item span.tag.t-neg{color:#fff}.item span.tag.t-mid{color:#7a5510}.item span.tag.t-pos{color:#2f7a4a}.item span.tag.t-ok{color:#2a4a7a}
.adesso{border-color:#e0b25b}.adx{padding:10px 0;border-bottom:1px solid var(--line)}.adx:last-of-type{border-bottom:0}.adx b{display:block;font-weight:600}.adx .tag{margin-top:4px}
.adx.dac{background:#fdf0ee;margin:0 -14px;padding:10px 14px;border-left:5px solid var(--bad)}.adb{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:8px}.adb .btn{padding:11px 8px;font-size:15px;text-decoration:none;text-align:center;min-height:46px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;justify-content:center}
.storia{margin-top:16px;border-top:1px solid var(--line);padding-top:12px}.storia ol{list-style:none;margin:8px 0 0;padding:0}.storia li{padding:7px 0;border-bottom:1px dashed var(--line);font-size:14px;line-height:1.4}.storia li span{color:var(--mist);margin-right:6px;font-variant-numeric:tabular-nums}.storia li small{display:block;color:#666}
.prx.dac{background:#fdf0ee;border-left:5px solid var(--bad)}.nbad{display:inline-grid;place-items:center;min-width:20px;height:20px;border-radius:10px;background:#c0392b;color:#fff;font:700 12px sans-serif;margin-left:4px;padding:0 5px}
.reglist{max-height:60vh;overflow:auto;border:1px solid var(--line);border-radius:8px;margin-top:10px;background:#fbf8f2}.rg{padding:8px 10px;border-bottom:1px solid var(--line);font-size:14px}.rg .h{font-size:12.5px;color:var(--mist)}.rg.neg{background:#fdf0ee}
details.cfg{margin:10px 0}details.cfg>summary{font:500 19px Georgia,serif;padding:14px 4px;cursor:pointer;list-style:none;border-bottom:1px solid var(--line)}details.cfg>summary::after{content:'›';float:right;transform:rotate(90deg);transition:.2s}details.cfg[open]>summary::after{transform:rotate(-90deg)}details.cfg>.card,details.cfg>h2+.card{margin-top:10px}details.cfg>h2{display:none}
.stx{padding:8px 0;border-bottom:1px solid var(--line)}.stx b{color:var(--ok)}.stx.no b{color:var(--bad)}.stx small{display:block;color:var(--mist);margin-top:3px}
.vbar{display:flex;background:#ece5d6;border-radius:10px;padding:3px;margin:0 0 12px}.vbar button{flex:1;border:0;background:none;padding:10px;border-radius:8px;font:600 14px sans-serif;color:var(--mist);cursor:pointer}.vbar button.on{background:#fff;color:var(--ink);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.btn.mini{padding:6px 12px;font-size:13px;float:right;margin-top:-2px}.pvt{flex:1;text-align:center;font:500 17px Georgia,serif;text-transform:capitalize}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px;max-width:760px}.cal i{font:600 11px sans-serif;text-align:center;color:var(--mist);font-style:normal;text-transform:uppercase;padding:2px 0}
.cd{min-height:64px;border:1px solid var(--line);background:#fff;border-radius:10px;display:flex;flex-direction:column;align-items:flex-start;justify-content:flex-start;gap:1px;cursor:pointer;position:relative;padding:6px 6px 8px;text-align:left;color:var(--ink);overflow:hidden}
.cd b{font:600 13px sans-serif;color:#555}.cd .cn{font:700 19px/1 sans-serif;color:var(--ink);margin-top:5px;white-space:nowrap}.cd .cn small{display:block;font:600 11px sans-serif;color:var(--ink);margin-top:1px}.cd small{font:11px/1.1 sans-serif;color:#555}.cd .cp{margin-top:2px}.cd .cz{margin-top:6px;font-style:italic}
.cd .cbar{position:absolute;left:6px;right:6px;bottom:5px;height:4px;border-radius:2px;background:#eee6d6}.cd .cbar i{display:block;height:100%;border-radius:2px;background:#3c8d5a}.cd .cbar i.a{background:#d68a1e}.cd .cbar i.r{background:#c0392b}
.leg b{font:700 12px sans-serif;color:var(--ink)}.leg .l-v,.leg .l-a,.leg .l-r{display:inline-block;width:14px;height:5px;border-radius:2px;margin-right:4px;vertical-align:middle}.leg .l-v{background:#3c8d5a}.leg .l-a{background:#d68a1e}.leg .l-r{background:#c0392b}
.cd em{position:absolute;top:4px;right:4px;background:#c0392b;color:#fff;border-radius:8px;font:700 10px sans-serif;padding:1px 5px;font-style:normal}
.cd.con{background:#fbf6ea;border-color:#d9c49a}.cd.oggi{border:2px solid var(--ink)}.cd.oggi b{color:var(--ink)}
.cd.chiuso{background:repeating-linear-gradient(135deg,#f6f3ec 0 6px,#efe9dd 6px 12px);color:var(--mist)}.cd.pass{opacity:.45}
.leg{display:flex;flex-wrap:wrap;gap:6px 14px;margin:10px 0 4px;font:12px sans-serif;color:#555}.leg span{display:flex;align-items:center;gap:5px}.leg i{width:14px;height:14px;border-radius:4px;border:1px solid var(--line);display:inline-block}
.leg .l-con{background:#fbf6ea;border-color:#d9c49a}.leg .l-q{background:#c0392b;border:0;height:4px;border-radius:2px}.leg .l-oggi{border:2px solid var(--ink)}.leg .l-ch{background:repeating-linear-gradient(135deg,#f6f3ec 0 3px,#efe9dd 3px 6px)}
h3.sub{font:600 15px sans-serif;margin:16px 0 8px}
@media(max-width:560px){.cd{min-height:78px;padding:5px 4px 10px}.cd .cn{font-size:16px}.cd .cn small{font-size:10px}.cd .cp{font-size:10px}.cd .cz{font-size:10px}}
.wd{display:block;width:100%;text-align:left;border:0;border-bottom:1px solid var(--line);background:none;padding:12px 2px;cursor:pointer;font:inherit}.wd:last-child{border-bottom:0}.wd b{display:block;font-weight:600}.wd span{color:var(--mist);font-size:14px}.wd em{color:#c0392b;font-style:normal;font-weight:600}.wd.oggi b{color:var(--gold)}
.prg{border-top:1px solid var(--line);margin-top:12px;padding-top:4px}.prg summary{font-weight:600;padding:10px 0;cursor:pointer;color:var(--ink)}
.pager{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:12px;font-size:14px}.pager .btn{padding:9px 12px;font-size:14px}.pager .btn[disabled]{opacity:.4}
</style></head><body>
<header><h1>Oltreconfini<small>Pannello</small></h1><nav id="tabs"></nav></header>
<main id="main"></main><div id="toast"></div><div id="busy">Un attimo…</div>
<script>
var PREN0=__PREN0__,PERM=__PERM__,RUOLO='__RUOLO__',SITO='__SITO__',CHIAVE='__CHIAVE__',IA='__IA__',TAB='__TAB__',PRR=__PRRIGHE__;
var AL=['Glutine','Crostacei','Uova','Pesce','Arachidi','Soia','Latte','Frutta a guscio','Sedano','Senape','Sesamo','Solfiti','Lupini','Molluschi'];
var CAT=['Antipasti','Primi','Secondi','Contorni','Dolci','Menù bimbi','Pizze','Pizze speciali'];
document.addEventListener('click',function(ev){var a=ev.target.closest('a[data-vai]');if(!a)return;ev.preventDefault();cur=a.dataset.vai;cerca='';tabs();apri()});
var SEZ={
 pren:{nome:'Prenotazioni'},
 oggi:{nome:'Menù settimana'},
 orari:{nome:'Orari'},
 piatti:{nome:'Piatti e pizze',titolo:'piatto',sotto:'ingredienti',gruppo:'categoria',ordina:true,unico:['piatto'],
  aiuto:'Tocca un piatto per cambiarlo. Le frecce cambiano l’ordine sul sito. Si scrive solo in italiano: le traduzioni si fanno da sole. <a href="#" data-vai="categorie">Categorie del menù (es. Dolci): traduzioni e prezzi →</a>',
  campi:[{h:'categoria',l:'Categoria',t:'scelta',o:CAT,aiutoCampo:'Per una categoria nuova (es. Dolci) scegli «＋ Nuova categoria…»: sul sito diventa una nuova scheda del menù, tradotta in automatico.'},{h:'piatto',l:'Nome del piatto',t:'text'},{h:'ingredienti',l:'Ingredienti',t:'textarea'},
   {h:'allergeni',l:'Allergeni',t:'allergeni'},{h:'prezzo',l:'Prezzo (sul sito si vede solo per le pizze; nel menù del QR si vedono tutti)',t:'number'},
   {h:'firma',l:'Piatto dello chef',t:'check',si:'sì',no:''},{h:'cos',l:'Cos’è? Spiegazione semplice (facoltativa)',t:'textarea'},{h:'foto',l:'Foto del piatto (facoltativa)',t:'foto'}]},
 eventi:{nome:'Eventi',titolo:'evento',sotto:'dal',ordina:false,unico:['evento'],
  aiuto:'Un evento compare in cima al menù del sito solo se è attivo e solo tra le due date.',
  campi:[{h:'attivo',l:'Attivo (si vede sul sito)',t:'check',si:'SÌ',no:'NO'},{h:'evento',l:'Nome dell’evento',t:'text'},
   {h:'dal',l:'Si vede dal',t:'date'},{h:'al',l:'Fino al (giorno dell’evento)',t:'date'},{h:'prezzo',l:'Prezzo a persona (vuoto se non c’è)',t:'number'},
   {h:'men',l:'Menù',t:'textarea',aiutoCampo:'Scrivi il titolo della portata con i due punti (es. <b>Antipasti:</b>) e sotto un piatto per riga. Se scrivi tutto di seguito, tocca «Metti in ordine»: il pannello va a capo da solo, tu controlla.'},{h:'note',l:'Note (facoltative)',t:'text'},
   {h:'sfondo',l:'Foto di sfondo del menù (facoltativa)',t:'sfondo',o:['Nessuna','Calici','Sala','Sala con archi','Seconda sala','Pizze nel forno','Parete dei vini','Bar','Ingresso'],aiutoCampo:'«Nessuna» = fondo blu elegante con cornice dorata. Con una foto il sito la scurisce da solo, così il menù resta leggibile. Puoi anche caricare una tua foto.'}]},
 avvisi:{nome:'Eventi in arrivo e avvisi',titolo:'testo',sotto:'tipo',ordina:false,
  aiuto:'Le feste e i temi dei prossimi mesi sono già pronti, con le date giuste: <b>accendi l’interruttore</b> di quelli che vuoi sul sito (spenti non si vedono). Puoi aggiungere promozioni, chiusure e ferie (annunciate due settimane prima), avvisi in alto sul sito e la pizza della settimana.',
  campi:[{h:'attivo',l:'Attivo (si vede sul sito)',t:'check',si:'SÌ',no:'NO'},{h:'tipo',l:'Cosa vuoi pubblicare?',t:'select',o:['Promozione','Chiusura','Orario speciale','Avviso','Pizza della settimana','Tema del sito']},
   {h:'dal',l:'Dal (da quando si vede)',t:'date'},{h:'al',l:'Al (compreso)',t:'date',vuoto:'Promozione: di solito il giorno prima dell\u2019evento. Pizza: lascia vuoto e resta 7 giorni.'},
   {h:'quando',l:'Quando siete chiusi?',t:'select',o:['Tutto il giorno','Chiuso a pranzo','Chiuso a cena'],se:{tipo:'Chiusura'}},
   {h:'pizza',l:'Quale pizza?',t:'pizza',se:{tipo:'Pizza della settimana'}},
   {h:'pranzo dal',l:'Pranzo dalle (vuoto = chiuso a pranzo)',t:'ora',se:{tipo:'Orario speciale'}},{h:'pranzo al',l:'Pranzo fino alle',t:'ora',se:{tipo:'Orario speciale'}},
   {h:'cena dal',l:'Cena dalle (vuoto = chiuso a cena)',t:'ora',se:{tipo:'Orario speciale'},aiutoCampo:'Per i giorni con un orario diverso dal solito (es. Vigilia: solo cena fino all’1). Il sito lo annuncia due settimane prima e il modulo di prenotazione lo rispetta.'},{h:'cena al',l:'Cena fino alle',t:'ora',se:{tipo:'Orario speciale'}},
   {h:'tema',l:'Quale tema?',t:'select',o:['Natale','Capodanno','San Valentino','Pasqua','Nessun tema'],se:{tipo:'Tema del sito'},aiutoCampo:'Logo con il cappello, bordi decorati e auguri in alto. Fuori dalle date scelte qui il sito usa le date automatiche (Natale 8–26 dicembre, Capodanno 27 dicembre–6 gennaio, San Valentino 7–14 febbraio, settimana di Pasqua) solo se in Configurazione → Sito i «Temi automatici» sono accesi. «Nessun tema» lo spegne per il periodo scelto.'},
   {h:'testo',l:'Titolo / testo',t:'text',max:60,ideale:32,aiutoCampo:'Promozione: il titolo grande, es. Cene di Natale. Chiusura: il motivo, es. Ferie invernali (facoltativo). Avviso: il testo da mostrare. Pizza: una frase che la racconta (facoltativa).'},
   {h:'sottotitolo',l:'Sottotitolo',t:'text',max:90,ideale:70,se:{tipo:'Promozione'},aiutoCampo:'Es.: La sala perfetta per il tuo team'},
   {h:'punti',l:'Punti forti, separati da ·',t:'text',max:80,ideale:65,se:{tipo:'Promozione'},aiutoCampo:'Es.: Sala privata · Menù personalizzati · Cucina & Pizzeria'},
   {h:'grafica',l:'Grafica sul sito (colori e decorazioni)',t:'select',o:['Automatica (dal titolo)','Natale','Capodanno','San Valentino','Pasqua','Festa della donna','Festa della mamma / del papà','Festa nazionale (tricolore)','Primavera','Estate','Halloween','Elegante (senza decorazioni)'],se:{tipo:'Promozione'},aiutoCampo:'«Automatica» sceglie da sola guardando il titolo (es. «Festa della mamma» → cuori, «Halloween» → zucche e pipistrelli). Se le promozioni attive sono più di una, il sito le mostra tutte: la più vicina in grande, le altre sotto, e nella barra in alto si alternano.'},
   {h:'foto',l:'Foto di sfondo',t:'sfondo',o:['Calici','Sala','Sala con archi','Seconda sala','Pizze nel forno','Parete dei vini','Bar','Ingresso'],se:{tipo:'Promozione'},aiutoCampo:'Tocca una delle foto del locale oppure «La tua foto» per caricarne una dal telefono (meglio orizzontale e luminosa: il testo ci va sopra).'}]},
 vini:{nome:'Vini',titolo:'vino',sotto:'produttore',gruppo:'categoria',ordina:true,unico:['vino','produttore'],
  aiuto:'La carta dei vini del menù del QR, con i prezzi: sul sito è divisa per regione, da nord a sud. Scegli sempre la regione.',
  campi:[{h:'categoria',l:'Categoria',t:'scelta',o:['Bollicine','Vini bianchi','Vini rosati','Vini rossi']},{h:'regione',l:'Regione',t:'scelta'},{h:'vino',l:'Vino',t:'text'},{h:'produttore',l:'Produttore',t:'text'},
   {h:'prezzo bott',l:'Prezzo della bottiglia € (75 cl)',t:'number'},
   {h:'prezzo mezza',l:'Prezzo della mezza bottiglia € (37,5 cl) — vuoto se non c’è',t:'number'},
   {h:'prezzo cal',l:'Prezzo al calice € (vuoto se non si serve al calice)',t:'number'},{h:'descrizione',l:'Descrizione (solo italiano)',t:'textarea'}]},
 bevande:{nome:'Bevande',titolo:'bevanda',sotto:'prezzo',gruppo:'gruppo',ordina:true,unico:['bevanda'],
  aiuto:'Acqua, bibite, birre, caffetteria, cocktail e distillati, con i prezzi: si vedono nel menù del QR.',
  campi:[{h:'gruppo',l:'Gruppo',t:'scelta'},{h:'bevanda',l:'Bevanda (con il formato, es. 0,4 l)',t:'text'},{h:'prezzo',l:'Prezzo €',t:'text',aiutoCampo:'Es.: 3,50 — se ci sono due misure: 7 / 9'}]},
 opinioni:{nome:'Opinioni'},
 impost:{nome:'Configurazione'},
 categorie:{nome:'Categorie del menù',nascosta:true,titolo:'categoria',sotto:'en',ordina:true,unico:['categoria'],
  aiuto:'Le categorie aggiunte (es. Dolci): compaiono sul sito dopo le pizze, nell’ordine di questa lista. Le traduzioni si correggono qui. Una categoria senza piatti non si vede. <a href="#" data-vai="piatti">← Torna ai piatti</a>',
  campi:[{h:'categoria',l:'Nome (italiano)',t:'text'},{h:'en',l:'In inglese',t:'text'},{h:'de',l:'In tedesco',t:'text'},{h:'fr',l:'In francese',t:'text'},{h:'prezzi',l:'Prezzi visibili anche sul sito (nel menù del QR si vedono sempre)',t:'check',si:'sì',no:'no'}]},
 faq:{nome:'Domande',titolo:'domanda',sotto:'risposta',ordina:true,unico:['domanda'],aiuto:'Le domande frequenti del sito.',
  campi:[{h:'domanda',l:'Domanda',t:'text'},{h:'risposta',l:'Risposta',t:'textarea'}]}
};
var cur=TAB==='oggi'?'oggi':'pren',DATA={},PIZZE=[],cerca='';
function $(s){return document.querySelector(s)}
function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
// conferme e domande dentro il pannello (niente finestre del browser con indirizzi strani)
// o: {t:titolo, d:testo, ok:'testo del pulsante', alt:'seconda scelta', no:'Annulla' (false = nessuno), pericolo:true, campo:{tipo:'number'|'text'|'textarea', v:'valore'}}
function chiedi(o,cb){var w=document.createElement('div');w.className='dlg';w.setAttribute('role','dialog');w.setAttribute('aria-modal','true');
  var c=o.campo,campo=!c?'':c.tipo==='textarea'?'<textarea id="dlg-in" rows="4">'+e(c.v||'')+'</textarea>':'<input id="dlg-in" type="'+(c.tipo==='number'?'number':'text')+'"'+(c.tipo==='number'?' inputmode="numeric" min="1" max="180"':'')+' value="'+e(c.v||'')+'">';
  w.innerHTML='<div class="dlg-b"><b>'+e(o.t)+'</b>'+(o.d?'<p>'+e(o.d)+'</p>':'')+campo+'<div class="dlg-r">'+(o.no===false?'':'<button class="btn light" data-v="no">'+e(o.no||'Annulla')+'</button>')+(o.alt?'<button class="btn light" data-v="alt">'+e(o.alt)+'</button>':'')+'<button class="btn '+(o.pericolo?'danger':'gold')+'" data-v="ok">'+e(o.ok||'OK')+'</button></div></div>';
  document.body.appendChild(w);var inp=w.querySelector('#dlg-in');try{(inp||w.querySelector('[data-v=ok]')).focus();if(inp&&inp.select)inp.select()}catch(x){}
  var fine=function(v){if(!w.parentNode)return;w.remove();document.removeEventListener('keydown',k);if(cb)cb(v,inp?inp.value:null)};
  var k=function(ev){if(ev.key==='Escape')fine('no');else if(ev.key==='Enter'&&inp&&inp.tagName==='INPUT'){ev.preventDefault();fine('ok')}};document.addEventListener('keydown',k);
  w.onclick=function(ev){if(ev.target===w)return fine('no');var b=ev.target.closest('button[data-v]');if(b)fine(b.dataset.v)}}
function msgs(){var c=$('#msgs');if(!c){c=document.createElement('div');c.id='msgs';document.body.appendChild(c)}var t=$('#toast');if(t&&t.parentNode!==c)c.appendChild(t);var y=$('#sync');if(y&&y.parentNode!==c)c.insertBefore(y,c.firstChild);c.classList.toggle('alto',!!document.querySelector('.sw-bar,.adb-fissa'));return c}
// un solo messaggio alla volta: il nuovo sostituisce il vecchio, mai sovrapposti
function toast(m,err){var c=msgs(),t=$('#toast');if(!t){t=document.createElement('div');t.id='toast';c.appendChild(t)}m=String(m==null?'':m);clearTimeout(t._t);if(t.style.display!=='block'||t.textContent!==m){t.textContent=m;t.style.animation='none';void t.offsetWidth;t.style.animation=''}t.className=(err||/^(errore|non |impossibile|attenzione)/i.test(m))?'err':'';t.style.display='block';t.onclick=function(){clearTimeout(t._t);t.style.display='none'};t._t=setTimeout(function(){t.style.display='none'},Math.min(7000,Math.max(3000,m.length*55)))}
// menù di un evento: dal testo libero alle portate {h: titolo, items: [piatti]} — funziona anche se è scritto tutto su una riga
function menuSezioni(txt, lang){
  var HEAD=/^(benvenut|antipast|prim[oi]$|second[oi]$|dolc[ei]|dessert|contorn|formagg|frutta|brindisi|caff[eè]|vin[oi]$|bevand|abbinament|amuse|aperitiv|portat|zupp|welcome|appetizer|starter|first$|second$|main$|sides?$|pairing|midnight|wines?$|drinks?$|cheeses?$|begrüßung|vorspeise|erster|zweiter|haupt|nachspeise|nachtisch|empfehlung|mitternacht|getränk|beilage|käse|message|mot$|entrées?$|plats?$|fromages?$|accord|minuit|mezzanott|boissons?$)/i;
  var FUNC=/^(e|ed|di|del|dello|della|dei|degli|delle|al|allo|alla|ai|agli|alle|con|in|su|sul|sulla|a|da|dal|dallo|dalla|per|il|lo|la|i|gli|le|un|una|uno|o|and|with|of|on|in|the|a|an|or|et|de|du|des|au|aux|à|avec|sur|le|la|les|en|ou)$/i;
  var EXC=/^(smith|golden|granny|delicious|parmigiano|reggiano|grana|padano|pecorino|romano|sardo|bra|bronte|pachino|chianina|fassona|piemontese|wagyu|angus|cinta|senese|mora|romagnola|dop|igp|doc|docg|carnaroli|vialone|nano|castelmagno|gorgonzola|taleggio|asiago|montasio|valtellina|casera|bitto|norcia|colonnata|arnad|san|daniele|parma|tropea|duchessa|duchess|bufala|campana|sorrento|amalfi|cetara|mazara|sicilia|piemonte|ligure|genovese|milanese|romana|napoletana|bolognese|catalana|magliocco|champagne|franciacorta|prosecco|barolo|chianti|amarone|nebbiolo|barbera|lambrusco|moscato|brut|bellavista|chef|bernese|hollandaise|perigord|périgord|alba|cervia|trapani|lessinia|monte|veronese|sbrinz|emmental|brie|camembert|roquefort|stilton|cheddar|feta|philadelphia|nutella|grand|marnier|cointreau|baileys|marsala|porto|madeira|sherry|cognac|armagnac|calvados|aperol|campari|martini|spritz|negroni|bellini|rossini|wellington|stroganoff|tatin|mont|blanc|suzette|melba|sacher|linzer|foresta|nera|black|forest|new|york|sant|santo|santa)$/i;
  var cap=function(s){s=String(s||'').replace(/^[\s•·\-–—*,.;:]+|[\s,;]+$/g,'').replace(/\.$/,'');return s?s.charAt(0).toUpperCase()+s.slice(1):''};
  // 1) un piatto per pezzo
  var piatti=function(body){var out=[];
    String(body||'').split(/\s*(?:\n|;|•|·|\|)\s*|\s+[-–—]\s+/).forEach(function(p){
      p.replace(/([a-zà-ÿ)\]])\.\s+(?=[A-ZÀ-Ý])/g,'$1.\u0001').split('\u0001').forEach(function(q){
        q=q.trim();if(!q)return;
        if(lang==='de'){out.push(q);return}
        var w=q.split(/\s+/),seg=[w[0]];
        for(var i=1;i<w.length;i++){var a=w[i],b=w[i-1];
          if(/^[A-ZÀ-Ý][a-zà-ÿ'’]/.test(a)&&/^[a-zà-ÿ][a-zà-ÿ'’]*[a-zà-ÿ]$/.test(b)&&!FUNC.test(b)&&!EXC.test(a.replace(/[^A-Za-zÀ-ÿ]/g,''))&&seg.length>=2){out.push(seg.join(' '));seg=[a]}
          else seg.push(a)}
        out.push(seg.join(' '))})});
    return out.map(cap).filter(Boolean)};
  // 2) titoli delle portate: «Antipasti:», «Benvenuto dallo chef:», «In abbinamento:»
  var pezzi=function(line){var res=[],re=/([A-Za-zÀ-ÿ'’)])\s*:(?=\s|$)/g,m,from=0,cur={h:null,start:0};
    while((m=re.exec(line))){var end=m.index+1,pre=line.slice(from,end),w=pre.split(/\s+/).filter(Boolean),n=w.length,k=-1;
      for(var j=n-1;j>=Math.max(0,n-4);j--){if(HEAD.test(w[j].replace(/[^A-Za-zÀ-ÿ]/g,''))){k=j;break}}
      if(k>=0)while(k>0&&n-k<5&&/^(in|a|al|alla|il|la|our|the|nostro|nostra|le|du)$/i.test(w[k-1])&&/^[A-ZÀ-Ý]/.test(w[k-1]))k--;
      if(k<0&&from===0&&n<=4&&/^[A-ZÀ-Ý]/.test(w[0]))k=0;
      if(k<0&&n&&/^[A-ZÀ-Ý]/.test(w[n-1])&&(n===1||!/^[A-ZÀ-Ý]/.test(w[n-2])))k=n-1;
      if(k<0)continue;
      var lab=w.slice(k).join(' '),bodyPrev=w.slice(0,k).join(' ');
      res.push({h:cur.h,body:(cur.pre||'')+(cur.pre&&bodyPrev?' ':'')+bodyPrev});
      cur={h:lab.replace(/\s*$/,'')};from=re.lastIndex;cur.pre=''}
    res.push({h:cur.h,body:(cur.pre||'')+line.slice(from)});
    return res.filter(function(p){return p.h!==null||p.body.trim()})};
  var out=[],sez=null,inl=false;
  String(txt||'').slice(0,4000).split(/\r?\n/).forEach(function(line){line=line.trim();if(!line)return;
    pezzi(line).forEach(function(p){
      if(p.h!==null){sez={h:cap(p.h),items:[]};out.push(sez);inl=!!p.body.trim()}
      else if(!sez||inl){sez={h:'',items:[]};out.push(sez);inl=false}
      sez.items=sez.items.concat(piatti(p.body))})});
  return out.filter(function(s){return s.h||s.items.length}).slice(0,16).map(function(s){s.items=s.items.slice(0,20);return s});
}
// lo stesso menù riscritto bene: titolo con i due punti, poi un piatto per riga
function menuInOrdine(txt){return menuSezioni(txt,'it').map(function(s){return (s.h?s.h+':\n':'')+s.items.join('\n')}).join('\n\n')}
function suTop(){try{window.scrollTo(0,0)}catch(e){}try{document.body.scrollIntoView({block:'start'})}catch(e){}}
// blocca subito i doppi tocchi, ma mostra «Un attimo…» solo se Google ci mette più di mezzo secondo
function busy(on){var b=$('#busy');clearTimeout(busy.t);if(!on){b.style.display='none';b.classList.remove('vis');return}b.classList.remove('vis');b.style.display='flex';busy.t=setTimeout(function(){b.classList.add('vis')},450)}
function call(fn,args,ok,ko){busy(true);var fatto=false,sv=setTimeout(function(){if(!fatto){busy(false);toast('Google risponde lentamente: attendi qualche secondo o ricarica la pagina')}},45000);
  var r=google.script.run.withSuccessHandler(function(x){fatto=true;clearTimeout(sv);busy(false);try{ok(x)}catch(e){erroreUI(e)}}).withFailureHandler(function(err){fatto=true;clearTimeout(sv);busy(false);var m=String(err&&err.message||err||'');if(ko)try{ko(m)}catch(e){}
    toast(/ricarica/i.test(m)?m:'Non è stato possibile completare: '+m.replace(/^Exception:\s*/,''));
    if(/ricarica/i.test(m))setTimeout(function(){DATA={};if(cur==='opinioni')OPN=null;tabs();apri()},1800)});r.api(CHIAVE,fn,args||[])}
// qualsiasi imprevisto nella pagina: niente schermata bloccata, solo un avviso
function erroreUI(e){busy(false);var b=$('#ok');if(b)b.disabled=false;toast('Qualcosa non è andato: riprova. Se succede ancora, ricarica la pagina (i dati salvati non si perdono).');try{console.error(e)}catch(x){}}
window.addEventListener('error',function(ev){erroreUI(ev.error||ev.message)});window.addEventListener('unhandledrejection',function(ev){erroreUI(ev.reason)});
function key(headers,h){for(var i=0;i<headers.length;i++)if(headers[i].toLowerCase().indexOf(h)===0)return headers[i];return null}
var SFONDI={'Calici':'calici','Sala':'sala-tavoli','Sala con archi':'sala-archi','Seconda sala':'seconda-sala','Pizze nel forno':'pizze-forno','Parete dei vini':'parete-vini','Bar':'bar-aperitivo','Ingresso':'ingresso'};
function fotoUrl(v){return /^[a-z0-9-]+$/.test(v)&&v.length<40?SITO+'media/foto/'+v+'-480.webp':'https://lh3.googleusercontent.com/d/'+v+'=w400'}
// rimpicciolisce la foto nel telefono (max 1400 px) e la manda a Drive
function caricaFoto(inp){var box=inp.closest('.foto,.sf'),file=inp.files[0],url=URL.createObjectURL(file),im=new Image();
  im.onload=function(){var r=Math.min(1,1400/Math.max(im.width,im.height)),c=document.createElement('canvas');c.width=Math.round(im.width*r);c.height=Math.round(im.height*r);
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);URL.revokeObjectURL(url);var b64=c.toDataURL('image/jpeg',.85).split(',')[1];
    var nome=(document.querySelector('#frm [data-k^="Piatto"],#frm [data-k^="piatto"],#frm [data-k^="Testo"],#frm [data-k^="testo"]')||{}).value||'foto';
    if(box.classList.contains('sf')){var u=box.querySelector('.sfu');u.innerHTML='<span>Carico…</span>';toast('Carico la foto…')}
    call('apiCaricaFoto',[b64,nome],function(id){box.dataset.v=id;
      if(box.classList.contains('sf')){box.querySelectorAll('.sfo').forEach(function(b){b.classList.remove('on')});var u=box.querySelector('.sfu');u.classList.add('on');u.innerHTML='<img src="'+fotoUrl(id)+'" alt=""><span>📷 La tua foto · cambia</span><input type="file" accept="image/*" hidden>'}
      else{box.querySelector('.fprev').innerHTML='<img src="'+fotoUrl(id)+'" alt="">';box.querySelector('[data-xf]').style.display=''}
      toast('Foto caricata ✓ Ora tocca Salva')},function(){if(box.classList.contains('sf'))box.querySelector('.sfu').innerHTML='<span>📷 La tua foto</span><input type="file" accept="image/*" hidden>'})};
  im.onerror=function(){toast('Questa foto non si apre: provane un\'altra')};im.src=url}
function toIso(s){var m=String(s||'').match(/(\d{1,2})\D(\d{1,2})\D(\d{4})/);return m?m[3]+'-'+('0'+m[2]).slice(-2)+'-'+('0'+m[1]).slice(-2):''}
function fromIso(s){var m=String(s||'').match(/(\d{4})-(\d{2})-(\d{2})/);return m?m[3]+'/'+m[2]+'/'+m[1]:''}
function alNum(s){return String(s||'').split(/[^\d]+/).map(Number).filter(function(n){return n>=1&&n<=14})}
function alTxt(a){a=a.slice().sort(function(x,y){return x-y});return a.length>1?a.slice(0,-1).join(', ')+' e '+a[a.length-1]:(a[0]?String(a[0]):'')}
function tabs(){$('#tabs').innerHTML=Object.keys(SEZ).filter(function(k){return !SEZ[k].nascosta||k===cur}).map(function(k){return '<button class="'+(k===cur?'on':'')+'" data-k="'+k+'">'+SEZ[k].nome+'</button>'}).join('')}
$('#tabs').onclick=function(ev){var b=ev.target.closest('button');if(!b)return;cur=b.dataset.k;cerca='';tabs();apri()};
/* ---- orari della settimana e regole per prenotazioni/asporto ---- */
var GIORNI=['Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato','Domenica'];
function orari(){if(DATA.orari&&DATA.regole){mostraOrari(DATA.orari,DATA.regole);rinfresca('orari');rinfresca('regole');return}call('apiLeggi',['orari'],function(o){DATA.orari=o;memo('orari');call('apiLeggi',['regole'],function(rg){DATA.regole=rg;memo('regole');mostraOrari(o,rg)})})}
function mostraOrari(o,rg){(function(){var H=o.headers,k=function(h){return key(H,h)};
  var h='<h2>Orari di apertura</h2><p class="hint">Lascia vuoto per «chiuso». Il sito mostra questi orari, il modulo di prenotazione e l’asporto propongono solo gli orari possibili. Per un giorno diverso dal solito (festività, eventi) usa «Eventi in arrivo e avvisi» → Chiusura o Orario speciale.</p><div class="card" id="orf">';
  if(!o.rows.length||!k('pranzo dal')){h+='<p class="hint">La scheda «Orari» non c’è ancora: nello script esegui «installa».</p></div>';$('#main').innerHTML=h;return}
  o.rows.forEach(function(r,i){h+='<div class="orr" data-i="'+i+'"><b>'+e(r[k('giorno')])+'</b><div class="orc"><span>Pranzo</span><input type="time" step="900" data-k="'+e(k('pranzo dal'))+'" value="'+e(r[k('pranzo dal')])+'"><span>–</span><input type="time" step="900" data-k="'+e(k('pranzo al'))+'" value="'+e(r[k('pranzo al')])+'"><button class="btn light x" data-x="p">chiuso</button></div>'+
    '<div class="orc"><span>Cena</span><input type="time" step="900" data-k="'+e(k('cena dal'))+'" value="'+e(r[k('cena dal')])+'"><span>–</span><input type="time" step="900" data-k="'+e(k('cena al'))+'" value="'+e(r[k('cena al')])+'"><button class="btn light x" data-x="c">chiuso</button></div></div>'});
  h+='<div class="row"><button class="btn gold" id="orsave">Salva gli orari</button></div></div><p class="hint">Le regole (ultima prenotazione, preavviso, asporto) sono in Configurazione.</p>';$('#main').innerHTML=h;
  $('#orf').onclick=function(ev){var b=ev.target.closest('button[data-x]');if(!b)return;b.parentNode.querySelectorAll('input').forEach(function(x){x.value=''})};
  $('#orsave').onclick=function(){var lav=[];
    document.querySelectorAll('#orf .orr').forEach(function(row){var i=+row.dataset.i,orig=o.rows[i],nv={},cambiato=false,a=row.querySelectorAll('input');
      for(var j=0;j<a.length;j+=2){if(!!a[j].value!==!!a[j+1].value){toast(orig[k('giorno')]+': indica sia l’apertura sia la chiusura (o lascia vuoti entrambi)');lav=null;return}}
      a.forEach(function(x){nv[x.dataset.k]=x.value;if(String(orig[x.dataset.k]||'')!==x.value)cambiato=true});if(lav&&cambiato)lav.push(['orari',i,nv,orig])});
    if(!lav)return;
    if(!lav.length){toast('Nessuna modifica');return}
    lav.forEach(function(x){var oc=copia(x[3]);Object.assign(DATA[x[0]].rows[x[1]],x[2]);accoda(x[0],'apiSalva',[x[0],x[1],x[2],null,oc])});mostraOrari(DATA.orari,DATA.regole)}})()}
/* ---- pannello istantaneo: i dati restano sul telefono e le modifiche partono in sottofondo ---- */
var SEZM=['piatti','categorie','eventi','avvisi','vini','bevande','faq','prezzi','orari','regole'],CODA=[],INVIO=false,AGG={};
function memo(k){try{localStorage.setItem('pn1-'+k,JSON.stringify({t:Date.now(),d:k==='__oggi'?OGGI:DATA[k]}))}catch(e){}}
function memoLeggi(){SEZM.concat(['__oggi']).forEach(function(k){try{var o=JSON.parse(localStorage.getItem('pn1-'+k)||'null');if(!o||!o.d)return;if(k==='__oggi')OGGI=o.d;else if(o.d.headers)DATA[k]=o.d}catch(e){}})}
function inCoda(sez){return CODA.some(function(x){return x.sez===sez})}
function inLista(sez){return cur===sez&&!$('#frm')&&!$('#orf')}
function stato(html,cls){var p=$('#sync');if(!p){p=document.createElement('div');p.id='sync';msgs().insertBefore(p,msgs().firstChild)}msgs();p.className='sync '+(cls||'');p.innerHTML=html;p.style.display=html?'flex':'none'}
// mette in fila una modifica: la lista è già aggiornata sul telefono, Google la riceve dietro le quinte
function accoda(sez,fn,args,fatto){CODA.push({sez:sez,fn:fn,args:args,fatto:fatto});if(DATA[sez])memo(sez);avanti()}
function avanti(){
  if(INVIO)return;
  if(!CODA.length){stato('Salvato ✓ <small>sul sito tra pochi minuti</small>','ok');clearTimeout(avanti.t);avanti.t=setTimeout(function(){if(!CODA.length&&!INVIO)stato('')},3500);return}
  INVIO=true;var op=CODA[0];stato('<span class="spin"></span> Salvataggio…'+(CODA.length>1?' ('+CODA.length+')':''),'');
  google.script.run.withSuccessHandler(function(r){INVIO=false;CODA.shift();
      if(r&&r.headers&&!inCoda(op.sez)){DATA[op.sez]=r;memo(op.sez);if(inLista(op.sez))lista()}
      try{if(op.fatto)op.fatto(r)}catch(e){}avanti()})
    .withFailureHandler(function(err){INVIO=false;var m=String(err&&err.message||err||'').replace(/^Exception:\s*/,'');
      if(/ricarica/i.test(m)){annulla(op.sez,m);return}
      stato('⚠ Non salvato: '+e(m||'connessione assente')+' <button id="sy-r">Riprova</button><button id="sy-a">Annulla</button>','err');
      $('#sy-r').onclick=function(){avanti()};$('#sy-a').onclick=function(){annulla(op.sez,'Modifica annullata')}})
    .api(CHIAVE,op.fn,op.args)}
// toglie le modifiche non riuscite di una sezione e ricarica i dati veri da Google
function annulla(sez,m){CODA=CODA.filter(function(x){return x.sez!==sez});toast(m);stato('');
  if(SEZM.indexOf(sez)<0){if(sez==='opinioni'){OPN=null;if(cur==='opinioni')opinioni()}if(sez==='oggi'&&cur==='oggi')oggi();avanti();return}
  call('apiLeggi',[sez],function(d){DATA[sez]=d;memo(sez);if(cur===sez)apri();avanti()})}
window.addEventListener('beforeunload',function(ev){if(CODA.length||INVIO){ev.preventDefault();ev.returnValue=''}});
// aggiorna una sezione in sottofondo (senza rotellina) e ridisegna solo se è cambiato qualcosa
function rinfresca(sez){if(SEZM.indexOf(sez)<0||inCoda(sez)||AGG[sez]&&Date.now()-AGG[sez]<30000)return;AGG[sez]=Date.now();
  google.script.run.withSuccessHandler(function(d){if(!d||!d.headers||inCoda(sez)||(cur===sez&&($('#frm')||$('#orf'))))return;var nuovo=JSON.stringify(d)!==JSON.stringify(DATA[sez]);DATA[sez]=d;memo(sez);if(nuovo&&inLista(sez))lista()}).withFailureHandler(function(){}).api(CHIAVE,'apiLeggi',[sez])}
function riga(H,o){var r={};H.forEach(function(h){r[h]=''});Object.keys(o).forEach(function(k){r[k]=o[k]});return r}
function copia(x){return JSON.parse(JSON.stringify(x))}
/* ---- impostazioni: persone, promemoria, sito (niente più modifiche al codice) ---- */
var PESCE=/gamber|scamp|pesce|tonn|salmon|baccal|merluzz|branzin|spigol|orata|spada|cozz|vongol|polp|calamar|seppi|totan|frutti di mare|ricciol|cernia|sogliol|rombo|trota|acciug|alic[ie]\b|sard[ei]|sgombr|capesant|ostric|aragost|astice|mazzancoll|nasello|platessa|persico|lavarello|coregone/,DUBBIE=[];
function controllaOggi(p,s,wd,opz){opz=opz||{};var w=[],rp=String(p||'').split(/\r?\n/).map(function(x){return x.replace(/^[\s•·\-–*]+/,'').trim()}).filter(Boolean),rs=String(s||'').split(/\r?\n/).map(function(x){return x.replace(/^[\s•·\-–*]+/,'').trim()}).filter(Boolean),V=vocab('piatti');
  var PRI=/pasta|spaghett|linguin|penne|rigaton|paccher|fusill|bucatin|risott|gnocch|lasagn|raviol|tortell|tagliatell|pappardell|orecchiett|trofie|zupp|minestr|vellutat|crema di|passato di|cannellon|maltagliat|strozzapret/,
      SEC=/arrost|grigli|filett|tagliata|cotolett|scaloppin|brasat|bollit|spezzatin|polpett|branzin|orata|salmon|baccal|pollo|maiale|manzo|vitell|conigli|agnell|frittura|fritto|trancio|scamon|costat|stinc|salsicc|hamburger|involtin|seppie|polpo|calamar/;
  
  if(rp.length>8)w.push('Ci sono '+rp.length+' primi: il sito ne mostra al massimo 8.');if(rs.length>8)w.push('Ci sono '+rs.length+' secondi: il sito ne mostra al massimo 8.');
  var tutti=rp.concat(rs),visti={};tutti.forEach(function(x){var n=nrm(x);if(visti[n])w.push('«'+x+'» è scritto due volte.');visti[n]=1});
  tutti.forEach(function(x){if(/\d+([.,]\d+)?\s*(€|euro)/i.test(x))w.push('«'+x+'»: i prezzi non vanno nei piatti, si impostano in «Prezzi delle formule».');
    else if(x.replace(/[^A-Za-zÀ-ÿ]/g,'').length<4)w.push('«'+x+'» sembra incompleto.')});
  rp.forEach(function(x){var n=nrm(x);if(SEC.test(n)&&!PRI.test(n))w.push('«'+x+'» sembra un secondo: è giusto tra i primi?')});
  rs.forEach(function(x){var n=nrm(x);if(PRI.test(n)&&!SEC.test(n))w.push('«'+x+'» sembra un primo: è giusto tra i secondi?')});
  if(!opz.noPesce)tutti.forEach(function(x){if(PESCE.test(nrm(x))&&!/\*/.test(x))w.push('«'+x+'»: se pesce o frutti di mare sono surgelati, per legge va indicato con * (es. Linguine allo scoglio*).')});
  if(!opz.noRefusi)refusi(tutti.join(' '),V).forEach(function(x){DUBBIE.push(x[0]);w.push((x[1]?'«'+x[0]+'» è scritto bene? Forse intendevi «'+x[1]+'».':'«'+x[0]+'»: parola che non conosco, controlla che sia scritta bene.'))});
  try{var O=DATA.orari,gg=['lun','mar','mer','gio','ven','sab','dom'][wd!=null?wd:(new Date().getDay()+6)%7];if(O&&tutti.length){var kg=key(O.headers,'giorno'),kp=key(O.headers,'pranzo dal'),r=O.rows.filter(function(x){return nrm(x[kg]).slice(0,3)===gg})[0];if(r&&!r[kp])w.push('secondo la scheda Orari quel giorno a pranzo siete chiusi: il menù si vedrà lo stesso.')}}catch(x){}
  return w.slice(0,8)}
function impVal(k){var R=DATA.regole;if(!R)return '';var kC=key(R.headers,'chiave'),kV=key(R.headers,'valore'),r=R.rows.filter(function(x){return String(x[kC]||'').toLowerCase()===k.toLowerCase()})[0];return r?String(r[kV]||''):''}
function impSet(k,v){var R=DATA.regole;if(R){var kC=key(R.headers,'chiave'),kV=key(R.headers,'valore'),r=R.rows.filter(function(x){return String(x[kC]||'').toLowerCase()===k.toLowerCase()})[0];if(r)r[kV]=v;else{var n={};n[kC]=k;n[kV]=v;R.rows.push(n)}}accoda('regole','apiImpostazione',[k,v])}
var RUOLI={editor:'Pannello completo',lettore:'Solo opinioni'};
// CONFIGURAZIONE: tutte le impostazioni in un posto solo (solo titolare e vice)
function impost(){if(!DATA.regole){call('apiLeggi',['regole'],function(d){DATA.regole=d;memo('regole');impost()});return}
  var GG=['lun','mar','mer','gio','ven','sab','dom'],gg=(impVal('Promemoria giorni')||'sab,dom,lun').toLowerCase(),rg=DATA.regole,kC=key(rg.headers,'chiave'),kV=key(rg.headers,'valore');
  var sez=function(id,titolo,corpo,aperto){return '<details class="cfg"'+(aperto?' open':'')+' id="'+id+'"><summary>'+titolo+'</summary><div class="card">'+corpo+'</div></details>'};
  var temiAuto=/^s/i.test(impVal('Temi automatici')||'no');
  var h='<h2>Configurazione</h2><p class="hint">Tutte le impostazioni del sito e del pannello. Tocca un titolo per aprirlo.</p>'+
   sez('c-st','Controllo del sistema','<p class="hint">Versione del pannello: <b>13 novembre 2026 · 18</b>. Verifica che sito, prenotazioni ed email funzionino.</p>'+
     '<div class="card" style="padding:14px;margin:0 0 14px"><b>Indirizzo del sistema (App web)</b><p class="hint" style="margin:6px 0 10px">È l’indirizzo a cui il sito manda prenotazioni e opinioni. In Apps Script: <b>Esegui il deployment → Gestisci deployment</b> → copia l’<b>URL</b> dell’App web (finisce con <b>/exec</b>) e incollalo qui. Si salva solo se la prova riesce.</p>'+
     '<input type="url" id="st-url" placeholder="https://script.google.com/macros/s/…/exec" autocomplete="off" spellcheck="false"><div class="row"><button class="btn gold" id="st-url-ok">Prova e salva</button></div><p class="hint" id="st-url-m" style="margin-top:8px"></p></div>'+
     '<div id="st-box"></div><div class="row"><button class="btn gold" id="st-ok">Controlla ora</button></div>',true)+
   sez('c-sito','Sito','<label>Indirizzo del sito</label><input type="url" id="im-sito" placeholder="https://oltreconfini.it" value="'+e(impVal('Indirizzo del sito'))+'"><p class="hint">I link nelle email ai clienti («La tua prenotazione») portano qui. Quando il sito cambia indirizzo, scrivi quello nuovo.</p>'+
     '<label>Link per lasciare una recensione su Google</label><input type="url" id="im-rec" placeholder="https://g.page/r/…/review" value="'+e(impVal('Link recensioni Google'))+'"><p class="hint">Dalla scheda Google dell’attività: «Chiedi recensioni» → copia il link.</p>'+
     '<div class="row"><button class="btn gold" id="im-ok">Salva</button></div>'+
     '<div class="sw2" style="margin-top:16px"><span>Temi automatici nelle date classiche</span><button class="tg big'+(temiAuto?' on':'')+'" id="im-temi" aria-label="Temi automatici"><span></span></button></div><p class="hint">Spento (consigliato): il sito usa solo i temi accesi in «Eventi in arrivo e avvisi», dove li trovi già pronti con le date.</p>')+
   sez('c-prom','Promemoria del menù della settimana','<p class="hint">Un’email a chi ha il promemoria acceso, nei giorni scelti, solo se il menù della settimana non è ancora scritto. Si accende e si spegne anche dalla scheda «Menù settimana».</p>'+
     '<div class="orc"><span>Dalle</span><input type="time" step="1800" id="pr-da" value="'+e(impVal('Promemoria dalle')||'09:30')+'"><span>alle</span><input type="time" step="1800" id="pr-a" value="'+e(impVal('Promemoria alle')||'12:00')+'"></div>'+
     '<div class="al" id="pr-gg">'+GG.map(function(g){return '<label><input type="checkbox" value="'+g+'" '+(gg.indexOf(g)>=0?'checked':'')+'> '+g+'</label>'}).join('')+'</div>'+
     '<div class="row"><button class="btn gold" id="pr-ok">Salva promemoria</button></div>')+
   '<details class="cfg" id="c-pren"><summary>Prenotazioni</summary>'+impPrenHTML()+'</details>'+
   sez('c-reg','Regole di prenotazione e asporto','<p class="hint">In minuti. Esempio: chiusura alle 23:00 e «ultima prenotazione» 45 → l’ultimo orario prenotabile è 22:15.</p><div id="rgf">'+
     rg.rows.map(function(r,i){return /\((minuti|giorni)/i.test(r[kC]||'')?'<label>'+e(r[kC])+'</label><input type="text" inputmode="numeric" data-i="'+i+'" value="'+e(r[kV])+'">':''}).join('')+
     '</div><div class="row"><button class="btn gold" id="rg-ok">Salva le regole</button></div>')+
   sez('c-pers','Persone e permessi','<div id="pers"><p class="hint">Carico…</p></div>')+
   sez('c-rg','Registro: chi ha fatto cosa sulle prenotazioni','<div id="reg"><p class="hint">Si apre qui: ogni prenotazione creata, modificata, segnata come arrivata, liberata o annullata, con l’ora e la persona.</p></div>');
  $('#main').innerHTML=h;impPrenAttiva();
  var crg=$('#c-rg');if(crg)crg.addEventListener('toggle',function(){if(crg.open&&!crg.dataset.ok){crg.dataset.ok='1';mostraRegistro({})}});
  // il controllo completo dura qualche secondo: si rifà da solo al massimo ogni 10 minuti (o con «Controlla ora»)
  var mostraSt=function(L){if(!$('#st-box'))return;var U=L.filter(function(x){return x.campo})[0]||{};if(U.url&&!$('#st-url').value)$('#st-url').value=U.url;
      $('#st-box').innerHTML=L.filter(function(x){return !x.campo}).map(function(x){return '<div class="stx '+(x.ok?'ok':'no')+'"><b>'+(x.ok?'✓':'✕')+'</b> '+e(x.t)+(x.aiuto?'<small>'+e(x.aiuto)+'</small>':'')+'</div>'}).join('')};
  var stato=function(forza){if(!forza&&STC.L&&Date.now()-STC.t<600000)return mostraSt(STC.L);$('#st-box').innerHTML='<p class="hint">Controllo…</p>';
    callPiano('apiStato',[],function(L){STC={t:Date.now(),L:L};mostraSt(L)},
      function(err){$('#st-box').innerHTML='<div class="stx no"><b>✕</b> Il controllo non è riuscito<small>'+e((err&&err.message)||'Errore sconosciuto')+' — esegui «installa» dall’editor e accetta tutti i permessi.</small></div>'})};
  $('#st-url-ok').onclick=function(){var b=this,m=$('#st-url-m'),u=$('#st-url').value.trim();if(!u){m.textContent='Incolla prima l’indirizzo.';return}b.disabled=true;m.textContent='Provo l’indirizzo come lo usa il sito…';
    callPiano('apiImpostaUrl',[u],function(r){b.disabled=false;if(r&&r.ok){m.textContent='✓ Salvato: il sito ora usa questo indirizzo.';toast('Indirizzo salvato');stato(true)}else m.textContent='✕ '+((r&&r.msg)||'Non risponde.')},
      function(err){b.disabled=false;m.textContent='✕ '+((err&&err.message)||'Non riuscito')+' — esegui «installa» dall’editor e accetta tutti i permessi.'})};
  $('#st-ok').onclick=function(){stato(true)};stato();
  $('#im-temi').onclick=function(){var on=!this.classList.contains('on');this.classList.toggle('on',on);impSet('Temi automatici',on?'sì':'no');toast(on?'Temi automatici accesi':'Temi solo dal pannello')};
  $('#pr-ok').onclick=function(){var da=$('#pr-da').value,a=$('#pr-a').value,g=[].map.call(document.querySelectorAll('#pr-gg input:checked'),function(x){return x.value}).join(',');
    if(!da||!a||da>=a){toast('L’orario di fine deve essere dopo quello di inizio');return}if(!g){toast('Scegli almeno un giorno (oppure spegni il promemoria in «Oggi»)');return}
    impSet('Promemoria dalle',da);impSet('Promemoria alle',a);impSet('Promemoria giorni',g)};
  $('#rg-ok').onclick=function(){var n=0;document.querySelectorAll('#rgf input').forEach(function(x){var i=+x.dataset.i,orig=rg.rows[i],v=x.value.replace(/\D/g,'');if(v===''){return}if(v!==String(orig[kV]||'')){var nv={};nv[kV]=v;var oc=copia(orig);Object.assign(rg.rows[i],nv);accoda('regole','apiSalva',['regole',i,nv,null,oc]);n++}});toast(n?'Regole salvate ✓':'Nessuna modifica')};
  $('#im-ok').onclick=function(){var u=$('#im-sito').value.trim(),r=$('#im-rec').value.trim();
    if(u&&!/^https?:\/\/[\w.-]+\.[a-z]{2,}/i.test(u)){toast('Scrivi l’indirizzo completo, es. https://oltreconfini.it');return}
    if(r&&!/^https:\/\/(g\.page|www\.google\.|maps\.app\.goo\.gl|search\.google\.com|goo\.gl)/i.test(r)){toast('Il link deve essere quello di Google (https://g.page/…, https://maps.app.goo.gl/…)');return}
    if(u!==impVal('Indirizzo del sito'))impSet('Indirizzo del sito',u);if(r!==impVal('Link recensioni Google'))impSet('Link recensioni Google',r)};
  call('apiPersone',[],mostraPersone)}
var RUOLI={admin:'Titolare',vice:'Vice',personale:'Personale'};
function mostraPersone(R){var box=$('#pers');if(!box)return;var L=R.persone,NOMI=R.nomi,ADM=R.mioRuolo==='admin';
  var puo=function(p){return ADM?(p.ruolo!=='admin'||p.io):(p.ruolo==='personale'||p.io)};
  var chip=function(p){return p.ruolo==='personale'?p.sezioni.map(function(k){return NOMI[k]}).join(', '):'tutte le sezioni'+(p.ruolo!=='personale'?' · gestisce il personale':'')};
  box.innerHTML='<p class="hint">Ognuno entra con il suo link personale. Il titolare e il vice decidono chi vede quali sezioni; i camerieri nuovi vedono prenotazioni e opinioni. Le operazioni sulle prenotazioni restano nel registro, con il nome di chi le ha fatte.</p>'+
   L.map(function(p){return '<div class="item pp" data-m="'+e(p.email)+'"><div class="t"><b>'+e(p.nome||p.email)+(p.io?' (tu)':'')+' <span class="badge'+(p.ruolo!=='personale'?' on':'')+'">'+RUOLI[p.ruolo]+'</span></b><span>'+(p.nome?e(p.email)+' · ':'')+chip(p)+(p.promemoria?' · promemoria':'')+'</span></div>'+
     (puo(p)?'<button class="mv" data-a="mod" title="Modifica">✎</button>':'')+'</div>'}).join('')+
   '<div class="row"><button class="btn gold" id="pp-new">+ Aggiungi una persona</button></div>';
  function scheda(p){var nuovo=!p;p=p||{email:'',nome:'',ruolo:'personale',sezioni:['pren','opinioni'],promemoria:false};
    var h='<div class="card" id="ppf"><h3 style="margin:0 0 6px">'+(nuovo?'Nuova persona':e(p.nome||p.email))+'</h3>'+
      (nuovo?'<label>Email</label><input type="email" id="pp-m" placeholder="nome@esempio.it">':'<p class="hint">'+e(p.email)+'</p>')+
      '<label>Nome (si vede nel registro)</label><input type="text" id="pp-n" maxlength="40" value="'+e(p.nome)+'" placeholder="es. Marco – cameriere">'+
      (p.ruolo==='admin'?'<p class="hint">Titolare: accesso a tutto.</p>':'<label>Ruolo</label><select id="pp-r"'+(p.io?' disabled':'')+'><option value="personale"'+(p.ruolo==='personale'?' selected':'')+'>Personale: solo le sezioni scelte</option>'+(ADM?'<option value="vice"'+(p.ruolo==='vice'?' selected':'')+'>Vice: tutto, e gestisce il personale</option>':'')+'</select>')+
      '<div id="pp-sez"><label>Sezioni che può vedere e modificare</label><div class="al">'+Object.keys(NOMI).map(function(k){return '<label><input type="checkbox" value="'+k+'"'+(p.sezioni.indexOf(k)>=0?' checked':'')+'> '+NOMI[k]+'</label>'}).join('')+'</div></div>'+
      '<label class="sw"><input type="checkbox" id="pp-p"'+(p.promemoria?' checked':'')+'> Riceve i promemoria e gli avvisi per email</label>'+
      '<div class="row"><button class="btn gold" id="pp-ok">'+(nuovo?'Aggiungi e manda il link':'Salva')+'</button><button class="btn light" id="pp-no">Annulla</button></div>'+
      (nuovo||p.io?'':'<div class="row"><button class="btn light" id="pp-link">✉ Rimanda il link</button><button class="btn light" id="pp-nuovo">↻ Link nuovo</button>'+(p.titolare?'':'<button class="btn bad" id="pp-via">Togli</button>')+'</div>')+'</div>';
    box.insertAdjacentHTML('beforeend',h);$('#pp-new').style.display='none';$('#ppf').scrollIntoView({block:'center'});
    var sez=function(){var r=$('#pp-r');$('#pp-sez').style.display=!r||r.value!=='personale'?'none':''};if($('#pp-r'))$('#pp-r').onchange=sez;sez();
    $('#pp-no').onclick=function(){mostraPersone(R)};
    $('#pp-ok').onclick=function(){var m=nuovo?$('#pp-m').value.trim().toLowerCase():p.email,ru=p.ruolo==='admin'?'admin':($('#pp-r')?$('#pp-r').value:p.ruolo),
      sz=[].map.call(document.querySelectorAll('#pp-sez input:checked'),function(x){return x.value});
      if(!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(m)){toast('Email non valida');return}if(nuovo&&L.some(function(x){return x.email===m})){toast('C’è già');return}
      if(ru==='personale'&&!sz.length){toast('Scegli almeno una sezione');return}
      call('apiPersonaSalva',[m,{nome:$('#pp-n').value.trim(),ruolo:ru,sezioni:sz,promemoria:$('#pp-p').checked}],function(x){toast(nuovo?'Aggiunta: riceve il link per email':'Salvato');R=x;mostraPersone(x)})};
    if($('#pp-link'))$('#pp-link').onclick=function(){chiedi({t:'Rimandare il link?',d:'Il link al pannello viene rimandato per email a '+p.email+'.',ok:'Rimanda il link'},function(v){if(v==='ok')call('apiPersonaLink',[p.email,false],function(x){toast('Link inviato');mostraPersone(x)})})};
    if($('#pp-nuovo'))$('#pp-nuovo').onclick=function(){chiedi({t:'Creare un link nuovo?',d:'Per '+p.email+'. Quello vecchio smette subito di funzionare (utile se è stato perso o inoltrato).',ok:'Crea link nuovo',pericolo:true},function(v){if(v==='ok')call('apiPersonaLink',[p.email,true],function(x){toast('Nuovo link inviato');mostraPersone(x)})})};
    if($('#pp-via'))$('#pp-via').onclick=function(){chiedi({t:'Togliere '+(p.nome||p.email)+'?',d:'Il suo link al pannello smette subito di funzionare.',ok:'Togli',pericolo:true},function(v){if(v==='ok')call('apiPersonaTogli',[p.email],function(x){toast('Tolta');mostraPersone(x)})})}}
  box.onclick=function(ev){var b=ev.target.closest('button[data-a="mod"]');if(!b||$('#ppf'))return;var m=b.closest('.pp').dataset.m;scheda(L.filter(function(x){return x.email===m})[0])};
  $('#pp-new').onclick=function(){if(!$('#ppf'))scheda(null)}}
// registro: chi ha fatto cosa
function mostraRegistro(f){var box=$('#reg');if(!box)return;f=f||{};
  call('apiRegistro',[f],function(R){
    box.innerHTML='<p class="hint">Le ultime 300 operazioni (filtrabili). Per le prenotazioni c’è il codice (#…), non il nome del cliente.</p>'+
      '<div class="flt"><select id="rg-p"><option value="">Tutte le persone</option>'+R.persone.map(function(x){return '<option'+(x===f.persona?' selected':'')+'>'+e(x)+'</option>'}).join('')+'</select>'+
      '<select id="rg-s"><option value="">Tutte le sezioni</option>'+R.sezioni.map(function(x){return '<option'+(x===f.sezione?' selected':'')+'>'+e(x)+'</option>'}).join('')+'</select></div>'+
      '<input type="text" id="rg-t" placeholder="Cerca (es. #A1B2C3, Margherita, Arrivati)" value="'+e(f.testo||'')+'" style="margin-top:8px">'+
      '<div class="reglist">'+(R.righe.length?R.righe.map(function(r){return '<div class="rg'+(/negato/i.test(r[5])?' neg':'')+'"><div class="h">'+e(r[0])+' '+e(r[1].slice(0,5))+' · <b>'+e(r[2])+'</b>'+(r[3]?' ('+e(r[3])+')':'')+' · '+e(r[4])+'</div><div><b>'+e(r[5])+'</b> '+e(r[6])+'</div></div>'}).join(''):'<p class="hint">Nessuna operazione.</p>')+'</div>'+
      '<label>Per quanti giorni tenere il registro</label><div class="row" style="margin-top:0"><input type="number" id="rg-g" min="30" max="730" value="'+R.giorni+'"><button class="btn light" id="rg-gok">Salva</button></div>'+
      '<p class="hint">Avvisa il personale che le operazioni nel pannello vengono registrate (serve per legge).</p>'+(R.url?'<p class="hint"><a href="'+e(R.url)+'" target="_blank">Apri il registro completo nel foglio Google</a></p>':'');
    var go=function(){mostraRegistro({persona:$('#rg-p').value,sezione:$('#rg-s').value,testo:$('#rg-t').value.trim()})};
    $('#rg-p').onchange=go;$('#rg-s').onchange=go;$('#rg-t').onchange=go;
    $('#rg-gok').onclick=function(){call('apiRegistroGiorni',[+$('#rg-g').value],function(){toast('Salvato')})}})}
function apri(){if(cur==='pren')return pren();if(cur==='oggi')return oggi();if(cur==='orari')return orari();if(cur==='impost')return impost();if(cur==='opinioni')return opinioni();if(DATA[cur]){lista();rinfresca(cur);return}call('apiLeggi',[cur],function(d){DATA[cur]=d;memo(cur);AGG[cur]=Date.now();lista()})}

/* ---- prenotazioni: agenda del giorno, nuove prenotazioni (anche telefoniche), arrivi ---- */
var PR=null,PRD='',PRT=0,PRF=null;
var PRK={},PRDEF={};Object.keys(PRR).forEach(function(k){PRK[k]=PRR[k][0];PRDEF[k]=PRR[k][1]});
var GSETP=['domenica','lunedì','martedì','mercoledì','giovedì','venerdì','sabato'],MESIP=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
function isoDi(d){return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2)}
function isoSposta(iso,n){var p=iso.split('-');return isoDi(new Date(+p[0],+p[1]-1,+p[2]+n))}
function giornoTesto(iso){var p=iso.split('-'),d=new Date(+p[0],+p[1]-1,+p[2]);var t=GSETP[d.getDay()]+' '+d.getDate()+' '+MESIP[d.getMonth()];return t.charAt(0).toUpperCase()+t.slice(1)}
function hmMin(h){var m=String(h||'').match(/(\d{1,2}):(\d{2})/);return m?+m[1]*60+ +m[2]:null}
// chiamata senza la schermata «Un attimo…» (aggiornamento automatico ogni minuto)
function callPiano(fn,args,ok,ko){try{google.script.run.withSuccessHandler(ok).withFailureHandler(function(err){if(ko){ko(err);toast((err&&err.message)||'Non riuscito: riprova')}}).api(CHIAVE,fn,args||[])}catch(e){}}
var PRV='g';      // vista: g = giorno, s = settimana, m = mese
// velocità: le giornate già viste restano in memoria (solo finché la pagina è aperta: niente dati dei clienti salvati sul telefono).
// Si mostra subito quello che c'è, poi si aggiorna in silenzio; i giorni vicini si caricano prima che servano.
var PRC={},PPC={};if(PREN0&&PREN0.iso)PRC[PREN0.iso]=PREN0;
var STC={t:0,L:null};
function prLibero(){return cur==='pren'&&!$('#prf')&&!$('#reg[data-pren]')}
function prCarico(t){$('#main').innerHTML='<h2>Prenotazioni</h2>'+vistaBar()+'<div class="card"><p class="hint">'+t+'</p></div>';vistaAttiva()}
function prVicini(iso){[isoSposta(iso,1),isoSposta(iso,-1)].forEach(function(x){if(!PRC[x])callPiano('apiPren',[x],function(d){if(d&&d.iso)PRC[d.iso]=d})})}
function pren(iso){PRD=iso||PRD||(PR&&PR.iso)||(PREN0&&PREN0.iso)||'';if(PRV!=='g')return prPeriodo();
  var c=PRD&&PRC[PRD],tok=++PRT;
  if(c){PR=c;if(prLibero())mostraPren()}else if(prLibero())prCarico('Carico la giornata…');
  callPiano('apiPren',[PRD],function(d){if(!d||!d.iso)return;
      if(tok!==PRT||PRQ.length||PRQV){if(!PRQ.length&&!PRQV)PRC[d.iso]=d;return}
      var cambiato=!PR||PR.iso!==d.iso||JSON.stringify(PR)!==JSON.stringify(d);PRC[d.iso]=d;PR=d;PRD=d.iso;
      if(cambiato&&PRV==='g'&&prLibero())mostraPren();prVicini(d.iso)},
    function(){if(tok===PRT&&!c&&prLibero())$('#main').innerHTML='<h2>Prenotazioni</h2><div class="card"><p>Non riesco a caricare le prenotazioni: controlla la connessione.</p><button class="btn gold" id="pn-retry">Riprova</button></div>',$('#pn-retry').onclick=function(){pren(PRD)}})}
// azioni istantanee: lo schermo cambia subito, il salvataggio parte dietro; se non riesce torna com'era e lo dice
var PRQ=[],PRQV=false;
function azionePren(b,s,opz,msg){var prima=JSON.stringify(PR),x=PR.lista.filter(function(y){return y.id===b.id})[0];if(!x)return;
  if(s==='ok'&&opz&&opz.arriva){x.eta=hm2(Math.max(x.m,PR.ora+(+opz.arriva)));x.dac=0;x.w=1}else{x.s=s;x.dac=0;if(s==='ok')x.fx=1}
  mostraPren();toast(msg);PRQ.push({a:[PR.iso,b.id,s,opz||{}],prima:prima,iso:PR.iso});prCorri()}
function prCorri(){if(PRQV||!PRQ.length)return;PRQV=true;var q=PRQ.shift();stato('Salvo…','');
  google.script.run.withSuccessHandler(function(x){PRQV=false;stato('');if(!PRQ.length&&PR&&PR.iso===q.iso&&cur==='pren'&&!$('#prf')){PR=x;mostraPren()}prCorri()})
   .withFailureHandler(function(err){PRQV=false;stato('');PRQ=[];if(PR&&PR.iso===q.iso){PR=JSON.parse(q.prima);if(cur==='pren'&&!$('#prf'))mostraPren()}
     chiedi({t:'Non salvato',d:String(err&&err.message||err).replace(/^Error:\s*/,'')+'\nHo rimesso com’era: riprova.',ok:'Ho capito',no:false})}).api(CHIAVE,'apiPrenStato',q.a)}
window.addEventListener('beforeunload',function(e){if(PRQ.length||PRQV){e.preventDefault();e.returnValue=''}});
// settimana e mese: i totali per giorno, un tocco apre la giornata
function lunedi(iso){var p=iso.split('-'),d=new Date(+p[0],+p[1]-1,+p[2]),w=(d.getDay()+6)%7;return isoDi(new Date(+p[0],+p[1]-1,+p[2]-w))}
function prPeriodo(){var base=PRD||isoDi(new Date()),da,n;
  if(PRV==='s'){da=lunedi(base);n=7}else{var p=base.split('-');da=p[0]+'-'+p[1]+'-01';n=new Date(+p[0],+p[1],0).getDate()}
  var k=PRV+da,c=PPC[k],tok=++PRT;if(c){if(prLibero())mostraPeriodo(da,c)}else if(prLibero())prCarico('Carico '+(PRV==='m'?'il mese':'la settimana')+'…');
  callPiano('apiPrenPeriodo',[da,n],function(L){PPC[k]=L;if(tok!==PRT||PRV==='g'||!prLibero())return;if(!c||JSON.stringify(c)!==JSON.stringify(L))mostraPeriodo(da,L)})}
function vistaBar(){return '<div class="vbar">'+[['g','Giorno'],['s','Settimana'],['m','Mese']].map(function(v){return '<button class="'+(PRV===v[0]?'on':'')+'" data-v="'+v[0]+'">'+v[1]+'</button>'}).join('')+'</div>'}
function vistaAttiva(){document.querySelectorAll('.vbar button').forEach(function(b){b.onclick=function(){PRV=b.dataset.v;if(PRV==='g')pren(PRD);else prPeriodo()}})}
function mostraPeriodo(da,L){var p=da.split('-'),mese=PRV==='m',h='<h2>Prenotazioni</h2>'+vistaBar();
  var sp=function(n){var d=new Date(+p[0],+p[1]-1,+p[2]);if(mese)d=new Date(+p[0],+p[1]-1+n,1);else d.setDate(d.getDate()+7*n);return isoDi(d)};
  h+='<div class="prnav"><button class="btn light" id="pv-p">‹</button><b class="pvt">'+(mese?MESIP[+p[1]-1]+' '+p[0]:'Settimana dal '+giornoTesto(da))+'</b><button class="btn light" id="pv-n">›</button></div>';
  var tot=L.reduce(function(a,x){return a+x.pers},0),np=L.reduce(function(a,x){return a+x.pren},0);
  h+='<p class="hint">'+np+' prenotazioni · '+tot+' persone</p>';
  if(mese){var w=(new Date(+p[0],+p[1]-1,1).getDay()+6)%7,oggiIso=isoDi(new Date());h+='<div class="cal"><i>lun</i><i>mar</i><i>mer</i><i>gio</i><i>ven</i><i>sab</i><i>dom</i>';for(var k=0;k<w;k++)h+='<span></span>';
    L.forEach(function(x){var cop=(x.cop[0]||0)+(x.cop[1]||0),pc=cop?Math.min(100,Math.round(100*x.pers/cop)):0,pass=x.iso<oggiIso;
      h+='<button class="cd'+(x.oggi?' oggi':'')+(x.chiuso?' chiuso':'')+(pass?' pass':'')+(x.pren?' con':'')+(pc>=80?' quasi':'')+'" data-iso="'+x.iso+'" aria-label="'+e(giornoTesto(x.iso)+': '+(x.chiuso?'chiuso':x.pren?x.pren+' prenotazioni, '+x.pers+' persone':'nessuna prenotazione'))+'">'+
        '<b>'+(+x.iso.slice(8))+'</b>'+(x.dac?'<em title="da contattare">'+x.dac+'</em>':'')+
        (x.chiuso?'<small class="cz">chiuso</small>':x.pren?'<span class="cn">'+x.pers+'<small> pers.</small></span><small class="cp">'+x.pren+' pren.</small><span class="cbar"><i class="'+(pc>=100?'r':pc>=70?'a':'v')+'" style="width:'+Math.max(8,pc)+'%"></i></span>':'')+'</button>'});
    h+='</div><div class="leg"><span><b>12 pers.</b> persone prenotate · <b>3 pren.</b> prenotazioni</span><span><i class="l-v"></i>c’è posto</span><span><i class="l-a"></i>quasi pieno</span><span><i class="l-r"></i>pieno</span><span><i class="l-ch"></i>chiuso</span></div>';
    var prox=L.filter(function(x){return x.pren&&x.iso>=oggiIso});
    h+='<h3 class="sub">'+(prox.length?'Giorni con prenotazioni':'Nessuna prenotazione da oggi in poi in questo mese')+'</h3>';
    if(prox.length)h+='<div class="card" style="padding:4px 12px">'+prox.map(function(x){return '<button class="wd'+(x.oggi?' oggi':'')+'" data-iso="'+x.iso+'"><b>'+giornoTesto(x.iso)+(x.oggi?' · oggi':'')+'</b><span>'+x.pren+(x.pren===1?' prenotazione':' prenotazioni')+' · '+x.pers+(x.pers===1?' persona':' persone')+(x.pranzo?' · pranzo '+x.pranzo+'/'+x.cop[0]:'')+(x.cena?' · cena '+x.cena+'/'+x.cop[1]:'')+(x.dac?' · <em>'+x.dac+' da contattare</em>':'')+'</span></button>'}).join('')+'</div>'}
  else h+='<div class="card" style="padding:4px 12px">'+L.map(function(x){return '<button class="wd'+(x.oggi?' oggi':'')+'" data-iso="'+x.iso+'"><b>'+giornoTesto(x.iso)+'</b><span>'+(x.chiuso?'chiuso':x.pren?x.pren+' prenotazioni · pranzo '+x.pranzo+'/'+x.cop[0]+' · cena '+x.cena+'/'+x.cop[1]:'nessuna prenotazione')+(x.dac?' · <em>'+x.dac+' da contattare</em>':'')+'</span></button>'}).join('')+'</div>';
  $('#main').innerHTML=h;vistaAttiva();
  $('#pv-p').onclick=function(){PRD=sp(-1);prPeriodo()};$('#pv-n').onclick=function(){PRD=sp(1);prPeriodo()};
  document.querySelectorAll('[data-iso]').forEach(function(b){b.onclick=function(){PRV='g';pren(b.dataset.iso)}})}

function telOk(t){var s=String(t||'').replace(/[\s.\/()\-]/g,'');if(!/^\+?\d+$/.test(s))return false;if(s.indexOf('00')===0)s='+'+s.slice(2);var n=s;if(s[0]==='+'){if(s.indexOf('+39')!==0){var d=s.slice(1);return d.length>=8&&d.length<=15}n=s.slice(3)}if(/^(\d)\1+$/.test(n.slice(1)))return false;return /^3\d{8,9}$/.test(n)||/^0\d{5,10}$/.test(n)}
function hm2(m){return ('0'+Math.floor(m/60)%24).slice(-2)+':'+('0'+m%60).slice(-2)}
function statoPren(b){
  if(b.s==='arr')return {t:b.ac?'Arrivati (l’ha segnalato il cliente)':'Arrivati',c:'pos'};
  if(b.s==='lib')return {t:'Tavolo liberato',c:'neg'};
  if(b.s==='ann')return {t:'Annullata dal cliente',c:'off'};
  if(b.s==='annR')return {t:'Annullata',c:'off'};
  if(PR.iso<PR.oggi)return {t:'Non segnati (arrivo non registrato)',c:'off'};
  if(PR.iso!==PR.oggi)return {t:'Confermata',c:'ok'};
  if(servFinito(PR,b))return {t:'Non segnati (arrivo non registrato)',c:'off'};   // servizio finito: non serve più fare niente
  if(b.dac)return {t:'DA CONTATTARE · non ha risposto',c:'neg'};
  if(b.eta)return {t:'Ha risposto: arriva alle '+b.eta,c:'mid'};
  if(!b.fx&&PR.ora>=b.m+PR.cfg.avv)return {t:'In ritardo · '+(b.em?'email inviata · ':'senza email: chiamalo · ')+(PR.cfg.libAuto?'si libera alle ':'da contattare alle ')+hm2(b.m+PR.cfg.lib),c:'mid'};
  if(PR.ora>=b.m)return {t:'Orario arrivato · da segnare',c:'mid'};
  return {t:'Confermata',c:'ok'};
}
// le prenotazioni che chiedono qualcosa adesso: da contattare, in ritardo, in arrivo nei prossimi 30 minuti
// un servizio è finito mezz'ora dopo la chiusura (es. pranzo fino alle 14:30 → alle 15:00): da lì le sue prenotazioni escono da «Adesso»
function servFinito(d,b){var f=d.fine&&d.fine[b.k]!=null?d.fine[b.k]:b.m+180;return d.ora>f+30}
function adesso(d){if(d.iso!==d.oggi)return [];return d.lista.filter(function(b){return b.s==='ok'&&(b.dac||d.ora>=b.m-30)&&!servFinito(d,b)}).sort(function(a,b){return (b.dac?1:0)-(a.dac?1:0)||a.m-b.m})}
function badgePren(){var n=PR&&PR.iso===PR.oggi?PR.lista.filter(function(b){return b.s==='ok'&&b.dac&&!servFinito(PR,b)}).length:0,bt=document.querySelector('#tabs button[data-k=pren]');if(bt)bt.innerHTML='Prenotazioni'+(n?' <span class="nbad">'+n+'</span>':'')}
function mostraPren(){(function(){
  if(PR&&PR.iso)PRC[PR.iso]=PR;
  var d=PR,h='<h2>Prenotazioni'+(PERM.ruolo==='admin'||PERM.ruolo==='vice'?'<button class="btn light mini" id="pn-reg">Registro</button>':'')+'</h2>'+vistaBar();
  h+='<div class="prnav"><button class="btn light" id="pn-p" aria-label="Giorno prima">‹</button><input type="date" id="pn-d" value="'+d.iso+'"><button class="btn light" id="pn-n" aria-label="Giorno dopo">›</button>'+(d.iso!==d.oggi?'<button class="btn light" id="pn-o">Oggi</button>':'')+'</div>';
  h+='<p class="prday">'+(d.iso===d.oggi?'<b>Oggi</b> · ':'')+giornoTesto(d.iso)+'</p>';
  if(!d.cfg.on)h+='<div class="state no">Le prenotazioni online sono spente: il sito invita a telefonare. Si riaccendono in Impostazioni.</div>';
  if(d.quota!==null&&d.quota<15)h+='<div class="state no">Restano solo '+d.quota+' email da inviare oggi (limite di Google): le conferme ai clienti potrebbero non partire. Le prenotazioni restano comunque salvate.</div>';
  var sv=['Pranzo','Cena'],tot='';
  [0,1].forEach(function(k){tot+='<div class="kpi"><b>'+d.occ[k]+'<small>/'+d.cfg.cop[k]+'</small></b><span>'+sv[k]+(d.servizi[k]?' · '+d.servizi[k]:' · chiuso')+'</span><i>coperti prenotati</i></div>'});
  h+='<div class="kpis k2">'+tot+'</div>';
  var ad=adesso(d);
  if(ad.length)h+='<div class="grp">Adesso</div><div class="card adesso">'+ad.map(function(b){var st=statoPren(b),tel=String(b.tel||'').replace(/[^\d+]/g,'');
    return '<div class="adx'+(b.dac?' dac':'')+'" data-id="'+b.id+'"><div><b>'+b.h+' · '+e(b.nm)+' · '+b.n+'</b><span class="tag t-'+st.c+'">'+st.t+'</span></div>'+
      '<div class="adb"><button class="btn gold" data-a="arr">✓ Arrivati</button>'+(tel?'<a class="btn light tel" href="tel:'+e(tel)+'" target="_blank" rel="noopener">📞 Chiama</a>':'')+
      (b.dac||d.ora>=b.m+d.cfg.avv?'<button class="btn light" data-a="arriva">Sta arrivando</button><button class="btn bad" data-a="lib">Libera</button>':'')+'</div></div>'}).join('')+
    '<p class="hint" style="margin:8px 0 0">Appena un tavolo si siede, tocca «Arrivati»: chi resta qui senza spunta viene controllato (email al cliente, poi «da contattare»).</p></div>';
  h+='<button class="btn gold" id="pn-new" style="width:100%">+ Nuova prenotazione</button><p class="hint" style="margin-top:8px">Segna qui anche quelle al telefono o al banco: così il sito sa quanti posti restano e nessuno prenota due volte lo stesso tavolo.</p>';
  if(!d.lista.length)h+='<div class="card"><p class="hint">Nessuna prenotazione per questo giorno.</p></div>';
  [0,1].forEach(function(k){var L=d.lista.filter(function(b){return b.k===k});if(!L.length)return;
    h+='<div class="grp">'+sv[k]+'</div><div class="card" style="padding:4px 10px">'+L.map(function(b){var st=statoPren(b),att=b.s==='ok'||b.s==='arr';
      return '<div class="item prx'+(att?'':' spenta')+(b.s==='ok'&&b.dac&&d.iso===d.oggi&&!servFinito(d,b)?' dac':'')+'" data-id="'+b.id+'"><div class="t"><b>'+b.h+' · '+e(b.nm)+' · '+b.n+(b.n===1?' persona':' persone')+'</b>'+
        '<span>#'+String(b.id).slice(0,6).toUpperCase()+' · '+(b.o==='s'?'dal sito':'al telefono')+(b.tv?' · tavolo '+e(b.tv):'')+(b.al?' · ⚠ allergie da chiedere':'')+(b.mf?' · email non partita':'')+(b.no?' · '+e(b.no):'')+'</span>'+
        '<span class="tag t-'+st.c+'">'+st.t+'</span></div>'+
        (att?'<button class="arrbtn'+(b.s==='arr'?' on':'')+'" data-a="arr" aria-label="Arrivati">'+(b.s==='arr'?'✓ Arrivati':'Arrivati?')+'</button>':'')+'</div>'}).join('')+'</div>'});
  if(d.stat)h+='<p class="hint" style="margin-top:14px">Questo mese: '+((d.stat.sito||0)+(d.stat.pannello||0))+' prenotazioni ('+(d.stat.sito||0)+' dal sito)'+(d.stat.ns?' · '+d.stat.ns+' arrivi non segnati':'')+(d.stat.lib?' · '+d.stat.lib+' tavoli liberati per ritardo':'')+'. I dati dei clienti si cancellano da soli ogni notte; restano solo questi numeri.</p>';
  $('#main').innerHTML=h;
  $('#pn-p').onclick=function(){pren(isoSposta(d.iso,-1))};$('#pn-n').onclick=function(){pren(isoSposta(d.iso,1))};if($('#pn-o'))$('#pn-o').onclick=function(){pren(d.oggi)};
  $('#pn-d').onchange=function(){if(this.value)pren(this.value)};
  $('#pn-new').onclick=function(){schedaPren(null)};
  badgePren();vistaAttiva();
  if($('#pn-reg'))$('#pn-reg').onclick=function(){$('#main').innerHTML='<h2>Registro delle prenotazioni</h2><p><a href="#" id="rg-back">← Torna alle prenotazioni</a></p><div class="card" id="reg" data-pren="1"><p class="hint">Carico…</p></div>';$('#rg-back').onclick=function(ev){ev.preventDefault();mostraPren()};mostraRegistro({})};
  $('#main').onclick=function(ev){var ax=ev.target.closest('.adx');
    if(ax){var bb=d.lista.filter(function(x){return x.id===ax.dataset.id})[0],bn=ev.target.closest('button[data-a]');if(!bb||!bn)return;
      if(bn.dataset.a==='arr')azionePren(bb,'arr',{},bb.nm+': arrivati ✓');
      if(bn.dataset.a==='arriva')chiedi({t:bb.nm+' sta arrivando',d:'Tra quanti minuti arriva? Il tavolo resta tenuto fino ad allora.',campo:{tipo:'number',v:'15'},ok:'Salva'},function(v,mi){if(v!=='ok')return;mi=Math.round(+mi);if(mi>0&&mi<=180)azionePren(bb,'ok',{arriva:mi},'Ok: lo aspettiamo tra '+mi+' minuti');else toast('Scrivi i minuti, da 1 a 180')});
      if(bn.dataset.a==='lib')chiedi({t:'Liberare il tavolo?',d:bb.nm+' · ore '+bb.h+' · '+bb.n+(bb.n===1?' persona':' persone')+'\nIl cliente non è arrivato: i posti tornano prenotabili.'+(bb.em?'\nVuoi avvisarlo per email?':''),ok:bb.em?'Libera e avvisa per email':'Libera il tavolo',alt:bb.em?'Libera senza email':'',pericolo:true},
        function(v){if(v==='ok'||v==='alt')azionePren(bb,'lib',{mail:v==='ok'&&!!bb.em},'Tavolo liberato')});
      return}
    var it=ev.target.closest('.prx');if(!it)return;var b=d.lista.filter(function(x){return x.id===it.dataset.id})[0];if(!b)return;
    var bt=ev.target.closest('button[data-a="arr"]');
    if(bt){azionePren(b,b.s==='arr'?'ok':'arr',{},b.s==='arr'?'Tolto «arrivati»':'Segnati come arrivati ✓');return}
    schedaPren(b)};
})()}
function schedaPren(b){(function(){
  var d=PR,nuova=!b;b=b||{h:'',n:2,nm:'',tel:'',em:'',no:'',tv:'',al:false};
  var opz=function(slot,sel){var o=slot.map(function(s){return '<option value="'+s.h+'"'+(s.h===sel?' selected':'')+'>'+s.h+' · '+(s.liberi>0?s.liberi+' posti liberi':'pieno')+'</option>'}).join('');
    if(sel&&!slot.some(function(s){return s.h===sel}))o='<option value="'+sel+'" selected>'+sel+'</option>'+o;return o+'<option value="__altro">Altro orario…</option>'};
  var h='<h2>'+(nuova?'Nuova prenotazione':'Prenotazione')+'</h2><div class="card" id="prf">';
  if(!nuova){var st=statoPren(b);h+='<p><span class="tag t-'+st.c+'">'+st.t+'</span> '+(b.o==='s'?'arrivata dal sito':'inserita dal pannello')+'</p>'}
  h+='<label>Giorno</label><input type="date" id="pf-d" value="'+d.iso+'">'+
    '<label>Ora</label><select id="pf-h">'+opz(d.slot,b.h)+'</select><input type="time" step="900" id="pf-ha" style="display:none;margin-top:8px">'+
    '<label>Persone</label><input type="number" inputmode="numeric" min="1" max="300" id="pf-n" value="'+e(b.n)+'">'+
    '<label>Nome</label><input type="text" id="pf-nm" autocomplete="off" value="'+e(b.nm)+'">'+
    '<label>Telefono</label><input type="text" inputmode="tel" id="pf-tel" value="'+e(b.tel)+'">'+(b.tel&&!nuova?'<a class="btn light tel" style="margin:2px 0 6px" href="tel:'+e(String(b.tel).replace(/[^\d+]/g,''))+'" target="_blank" rel="noopener">📞 Chiama '+e(b.tel)+'</a>':'')+
    '<label>Email (facoltativa)</label><input type="email" inputmode="email" autocomplete="off" autocapitalize="off" id="pf-em" value="'+e(b.em)+'"><p class="hint">Se la scrivi, il cliente riceve conferma, promemoria e avviso di ritardo. Puoi lasciarla vuota.</p>'+

    '<label>Tavolo (facoltativo)</label><input type="text" id="pf-tv" value="'+e(b.tv)+'">'+
    '<label>Note</label><textarea id="pf-no" placeholder="Seggiolone, compleanno…">'+e(b.no)+'</textarea><p class="hint">Non scrivere qui allergie o dati sulla salute: spunta la casella e chiedile in sala.</p>'+
    '<label class="sw"><input type="checkbox" id="pf-al"'+(b.al?' checked':'')+'> Al tavolo ci sono allergie o intolleranze</label>'+
    '<div id="pf-w"></div><div class="row"><button class="btn gold" id="pf-ok">Salva</button><button class="btn light" id="pf-no-btn">Indietro</button></div>';
  if(!nuova){h+='<div class="row">';
    if(b.s==='ok'||b.s==='arr')h+='<button class="btn bad" id="pf-ann">Annulla la prenotazione</button>';
    else h+='<button class="btn light" id="pf-riatt">Riattiva la prenotazione</button>';
    h+='</div>';if(PERM.ruolo==='admin'||PERM.ruolo==='vice')h+='<div class="storia" id="pf-st"><b>Storia di #'+String(b.id).slice(0,6).toUpperCase()+'</b><p class="hint">Carico chi ha fatto cosa…</p></div>'}
  h+='</div>';$('#main').innerHTML=h;suTop();
  if($('#pf-st'))callPiano('apiPrenStoria',[b.id],function(L){var x=$('#pf-st');if(!x)return;x.innerHTML='<b>Storia di #'+String(b.id).slice(0,6).toUpperCase()+'</b>'+(L&&L.length?'<ol>'+L.map(function(r){return '<li><span>'+e(r.d+' '+r.h)+'</span><b>'+e(r.az)+'</b>'+(r.det?' · '+e(r.det):'')+'<small>'+e(r.chi.replace(/ · .*$/,'')+(r.ruolo?' ('+r.ruolo.toLowerCase()+')':''))+'</small></li>'}).join('')+'</ol>':'<p class="hint">Nessuna operazione registrata (le prenotazioni fatte prima del registro non hanno storia).</p>')},function(){var x=$('#pf-st');if(x)x.innerHTML='<b>Storia</b><p class="hint">Non disponibile in questo momento.</p>'});
  var giorno=d.iso;
  function oraSel(){var v=$('#pf-h').value;return v==='__altro'?$('#pf-ha').value:v}
  $('#pf-h').onchange=function(){$('#pf-ha').style.display=this.value==='__altro'?'':'none';if(this.value==='__altro')$('#pf-ha').focus()};
  $('#pf-d').onchange=function(){var v=this.value;if(!v)return;giorno=v;call('apiPren',[v],function(x){PRF=x;var cur=oraSel();$('#pf-h').innerHTML=opz(x.slot,cur);if(!x.servizi[0]&&!x.servizi[1])toast('Quel giorno risulta chiuso')})};
  function salva(forza){var r={h:oraSel(),n:$('#pf-n').value,nm:$('#pf-nm').value,tel:$('#pf-tel').value,em:$('#pf-em').value,tv:$('#pf-tv').value,no:$('#pf-no').value,al:$('#pf-al').checked};
    if(!r.h){toast('Scegli l’orario');return}if(!(+r.n>=1)){toast('Indica quante persone');return}if(r.nm.trim().length<2){toast('Scrivi il nome');return}
    if(!telOk(r.tel)){toast('Telefono non valido: cellulare (3…) o fisso (0…); se estero con il prefisso +');return}
    r.em=String(r.em||'').trim();if(r.em&&!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(r.em)){toast('L’email non sembra giusta: correggila o lasciala vuota');$('#pf-em').focus();return}
    // spostata a un altro giorno: si crea nel nuovo giorno e si annulla la vecchia
    var spostata=!nuova&&giorno!==d.iso;
    call('apiPrenSalva',[giorno,r,spostata?null:(nuova?null:b.id),!!forza],function(x){
      if(x.avvisi){$('#pf-w').innerHTML='<div class="ck"><b>Controlla prima di salvare</b><ul>'+x.avvisi.map(function(a){return '<li>'+e(a)+'</li>'}).join('')+'</ul><div class="row"><button class="btn light" id="pf-fix">Correggo</button><button class="btn gold" id="pf-force">Salva lo stesso</button></div></div>';
        $('#pf-fix').onclick=function(){$('#pf-w').innerHTML=''};$('#pf-force').onclick=function(){salva(true)};$('#pf-w').scrollIntoView({block:'center'});return}
      if(spostata){call('apiPrenStato',[d.iso,b.id,'annR',{}],function(){PR=x;mostraPren();toast('Spostata a '+giornoTesto(giorno))});return}
      PR=x;mostraPren();toast(nuova?'Prenotazione salvata ✓':'Modifiche salvate ✓')})}
  $('#pf-ok').onclick=function(){salva(false)};$('#pf-no-btn').onclick=function(){mostraPren()};
  if($('#pf-ann'))$('#pf-ann').onclick=function(){chiedi({t:'Annullare la prenotazione?',d:b.nm+' · ore '+b.h+(b.em?'\nVuoi avvisare il cliente per email?':''),ok:b.em?'Annulla e avvisa per email':'Annulla la prenotazione',alt:b.em?'Annulla senza email':'',no:'Indietro',pericolo:true},
    function(v){if(v!=='ok'&&v!=='alt')return;call('apiPrenStato',[d.iso,b.id,'annR',{mail:v==='ok'&&!!b.em}],function(x){PR=x;mostraPren();toast('Prenotazione annullata')})})};
  if($('#pf-riatt'))$('#pf-riatt').onclick=function(){call('apiPrenStato',[d.iso,b.id,'ok',{}],function(x){PR=x;mostraPren();toast('Riattivata: non verrà più liberata in automatico')},function(m){if(/posto/.test(m))chiedi({t:'Non c’è più posto',d:m+'\nRiattivarla lo stesso, oltre i coperti?',ok:'Riattiva lo stesso'},function(v){if(v==='ok')call('apiPrenStato',[d.iso,b.id,'ok',{forza:true}],function(x){PR=x;mostraPren();toast('Riattivata')})})})};
})()}
// aggiornamento automatico: ogni minuto, mentre si guarda l'agenda (non durante la modifica)
setInterval(function(){if(cur==='pren'&&PRV==='g'&&PR&&!PRQ.length&&!PRQV&&!$('#prf')&&!$('#reg')&&document.visibilityState!=='hidden')callPiano('apiPren',[PR.iso],function(x){if(cur==='pren'&&!$('#prf')){PR=x;var y=window.scrollY;mostraPren();window.scrollTo(0,y)}})},60000);
// impostazioni delle prenotazioni (scheda Impostazioni)
var PRGRUPPI=[
 ['Posti e orari',[['copL','Coperti a pranzo','Quante persone potete accogliere insieme. Il sito non vende mai più posti di questi.'],['copD','Coperti a cena'],
   ['durL','Durata del tavolo a pranzo (minuti)','Per quanto tempo un tavolo resta occupato: serve a capire quando si libera.'],['durD','Durata del tavolo a cena (minuti)'],
   ['maxN','Persone massime per una prenotazione online','I gruppi più grandi vengono invitati a telefonare.'],['step','Intervallo tra gli orari prenotabili (minuti)','Es. 15 = 19:00, 19:15, 19:30…'],
   ['pochi','Mostra «ultimi posti» quando ne restano meno di','0 = mai.']]],
 ['Avvisi al cliente',[
   ['prom','Promemoria: quante ore prima','0 = nessun promemoria.'],['avv','Ritardo: dopo quanti minuti mandiamo l’email «stai arrivando?»'],['lib','Senza risposta: dopo quanti minuti dall’orario prenotato','Da quel momento la prenotazione diventa rossa «da contattare» e arriva un’email al personale con nome e telefono.'],
   ['libAuto','Libera il tavolo da solo (invece di «da contattare»)','Spento: decide il personale dopo aver chiamato. Acceso: il tavolo si libera e il cliente riceve un’email.'],
   ['etaMax','Ritardo massimo che il cliente può chiedere (minuti)','Il cliente che conferma «sto arrivando» può scegliere fino a questo ritardo.'],['etaMarg','Margine dopo l’orario confermato dal cliente (minuti)']]],
 ['Dati del locale nei messaggi',[['nomeLoc','Nome del locale'],['indLoc','Indirizzo'],['telLoc','Telefono','Compare nelle email e nei messaggi del sito («chiamaci al…»).'],['mailLoc','Email per le risposte dei clienti'],['notaMail','Nota in fondo alle email (facoltativa)','Es.: Parcheggio gratuito nel cortile.']]],
 ['Avvisi al locale',[['avvisa','Email al locale per le prenotazioni e disdette del giorno stesso','Senza dati personali: solo ora e persone.']]],
 ['Privacy e sicurezza',[['conserva','Giorni di conservazione dei dati dopo la prenotazione','0 = si cancellano la notte dopo (consigliato). Se lo cambi, l’informativa del sito si aggiorna da sola.'],
   ['oraPul','Ora della cancellazione notturna (0–6)'],['doppia','Stesso telefono: considera doppione entro (ore)','0 = nessun controllo.'],['oraMax','Prenotazioni online massime all’ora','Protezione contro gli invii automatici.']]]];
function impPrenHTML(){var v=function(k){var x=impVal(PRK[k]);return x===''?PRDEF[k]:x};
  var campo=function(c){var k=c[0],t=PRR[k][2],h='';
    if(t==='s'){var on=!/^(no|off|spent)/i.test(v(k));return '<div class="sw2" style="margin-top:14px"><span>'+c[1]+'</span><button class="tg big'+(on?' on':'')+'" data-pk="'+k+'" aria-label="'+e(c[1])+'"><span></span></button></div>'+(c[2]?'<p class="hint">'+c[2]+'</p>':'')}
    if(Array.isArray(t))h='<input type="number" inputmode="numeric" min="'+t[0]+'" max="'+t[1]+'" data-pk="'+k+'" value="'+e(v(k))+'">';
    else h='<input type="'+(t==='e'?'email':'text')+'" data-pk="'+k+'" value="'+e(v(k))+'">';
    return '<label>'+c[1]+'</label>'+h+(c[2]?'<p class="hint">'+c[2]+'</p>':'')};
  var h='<h2>Prenotazioni</h2><div class="card" id="prs">'+campo(['on','Prenotazioni online dal sito','Spente: il sito non accetta prenotazioni e invita a telefonare.'])+
   PRGRUPPI.map(function(g,i){return '<details'+(i===0?' open':'')+' class="prg"><summary>'+g[0]+'</summary>'+g[1].map(campo).join('')+(g[0]==='Avvisi al locale'?'<label>A chi arrivano gli avvisi (una email per riga)</label><textarea id="pr-avv" placeholder="Vuoto = chi ha il promemoria acceso (scheda Persone)"></textarea><p class="hint">Ricevono le nuove prenotazioni del giorno e i clienti da contattare per ritardo (con nome e telefono).</p>':'')+'</details>'}).join('')+
   '<div class="row"><button class="btn gold" id="prs-ok">Salva prenotazioni</button></div></div>';
  return h}
function impPrenAttiva(){var box=$('#prs');if(!box)return;
  var sw=function(ev){var t=ev.target.closest('button.tg[data-pk]');if(!t)return;var on=!t.classList.contains('on');t.classList.toggle('on',on);impSet(PRK[t.dataset.pk],on?'sì':'no');toast((on?'Acceso: ':'Spento: ')+PRK[t.dataset.pk])};
  box.addEventListener('click',sw);
  call('apiPrenAvvisi',[null],function(a){var t=$('#pr-avv');if(t){t.value=a.join('\n');t.dataset.orig=t.value}});
  $('#prs-ok').onclick=function(){var err='',cambi=[];[].forEach.call(box.querySelectorAll('input[data-pk]'),function(x){var k=x.dataset.pk,t=PRR[k][2],val=String(x.value).trim();
      if(Array.isArray(t)){val=val.replace(/\D/g,'');if(val===''||+val<t[0]||+val>t[1]){err='«'+x.previousElementSibling.textContent+'»: scegli un numero tra '+t[0]+' e '+t[1];return}}
      if(t==='e'&&val&&!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(val)){err='Email non valida';return}
      if(k==='telLoc'&&val.replace(/\D/g,'').length<6){err='Scrivi il telefono completo';return}
      if(/[<>]/.test(val)){err='Niente simboli < >';return}
      var cur=impVal(PRK[k]);if(cur==='')cur=PRDEF[k];if(val!==cur)cambi.push([k,val])});
    var g=function(k){var x=box.querySelector('[data-pk="'+k+'"]');return +x.value};
    if(!err&&g('lib')<=g('avv'))err='Il tavolo si libera dopo la domanda «stai arrivando?»: metti un numero più grande';
    if(err){toast(err);return}
    var av=$('#pr-avv'),avv=av.value!==av.dataset.orig;
    if(!cambi.length&&!avv){toast('Nessuna modifica');return}
    cambi.forEach(function(c){impSet(PRK[c[0]],c[1])});
    if(avv)call('apiPrenAvvisi',[av.value.split(/[\s,;]+/).filter(Boolean)],function(a){av.value=a.join('\n');av.dataset.orig=av.value;toast('Salvato ✓')});else toast('Salvato ✓')};
}
/* ---- menù della settimana (pranzo, lunedì–sabato) + prezzi delle formule ---- */
var SETTV=null;    // la settimana che si sta guardando (lunedì, aaaa-mm-gg)
function oggi(lun){if(!lun&&OGGI&&OGGI.giorni&&(!SETTV||SETTV===OGGI.lun)){mostraOggi(OGGI);return}
  call('apiSettLeggi',[lun||''],function(o){if(!lun||lun===o.corrente){OGGI=o;memo('__oggi')}mostraOggi(o)})}
var MESI_S=['gennaio','febbraio','marzo','aprile','maggio','giugno','luglio','agosto','settembre','ottobre','novembre','dicembre'];
function dataLunga(iso){var p=iso.split('-');return (+p[2])+' '+MESI_S[+p[1]-1]}
function spostaIso(iso,gg){var d=new Date(iso+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+gg);return d.toISOString().slice(0,10)}
function mostraOggi(o){(function(){
  if(!o||!o.giorni){OGGI=null;return oggi()}
  SETTV=o.lun;
  var kC0=DATA.regole&&key(DATA.regole.headers,'chiave'),kV0=DATA.regole&&key(DATA.regole.headers,'valore'),rp=DATA.regole?DATA.regole.rows.filter(function(r){return /^promemoria/i.test(r[kC0]||'')})[0]:null,promOn=!rp||!/^(no|spent|off)/i.test(rp[kV0]||'');
  var corr=o.lun===o.corrente,prox=o.lun===spostaIso(o.corrente,7),nome=corr?'Questa settimana':prox?'Prossima settimana':(o.lun<o.corrente?'Settimana passata':'Settimana');
  var chiuso=function(i){try{var O=DATA.orari,kg=key(O.headers,'giorno'),kp=key(O.headers,'pranzo dal'),r=O.rows.filter(function(x){return nrm(x[kg]).slice(0,3)===['lun','mar','mer','gio','ven','sab'][i]})[0];return r&&!r[kp]}catch(x){return false}};
  var h='<label class="sw big"><input type="checkbox" id="prom" '+(promOn?'checked':'')+'><span class="tr"></span><span><b>Promemoria del menù della settimana</b><small>'+(promOn?'Acceso: un’email nei giorni scelti in Configurazione (di base sabato, domenica e lunedì), solo se la settimana non è ancora scritta.':'Spento: non arrivano email di promemoria.')+'</small></span></label>'+
  '<h2>Menù della settimana</h2>'+
  '<div class="pnav"><button class="btn light" id="sw-p" aria-label="Settimana prima">‹</button><div class="sw-t"><b>'+nome+'</b><span>da lunedì '+dataLunga(o.lun)+' a sabato '+dataLunga(spostaIso(o.lun,5))+'</span></div><button class="btn light" id="sw-n" aria-label="Settimana dopo">›</button></div>'+
  (o.pubblicata?'<div class="state ok">Sul sito ✓ — puoi cambiarla quando vuoi.</div>':'<div class="state no">Non ancora scritta.</div>')+
  '<p class="hint">Un piatto per riga. Il sito mostra il menù del giorno e, sotto, quello degli altri giorni. Un giorno vuoto non compare.</p><div id="sw-ck"></div>'+
  o.giorni.map(function(d,i){var pass=d.iso<o.oggi,oggiQ=d.iso===o.oggi;
    return '<div class="card sw-g'+(pass?' pass':'')+(oggiQ?' oggiq':'')+'"><div class="sw-h"><b>'+d.nome+' '+dataLunga(d.iso)+'</b>'+(oggiQ?'<span class="tag">oggi</span>':'')+(pass?'<span class="tag grey">passato</span>':'')+
      (i?'<button class="btn mini light" data-cp="'+i+'">Copia da '+o.giorni[i-1].nome.toLowerCase()+'</button>':'')+'</div>'+
      (chiuso(i)?'<p class="hint">Secondo la scheda Orari a pranzo siete chiusi.</p>':'')+
      '<label for="p'+i+'">Primi</label><textarea id="p'+i+'" rows="3"'+(i?'':' placeholder="Linguine ai frutti di mare"')+'>'+e(d.primi.join('\n'))+'</textarea>'+
      '<label for="s'+i+'">Secondi</label><textarea id="s'+i+'" rows="3"'+(i?'':' placeholder="Coniglio alla ligure con patate"')+'>'+e(d.secondi.join('\n'))+'</textarea></div>'}).join('')+
  '<div class="row sw-bar"><button class="btn gold" id="pub">Pubblica la settimana</button>'+(o.pubblicata?'<button class="btn bad" id="tog">Togli dal sito</button>':'')+'</div>'+
  '<h2>Prezzi delle formule</h2><div class="card" id="prezzi">Carico…</div>';
  $('#main').innerHTML=h;
  $('#sw-p').onclick=function(){oggi(spostaIso(o.lun,-7))};$('#sw-n').onclick=function(){oggi(spostaIso(o.lun,7))};
  document.querySelectorAll('[data-cp]').forEach(function(b){b.onclick=function(){var i=+b.dataset.cp;$('#p'+i).value=$('#p'+(i-1)).value;$('#s'+i).value=$('#s'+(i-1)).value;toast('Copiato: cambia solo quello che serve')}});
  var righe=function(t){return String(t||'').split(/\r?\n/).map(function(x){return x.replace(/^[\s•·\-–*]+/,'').trim()}).filter(Boolean).slice(0,8)};
  var leggi=function(vuota){return o.giorni.map(function(d,i){return vuota?{primi:'',secondi:''}:{primi:$('#p'+i).value,secondi:$('#s'+i).value}})};
  // controllo dell'IA fatto in anticipo, mentre si scrive: quando si tocca «Pubblica» di solito è già pronto
  var IAQ={},iaChiave=function(G){return JSON.stringify(G.map(function(x){return [righe(x.primi),righe(x.secondi)]}))},
    iaPer=function(G){return G.map(function(x,i){return {giorno:o.giorni[i].nome,primi:righe(x.primi),secondi:righe(x.secondi)}})},
    iaChiedi=function(G,fatto){var k=iaChiave(G),q=IAQ[k];if(q&&q.r){if(fatto)fatto(q.r);return}if(q){if(fatto)q.cb.push(fatto);return}
      q=IAQ[k]={cb:fatto?[fatto]:[]};google.script.run.withSuccessHandler(function(r){q.r=r||{};q.cb.forEach(function(f){f(q.r)})}).withFailureHandler(function(){q.r={errore:1};q.cb.forEach(function(f){f(q.r)})}).api(CHIAVE,'apiControllaSettIA',[iaPer(G)])},
    iaT=null;
  if(IA==='1')document.querySelectorAll('.sw-g textarea').forEach(function(t){t.addEventListener('input',function(){clearTimeout(iaT);iaT=setTimeout(function(){if($('#p0'))iaChiedi(leggi())},1500)})});
  var pubblica=function(G,forza,ia){
    // controlli prima di pubblicare (avvisano soltanto: si può sempre pubblicare lo stesso)
    if(!forza&&IA==='1'&&ia===undefined&&!G.every(function(x){return !righe(x.primi).length&&!righe(x.secondi).length})){
      var fatto=false,vai=function(r){if(fatto)return;fatto=true;$('#pub').disabled=false;$('#pub').textContent='Pubblica la settimana';pubblica(G,false,r&&!r.errore?r:null)};
      $('#pub').disabled=true;$('#pub').textContent='Controllo…';setTimeout(function(){vai(null)},6000);iaChiedi(G,vai);return}
    if(!forza){var w=[],vuota=G.every(function(x){return !righe(x.primi).length&&!righe(x.secondi).length}),pesce=[];DUBBIE=[];
      if(vuota)w.push('Non hai scritto nessun piatto: pubblicando così la settimana viene tolta dal sito.');
      else G.forEach(function(x,i){if(!righe(x.primi).length&&!righe(x.secondi).length)return;
        righe(x.primi).concat(righe(x.secondi)).forEach(function(y){if(PESCE.test(nrm(y))&&!/\*/.test(y)&&pesce.indexOf(y)<0)pesce.push(y)});
        controllaOggi(x.primi,x.secondi,i,{noPesce:true,noRefusi:!!ia}).forEach(function(m){w.push(o.giorni[i].nome+': '+m)})});
      if(ia&&ia.avvisi)ia.avvisi.forEach(function(a){w.unshift((a.giorno?a.giorno+': ':'')+a.testo)});
      if(pesce.length)w.push('Piatti di pesce: se il pesce è surgelato, per legge va indicato con * dopo il nome (es. Trancio di spada*). '+pesce.join(' · '));
      var corr=ia&&ia.correzioni?ia.correzioni:[];
      var box=$('#sw-ck');box.innerHTML='';
      if(w.length||corr.length){box.innerHTML='<div class="ck"><b>Controlla prima di pubblicare</b>'+(ia?'<p class="hint" style="margin:4px 0 0">Riletto dall’IA ✓</p>':'')+'<ul>'+w.slice(0,14).map(function(x){return '<li>'+e(x)+'</li>'}).join('')+
          corr.map(function(c,j){return '<li>'+(c.giorno?e(c.giorno)+': ':'')+'«'+e(c.da)+'» → «'+e(c.a)+'» <a href="#" data-co="'+j+'">correggi</a></li>'}).join('')+'</ul>'+
          (corr.length>1?'<div class="row" style="margin-top:6px"><button class="btn light" id="ck-all">Correggi tutto</button></div>':'')+
          '<div class="row"><button class="btn light" id="ck-no">Correggo</button><button class="btn gold" id="ck-ok">Pubblica lo stesso</button></div></div>';
        var applica=function(c){o.giorni.forEach(function(d,i){if(c.giorno&&c.giorno!==d.nome)return;['p','s'].forEach(function(k){var t=$('#'+k+i);if(t&&t.value.indexOf(c.da)>=0)t.value=t.value.split(c.da).join(c.a)})})};
        box.querySelectorAll('a[data-co]').forEach(function(a){a.onclick=function(ev){ev.preventDefault();applica(corr[+a.dataset.co]);a.parentNode.style.textDecoration='line-through';a.remove()}});
        if($('#ck-all'))$('#ck-all').onclick=function(){corr.forEach(applica);box.innerHTML='';toast('Corretto: controlla e pubblica')};
        var dub=DUBBIE.slice();box.scrollIntoView({behavior:'smooth',block:'start'});$('#ck-no').onclick=function(){box.innerHTML=''};
        $('#ck-ok').onclick=function(){box.innerHTML='';if(dub.length)imparaParole(dub);pubblica(leggi(),true)};return}}
    var P=G.map(function(x){return {primi:righe(x.primi).map(function(y){return pulisci(y,true)}).join('\n'),secondi:righe(x.secondi).map(function(y){return pulisci(y,true)}).join('\n')}});
    o.giorni.forEach(function(d,i){d.primi=righe(P[i].primi);d.secondi=righe(P[i].secondi)});o.pubblicata=o.giorni.some(function(d){return d.primi.length||d.secondi.length});
    if(o.lun===o.corrente){OGGI=o;memo('__oggi')}
    accoda('oggi','apiSettPubblica',[o.lun,P],function(r){if(r&&r.lun===r.corrente){OGGI=r;memo('__oggi')}});mostraOggi(o);toast(o.pubblicata?'Settimana pubblicata ✓':'Settimana tolta dal sito')};
  $('#pub').onclick=function(){pubblica(leggi())};
  $('#prom').onchange=function(){var on=this.checked,val=on?'sì':'no';
    if(DATA.regole){var r=DATA.regole.rows.filter(function(x){return /^promemoria/i.test(x[kC0]||'')})[0];if(r)r[kV0]=val;else{var n={};n[kC0]='Promemoria menù del giorno';n[kV0]=val;DATA.regole.rows.push(n)}}
    accoda('regole','apiImpostazione',['Promemoria menù del giorno',val]);toast(on?'Promemoria acceso':'Promemoria spento');mostraOggi(o)};
  if($('#tog'))$('#tog').onclick=function(){chiedi({t:'Togliere tutta la settimana dal sito?',d:'Si cancellano i piatti da lunedì a sabato di questa settimana.',ok:'Togli dal sito',pericolo:true},function(v){if(v==='ok')pubblica(leggi(true),true)})};
  var conPrezzi=function(d){DATA.prezzi=d;var kF=key(d.headers,'formula'),kC=key(d.headers,'cosa'),kP=key(d.headers,'prezzo');
    $('#prezzi').innerHTML='<p class="hint">Il + davanti vuol dire «in più» (pizza + 2 €).</p>'+d.rows.map(function(r,i){return '<label>'+e(r[kF])+'</label><input type="text" data-i="'+i+'" value="'+e(r[kP])+'" inputmode="decimal"><span class="hint">'+e(r[kC])+'</span>'}).join('')+
    '<div class="row"><button class="btn" id="savep">Salva i prezzi</button></div>';
    $('#savep').onclick=function(){var n=0;document.querySelectorAll('#prezzi input').forEach(function(inp){var i=+inp.dataset.i,v=inp.value.replace(/\s*€\s*/g,'').trim(),orig=DATA.prezzi.rows[i];if(v===String(orig[kP]||''))return;var o={};o[kP]=v;var oc=copia(orig);orig[kP]=v;n++;accoda('prezzi','apiSalva',['prezzi',i,o,null,oc])});if(!n)toast('Nessuna modifica')}};
  if(DATA.prezzi)conPrezzi(DATA.prezzi);else call('apiLeggi',['prezzi'],function(d){memo('prezzi');conPrezzi(d)})})()}


/* ---- opinioni: dashboard (grafici amCharts) ---- */
var OPN=null,PER=30,ROOTS=[],F={q:'',sent:'',tipo:'',tema:'',stato:'',ord:'new',testo:true,pag:0},CANEDIT=true;
var VOCI=['Cucina','Pizza','Servizio in sala','Ambiente','Tempi di attesa','Puntualità al ritiro'];
var MESI=['gen','feb','mar','apr','mag','giu','lug','ago','set','ott','nov','dic'];
var COL={pos:'#2f7a4a',mid:'#c08a1e',neg:'#b23a2e',ink:'#0b121c',gold:'#a8874e'};
var SENT={neg:'Critica',mid:'Da migliorare',pos:'Positiva'};
var TEMI=[['Attesa',/attes|lent|aspett|ritard|tempi|wait|slow|late|langsam|warte|attente/],
 ['Servizio',/personal|camerier|servizio|scortes|maleducat|antipatic|sgarbat|staff|service|rude|unfreundlich|bedienung|serveur|impoli/],
 ['Prezzo',/\bcar[oie]\b|prezz|costos|conto|expensive|price|teuer|preis|cher\b|prix/],
 ['Cibo freddo',/fredd|tiepid|\bcold\b|kalt|froid/],
 ['Qualità del cibo',/crud|bruciat|salat|insipid|scott[oa]\b|gommos|unt[oa]\b|pesant|burnt|salty|bland|undercook|verbrannt|versalzen|brul|fade\b|qualit/],
 ['Porzioni',/porzion|scars|piccol|portion|small|klein|petit/],
 ['Rumore',/rumor|confusion|nois|\blaut|bruyant|bruit/],
 ['Pulizia',/sporc|pulizi|bagn|dirty|unclean|schmutz|propre/],
 ['Prenotazione',/prenot|telefon|rispost|booking|phone|reserv/]];
var NEGW=/attes|lent|fredd|tiepid|crud|bruciat|salat|insipid|scortes|maleducat|sgarbat|sporc|rumor|car[oie]\b|pessim|deludent|mai pi|scars|cold|slow|rude|dirty|expensive|disappoint|bad|kalt|langsam|teuer|schlecht|froid|lent|cher\b|mauvais|decevant/g;
function dt(s){var m=String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?new Date(+m[3],+m[2]-1,+m[1]).getTime():NaN}
function num(x){var n=parseFloat(String(x).replace(',','.'));return isNaN(n)?null:n}
function avg(a){a=a.filter(function(x){return x!==null});return a.length?a.reduce(function(p,q){return p+q},0)/a.length:null}
function f1(x){return x===null?'–':x.toFixed(1).replace('.',',')}
function nrm(s){return String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase()}
function prep(x){var o={row:x[0],t:dt(x[1]),d:x[1],h:x[2],tipo:x[3]||'Non indicato',v:x.slice(4,10).map(num),m:num(x[10]),best:x[11],better:x[12],wish:x[13],l:x[14],stato:x[15]||'Nuova',nota:x[16]||''};
  if(x[17]||x[18]||x[19]){o.orig={best:o.best,better:o.better,wish:o.wish};o.best=x[17]||o.best;o.better=x[18]||o.better;o.wish=x[19]||o.wish}
  var mn=Math.min.apply(null,o.v.filter(function(z){return z!==null}).concat([5]));
  o.sent=(o.m!==null&&o.m<3)||mn<=2?'neg':((o.m!==null&&o.m<4)||o.better?'mid':'pos');
  var txt=nrm(o.better+' '+(o.sent!=='pos'?o.best:'')+' '+o.wish);o.temi=o.sent==='pos'?[]:TEMI.filter(function(t){return t[1].test(txt)}).map(function(t){return t[0]});
  o.low=o.v.map(function(z,k){return z!==null&&z<=2?VOCI[k]+' '+z:null}).filter(Boolean);o.all=nrm([o.d,o.tipo,o.best,o.better,o.wish,o.nota].concat(o.orig?[o.orig.best,o.orig.better,o.orig.wish]:[]).join(' '));return o}
function loadAm(cb){if(window.am5&&window.am5xy)return cb();var L=['https://cdn.amcharts.com/lib/5/index.js','https://cdn.amcharts.com/lib/5/xy.js','https://cdn.amcharts.com/lib/5/themes/Animated.js','https://cdn.amcharts.com/lib/5/locales/it_IT.js'],i=0;
  (function nx(){if(i>=L.length)return cb();var s=document.createElement('script');s.src=L[i++];s.onload=nx;s.onerror=function(){toast('Grafici non disponibili: controlla la connessione');cb()};document.head.appendChild(s)})()}
function opinioni(){if(OPN)return dash();
  var usa=function(r){CANEDIT=r.ruolo==='editor';OPN=r.righe.map(prep).filter(function(o){return !isNaN(o.t)})};
  var c=null;try{c=JSON.parse(localStorage.getItem('pn1-opn')||'null')}catch(e){}
  var nuove=function(r){try{localStorage.setItem('pn1-opn',JSON.stringify(r))}catch(e){}};
  if(c&&c.righe){usa(c);loadAm(dash);google.script.run.withSuccessHandler(function(r){if(!r||inCoda('opinioni'))return;nuove(r);if(JSON.stringify(r)!==JSON.stringify(c)){usa(r);if(cur==='opinioni')dash()}}).withFailureHandler(function(){}).api(CHIAVE,'apiOpinioni',[]);return}
  call('apiOpinioni',[],function(r){nuove(r);usa(r);loadAm(dash)})}
function root(id){var r=am5.Root.new(id);r.setThemes([am5themes_Animated.new(r)]);if(window.am5locales_it_IT)r.locale=am5locales_it_IT;r.numberFormatter.set('numberFormat','#.#');ROOTS.push(r);return r}
function xy(r,horiz){var c=r.container.children.push(am5xy.XYChart.new(r,{panX:false,panY:false,wheelX:'none',wheelY:'none',paddingLeft:0,paddingRight:6}));
  c.set('cursor',am5xy.XYCursor.new(r,{behavior:'none'}));c.get('cursor').lineY.set('visible',false);if(horiz)c.get('cursor').lineX.set('visible',false);return c}
function axisStyle(ax){ax.get('renderer').labels.template.setAll({fontSize:12,fill:am5.color(0x6d6a63)});ax.get('renderer').grid.template.setAll({stroke:am5.color(0xe7e1d4),strokeOpacity:1})}
function charts(cur){ROOTS.forEach(function(r){r.dispose()});ROOTS=[];if(!window.am5||!window.am5xy)return;
  // 1. opinioni al mese: positive / da migliorare / critiche (colonne impilate)
  var now=new Date(),mons=[];for(var i=11;i>=0;i--){var d=new Date(now.getFullYear(),now.getMonth()-i,1);mons.push({m:MESI[d.getMonth()],full:MESI[d.getMonth()]+' '+d.getFullYear(),y:d.getFullYear(),mo:d.getMonth(),pos:0,mid:0,neg:0,a:[]})}
  OPN.forEach(function(o){var d=new Date(o.t);mons.forEach(function(x){if(x.y===d.getFullYear()&&x.mo===d.getMonth()){x[o.sent]++;if(o.m!==null)x.a.push(o.m)}})});
  mons.forEach(function(x){x.avg=x.a.length?Math.round(avg(x.a)*10)/10:null;x.n=x.a.length});
  var r=root('ch-mesi'),c=xy(r),xa=c.xAxes.push(am5xy.CategoryAxis.new(r,{categoryField:'m',renderer:am5xy.AxisRendererX.new(r,{minGridDistance:24})})),ya=c.yAxes.push(am5xy.ValueAxis.new(r,{min:0,renderer:am5xy.AxisRendererY.new(r,{})}));
  axisStyle(xa);axisStyle(ya);xa.data.setAll(mons);
  ['pos','mid','neg'].forEach(function(k){var s=c.series.push(am5xy.ColumnSeries.new(r,{name:SENT[k],xAxis:xa,yAxis:ya,valueYField:k,categoryXField:'m',stacked:true,fill:am5.color(COL[k]),stroke:am5.color(0xffffff),
    tooltip:am5.Tooltip.new(r,{labelText:'{full} · {name}: {valueY}'})}));s.columns.template.setAll({width:am5.percent(62),strokeWidth:2,cornerRadiusTL:k==='neg'?4:0,cornerRadiusTR:k==='neg'?4:0});s.data.setAll(mons);s.appear(600)});
  r.container.set('layout',r.verticalLayout);var lg=r.container.children.push(am5.Legend.new(r,{centerX:am5.p50,x:am5.p50,marginTop:6}));lg.labels.template.setAll({fontSize:12});lg.data.setAll(c.series.values);
  // 2. voto medio mese per mese (linea)
  r=root('ch-media');c=xy(r);xa=c.xAxes.push(am5xy.CategoryAxis.new(r,{categoryField:'m',renderer:am5xy.AxisRendererX.new(r,{minGridDistance:24})}));ya=c.yAxes.push(am5xy.ValueAxis.new(r,{min:1,max:5,strictMinMax:true,renderer:am5xy.AxisRendererY.new(r,{})}));
  axisStyle(xa);axisStyle(ya);xa.data.setAll(mons);
  var ls=c.series.push(am5xy.LineSeries.new(r,{name:'Voto medio',xAxis:xa,yAxis:ya,valueYField:'avg',categoryXField:'m',stroke:am5.color(COL.ink),connect:false,tooltip:am5.Tooltip.new(r,{labelText:'{full}: {valueY} su 5 ({n} opinioni)'})}));
  ls.strokes.template.set('strokeWidth',2);ls.bullets.push(function(rt,se,di){if(di.dataContext&&di.dataContext.avg==null)return;return am5.Bullet.new(rt,{locationX:.5,sprite:am5.Circle.new(rt,{radius:5,fill:am5.color(COL.ink),stroke:am5.color(0xffffff),strokeWidth:2})})});ls.data.setAll(mons);ls.appear(600);
  // 3. voto medio per voce (barre orizzontali)
  var voci=VOCI.map(function(n,k){var a=cur.map(function(o){return o.v[k]}).filter(function(z){return z!==null});var mm=a.length?Math.round(avg(a)*10)/10:null;return{v:n+'  '+f1(mm),m:mm,n:a.length}}).filter(function(x){return x.n}).reverse();
  r=root('ch-voci');c=xy(r,true);ya=c.yAxes.push(am5xy.CategoryAxis.new(r,{categoryField:'v',renderer:am5xy.AxisRendererY.new(r,{minGridDistance:10})}));xa=c.xAxes.push(am5xy.ValueAxis.new(r,{min:0,max:5,strictMinMax:true,renderer:am5xy.AxisRendererX.new(r,{})}));
  axisStyle(xa);axisStyle(ya);ya.get('renderer').grid.template.set('visible',false);ya.data.setAll(voci);
  var bs=c.series.push(am5xy.ColumnSeries.new(r,{xAxis:xa,yAxis:ya,valueXField:'m',categoryYField:'v',fill:am5.color(COL.ink),stroke:am5.color(COL.ink),tooltip:am5.Tooltip.new(r,{labelText:'{categoryY}: {valueX} su 5 ({n} voti)'})}));
  bs.columns.template.setAll({height:am5.percent(55),cornerRadiusTR:4,cornerRadiusBR:4,strokeOpacity:0});
  bs.columns.template.adapters.add('fill',function(f,t){var d=t.dataItem&&t.dataItem.dataContext;return d&&d.m<3.5?am5.color(COL.neg):f});
  bs.data.setAll(voci);bs.appear(600);
  // 4. di cosa si lamentano (temi nelle critiche e nei suggerimenti)
  var tm=TEMI.map(function(t){var nn=cur.filter(function(o){return o.temi.indexOf(t[0])>=0}).length;return{tema:t[0],t:t[0]+'  '+nn,n:cur.filter(function(o){return o.temi.indexOf(t[0])>=0}).length}}).filter(function(x){return x.n}).sort(function(a,b){return a.n-b.n});
  var box=document.getElementById('ch-temi');
  if(!tm.length){box.innerHTML='<p class="hint">Nessuna critica ricorrente in questo periodo.</p>';box.style.height='auto'}else{box.style.height=(70+tm.length*34)+'px';
  r=root('ch-temi');c=xy(r,true);ya=c.yAxes.push(am5xy.CategoryAxis.new(r,{categoryField:'t',renderer:am5xy.AxisRendererY.new(r,{minGridDistance:10})}));xa=c.xAxes.push(am5xy.ValueAxis.new(r,{min:0,maxPrecision:0,renderer:am5xy.AxisRendererX.new(r,{})}));
  axisStyle(xa);axisStyle(ya);ya.get('renderer').grid.template.set('visible',false);ya.data.setAll(tm);
  bs=c.series.push(am5xy.ColumnSeries.new(r,{xAxis:xa,yAxis:ya,valueXField:'n',categoryYField:'t',fill:am5.color(COL.neg),stroke:am5.color(COL.neg),tooltip:am5.Tooltip.new(r,{labelText:'{categoryY}: {valueX} opinioni'})}));
  bs.columns.template.setAll({height:am5.percent(55),cornerRadiusTR:4,cornerRadiusBR:4,strokeOpacity:0,cursorOverStyle:'pointer'});
  bs.columns.template.events.on('click',function(ev){F.tema=ev.target.dataItem.dataContext.tema;F.pag=0;lista2();document.getElementById('cm-box').scrollIntoView({behavior:'smooth'})});
  bs.data.setAll(tm);bs.appear(600)}
  // 5. come votano
  var dist=[1,2,3,4,5].map(function(v){return{s:v+'★',n:cur.filter(function(o){return o.m!==null&&Math.min(5,Math.max(1,Math.round(o.m)))===v}).length}});
  r=root('ch-dist');c=xy(r);xa=c.xAxes.push(am5xy.CategoryAxis.new(r,{categoryField:'s',renderer:am5xy.AxisRendererX.new(r,{minGridDistance:10})}));ya=c.yAxes.push(am5xy.ValueAxis.new(r,{min:0,maxPrecision:0,renderer:am5xy.AxisRendererY.new(r,{})}));
  axisStyle(xa);axisStyle(ya);xa.data.setAll(dist);
  bs=c.series.push(am5xy.ColumnSeries.new(r,{xAxis:xa,yAxis:ya,valueYField:'n',categoryXField:'s',fill:am5.color(COL.ink),stroke:am5.color(COL.ink),tooltip:am5.Tooltip.new(r,{labelText:'{categoryX}: {valueY} opinioni'})}));
  bs.columns.template.setAll({width:am5.percent(55),cornerRadiusTL:4,cornerRadiusTR:4,strokeOpacity:0});
  bs.columns.template.adapters.add('fill',function(f,t){var d=t.dataItem&&t.dataItem.dataContext;return d&&parseInt(d.s)<=2?am5.color(COL.neg):d&&parseInt(d.s)===3?am5.color(COL.mid):f});
  bs.data.setAll(dist);bs.appear(600)}
function periodo(){var now=Date.now(),day=864e5;return{from:PER?now-PER*day:0,prev:PER?now-2*PER*day:0}}
function dash(){
  var P=periodo(),cur=OPN.filter(function(o){return o.t>=P.from}),prev=PER?OPN.filter(function(o){return o.t>=P.prev&&o.t<P.from}):[];
  var h='<h2>Opinioni dei clienti</h2><div class="seg" id="per">'+[[30,'30 giorni'],[90,'3 mesi'],[365,'12 mesi'],[0,'Tutto']].map(function(p){return '<button data-p="'+p[0]+'" class="'+(p[0]===PER?'on':'')+'">'+p[1]+'</button>'}).join('')+'</div>';
  if(!OPN.length){$('#main').innerHTML=h+'<div class="card">Ancora nessuna opinione. Arrivano dal modulo «Com’è andata?» del sito: appena un cliente lo invia, compare qui.</div>';bindPer();return}
  var m=avg(cur.map(function(o){return o.m})),mp=avg(prev.map(function(o){return o.m})),delta=(m!==null&&mp!==null)?m-mp:null;
  var sod=cur.length?Math.round(cur.filter(function(o){return o.m>=4}).length/cur.length*100):null,neg=cur.filter(function(o){return o.sent==='neg'}).length;
  h+='<div class="kpis k4"><div class="kpi"><b>'+f1(m)+'</b><span>voto medio su 5</span>'+(delta!==null?'<i>'+(delta>=0?'▲ ':'▼ ')+f1(Math.abs(delta))+' sul periodo prima</i>':'')+'</div>'+
    '<div class="kpi"><b>'+cur.length+'</b><span>opinioni</span>'+(PER?'<i>'+prev.length+' nel periodo prima</i>':'')+'</div>'+
    '<div class="kpi"><b>'+(sod===null?'–':sod+'%')+'</b><span>soddisfatti</span><i>media 4 o più</i></div>'+
    '<div class="kpi neg" id="k-neg" role="button" tabindex="0"><b>'+neg+'</b><span>⚠ critiche</span><i>tocca per vederle</i></div></div>';
  h+='<div class="card"><b>Opinioni al mese</b><p class="hint">Ultimi 12 mesi, divise per giudizio.</p><div id="ch-mesi" class="am"></div></div>'+
     '<div class="card"><b>Voto medio mese per mese</b><p class="hint">Scala da 1 a 5. Tocca un punto per i dettagli.</p><div id="ch-media" class="am"></div></div>'+
     '<div class="card"><b>Voto medio per voce</b><p class="hint">Nel periodo scelto. In rosso le voci sotto 3,5.</p><div id="ch-voci" class="am" style="height:250px"></div></div>'+
     '<div class="card"><b>Di cosa si lamentano</b><p class="hint">Temi trovati nelle critiche e nei suggerimenti. Tocca una barra per leggere quei commenti.</p><div id="ch-temi" class="am"></div></div>'+
     '<div class="card"><b>Come votano</b><p class="hint">Opinioni per voto medio arrotondato.</p><div id="ch-dist" class="am" style="height:220px"></div></div>';
  var tipi={};cur.forEach(function(o){(tipi[o.tipo]=tipi[o.tipo]||[]).push(o)});
  h+='<div class="card"><b>Per tipo di visita</b><table class="tt"><tr><th>Cosa hanno preso</th><th>Media</th><th>Opinioni</th><th>Critiche</th></tr>'+Object.keys(tipi).sort(function(a,b){return tipi[b].length-tipi[a].length}).map(function(k){var a=tipi[k];return '<tr><td>'+e(k)+'</td><td>'+f1(avg(a.map(function(o){return o.m})))+'</td><td>'+a.length+'</td><td>'+a.filter(function(o){return o.sent==='neg'}).length+'</td></tr>'}).join('')+'</table></div>';
  h+='<div class="card" id="cm-box"></div>';
  $('#main').innerHTML=h;bindPer();
  $('#k-neg').onclick=function(){F.sent='neg';F.pag=0;lista2();$('#cm-box').scrollIntoView({behavior:'smooth'})};
  setTimeout(function(){charts(cur)},30);lista2()}
function bindPer(){$('#per').onclick=function(ev){var b=ev.target.closest('button');if(!b)return;PER=+b.dataset.p;F.pag=0;dash()}}
var NEGWW=new RegExp('[a-zàèéìíòóùäöüßç]*(?:'+NEGW.source+')[a-zàèéìíòóùäöüßç]*','gi');
function evid(s){return e(s).replace(NEGWW,function(w){return '<mark>'+w+'</mark>'})}
function filtrate(){var P=periodo(),q=nrm(F.q).split(/\s+/).filter(Boolean);
  var a=OPN.filter(function(o){return o.t>=P.from&&(!F.sent||o.sent===F.sent)&&(!F.tipo||o.tipo===F.tipo)&&(!F.tema||o.temi.indexOf(F.tema)>=0)&&(!F.stato||o.stato===F.stato)&&(!F.testo||o.best||o.better||o.wish)&&q.every(function(w){return o.all.indexOf(w)>=0})});
  var srt={'new':function(x,y){return y.t-x.t||String(y.h).localeCompare(x.h)},old:function(x,y){return x.t-y.t},low:function(x,y){return (x.m||0)-(y.m||0)||y.t-x.t},high:function(x,y){return (y.m||0)-(x.m||0)||y.t-x.t}};
  return a.sort(srt[F.ord])}
function lista2(keep){var box=$('#cm-box');if(!box)return;var old=$('#cmlist'),top=keep&&old?old.scrollTop:0;var tipi={};OPN.forEach(function(o){tipi[o.tipo]=1});
  var sel=function(id,cur,opts){return '<select id="'+id+'">'+opts.map(function(o){return '<option value="'+e(o[0])+'"'+(o[0]===cur?' selected':'')+'>'+e(o[1])+'</option>'}).join('')+'</select>'};
  var a=filtrate(),PG=25,pages=Math.max(1,Math.ceil(a.length/PG));F.pag=Math.min(F.pag,pages-1);var pg=a.slice(F.pag*PG,F.pag*PG+PG);
  var h='<b>Cosa dicono</b><p class="hint">Cerca, filtra e ordina. Le parole che di solito indicano un problema sono evidenziate.</p>'+
   '<input type="text" id="f-q" placeholder="Cerca una parola, es. attesa" value="'+e(F.q)+'"><div class="flt">'+
   sel('f-sent',F.sent,[['','Tutti i giudizi'],['neg','⚠ Solo critiche'],['mid','Da migliorare'],['pos','Positive']])+
   sel('f-tema',F.tema,[['','Tutti i temi']].concat(TEMI.map(function(t){return[t[0],t[0]]})))+
   sel('f-tipo',F.tipo,[['','Ogni visita']].concat(Object.keys(tipi).map(function(t){return[t,t]})))+
   sel('f-stato',F.stato,[['','Ogni stato'],['Nuova','Nuove'],['In lavorazione','In lavorazione'],['Risolta','Risolte']])+
   sel('f-ord',F.ord,[['new','Più recenti'],['old','Più vecchie'],['low','Voto più basso'],['high','Voto più alto']])+'</div>'+
   '<label class="sw" style="font-weight:400;margin-top:8px"><input type="checkbox" id="f-testo" '+(F.testo?'checked':'')+'> Solo chi ha scritto un commento</label>'+
   '<div class="cmbar"><span><b>'+a.length+'</b> opinioni'+(F.sent||F.tema||F.tipo||F.stato||F.q?' · <a href="#" id="f-reset">togli i filtri</a>':'')+'</span>'+(CANEDIT&&a.length?'<button class="btn light" id="f-exp">Esporta (arriva per email)</button>':'')+'</div>';
  h+='<div class="cmlist" id="cmlist">';
  h+=pg.length?pg.map(function(o){return '<div class="cm s-'+o.sent+'"><div class="h"><span class="tag t-'+o.sent+'">'+(o.sent==='neg'?'⚠ ':'')+SENT[o.sent]+'</span> '+e(o.d)+' '+e(o.h)+' · '+e(o.tipo)+' · media <b>'+f1(o.m)+'</b>'+(o.l&&o.l!=='it'?' · '+e(o.l.toUpperCase()):'')+'</div>'+
    (o.low.length?'<div class="low">Voti bassi: '+o.low.map(e).join(', ')+'</div>':'')+
    (o.best?'<p><b>Piaciuto:</b> '+(o.sent==='pos'?e(o.best):evid(o.best))+'</p>':'')+(o.better?'<p><b>Da migliorare:</b> '+evid(o.better)+'</p>':'')+(o.wish?'<p><b>Vorrebbe trovare:</b> '+e(o.wish)+'</p>':'')+(o.orig?'<p class="orig">Tradotto '+({en:'dall’inglese',de:'dal tedesco',fr:'dal francese'}[o.l]||'in italiano')+' · originale: «'+e([o.orig.best,o.orig.better,o.orig.wish].filter(Boolean).join(' · '))+'»</p>':'')+
    (o.temi.length?'<div class="temi">'+o.temi.map(function(t){return '<span>'+e(t)+'</span>'}).join('')+'</div>':'')+
    (CANEDIT?'<div class="act"><select data-row="'+o.row+'" class="st">'+['Nuova','In lavorazione','Risolta'].map(function(s){return '<option'+(s===o.stato?' selected':'')+'>'+s+'</option>'}).join('')+'</select><button class="btn light nt" data-row="'+o.row+'">'+(o.nota?'Modifica nota':'Aggiungi nota')+'</button></div>':'<div class="h">Stato: '+e(o.stato)+'</div>')+
    (o.nota?'<div class="nota">Nota: '+e(o.nota)+'</div>':'')+'</div>'}).join(''):'<p class="hint">Nessuna opinione con questi filtri.</p>';
  h+='</div>';
  if(pages>1)h+='<div class="pager"><button class="btn light" id="pg-p" '+(F.pag?'':'disabled')+'>‹ Indietro</button><span>Pagina '+(F.pag+1)+' di '+pages+'</span><button class="btn light" id="pg-n" '+(F.pag<pages-1?'':'disabled')+'>Avanti ›</button></div>';
  box.innerHTML=h;$('#cmlist').scrollTop=top;
  var re=function(){F.pag=0;lista2()};
  $('#f-q').oninput=function(){F.q=this.value;var p=this.selectionStart;F.pag=0;lista2();var q=$('#f-q');q.focus();q.setSelectionRange(p,p)};
  ['sent','tema','tipo','stato','ord'].forEach(function(k){$('#f-'+k).onchange=function(){F[k]=this.value;re()}});
  $('#f-testo').onchange=function(){F.testo=this.checked;re()};
  if($('#f-reset'))$('#f-reset').onclick=function(ev){ev.preventDefault();F.q='';F.sent='';F.tema='';F.tipo='';F.stato='';re()};
  if($('#pg-p'))$('#pg-p').onclick=function(){F.pag--;lista2()};
  if($('#pg-n'))$('#pg-n').onclick=function(){F.pag++;lista2()};
  box.querySelectorAll('select.st').forEach(function(s){s.onchange=function(){var o=OPN.filter(function(x){return x.row==s.dataset.row})[0];o.stato=s.value;try{localStorage.removeItem('pn1-opn')}catch(e){}accoda('opinioni','apiOpinioneStato',[o.row,o.stato,o.nota])}});
  box.querySelectorAll('button.nt').forEach(function(b){b.onclick=function(){var o=OPN.filter(function(x){return x.row==b.dataset.row})[0],_n=chiedi({t:'Nota interna',d:'Cosa abbiamo deciso o fatto (la vede solo lo staff).',campo:{tipo:'textarea',v:o.nota||''},ok:'Salva la nota'},function(v,n){if(v!=='ok')return;o.nota=String(n||'').trim();try{localStorage.removeItem('pn1-opn')}catch(e){}accoda('opinioni','apiOpinioneStato',[o.row,o.stato,o.nota]);lista2(true)})}});
  if($('#f-exp'))$('#f-exp').onclick=function(){var rows=a.map(function(o){return[o.d,o.tipo,f1(o.m),SENT[o.sent],o.temi.join(', '),o.low.join(', '),o.best,o.better,o.wish,o.stato,o.nota]});
    call('apiEsporta',[rows],function(m){toast('Ti ho mandato il file per email ('+m+')')})}}
/* ---- liste generiche ---- */
function lista(){var s=SEZ[cur],d=DATA[cur],H=d.headers,kT=key(H,s.titolo),kS=key(H,s.sotto),kG=s.gruppo?key(H,s.gruppo):null,kA=key(H,'attivo'),kTipo=key(H,'tipo');
  var h='<h2>'+s.nome+'</h2><p class="hint">'+s.aiuto+'</p><div class="row" style="margin:0 0 12px"><button class="btn gold" id="add">+ Aggiungi</button></div>';
  if(cur==='vini')h+='<a class="btn light" style="display:block;text-align:center;text-decoration:none;margin:0 0 12px" href="'+e(SITO)+'digitale/?stampa=vini" target="_blank" rel="noopener">🖨 Carta dei vini da stampare (A5, PDF)</a>';
  if(cur==='piatti'){try{var kAl=key(H,'allergeni'),kIn=key(H,'ingredienti'),kCa=key(H,'categoria'),dub=[];
    if(kAl)d.rows.forEach(function(r,i){if(!r[kT])return;var al=alNum(r[kAl]),sg=alSugg(r[kT]+' '+(r[kIn]||'')+(/^pizz/i.test(r[kCa]||'')?' pizza':'')),m=sg.filter(function(n){return al.indexOf(n)<0});
      var sig=nrm(r[kT]+'|'+(r[kIn]||'')+'|'+al.join(','));if(m.length&&ALOK.indexOf(sig)<0)dub.push('<li><a href="#" data-ai="'+i+'"><b>'+e(r[kT])+'</b></a> · forse manca '+m.map(function(n){return n+' '+AL[n-1].toLowerCase()}).join(', ')+' · <a href="#" data-alok="'+e(sig)+'">è giusto così</a></li>')});
    if(dub.length)h+='<details class="ck" style="margin:0 0 12px"><summary><b>⚠ Allergeni da controllare: '+dub.length+' '+(dub.length===1?'piatto':'piatti')+'</b></summary><p class="hint" style="margin:6px 0">Dagli ingredienti sembrano mancare alcuni allergeni (obbligatori per legge). Controlla con lo chef: tocca il piatto, spunta quelli giusti e salva. Se invece è già giusto, tocca «è giusto così» e non te lo chiede più.</p><ul>'+dub.join('')+'</ul></details>'}catch(err){}}
  if(d.rows.length>12)h+='<input type="text" class="search" id="q" placeholder="Cerca…" value="'+e(cerca)+'">';
  h+='<div class="card" id="lst">';var last=null,q=cerca.toLowerCase();
  d.rows.forEach(function(r,i){if(!r[kT]&&!r[kS])return;if(q&&JSON.stringify(r).toLowerCase().indexOf(q)<0)return;
    if(kTipo&&/^esempio/i.test(r[kTipo]))return;
    if(kG&&r[kG]!==last){last=r[kG];h+='<div class="grp">'+e(last)+'</div>'}
    var badge=kA?'<button class="tg'+(/^s/i.test(r[kA])?' on':'')+'" data-tg="1" role="switch" aria-checked="'+(/^s/i.test(r[kA])?'true':'false')+'" aria-label="Attivo sul sito"><span></span></button>':'';
    var sub=cur==='avvisi'?(r[kTipo]||'')+' · '+(r[key(H,'dal')]||'')+(r[key(H,'al')]?' → '+r[key(H,'al')]:'')+(r[key(H,'pizza')]?' · '+r[key(H,'pizza')]:r[key(H,'tema')]?' · '+r[key(H,'tema')]:r[key(H,'quando')]?' · '+r[key(H,'quando')]:''):cur==='eventi'?(r[key(H,'dal')]+' → '+r[key(H,'al')]):(r[kS]||'');
    h+='<div class="item" data-i="'+i+'"><div class="t"><b>'+e(r[kT]||r[kTipo]||'')+'</b><span>'+e(sub)+'</span></div>'+badge+
      (s.ordina&&!q?'<button class="mv" data-m="-1" aria-label="Su">↑</button><button class="mv" data-m="1" aria-label="Giù">↓</button>':'')+'</div>'});
  h+='</div>';$('#main').innerHTML=h;
  if($('#q'))$('#q').oninput=function(){cerca=this.value;var p=this.selectionStart;lista();$('#q').focus();$('#q').setSelectionRange(p,p)};
  $('#add').onclick=function(){scheda(null)};
  document.querySelectorAll('#main [data-ai]').forEach(function(x){x.onclick=function(ev){ev.preventDefault();scheda(+x.dataset.ai)}});
  document.querySelectorAll('#main [data-alok]').forEach(function(x){x.onclick=function(ev){ev.preventDefault();ALOK.push(x.dataset.alok);try{localStorage.setItem('pn1-alok',JSON.stringify(ALOK.slice(-300)))}catch(er){}var li=x.closest('li'),dt=x.closest('details');if(li)li.remove();if(dt&&!dt.querySelector('li'))dt.remove();toast('Ok, segnato come giusto')}});
  $('#lst').onclick=function(ev){var it=ev.target.closest('.item');if(!it)return;var i=+it.dataset.i,m=ev.target.dataset.m;
    // interruttore Attivo: si accende o spegne senza aprire la scheda
    if(ev.target.closest('[data-tg]')){ev.stopPropagation();var R=DATA[cur].rows[i],cA=s.campi.filter(function(c){return c.h==='attivo'})[0]||{si:'SÌ',no:'NO'},orig=copia(R),o={};
      o[kA]=/^s/i.test(R[kA])?cA.no:cA.si;R[kA]=o[kA];accoda(cur,'apiSalva',[cur,i,o,null,orig]);toast(/^s/i.test(o[kA])?'Attivo: si vede sul sito (nelle sue date)':'Spento: non si vede sul sito');lista();return}
    if(m){ev.stopPropagation();var R=DATA[cur].rows,j=i+(+m>0?1:-1);if(j<0||j>=R.length)return;var orig=copia(R[i]),tmp=R[i];R[i]=R[j];R[j]=tmp;accoda(cur,'apiSposta',[cur,i,+m,orig]);lista();return}scheda(i)}}

/* ---- controlli prima di salvare: allergeni, refusi, doppioni simili, surgelati, prezzi ---- */
// parole che indicano un allergene (aiuto: la decisione finale resta dello chef)
var ALW=[[1,/farin|pasta\b|pane\b|pani\b|pangrattat|grissin|crostin|bruschett|gnocc|pizza|impast|focacc|tagliatell|pappardell|spaghett|raviol|plin|fileja|lasagn|cous|orzo|farro|segale|birra|panat|impanat|pastella|cotolett|cordon|seitan|piadin|cracker|biscott|frolla|sfoglia|base pizza|pizza fritta|calzone/],
 [2,/gamber|scamp|aragost|astice|granch|mazzancoll|crostace|bisque/],
 [3,/uov|tuorl|maiones|frittat|carbonara|albume|tagliatell|pappardell|raviol|plin|cordon|cotolett|frolla/],
 [4,/pesce|acciug|alic[ie]\b|tonn|salmon|baccal|merluzz|branzin|orata|spada|colatura|bottarga|sgombr|cacciucc/],
 [5,/arachid|nocciolin/],[6,/\bsoia|edamame|tofu/],
 [7,/latte|mozzarell|burrat|formagg|parmigian|grana\b|pecorin|gorgonzol|taleggi|provol|scamorz|ricott|mascarpon|fontin|castelmagno|caciocavall|stracciatell|burro|panna|fondut|besciamell|bufala|crescenza|stracchin|cacio\b|cacio e pepe|carbo-crema/],
 [8,/\bnoci\b|\bnoce\b|nocciol|mandorl|pistacchi|anacard|pinoli|pesto/],[9,/sedan|soffritt|ragu|ragù/],[10,/senap|mostard/],[11,/sesam|tahin/],
 [12,/\bvino\b|nebbiolo|magliocco|aceto|balsamic|solfit|marsala|prosecco|riduzione al/],[13,/lupin/],
 [14,/cozz|vongol|polp(?!ett)|polip|calamar|seppi|totan|ostric|capesant|moscardin|frutti di mare|lumach|fasolar/]];
function alSugg(txt){var t=nrm(txt);return ALW.filter(function(a){return a[1].test(t)}).map(function(a){return a[0]})}
// vocabolario: tutte le parole già usate nel menù + parole di cucina comuni
var VOC={piatti:'allo alla alle agli alle della dello delle degli dalla dallo nella nello nelle negli sulla sullo sulle sugli dalle dagli con senza oppure fresco fresca freschi fresche casa nostro nostra nostri nostre forno scoglio mare terra giorno ripieno ripiena ripieni saltato saltata saltati gratinato gratinata gratinati croccante croccanti profumato profumata leggero leggera delicato delicata rustico rustica tradizionale nonna stagione stagionale tipico tipica antica antico verace veraci nero nera bianca bianche rosse fumé fume speziato speziata mantecato mantecata cotto cotta cotti crude crudo affettato tostato tostata aromatico aromatiche erbe agrumi limone arancia lime menta prezzemolo rosmarino salvia timo alloro maggiorana erba cipollina pepe sale olio burro panna latte mollica pane pangrattato zucchero miele vino cottura lenta lungo lunga antipasto antipasti primo primi secondo secondi contorno contorni pizza pizze speciale speciali margherita marinara diavola capricciosa quattro stagioni formaggi napoli calabrese pugliese bufalina ortolana tirolese tedesca calzone fritto fritta fritti focaccia pomodoro pomodorini san marzano mozzarella fior latte basilico origano aglio olio extravergine oliva olive nere taggiasche capperi acciughe alici tonno cipolla tropea rossa peperoni peperoncino piccante salame salamino salsiccia finocchietto prosciutto cotto crudo parma speck bresaola mortadella guanciale pancetta lardo arnad nduja wurstel funghi champignon porcini chiodini tartufo carciofi zucchine melanzane rucola grana parmigiano pecorino romano gorgonzola taleggio provola scamorza affumicata ricotta mascarpone burrata stracciatella fontina castelmagno caciocavallo pistacchio noci nocciole mandorle pinoli miele patate patatine forno grigliate griglia verdure stagione insalata mista verde gamberi gambero rosso mazara scampi cozze vongole calamari polipo polpo seppie pesce spada branzino orata salmone baccalà frutti mare crudo crudi tartare carpaccio battuta manzo vitello maiale pollo tacchino cervo capriolo cinghiale agnello costata tagliata filetto guancetta brasata brasato ragù bolognese carbonara amatriciana cacio pepe risotto milanese zafferano gnocchi pappardelle tagliatelle spaghetti spaghettone linguine paccheri ravioli raviolo plin lasagne fileja carnaroli riserva castagne mirtilli salsa crema vellutata fonduta riduzione nebbiolo magliocco vino bianco aceto balsamico maionese senape sesamo soia hummus ceci fagioli lenticchie bisque gremolada midollo tuorlo uovo uova marinato cialda crusco confettura pera fichi trifolati scottato scottata affumicato sott’aceti gnocco bruschette polpette tagliere salumi miste misto selezione crostacei bimbi cheeseburger cotoletta impasto integrale carbone vegetale aggiunta condimenti coperto glutine trancio tranci trancetto filetto filetti fettina fettine fetta fette spiedino spiedini involtino involtini polpetta polpette polpettone medaglione medaglioni scaloppina scaloppine cotoletta cotolette bistecca bistecche fiorentina tagliata straccetti spezzatino stufato stracotto arrosto arrosti arrostito arrostita bollito bolliti lesso brasato ossobuco ossibuchi stinco stinchi guancia guanciale coppa lonza arista porchetta cotechino zampone luganega luganiga salsicce rognone fegato fegatini trippa lampredotto coda cappone faraona anatra petto petti coscia cosce sovracoscia alette pollo galletto tacchino quaglia coniglio lepre cinghiale capriolo cervo agnello abbacchio capretto vitello vitellone manzo scottona maiale suino maialino bovino carpaccio tartare battuta roastbeef vitel tonné tonnato hamburger spada tonno salmone merluzzo nasello baccala stoccafisso orata branzino spigola ricciola rombo sogliola platessa trota persico lavarello coregone luccio pesce persico sgombro sardine sarde alici acciughe triglie triglia cernia dentice pagello sarago palombo verdesca razza gallinella scorfano coda di rospo rana pescatrice seppia seppie seppioline calamari calamaretti totani polpo polipo moscardini gamberi gamberetti gamberoni mazzancolle scampi aragosta astice granchio cozze vongole telline cannolicchi capesante ostriche fasolari frutti mare crostacei molluschi bottarga colatura fagioli fagiolini cannellini borlotti ceci lenticchie piselli fave lupini edamame soia patate patatine purè pure crocchette spinaci bietole bieta erbette cicoria catalogna friarielli broccoli broccoletti cavolfiore cavolo cavoli verza cavolo nero cappuccio cavoletti bruxelles carciofi carciofini asparagi zucchine zucchina melanzane melanzana peperoni peperone peperonata caponata ratatouille pomodori pomodorini datterini ciliegini cipolle cipolline scalogno porri porro sedano carote carota finocchi finocchio rape rapa ravanelli radicchio indivia scarola lattuga songino valeriana rucola crescione misticanza funghi porcini champignon chiodini finferli galletti pioppini tartufo zucca castagne mais olive capperi friggitelli cetrioli barbabietola topinambur cardi germogli verdure ortaggi contorno contorni insalata insalatina pasta paste spaghetti spaghettoni spaghettini vermicelli linguine bavette tagliolini tagliatelle fettuccine pappardelle lasagne lasagna cannelloni ravioli raviolini tortellini tortelloni tortelli agnolotti plin cappelletti anolini culurgiones mezzelune penne pennette rigatoni maccheroni mezze maniche sedanini fusilli trofie orecchiette cavatelli strozzapreti pici bigoli garganelli farfalle conchiglie paccheri ziti candele calamarata mafalde reginette casarecce gramigna tubetti ditalini orzo farro riso risotto risotti arancini gnocchi gnocchetti malloreddus pizzoccheri canederli spatzle passatelli minestra minestrone zuppa zuppe vellutata crema passato brodo consommé pasta fagioli ribollita pappa acquacotta polenta polentina taragna frittata frittate tortino sformato flan quiche torta salata burro olio aglio peperoncino prezzemolo basilico salvia rosmarino timo origano maggiorana alloro menta finocchietto aneto erba cipollina pepe noce moscata zafferano curry paprika cannella chiodi garofano ginepro vino bianco rosso marsala aceto balsamico limone arancia lime agrumi miele senape maionese ketchup salsa salse sugo sughi ragu ragout pesto pesto genovese pomodoro passata pelati concentrato panna latte besciamella fonduta formaggio formaggi mozzarella bufala burrata stracciatella ricotta mascarpone gorgonzola taleggio fontina asiago montasio provolone provola scamorza caciocavallo pecorino parmigiano grana padano reggiano robiola stracchino crescenza squacquerone castelmagno bitto casera emmental brie crosta uovo uova tuorlo albume pancetta speck prosciutto crudo cotto bresaola salame salamino mortadella nduja lardo culatello coppa salumi tagliere affettati gratin gratinato gratinata gratinati gratinate impanato impanata impanati panato panata fritto fritta fritti fritte frittura pastella tempura griglia grigliato grigliata grigliati alla brace piastra forno al cartoccio vapore lessato lessata saltato saltata saltati saltate trifolato trifolati spadellato spadellati stufato stufata stufati brasata mantecato mantecata affumicato affumicata marinato marinata marinati scottato scottata confit glassato glassata caramellato caramellata ripieno ripiena ripieni farcito farcita croccante croccanti cremoso cremosa morbido morbida tiepido tiepida freddo fredda caldo calda casereccio casereccia fatto in casa nostrano nostrana tradizionale classico classica rustico rustica genovese bolognese milanese napoletana siciliana romana pugliese calabrese sarda toscana ligure piemontese valtellinese veneziana carbonara amatriciana gricia arrabbiata puttanesca norma boscaiola pescatora marinara scoglio vongole carbonara cacio pepe aglio olio peperoncino quattro formaggi primavera ortolana contadina cacciatora pizzaiola parmigiana valdostana saltimbocca piccata con e al alla allo alle ai agli del della dello dei degli delle di da in su sul sulla nel nella crema di dadolata julienne cubetti scaglie granella briciole crumble chips cialda cialde dolce dolci dessert tiramisù tiramisu panna cotta cheesecake sorbetto gelato gelati semifreddo torta tortino crostata cannolo cannoli cannoncino babà baba profiteroles millefoglie affogato fondente cuore caldo cioccolato bianco frutti bosco fragole lamponi crème brûlée creme brulee zabaione meringa meringata pastiera cassata sfogliatella tartufo bignè bigne biscotti cantucci amaretti savoiardi caramello caramellato salato vaniglia cannella cocco mousse soufflé souffle strudel mele crumble zuppa inglese bonet salame cioccolato macedonia ananas gelato fiordilatte nocciola caffè cacao granella frolla sfoglia pan spagna pandoro panettone colomba chiacchiere frittelle paté pate patè fegatino sformatino sformatini muggine caprino cime ripassate duchessa brioche crostino tradizione benvenuto chef abbinamento mezzanotte brindisi spumante caldarroste crostone schiacciata crudité bottone bollicine calice omaggio viola novello acciuga agliata agnolini agretti agrodolce alalunga albicocca albicocche alborella amaretto anelletti anguilla anice animelle arancine arance arrosticini arselle baci bagna cauda bagnetto baicoli battuto bergamotto bianchetti biancomangiare bocconcini boga bomboloni bottoni braciola braciole brodetto bruschetta bucatini budino busiate cacciagione cacciucco caciotta caciucco campanelle capocollo caprese carciofo cardoncelli carpione carrè casatiello casoncelli castagnaccio casunziei cazzimperio cecina cedro cetriolo chiocciole ciabatta ciambella ciliegie cioppino cipollotto ciuppin cocomero coratella cornetto costine costolette crescentina crespelle crostini cuscus dolcetti farinata favette fegatelli fettunta finanziera finocchiona frattaglie fregola frico galantina gelatina gianduia gnudi granita grissini gubana impepata lampascioni lingua lombata lombo lumache malfatti marmellata maritozzo melagrana missoltini mondeghili more mostarda nervetti occhiata ombrina padellata pagnotta pajata palamita panelle panforte panissa pannacotta panzanella panzerotti pasticcio pere pesche piadina pistacchi pitta prugne puntarelle ricci risi pietro sartù scialatielli soppressata strangozzi strascinati struffoli supplì susine tiella tomino tonnarelli tordelli torrone tracchie trenette umbricelli uvetta vincisgrassi zeppole zuccotto affumicati glassati caramellati laccato laccata vellutato sfiziosi sfizioso brasati umido ripassato ripassata ripassati trifolata sottolio sottaceto sottaceti scottati spadellata pastellato pastellata infarinato soffritto rosolato rosolata sbriciolato sbriciolata scomposto scomposta tiepidi profumati aromatizzato aromatizzata mantecati sfumato sfumata frullato frullata emulsione pestato tartara cruda cotte dente brisè lievitato lievitazione fermentato stagionato stagionata stagionati affinato affinata erborinato sottovuoto bassa temperatura cbt legna padella wok fritture panko brunoise chiffonade concassé dadini listarelle polvere tuile spuma bavarese gel sferificazione majonese aioli tzatziki guacamole pinzimonio amuse bouche andouillette baguette béarnaise béchamel beignet beignets beurre blanc blanquette bœuf boeuf bourguignon bouillabaisse bouillon brandade cassoulet céleri champignons chantilly charcuterie chèvre choucroute clafoutis cocotte coq coquilles cordon bleu crêpe crêpes croissant croque monsieur madame croûte croûtons crudités daube éclair entrecôte escargots escalope financier flambé foie gras fricassée frites fromage galette gâteau gaufre glace gougères dauphinois hachis parmentier homard jambon macaron macarons madeleine magret meunière millefeuille mille feuille moules marinière navarin niçoise nougat omelette pain perdu palmier parfait pâtisserie paupiettes pissaladière pithiviers pot feu potage poulet lorraine rillettes rouille sabayon salade saumon soupe tapenade tarte tatin terrine tournedos rossini velouté vichyssoise vinaigrette vol vent quenelles rösti fondue raclette tartiflette sauce hollandaise dijonnaise provençale bordelaise normande lyonnaise parisienne duxelles mirepoix bouquet garni noisette sorbet chocolat praline pralin ganache nougatine tuiles opéra fraisier paris brest religieuse chouquettes canelé cannelé kouign amann mignardises petit four petits fours paella tapas tapa pintxos pinchos tortilla española gazpacho salmorejo jamón ibérico serrano chorizo morcilla croquetas patatas bravas alioli pulpo gallega gambas ajillo calamares pimientos padrón boquerones vinagre albóndigas fabada asturiana cocido madrileño churros chocolate catalana turrón empanada empanadas pisto escalivada sobrasada manchego queso fideuà arroz negro marisco mariscos merluza bacalao pil chipirones zarzuela pescaíto frito huevos rotos migas lacón callos montaditos bocadillo tostas tomate amb tomàquet chuletón solomillo secreto presa pluma cochinillo lechazo rabo toro pimentón romesco calçots mojo picón papas arrugadas ensaladilla rusa porra antequerana sangría tinto verano horchata ceviche tacos burrito nachos quesadilla enchiladas fajitas chili carne mole tamales arepas burger burgers beef chicken pork lamb steak ribs ribeye sirloin brisket pulled bacon sausage sausages ham turkey duck salmon tuna cod haddock prawns shrimp lobster crab oysters mussels scallops squid fish fries wedges mash mashed potatoes roast roasted grilled fried baked smoked braised stewed sauteed crispy creamy spicy sweet sour tangy glazed stuffed breaded battered caesar salad coleslaw onion rings nuggets wings hot dog club sandwich wrap toast bagel muffin pancakes waffles brownie pudding pie tart trifle scone scones shortbread cookie cookies cupcake donut doughnut ice cream sundae milkshake smoothie gravy mayo mustard barbecue bbq dressing ranch pickles cheddar blue cheese parmesan avocado tomato lettuce cucumber spinach mushrooms beans peas carrots corn sweetcorn rice noodles soup chowder stew tikka masala korma vindaloo naan samosa shepherd cottage and full english breakfast yorkshire sunday bangers ploughman toad hole sticky toffee eton mess bread butter vegan vegetarian gluten free dairy plant based veggie homemade fresh seasonal local organic special combo side sides starter starters main mains desserts kids menu brunch lunch dinner tasting platter sharing pinsa padellino tegamino sfilatino burratina datterino pachino spianata ventricina zola multicereali kamut canapa lievito madre biga poolish idratazione cornicione montanara battilocchio portafoglio crocchè frittatina arancino pizzetta pizzette doppio misti polpettine ascolane mozzarelle carrozza fiori espresso macchiato cappuccino ristretto corretto decaffeinato ginseng amaro digestivo limoncello grappa sambuca mirto genepì nocino vin santo passito moscato brachetto spritz aperol campari negroni americano bellini hugo prosecco sushi sashimi nigiri uramaki hosomaki temaki ramen udon soba gyoza poke wasabi teriyaki miso tofu kimchi bibimbap dumpling dumplings dim sum wonton pad thai satay basmati jasmine biryani tandoori chutney falafel couscous tajine pita kebab shawarma moussaka feta gyros souvlaki halloumi baklava goulash gulasch schnitzel wiener knödel pretzel brezel sachertorte kaiserschmarrn borscht pierogi blini cevapcici burek tabbouleh ganoush labneh harissa za’atar sumac quinoa bulgur chia açaí acai bowl granola yogurt kefir',vini:'vino vini bianco bianchi rosso rossi rosato rosati bollicine spumante brut extra dry metodo classico millesimato riserva superiore classico docg doc igt igp dop bio biologico cuvée calice bottiglia champagne premier grand cru réserve franciacorta satèn prosecco valdobbiadene conegliano cartizze trento lugana vermentino falanghina greco tufo fiano avellino gewürztraminer müller thurgau riesling sauvignon chardonnay pinot grigio nero bianco kerner sylvaner traminer malvasia grillo inzolia catarratto zibibbo moscato passito barolo barbaresco nebbiolo langhe roero arneis barbera dolcetto alba asti gavi cortese amarone valpolicella ripasso recioto bardolino soave custoza brunello montalcino rosso montepulciano nobile chianti classico morellino scansano bolgheri sangiovese ciliegiolo vernaccia gimignano aglianico taurasi primitivo manduria negroamaro salice salentino nero avola etna cerasuolo vittoria frappato cirò magliocco gaglioppo tintilia molise lambrusco sangiovese romagna sagrantino montefalco verdicchio castelli jesi pecorino passerina cannonau sardegna carignano groppello garda valtellina sforzato merlot cabernet franc syrah tenuta cantina castello poggio podere fattoria azienda agricola cascina masseria villa',bevande:'acqua naturale frizzante minerale bottiglia birra birre spina bionda ambrata rossa scura weiss weissbier ipa lager pils bock dunkel analcolica senza glutine luppoli coca cola zero fanta sprite chinotto aranciata limonata gassosa succo frutta pesca pera albicocca ace tè freddo limone caffè macchiato espresso decaffeinato ginseng orzo cappuccino tisana digestiva camomilla spritz aperol campari negroni sbagliato americano gin tonic lemon rum cola vodka whisky bourbon scotch grappa amaro limoncello sambuca mirto brandy cognac passito liquore'};
var ALOK=[];try{ALOK=JSON.parse(localStorage.getItem('pn1-alok')||'[]')}catch(e){}
var PAROLE=[];try{PAROLE=JSON.parse(localStorage.getItem('pn1-parole')||'[]')}catch(e){}
function vocab(sez){var v={};String(VOC[sez]||'').split(' ').forEach(function(w){if(w)v[nrm(w)]=w});PAROLE.forEach(function(w){v[nrm(w)]=w});[sez].forEach(function(k){var d=DATA[k];if(!d)return;d.rows.forEach(function(r){Object.keys(r).forEach(function(c){String(r[c]||'').split(/[^A-Za-zÀ-ÿ’']+/).forEach(function(w){if(w.length>=4&&!/\d/.test(w))v[nrm(w)]=v[nrm(w)]||w})})})});return v}
function lev(a,b){if(Math.abs(a.length-b.length)>2)return 9;var d=[],i,j;for(i=0;i<=a.length;i++){d[i]=[i]}for(j=1;j<=b.length;j++)d[0][j]=j;for(i=1;i<=a.length;i++)for(j=1;j<=b.length;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[a.length][b.length]}
// parole probabilmente scritte male: non presenti nel vocabolario ma molto simili a una che c'è
// la parola è conosciuta? anche al plurale o con -ini, -etti, -oni… (fagiolini ← fagioli, tranci ← trancio)
function imparaParole(L){L=L.filter(function(x){return x&&x.length>=3});if(!L.length)return;L.forEach(function(w){if(PAROLE.indexOf(w.toLowerCase())<0)PAROLE.push(w.toLowerCase())});try{localStorage.setItem('pn1-parole',JSON.stringify(PAROLE))}catch(e){}
  try{google.script.run.withSuccessHandler(function(p){if(p){PAROLE=p;try{localStorage.setItem('pn1-parole',JSON.stringify(p))}catch(e){}}}).api(CHIAVE,'apiParoleOk',[L])}catch(e){}}
function noto(n,V){if(V[n])return true;if(n.length<5)return false;var fin=['','o','i','a','e'];
  if(/[aeio]$/.test(n)){var b=n.slice(0,-1);for(var k=1;k<fin.length;k++)if(V[b+fin[k]])return true}
  var suf=['ini','ino','ina','ine','etti','etto','etta','ette','elli','ello','ella','elle','oni','one','ata','ate','ati','ato','ita','ite','iti','ito','issimo','issima'];
  for(var i=0;i<suf.length;i++){var s=suf[i];if(n.length>s.length+3&&n.slice(-s.length)===s){var r=n.slice(0,-s.length);for(var j=0;j<fin.length;j++)if(V[r+fin[j]])return true}}
  return false}
// parole corte (3 lettere) che vanno sempre bene; le altre di 3 lettere sconosciute si segnalano (es. «Linguine al ast»)
var CORTE={};'all agl dal del dei sul sui nel nei col coi con per tra fra gli una uno and the con con mix bar pub gin rum tea the uva uve sal pan tè thè bbq dop igp doc cbt kg lt cl ml pz ext mou soia due tre sei che chi non più piu via ore già gia suo sua mio mia bis top new hot red big veg pie jam bun dip pot oil egg ham cod hen rib bao poke'.split(' ').forEach(function(w){CORTE[w]=1});
function refusi(txt,V){var out=[],seen={};String(txt||'').split(/[^A-Za-zÀ-ÿ’']+/).forEach(function(w){var n=nrm(w);if(w.length<3||seen[n]||noto(n,V))return;
  if(w.length===3){seen[n]=1;if(CORTE[n]||/^[A-Z]{3}$/.test(w))return;var b3=null;Object.keys(V).forEach(function(k){if(!b3&&k.length>=3&&k.length<=4&&k[0]===n[0]&&lev(n,k)===1)b3=V[k]});out.push([w,b3||''])
    ;return}seen[n]=1;var best=null,bd=9;Object.keys(V).forEach(function(k){if(Math.abs(k.length-n.length)>1||k.slice(0,2)!==n.slice(0,2))return;var x=lev(n,k);if(x<bd){bd=x;best=V[k]}});if(best&&bd<=(n.length>=8?2:1))out.push([w,best])});return out}
// accenti e maiuscole: sistemati da soli
var ACC={'ragu':'ragù','caffe':'caffè','baccala':'baccalà','menu':'menù','pero':'però'};
// spazi doppi tolti, ma gli «a capo» restano (menù degli eventi, ingredienti su più righe)
function pulisci(s,maiusc){s=String(s||'').replace(/\r\n?/g,'\n').split('\n').map(function(r){return r.replace(/[ \t\u00a0\u200b]+/g,' ').replace(/ +([,.;:])/g,'$1').trim()}).join('\n').replace(/\n{3,}/g,'\n\n').trim();s=s.replace(/[A-Za-zÀ-ÿ]+/g,function(w){var r=ACC[w.toLowerCase()];return r?(w[0]===w[0].toUpperCase()?r[0].toUpperCase()+r.slice(1):r):w});if(maiusc&&s)s=s[0].toUpperCase()+s.slice(1);return s}
function num(x){var n=parseFloat(String(x||'').replace(',','.').replace(/[^\d.]/g,''));return isNaN(n)?null:n}
function mediana(a){a=a.filter(function(x){return x!==null}).sort(function(x,y){return x-y});return a.length?a[Math.floor(a.length/2)]:null}
function controlla(sez,o,H,i){var err=[],warn=[],V=vocab(sez),d=DATA[sez],k=function(h){return key(H,h)};
  if(sez==='piatti'){var nm=o[k('piatto')]||'',ing=o[k('ingredienti')]||'',cat=o[k('categoria')]||'',pr=k('prezzo');
    var al=alNum(o[k('allergeni')]),sg=alSugg(nm+' '+ing+(/^pizz/i.test(cat)?' pizza':''));
    var mancano=sg.filter(function(n){return al.indexOf(n)<0});
    if(mancano.length)warn.push('Allergeni: dagli ingredienti sembrano esserci anche '+mancano.map(function(n){return n+' · '+AL[n-1]}).join(', ')+'. Controlla con lo chef e spunta quelli giusti.');
    if(!al.length&&!sg.length)warn.push('Nessun allergene segnato: confermi che il piatto non ne contiene nessuno?');
    if(/gamber|scamp|aragost|astice|granch|mazzancoll|pesce|tonn|salmon|baccal|merluzz|branzin|orata|spada|cozz|vongol|polp|polip|calamar|seppi|totan|capesant|frutti di mare|crud/.test(nrm(nm+' '+ing))&&!/\*/.test(nm+ing))
      warn.push('Pesce o frutti di mare: se sono surgelati, per legge va indicato. Aggiungi * dopo il nome (es. Gambero* scottato).');
    if(pr&&o[pr]!==''){var p=num(o[pr]);if(p===null)err.push('Il prezzo deve essere un numero (es. 12 oppure 12,50).');
      else{var m=mediana(d.rows.filter(function(r,j){return j!==i&&r[k('categoria')]===cat}).map(function(r){return num(r[pr])}));
        if(m&&(p>m*2.5||p<m*.4))warn.push('Prezzo '+o[pr]+' €: in «'+cat+'» i prezzi di solito sono intorno ai '+m+' €. È giusto?')}}
    else if(pr)warn.push('Manca il prezzo.');
    refusi(nm+' '+ing,V).forEach(function(x){DUBBIE.push(x[0]);warn.push((x[1]?'«'+x[0]+'» è scritto bene? Forse intendevi «'+x[1]+'».':'«'+x[0]+'»: parola che non conosco, controlla che sia scritta bene.'))})}
  if(sez==='vini'){var b=num(o[k('prezzo bott')]),c=num(o[k('prezzo cal')]),wn=nrm(o[k('vino')]+' '+(o[k('produttore')]||'')),wc=o[k('categoria')]||'',wr=o[k('regione')]||'';
    var REG=[[/barolo|barbaresco|roero|arneis|langhe|barbera|dolcetto|gavi|nebbiolo d.alba|asti\b/,'Piemonte'],[/amarone|valpolicella|ripasso|recioto|bardolino|soave|custoza|prosecco|valdobbiadene|conegliano|cartizze/,'Veneto'],
      [/franciacorta|valtellina|sforzato|oltrepo|groppello/,'Lombardia'],[/brunello|montalcino|chianti|morellino|scansano|bolgheri|vernaccia|nobile di montepulciano|ciliegiolo/,'Toscana'],
      [/greco di tufo|fiano|taurasi|falanghina|aglianico del taburno/,'Campania'],[/primitivo|negroamaro|salice salentino|castel del monte/,'Puglia'],[/nero d.avola|grillo|inzolia|catarratto|etna|cerasuolo di vittoria|frappato|zibibbo|pantelleria/,'Sicilia'],
      [/ciro|magliocco|gaglioppo/,'Calabria'],[/tintilia/,'Molise'],[/lambrusco|sangiovese di romagna|albana/,'Emilia'],[/sagrantino|montefalco/,'Umbria'],[/verdicchio|pecorino.*offida|passerina/,'Marche'],
      [/montepulciano d.abruzzo|trebbiano d.abruzzo|cerasuolo d.abruzzo/,'Abruzzo'],[/cannonau|carignano del sulcis|vermentino di gallura/,'Sardegna'],[/gewurztraminer|lagrein|schiava|santa maddalena|kerner|muller thurgau/,'Alto Adige'],
      [/trento doc|teroldego|marzemino/,'Trentino'],[/champagne/,'Francia']];
    var ART={Piemonte:'del',Veneto:'del',Lombardia:'della',Toscana:'della',Campania:'della',Puglia:'della',Sicilia:'della',Calabria:'della',Molise:'del',Emilia:'dell’',Umbria:'dell’',Marche:'delle',Abruzzo:'dell’',Sardegna:'della','Alto Adige':'dell’',Trentino:'del'};
    var reg=REG.filter(function(x){return x[0].test(wn)})[0];
    if(reg&&wr&&nrm(wr).indexOf(nrm(reg[1]))<0&&!(reg[1]==='Alto Adige'&&/trentino|alto adige|sudtirol/.test(nrm(wr))))warn.push('«'+o[k('vino')]+'» di solito è un vino '+(reg[1]==='Francia'?'francese':ART[reg[1]]+(/’$/.test(ART[reg[1]])?'':' ')+reg[1])+', ma hai scelto la regione «'+wr+'». È giusto?');
    var tipo=/rosato|rose\b|cerasuolo d.abruzzo|chiaretto/.test(wn)?'rosati':/champagne|franciacorta|prosecco|spumante|brut|metodo classico|trento doc|cartizze|extra dry|pas dose|saten/.test(wn)?'bollicine':
      /passito|recioto|moscato d.asti|vin santo|zibibbo/.test(wn)?'dessert':
      /barolo|barbaresco|amarone|valpolicella|ripasso|brunello|chianti|morellino|primitivo|negroamaro|nero d.avola|aglianico|taurasi|nebbiolo|barbera|dolcetto|sagrantino|cannonau|lambrusco|tintilia|ciliegiolo|magliocco|merlot|cabernet|syrah|pinot nero|lagrein|teroldego|montepulciano d|sangiovese|groppello|frappato|gaglioppo/.test(wn)?'rossi':
      /gewurztraminer|lugana|vermentino|falanghina|greco|fiano|arneis|gavi|soave|verdicchio|grillo|inzolia|chardonnay|sauvignon|pinot grigio|pinot bianco|riesling|kerner|muller|malvasia|trebbiano|pecorino|passerina|catarratto|vernaccia|custoza|traminer/.test(wn)?'bianchi':'';
    if(tipo&&wc&&nrm(wc).indexOf(tipo)<0&&!(tipo==='bollicine'&&/spumant|bollicin/.test(nrm(wc))))warn.push('«'+o[k('vino')]+'» sembra '+{rosati:'un rosato',bollicine:'una bollicina',dessert:'un vino da dessert',rossi:'un vino rosso',bianchi:'un vino bianco'}[tipo]+', ma la categoria scelta è «'+wc+'». È giusto?');
    if(o[k('prezzo bott')]&&b===null)err.push('Il prezzo della bottiglia deve essere un numero.');
    if(o[k('prezzo cal')]&&c===null)err.push('Il prezzo al calice deve essere un numero.');
    if(b!==null&&c!==null&&c>=b)err.push('Il calice costa più (o uguale) della bottiglia: controlla i due prezzi.');
    var mzS=k('prezzo mezza')?o[k('prezzo mezza')]:'',mz=mzS?num(mzS):null;
    if(/37[,.]5|mezza|½|·/i.test(String(o[k('prezzo bott')]||'')))err.push('Nel prezzo della bottiglia scrivi solo il numero: la mezza bottiglia ha il suo campo qui sotto.');
    if(mzS&&mz===null)err.push('Il prezzo della mezza bottiglia deve essere un numero.');
    if(mz!==null&&b!==null&&mz>=b)err.push('La mezza bottiglia costa quanto o più della bottiglia intera: controlla i prezzi.');
    if(mz!==null&&c!==null&&mz<=c)warn.push('La mezza bottiglia costa meno (o uguale) di un calice: è giusto?');
    if(c!==null&&c>15)warn.push('Calice a '+o[k('prezzo cal')]+' €: è giusto?');
    if(!o[k('prezzo bott')])warn.push('Manca il prezzo della bottiglia.');
    refusi(o[k('vino')]+' '+o[k('produttore')],V).forEach(function(x){DUBBIE.push(x[0]);warn.push((x[1]?'«'+x[0]+'» è scritto bene? Forse intendevi «'+x[1]+'».':'«'+x[0]+'»: parola che non conosco, controlla che sia scritta bene.'))})}
  if(sez==='bevande'){var pv=o[k('prezzo')]||'';if(!pv)warn.push('Manca il prezzo.');else if(!/^\d+([.,]\d{1,2})?(\s*\/\s*\d+([.,]\d{1,2})?)?$/.test(pv.replace(/\s*€/,'')))err.push('Il prezzo deve essere un numero (es. 3,50) oppure due misure (es. 7 / 9).');
    refusi(o[k('bevanda')],V).forEach(function(x){DUBBIE.push(x[0]);warn.push((x[1]?'«'+x[0]+'» è scritto bene? Forse intendevi «'+x[1]+'».':'«'+x[0]+'»: parola che non conosco, controlla che sia scritta bene.'))})}
  if(sez==='eventi'){var VE=vocab('piatti'),righe=[];menuSezioni(String(o[k('men')]||''),'it').forEach(function(x){righe=righe.concat(x.items)});
    righe.forEach(function(rg){var ws=rg.split(/[^A-Za-zÀ-ÿ’']+/).filter(function(w){return w.length>=3});if(ws.length&&!ws.some(function(w){return VE[nrm(w)]}))warn.push('«'+rg+'» non sembra un piatto che conosco: controlla che sia scritto bene.')});
    refusi(righe.join(' '),VE).forEach(function(x){DUBBIE.push(x[0]);warn.push((x[1]?'«'+x[0]+'» è scritto bene? Forse intendevi «'+x[1]+'».':'«'+x[0]+'»: parola che non conosco, controlla che sia scritta bene.'))});
    var pe=o[k('prezzo')];if(pe&&num(pe)===null)err.push('Il prezzo deve essere un numero (es. 45).');
    if(o[k('dal')]&&o[k('al')]&&toIso(o[k('al')])<toIso(o[k('dal')]))err.push('La data «fino al» è prima di «si vede dal».')}
  // il nome ha senso per questa sezione? (almeno una parola conosciuta, o una voce già usata)
  var kN={piatti:'piatto',vini:'vino',bevande:'bevanda'}[sez];
  if(kN&&o[k(kN)]){var nmw=String(o[k(kN)]).split(/[^A-Za-zÀ-ÿ’']+/).filter(function(w){return w.length>=3}),altre={piatti:'vini',vini:'bevande',bevande:'vini'},Vo=vocab(sez==='vini'?'bevande':'vini'),Vf=vocab('piatti');
    var conosce=nmw.some(function(w){return V[nrm(w)]}),altrove=nmw.filter(function(w){return !V[nrm(w)]&&(Vo[nrm(w)]||(sez!=='piatti'&&Vf[nrm(w)]))});
    var BRAND=/poretti|menabrea|moretti|peroni|heineken|paulaner|ichnusa|nastro azzurro|corona|tennent|guinness|leffe|beck|coca|fanta|sprite|schweppes|red bull|san pellegrino|levissima|aperol|campari|martini|jagermeister|baileys/;
    if(sez==='vini'&&BRAND.test(nrm(o[k(kN)])))warn.push('«'+o[k(kN)]+'» sembra una bevanda (birra, bibita o liquore), non un vino: va nella sezione Bevande?');
    else if(altrove.length&&!conosce)warn.push('«'+o[k(kN)]+'» sembra appartenere a un’altra sezione ('+(Vo[nrm(altrove[0])]?{vini:'Bevande',bevande:'Vini',piatti:'Vini'}[sez]:'Piatti')+'). È giusto metterlo qui?');
    else if(!conosce&&nmw.length)warn.push('«'+o[k(kN)]+'» non è un nome che conosco come '+{piatti:'piatto',vini:'vino',bevande:'bevanda'}[sez]+': controlla che sia scritto bene e completo'+(sez==='vini'?' (es. denominazione + nome, come «Barolo Serralunga»)':'')+'.')}
  // nome molto simile a una voce che c'è già (es. Margerita / Margherita)
  var s=SEZ[sez],kT=s&&key(H,s.titolo);if(kT&&o[kT]&&s.unico){var me=nrm(o[kT]);d.rows.forEach(function(r,j){if(j===i)return;var x=nrm(r[kT]||'');if(x&&x!==me&&me.length>4&&lev(x,me)<=2)warn.push('Il nome è molto simile a «'+r[kT]+'», che c’è già: è un doppione scritto diversamente?')})}
  return {err:err,warn:warn}}
function scheda(i,pre,dopoCopia,forza){var iaFatto=false,iaRis=null,iaTok=0,dupOk=false;var s=SEZ[cur],d=DATA[cur],H=d.headers,r=i===null?(pre||{}):d.rows[i];
  var h='<h2>'+(i===null?(pre?'Copia da modificare':'Aggiungi'):'Modifica')+'</h2>'+(pre?'<p class="hint">È una copia: cambia quello che serve (almeno il nome) e tocca Salva. Verrà messa subito sotto l’originale.</p>':'')+'<div class="card" id="frm">';
  s.campi.forEach(function(c){var k=key(H,c.h);if(!k)return;var v=r[k]||'';
    var wrap='<div class="f" data-h="'+c.h+'"'+(c.se?' data-se="'+e(JSON.stringify(c.se))+'"':'')+'>';
    if(c.t==='check'){h+=wrap+'<label class="sw"><input type="checkbox" data-k="'+e(k)+'" data-t="check" data-si="'+c.si+'" data-no="'+c.no+'" '+((i===null?c.si==='SÌ':/^s/i.test(v))?'checked':'')+'> '+c.l+'</label></div>';return}
    h+=wrap+'<label>'+c.l+'</label>';
    if(c.t==='select'){if(i===null&&cur==='piatti'&&cerca)v='';h+='<select data-k="'+e(k)+'">'+c.o.map(function(o){return '<option'+(o===v?' selected':'')+'>'+e(o)+'</option>'}).join('')+'</select>'}
    else if(c.t==='scelta'){var opts=[];(c.o||[]).concat(d.rows.map(function(x){return x[k]})).forEach(function(o){o=String(o||'').trim();if(o&&opts.indexOf(o)<0)opts.push(o)});if(v&&opts.indexOf(v)<0)opts.push(v);
      h+='<select data-k="'+e(k)+'" data-t="scelta" data-l="'+e(c.l.toLowerCase())+'"><option value="">— scegli —</option>'+opts.map(function(o){return '<option'+(o===v?' selected':'')+'>'+e(o)+'</option>'}).join('')+'<option value="__nuova__">＋ Nuova '+e(c.l.toLowerCase())+'…</option></select>'+
        '<input type="text" class="nuova" placeholder="Scrivi la nuova '+e(c.l.toLowerCase())+'" style="display:none;margin-top:8px"><p class="hint">Scegli dalla lista. Usa «Nuova» solo se non c’è davvero.</p>'}
    else if(c.t==='list'){var opts={};d.rows.forEach(function(x){if(x[k])opts[x[k]]=1});h+='<input type="text" list="dl-'+c.h.replace(/\W/g,'')+'" data-k="'+e(k)+'" value="'+e(v)+'"><datalist id="dl-'+c.h.replace(/\W/g,'')+'">'+Object.keys(opts).map(function(o){return '<option value="'+e(o)+'">'}).join('')+'</datalist>'}
    else if(c.t==='pizza'){h+='<select data-k="'+e(k)+'"><option></option>'+PIZZE.map(function(o){return '<option'+(o===v?' selected':'')+'>'+e(o)+'</option>'}).join('')+'</select>'}
    else if(c.t==='textarea')h+='<textarea data-k="'+e(k)+'">'+e(v)+'</textarea>';
    else if(c.t==='date')h+='<input type="date" data-k="'+e(k)+'" data-t="date" value="'+toIso(v)+'">'+(c.vuoto?'<p class="hint">'+c.vuoto+'</p>':'');
    else if(c.t==='ora')h+='<input type="time" step="900" data-k="'+e(k)+'" value="'+e(String(v).replace('.',':').slice(0,5))+'">';
    else if(c.t==='number')h+='<input type="text" inputmode="decimal" data-k="'+e(k)+'" value="'+e(v)+'">';
    else if(c.t==='sfondo'){var mia=v&&c.o.indexOf(v)<0;if(!v)v=c.o[0];
      h+='<div class="sf" data-k="'+e(k)+'" data-t="sfondo" data-v="'+e(v)+'">'+c.o.map(function(o){return '<button type="button" class="sfo'+(o===v?' on':'')+'" data-o="'+e(o)+'">'+(o==='Nessuna'?'<i class="sfn"></i>':'<img src="'+fotoUrl(SFONDI[o]||'calici')+'" alt="" loading="lazy">')+'<span>'+e(o)+'</span></button>'}).join('')+
        '<label class="sfo sfu'+(mia?' on':'')+'">'+(mia?'<img src="'+fotoUrl(v)+'" alt="">':'')+'<span>📷 La tua foto</span><input type="file" accept="image/*" hidden></label></div>'}
    else if(c.t==='foto'){h+='<div class="foto" data-k="'+e(k)+'" data-t="foto" data-v="'+e(v)+'"><div class="fprev">'+(v?'<img src="'+fotoUrl(v)+'" alt="">':'<p class="hint">Nessuna foto: il piatto si vede senza.</p>')+'</div>'+
      '<label class="btn light">📷 Scatta o scegli una foto<input type="file" accept="image/*" hidden></label> <button type="button" class="btn bad" data-xf'+(v?'':' style="display:none"')+'>Togli la foto</button></div>'}
    else if(c.t==='allergeni'){var a=alNum(v);h+='<p class="hint sugg" id="sugg"></p><div class="al" data-k="'+e(k)+'" data-t="al">'+AL.map(function(n,j){return '<label><input type="checkbox" value="'+(j+1)+'" '+(a.indexOf(j+1)>=0?'checked':'')+'> '+(j+1)+' · '+n+'</label>'}).join('')+'</div>'}
    else h+='<input type="text" data-k="'+e(k)+'" value="'+e(v)+'"'+(c.max?' maxlength="'+c.max+'" data-max="'+c.max+'" data-ideale="'+c.ideale+'"':'')+'>'+(c.max?'<p class="hint cnt"></p>':'');
    if(c.aiutoCampo)h+='<p class="hint">'+c.aiutoCampo+'</p>';
    h+='</div>'});
  h+='<div class="row"><button class="btn gold" id="ok">Salva</button><button class="btn light" id="no">Annulla</button></div>'+(i!==null?'<div class="row"><button class="btn light" id="dup">Duplica e modifica</button><button class="btn bad" id="del">Elimina</button></div>':'')+'</div>';
  $('#main').innerHTML=h;suTop();
  if(cur==='eventi'){var mt=document.querySelector('#frm .f[data-h="men"] textarea');if(mt){
    var pv=document.createElement('div');pv.className='mo-prev';var bt=document.createElement('button');bt.type='button';bt.className='btn light';bt.textContent='✨ Metti in ordine';
    var anteprima=function(){var S=menuSezioni(mt.value,'it');pv.innerHTML=S.length?'<p class="hint" style="color:#b9b3a3;margin:0 0 8px">Anteprima sul sito</p>'+S.map(function(x){return (x.h?'<b>'+e(x.h)+'</b>':'')+x.items.map(function(t){return '<div>'+e(t)+'</div>'}).join('')}).join(''):'';pv.style.display=S.length?'':'none'};
    bt.onclick=function(){var nv=menuInOrdine(mt.value);if(nv&&nv!==mt.value){mt.value=nv;toast('Fatto: un piatto per riga. Controlla e tocca Salva')}else toast('Il menù è già in ordine');mt.style.height=Math.min(600,mt.scrollHeight+4)+'px';anteprima()};
    mt.parentNode.insertBefore(bt,mt.nextSibling);mt.parentNode.insertBefore(pv,bt.nextSibling);mt.addEventListener('input',function(){clearTimeout(anteprima.t);anteprima.t=setTimeout(anteprima,250)});
    if(mt.value&&!/\n/.test(mt.value.trim())&&mt.value.length>90){var nv0=menuInOrdine(mt.value);if(nv0&&nv0!==mt.value){mt.value=nv0;toast('Ho messo il menù in ordine, un piatto per riga: controlla e tocca Salva')}}
    mt.style.minHeight='180px';mt.style.height=Math.min(600,mt.scrollHeight+4)+'px';anteprima()}}
  function vis(){document.querySelectorAll('#frm .f[data-se]').forEach(function(f){var se=JSON.parse(f.dataset.se),ok=true;Object.keys(se).forEach(function(h){var el=document.querySelector('#frm .f[data-h="'+h+'"] [data-k]');if(el&&el.value!==se[h])ok=false});f.style.display=ok?'':'none'})}
  // contatore dei caratteri: oltre il consigliato il titolo resta leggibile ma diventa più piccolo
  function conta(el){var p=el.parentNode.querySelector('.cnt');if(!p)return;var n=el.value.length,id=+el.dataset.ideale;p.textContent=n+' / '+el.dataset.max+' caratteri'+(n>id?' · lungo: sul sito il testo sarà più piccolo (consigliato fino a '+id+')':'');p.style.color=n>id?'#b26b00':''}
  document.querySelectorAll('#frm [data-max]').forEach(function(el){conta(el);el.addEventListener('input',function(){conta(el)})});
  $('#frm').onchange=function(ev){var inp=ev.target;if(inp.type==='file'&&inp.files[0])return caricaFoto(inp);
    if(inp.dataset&&inp.dataset.t==='scelta'){var n=inp.parentNode.querySelector('.nuova');n.style.display=inp.value==='__nuova__'?'':'none';if(inp.value==='__nuova__')n.focus()}vis()};vis();
  if($('#dup'))$('#dup').onclick=function(){var c={};Object.keys(r).forEach(function(k){c[k]=r[k]});var kT=key(H,s.titolo);if(kT)c[kT]=(c[kT]||'')+' (copia)';scheda(null,c,i)};
  $('#frm').addEventListener('click',function(ev){var so=ev.target.closest('button.sfo');if(so){var sf=so.closest('.sf');sf.dataset.v=so.dataset.o;sf.querySelectorAll('.sfo').forEach(function(b){b.classList.toggle('on',b===so)});return}});
  $('#frm').addEventListener('click',function(ev){if(!ev.target.hasAttribute('data-xf'))return;var f=ev.target.closest('.foto');f.dataset.v='';f.querySelector('.fprev').innerHTML='<p class="hint">Nessuna foto.</p>';ev.target.style.display='none'});
  // suggerimento allergeni mentre si scrivono nome e ingredienti
  function sugg(){var p=$('#sugg');if(!p)return;var nm=document.querySelector('#frm .f[data-h="piatto"] [data-k]'),ig=document.querySelector('#frm .f[data-h="ingredienti"] [data-k]'),ct=document.querySelector('#frm .f[data-h="categoria"] [data-k]');
    var sg=alSugg((nm?nm.value:'')+' '+(ig?ig.value:'')+(ct&&/^pizz/i.test(ct.value)?' pizza':'')),box=document.querySelector('#frm .al');var on=[].map.call(box.querySelectorAll('input:checked'),function(x){return +x.value});
    var miss=sg.filter(function(n){return on.indexOf(n)<0});
    p.innerHTML=sg.length?('Dagli ingredienti: probabili allergeni '+sg.map(function(n){return '<b>'+n+'</b> '+AL[n-1]}).join(', ')+(miss.length?' · <a href="#" id="sugg-ok">spunta quelli mancanti</a>':' ✓')):'';
    var a=$('#sugg-ok');if(a)a.onclick=function(ev){ev.preventDefault();miss.forEach(function(n){var x=box.querySelector('input[value="'+n+'"]');if(x)x.checked=true});sugg()}}
  document.querySelectorAll('#frm .f[data-h="piatto"] [data-k],#frm .f[data-h="ingredienti"] [data-k]').forEach(function(el){el.addEventListener('input',sugg)});
  if($('#sugg')){document.querySelector('#frm .al').addEventListener('change',sugg);sugg()}
  $('#frm').addEventListener('input',function(ev){if(ev.isTrusted){iaFatto=false;iaRis=null;dupOk=false}});$('#frm').addEventListener('change',function(ev){if(ev.isTrusted){iaFatto=false;iaRis=null}});
  $('#no').onclick=lista;
  if($('#del'))$('#del').onclick=function(){chiedi({t:'Eliminare definitivamente?',d:'«'+(d.rows[i][key(H,s.titolo)]||'')+'» sparisce dal sito e dal pannello.',ok:'Elimina',pericolo:true},function(v){if(v!=='ok')return;var orig=copia(d.rows[i]);d.rows.splice(i,1);accoda(cur,'apiElimina',[cur,i,orig]);lista()})};
  $('#ok').onclick=function(){var o={},manca='';document.querySelectorAll('#frm [data-k]').forEach(function(el){var k=el.dataset.k,f=el.closest('.f');
      if(f&&f.style.display==='none'){o[k]='';return}
      if(el.dataset.t==='scelta'){var val=el.value;
        if(val==='__nuova__'){val=el.parentNode.querySelector('.nuova').value.trim();
          // scritta in modo diverso ma già esistente (maiuscole, accenti, spazi)? si usa quella che c'è
          [].forEach.call(el.options,function(op){if(op.value!=='__nuova__'&&op.value&&nrm(op.value).replace(/\s+/g,' ').trim()===nrm(val).replace(/\s+/g,' ').trim())val=op.value})}
        if(!val)manca=manca||el.dataset.l;o[k]=val;return}
      if(el.dataset.t==='check')o[k]=el.checked?el.dataset.si:el.dataset.no;
      else if(el.dataset.t==='date')o[k]=fromIso(el.value);
      else if(el.dataset.t==='foto'||el.dataset.t==='sfondo')o[k]=el.dataset.v||'';
      else if(el.dataset.t==='al')o[k]=alTxt([].map.call(el.querySelectorAll('input:checked'),function(x){return +x.value}));
      else o[k]=el.value.trim()});
    if(manca){toast('Scegli la '+manca+' (o scrivi quella nuova)');return}
    // spazi doppi, accenti (ragu → ragù) e maiuscola iniziale sistemati da soli
    Object.keys(o).forEach(function(k){if(typeof o[k]==='string'&&!/^(Foto|Allergeni|Dal|Al|Attivo|Firma)/i.test(k))o[k]=pulisci(o[k],k===key(H,s.titolo))});
    var kT=key(H,s.titolo);if(kT&&!o[kT]&&cur!=='avvisi'){toast('Manca il nome');return}
    // niente doppioni: stesso nome (e per i vini stesso produttore) già presente
    if(s.unico){var ks=s.unico.map(function(x){return key(H,x)}).filter(Boolean),sig=function(x){return ks.map(function(k){return nrm(x[k]||'').replace(/\s+/g,' ').trim()}).join('|')},me=sig(o),j=-1;
      d.rows.forEach(function(x,n){if(n!==i&&j<0&&sig(x)===me)j=n});
      if(j>=0&&!forza&&!dupOk){chiedi({t:'«'+(o[kT]||'')+'» esiste già'+(s.gruppo&&d.rows[j][key(H,s.gruppo)]?' in '+d.rows[j][key(H,s.gruppo)]:''),d:'Vuoi aprire quella che c’è già, oppure salvarla lo stesso come voce nuova?',ok:'Apri quella che c’è',alt:'Salva come nuova'},function(v){if(v==='ok')scheda(j);else if(v==='alt'){dupOk=true;$('#ok').click()}});return}}
    if(cur==='avvisi'){var kd=key(H,'dal'),kp=key(H,'pizza'),kty=key(H,'tipo');if(!o[kd]){toast('Manca la data');return}if(o[kty]==='Pizza della settimana'&&!o[kp]){toast('Scegli la pizza');return}if(o[kty]==='Promozione'&&!o[key(H,'testo')]){toast('Manca il titolo');return}if(o[kty]==='Tema del sito'&&!o[key(H,'al')]){toast('Scegli anche fino a quando');return}}
    // un errore nei controlli non deve mai impedire di salvare
    DUBBIE=[];var ck;try{ck=controlla(cur,o,H,i)}catch(err){ck={err:[],warn:[]}}var dubbie=DUBBIE.slice();var box=$('#ck');if(box)box.remove();
    // seconda opinione dell'IA (se attiva): prima dei controlli locali, una volta per ogni versione della scheda
    if(!forza&&IA==='1'&&!iaFatto&&['piatti','vini','bevande','eventi'].indexOf(cur)>=0){var ctx={};s.campi.forEach(function(c){if(c.t==='select'||c.t==='scelta'){var kk=key(H,c.h),v={};d.rows.forEach(function(x){if(x[kk])v[x[kk]]=1});ctx[c.l]=Object.keys(v).slice(0,40)}});
      var tok=Date.now(),fine=function(r,msg){if(iaTok!==tok)return;iaTok=0;busy(false);var w=$('#ia-w');if(w)w.remove();$('#ok').disabled=false;iaRis=r||{};iaFatto=true;if(msg)toast(msg);$('#ok').click()};iaTok=tok;
      var w=document.createElement('div');w.id='ia-w';w.className='ck';w.innerHTML='<b>Controllo in corso…</b><p class="hint" style="margin:6px 0 0">L’IA sta rileggendo la voce (pochi secondi).</p>';$('#frm').insertBefore(w,$('#frm').firstChild);w.scrollIntoView({behavior:'smooth',block:'start'});$('#ok').disabled=true;busy(true);
      setTimeout(function(){fine({},'L’IA non ha risposto in tempo: controllo con le regole normali')},12000);
      google.script.run.withSuccessHandler(function(r){fine(r,r&&r.errore?'IA non disponibile ora: controllo con le regole normali':'')}).withFailureHandler(function(){fine({},'IA non disponibile ora: controllo con le regole normali')}).api(CHIAVE,'apiControllaIA',[cur,o,ctx,ck.warn]);return}
    var corr=(iaRis&&iaRis.correzioni)||{},ck2=Object.keys(corr);
    if(iaRis&&iaRis.avvisi){ck.warn=ck.warn.filter(function(x){return x.indexOf('è scritto bene?')<0}).concat(iaRis.avvisi.map(function(x){return 'IA · '+x}));dubbie=[]}   // l'IA riconosce le parole meglio del dizionario
    if((ck.err.length||ck.warn.length||ck2.length)&&!forza){var b=document.createElement('div');b.id='ck';b.className='ck';
      b.innerHTML='<b>'+(ck.err.length?'Attenzione, controlla prima di salvare':'Controlla prima di salvare')+'</b><ul>'+ck.err.map(function(x){return '<li class="e">'+e(x)+'</li>'}).join('')+ck.warn.map(function(x){return '<li>'+e(x)+'</li>'}).join('')+
        ck2.map(function(f){return '<li>Proposta: <b>'+e(f)+'</b> → «'+e(corr[f])+'» <a href="#" data-cor="'+e(f)+'">applica</a></li>'}).join('')+'</ul>'+
        '<p class="hint" style="margin:6px 0 10px">Sono solo avvisi: se sei sicuro che è tutto giusto, puoi salvare lo stesso.</p><div class="row"><button class="btn light" id="ck-no">Correggo</button><button class="btn gold" id="ck-ok">'+(ck.err.length?'Salva lo stesso':'È tutto giusto, salva')+'</button></div>';
      $('#frm').insertBefore(b,$('#frm').firstChild);b.scrollIntoView({behavior:'smooth',block:'start'});
      if($('#ck-no'))$('#ck-no').onclick=function(){b.remove()};
      b.querySelectorAll('a[data-cor]').forEach(function(a){a.onclick=function(ev){ev.preventDefault();var el=document.querySelector('#frm [data-k="'+a.dataset.cor.replace(/"/g,'\\"')+'"]');
        if(el&&'value' in el){el.value=corr[a.dataset.cor];el.dispatchEvent(new Event('input'))}a.parentNode.style.textDecoration='line-through';a.remove()}});
      if($('#ck-ok'))$('#ck-ok').onclick=function(){forza=true;b.remove();if(dubbie.length)imparaParole(dubbie);$('#ok').click()};
      return}
    var kG0=s.gruppo?key(H,s.gruppo):null,dopo=null;if(i===null&&dopoCopia!=null&&(!kG0||o[kG0]===d.rows[dopoCopia][kG0]))dopo=dopoCopia;else if(i===null&&s.gruppo){var kG=key(H,s.gruppo);d.rows.forEach(function(x,j){if(x[kG]===o[kG])dopo=j})}
    var sez=cur,orig=i===null?null:copia(d.rows[i]);if(i===null)d.rows.splice(dopo==null||dopo<0?d.rows.length:dopo+1,0,riga(H,o));else d.rows[i]=Object.assign({},d.rows[i],o);accoda(sez,'apiSalva',[sez,i,o,dopo,orig]);lista()}}
// carica in sottofondo tutte le sezioni, senza bloccare lo schermo
function precarica(){google.script.run.withSuccessHandler(function(t){if(!t)return;PIZZE=t.__pizze||PIZZE;try{localStorage.setItem('pn1-pizze',JSON.stringify(PIZZE))}catch(e){}
    if('__demo' in t){DEMO=t.__demo||'';demoStriscia()}
    if(t.__parole){PAROLE=t.__parole;try{localStorage.setItem('pn1-parole',JSON.stringify(PAROLE))}catch(e){}}
    if(t.__oggi&&!inCoda('oggi')){var cambio=JSON.stringify(t.__oggi)!==JSON.stringify(OGGI);OGGI=t.__oggi;memo('__oggi');if(cambio&&cur==='oggi'&&(!SETTV||SETTV===OGGI.lun)&&!document.activeElement.closest('textarea,input'))mostraOggi(OGGI)}
    Object.keys(t).forEach(function(k){if(k.indexOf('__')===0||!t[k]||!t[k].headers||inCoda(k)||(cur===k&&($('#frm')||$('#orf'))))return;var nuovo=JSON.stringify(t[k])!==JSON.stringify(DATA[k]);DATA[k]=t[k];AGG[k]=Date.now();memo(k);if(nuovo&&inLista(k))lista()})})
  .withFailureHandler(function(){}).api(CHIAVE,'apiTutto',[])}
var DEMO='';
// striscia rossa in cima finché la demo è in corso: così non ci si dimentica di finirla
function demoStriscia(){var b=$('#demo-x');if(!DEMO){if(b)b.remove();return}if(!b){b=document.createElement('div');b.id='demo-x';b.style.cssText='background:#b23a2e;color:#fff;padding:8px 14px;font:600 14px sans-serif;text-align:center;cursor:pointer';document.body.insertBefore(b,document.body.firstChild)}
  b.textContent='DEMO DEL SITO IN CORSO dal '+DEMO+' · si finisce dall’editor con «fineDemoSito»';b.onclick=function(){toast('Apri Apps Script, scegli «fineDemoSito» in alto e premi Esegui')}}
var OGGI=null;try{PIZZE=JSON.parse(localStorage.getItem('pn1-pizze')||'[]')}catch(e){}memoLeggi();
(function(){var G=PERM.ruolo==='admin'||PERM.ruolo==='vice';
  if(!G){Object.keys(SEZ).forEach(function(k){var base=k==='categorie'?'piatti':k;if(k==='impost'||PERM.sezioni.indexOf(base)<0)delete SEZ[k]})}
  if(!SEZ[cur])cur=Object.keys(SEZ).filter(function(k){return !SEZ[k].nascosta})[0]||'pren';
  if(G||PERM.sezioni.some(function(k){return ['oggi','orari','piatti','eventi','avvisi','vini','bevande','faq'].indexOf(k)>=0}))precarica()})();
tabs();apri();
</script></body></html>`;
