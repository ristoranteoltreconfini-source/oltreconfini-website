# oltreconfini
Sito del Ristorante Pizzeria Oltreconfini — https://oltreconfini.it

Tutto gira su Cloudflare, senza fogli Google né Apps Script: sito, dati del menù, pannello, prenotazioni, opinioni, email.
I dati stanno in un Durable Object con database SQLite, creato nella giurisdizione UE.

## Struttura
- `public/` — il sito statico. Legge i dati da `/dati/d/<id>` (CSV, stesso formato dei vecchi fogli), le foto da `/foto/<id>`,
  e manda prenotazioni e opinioni a `/api`.
- `src/index.js` — il Worker: indirizzi, Durable Object, lavori programmati (ogni minuto).
- `src/backend.js` — la logica del pannello (lo script Apps Script originale, adattato).
- `src/gas.js` — i sostituti dei servizi Google (fogli, proprietà, memoria, email, file) sopra il database.
- `src/auto.js` — colonne «(auto)»: copie e traduzioni EN/DE/FR (Gemini, con memoria delle traduzioni).
- `src/posta.js` — invio delle email (Resend).
- `src/pannello.html` — la pagina del pannello.
- `apps-script/Pannello.gs` — lo script originale, solo come riferimento.
- `scripts/importa.mjs` — importazione iniziale dei fogli Google pubblici.

## Comandi
```bash
npm install
npm run dev      # prova su http://localhost:8787 (segreti di prova in .dev.vars)
npm run deploy   # pubblica su Cloudflare
```

Segreti (`npx wrangler secret put NOME`): `OWNER_EMAIL`, `ADMIN_TOKEN`, `GEMINI_API_KEY`, `RESEND_API_KEY`.

Prima messa in funzione:
```bash
node scripts/importa.mjs scarica
ADMIN_TOKEN=… node scripts/importa.mjs invia https://indirizzo-del-sito/ email-del-titolare
curl -H "authorization: Bearer …" https://indirizzo-del-sito/_link   # link personale del titolare al pannello
```
