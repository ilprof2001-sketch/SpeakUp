# Aftercall — CLAUDE.md

Progetto: **Aftercall** (repo: SpeakUp)
Un AI speaking coach per inglese: registra conversazioni, trascrive con Whisper, analizza con GPT-4o e restituisce 5 correzioni mirate.

---

## Stack tecnico

| Layer | Tecnologia |
|---|---|
| Frontend | HTML/CSS/JS vanilla — zero framework, tutto in `index.html` |
| Font | Plus Jakarta Sans (Google Fonts) |
| Backend | Vercel Serverless Functions (ES modules) |
| AI — Trascrizione | OpenAI Whisper (`whisper-1`) |
| AI — Analisi/Spiegazione | OpenAI GPT-4o |
| Autenticazione | Clerk (client SDK + backend SDK) |
| Pagamenti | Stripe (Checkout + Webhooks) |
| Hosting | Vercel |
| Repo | https://github.com/ilprof2001-sketch/SpeakUp |

---

## Struttura file

```
SpeakUp/
├── index.html              # Intera app frontend (HTML + CSS + JS inline)
├── package.json            # Node.js ES modules, dipendenze: openai, stripe, @clerk/backend
├── api/
│   ├── transcribe.js       # POST /api/transcribe — audio → testo (Whisper)
│   ├── analyse.js          # POST /api/analyse   — testo → 5 correzioni (GPT-4o) + validazione Clerk
│   ├── explain.js          # POST /api/explain   — approfondimento singola correzione (GPT-4o)
│   └── stripe-webhook.js   # POST /api/stripe-webhook — gestione eventi Stripe (incl. cancellazioni)
└── .claude/
    └── settings.local.json # Permessi Claude Code per operazioni git
```

---

## Variabili d'ambiente richieste

```
OPENAI_API_KEY          # Per GPT-4o (analyse, explain) e Whisper (transcribe)
CLERK_SECRET_KEY        # Per verificare token, aggiornare metadata utenti
STRIPE_SECRET_KEY       # Per verificare e gestire eventi Stripe
STRIPE_WEBHOOK_SECRET   # Per validare la firma dei webhook Stripe
```

---

## API Endpoints

### `POST /api/transcribe`
Riceve un file audio come `multipart/form-data` (campo `audio`), lo trascrive con Whisper.
- Body parser: **disabilitato** — parsing manuale del multipart boundary
- Formati supportati: `webm`, `mp4`, `ogg`, `wav`, `m4a`
- CORS headers: presenti
- Header richiesto: `Authorization: Bearer <clerk_token>`
- Risposta: `{ text: "..." }`
- **Validazione server-side**: verifica token Clerk, controlla `publicMetadata.premium`, limita utenti free a 6 sessioni

### `POST /api/analyse`
Riceve il testo trascritto e la modalità, restituisce 5 correzioni via GPT-4o.
- Body: `{ text, mode, customFocus? }`
- Header richiesto: `Authorization: Bearer <clerk_token>`
- Risposta: `{ corrections: [{ original, corrected, explanation, category }] }`
- Categorie possibili: `grammar`, `natural`, `simplicity`, `improvement`, `custom`, `realtalk`
- Modello: `gpt-4o`, `max_tokens: 1000`
- Nota: il JSON viene estratto con `.replace(/```json|```/g, '').trim()` prima del parse
- CORS headers: presenti
- **Validazione server-side**: verifica token Clerk, controlla `publicMetadata.premium`, limita utenti free a 6 sessioni, incrementa `privateMetadata.sessionCount`

### `POST /api/explain`
Approfondimento di una singola correzione, adattato al mode attivo.
- Body: `{ original, corrected, explanation, category, mode }`
- Risposta: `{ text: "..." }` (3–5 frasi in plain text)
- Modello: `gpt-4o`, `max_tokens: 300`
- CORS headers: presenti
- Header richiesto: `Authorization: Bearer <clerk_token>`
- **Validazione**: verifica token Clerk (nessun conteggio sessioni — explain è azione secondaria)

### `POST /api/stripe-webhook`
Riceve eventi Stripe e aggiorna Clerk quando un utente acquista o cancella Premium.
- Body parser: **disabilitato** — raw body per verifica firma
- Eventi gestiti:
  - `checkout.session.completed` → `publicMetadata.premium = true`
  - `customer.subscription.created` → `publicMetadata.premium = true`
  - `customer.subscription.updated` → `publicMetadata.premium = true`
  - `customer.subscription.deleted` → `publicMetadata.premium = false`
- Flusso: estrae email cliente → cerca utente Clerk → aggiorna `publicMetadata.premium`

---

## Autenticazione — Clerk

**Frontend** (`index.html`):
- SDK caricato via `<script>` con chiave pubblica di produzione: `pk_live_Y2xlcmsuYWZ0ZXJjYWxsLnRlY2gk`
- `window.Clerk.load()` all'evento `load` della pagina
- Login modal: `window.Clerk.mountSignIn(el)` montato dinamicamente su `#clerk-mount`
- Rilevamento utente: `window.Clerk.user` — se presente, l'utente è loggato
- Premium check: `window.Clerk.user.publicMetadata.premium === true`
- Sign-out: `window.Clerk.signOut()`
- Il bottone utente (`#user-button-mount`) viene mostrato solo da loggati
- Token inviato a `/api/analyse` via `Authorization: Bearer` header

**Backend** (`analyse.js`):
- `createClerkClient({ secretKey })` da `@clerk/backend`
- `clerk.verifyToken(token)` per autenticare la richiesta
- `privateMetadata.sessionCount` per tracciare le sessioni server-side
- Limite: 6 sessioni per utenti free, illimitate per Premium

