# Gestione Doposcuola — Cooperativa Officina Immaginata

Piattaforma per la gestione dei pagamenti pasti, abbonamenti e presenze dei servizi di doposcuola.

## Stack

- **Frontend**: SPA vanilla JS/HTML/CSS → Cloudflare Pages
- **Backend**: Cloudflare Workers (API REST)
- **Database**: Cloudflare D1 (SQLite)
- **Email**: Cloudflare Email Workers + Resend

## Sedi

| Sede | Istituto | Orari | Livello |
|------|----------|-------|---------|
| Orsini | IC7 – Via Vivaldi 76 | Lun–Ven 13:00–17:00 | Primaria e Secondaria |
| Sante Zennaro | IC5 – Via Pirandello 12 | Lun–Ven 14:00–17:00 | Secondaria |
| Valsalva | IC4 – Via Guicciardini 8 | Lun–Ven 14:00–17:00 | Secondaria |
| Campanella | IC4 – Via Gioberti 1 | Mar–Ven 12:45–16:45 | Primaria |

## Setup

### Prerequisiti

```bash
npm install -g wrangler
wrangler login
```

### 1. Crea il database D1

```bash
wrangler d1 create doposcuola-db
```

Copia l'`id` che appare e incollalo in `wrangler.toml` al posto di `YOUR_D1_DATABASE_ID`.

### 2. Inizializza lo schema

```bash
wrangler d1 execute doposcuola-db --file=schema/init.sql
```

### 3. Configura i secrets

```bash
wrangler secret put JWT_SECRET        # stringa random lunga (es. openssl rand -hex 32)
wrangler secret put RESEND_API_KEY    # chiave API da resend.com
wrangler secret put FROM_EMAIL        # es. noreply@officinaimmaginata.it
```

### 4. Deploy del Worker

```bash
cd workers/api
npm install
wrangler deploy
```

### 5. Deploy del frontend

Il frontend viene deployato automaticamente da Cloudflare Pages ad ogni push su `main`.

Impostazioni Cloudflare Pages:
- **Build command**: (nessuno — file statici)
- **Build output directory**: `frontend`
- **Root directory**: `/`

### Dominio personalizzato

Dalla dashboard Cloudflare Pages → il tuo progetto → Custom domains → aggiungi `officinaimmaginata.it`.

## Sviluppo locale

```bash
# Backend
cd workers/api && wrangler dev

# Frontend: apri semplicemente frontend/index.html nel browser
```
