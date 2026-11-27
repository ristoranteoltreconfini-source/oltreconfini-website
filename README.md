# oltreconfini
Sito del Ristorante Pizzeria Oltreconfini — https://oltreconfini.it

## Struttura
- `public/` — il sito statico (HTML, foto, font). È esattamente ciò che viene pubblicato.
- `apps-script/Pannello.gs` — lo script Google Apps Script del pannello (menù, prenotazioni, promemoria, opinioni).
  `Persone.gs`, con la chiave dell'IA, **non** va mai messo qui (è escluso da `.gitignore`).
- `wrangler.jsonc` — configurazione di Cloudflare Workers.

## Comandi
```bash
npm install
npm run dev      # anteprima su http://localhost:8787
npm run deploy   # pubblica su Cloudflare (serve CLOUDFLARE_API_TOKEN e CLOUDFLARE_ACCOUNT_ID)
```