**Backend** (`stripe-webhook.js`):
- `clerk.users.getUserList({ emailAddress: [...] })` per trovare l'utente
- `clerk.users.updateUserMetadata(id, { publicMetadata: { premium: true/false } })`

---

## Pagamenti — Stripe

- Link checkout hardcoded in `index.html`: `https://buy.stripe.com/5kQbJ18OZ1BAa5ic8K5AQ00`
- `handleUpgrade()` apre il link in `_blank`
- Il webhook riceve la conferma e setta/resetta il flag Premium su Clerk
- Prezzo: **€9.99/mese**
- Cancellazione abbonamento gestita: `customer.subscription.deleted` → `premium = false`

---

## Flusso sessioni e limiti

| Tipo utente | Sessioni massime |
|---|---|
| Guest (non loggato) | 3 |
| Loggato (free) | 6 |
| Premium | Illimitate |

- Il contatore sessioni lato client è in `localStorage` (`aftercall_sessions`) — usato per UX
- Il contatore sessioni **server-side** è in `privateMetadata.sessionCount` su Clerk (verificato in `/api/analyse`)
- Lo storico correzioni è salvato in `localStorage` (`aftercall_history`)
- Durata massima registrazione free: **5 minuti (300 secondi)**
- Durata massima Premium: **30 minuti (1800 secondi)**
- Il limite è applicato lato frontend (`getMaxSeconds()` → 300 o 1800 in base a `isPremium()`) e lato backend (`transcribe.js` → size check: 8MB free, 25MB premium)
- Quando le sessioni finiscono: guest → modal login, loggato → paywall overlay

---

## Modalità di analisi

### `top5` (default)
Le 5 correzioni più impattanti su tutti i livelli (grammatica, naturalezza, fluency, scelta lessicale). Priorità a errori che suonano innaturali a un madrelingua.

### `realtalk`
Inglese informale/casuale. Non corregge slang accettati dai madrelingua (`gonna`, `wanna`, `ain't`). Suggerisce la versione colloquiale quando il parlante usa l'inglese troppo formale. Tono amichevole e leggermente ironico. Usa la categoria `realtalk` per osservazioni su slang/informalità.

### `custom`
L'utente specifica il focus (es. "C1 exam", "job interview", "prepositions"). Il prompt si adatta:
- **Esami**: analisi rigorosa, vocabolario sofisticato, penalizza frasi piatte
- **Topic grammaticale**: si concentra solo su quel topic
- **Contesto** (lavoro, accademico): adatta tono e vocabolario

---

## Funzionalità implementate

### Frontend
- Landing page con hero, sezione "Come funziona" (3 step), pricing (Free/Premium)
- Registrazione audio via `MediaRecorder` + `AudioContext` per waveform animata (12 barre)
- SVG ring progress attorno al bottone record (conta fino a 5 minuti)
- Barra progresso tempo con colori warn/danger
- Fallback: input manuale del testo (textarea) se non si vuole registrare
- Badge sessioni rimaste (verde → giallo → rosso)
- Banner bottom fixato che appare dopo la prima sessione guest
- Risultati: 5 correction card con animazione `fadeUp` scalata
- "Tell me more": carica spiegazione approfondita lazy (via `/api/explain`)
- "Copy": copia testo formattato con emoji negli appunti
- "𝕏 Share": apre Twitter intent pre-compilato con la correzione
- "New session": reset completo dello stato UI
- Progress Drawer (slide-in da destra):
  - Streak giorni consecutivi + best streak
  - Dot settimanali (7 giorni, lun-dom)
  - Statistiche (sessioni totali, correzioni totali)
  - Grafico a barre per categorie di errori più frequenti
  - Lista sessioni passate espandibili
- Effetto parallasse radiale sul background (segue il mouse)
- Animazione coriandoli al completamento analisi
- Modal login Clerk
- Paywall overlay per upgrade Premium
- Favicon SVG (emoji 🎙️) e meta description presenti

### Backend
- Parsing multipart manuale in `transcribe.js` (senza librerie)
- Verifica firma webhook Stripe
- Aggiornamento metadata Clerk post-pagamento e post-cancellazione
- Validazione sessioni server-side in `analyse.js` (token Clerk + `privateMetadata.sessionCount`)
- CORS headers su tutti gli endpoint

---

## Problemi noti / cose da sistemare

- **Canvas di condivisione** (`#share-canvas`) — presente nell'HTML ma non usato da JS. Era per generare una card immagine da condividere. Feature abbandonata o da completare.
- **Storico solo lato client** — `localStorage` non è sincronizzato cross-device. Con Clerk + un DB si potrebbe mostrare lo storico ovunque.
- **Naming inconsistente** — repo "SpeakUp", `package.json` con `"name": "speakup"`, brand utente "Aftercall".

---

## Prossimi step suggeriti

### Priorità media
1. **Card immagine per la condivisione** — completare la feature con `#share-canvas` (Canvas API + `toBlob()`) per generare un'immagine 1080×1080 da condividere su social invece del solo testo. — completare la feature con `#share-canvas` (Canvas API + `toBlob()`) per generare un'immagine 1080×1080 da condividere su social invece del solo testo.

### Priorità bassa / miglioramenti
7. **Sincronizzazione storico cross-device** — salvare lo storico su Vercel KV o Supabase invece di `localStorage`.
8. **Naming consistency** — aggiornare `package.json` e il titolo del repo da "speakup" ad "aftercall".
