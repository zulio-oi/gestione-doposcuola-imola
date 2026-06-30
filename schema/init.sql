-- ============================================================
-- Gestione Doposcuola — Officina Immaginata
-- Schema D1 (SQLite)
-- ============================================================

PRAGMA foreign_keys = ON;

-- ------------------------------------------------------------
-- Utenti (genitori, operatori, admin)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,          -- UUID
  email       TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL CHECK(role IN ('admin','operatore','genitore')),
  sede_id     TEXT,                      -- per operatori: sede assegnata (o NULL = tutte)
  created_at  TEXT DEFAULT (datetime('now')),
  last_login  TEXT
);

-- ------------------------------------------------------------
-- Magic link tokens (per login senza password)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS magic_tokens (
  token       TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  TEXT NOT NULL,
  used        INTEGER DEFAULT 0
);

-- ------------------------------------------------------------
-- Bambini iscritti
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bambini (
  id          TEXT PRIMARY KEY,          -- UUID
  nome        TEXT NOT NULL,
  cognome     TEXT NOT NULL,
  classe      TEXT NOT NULL,
  sede_id     TEXT NOT NULL,
  orario      TEXT NOT NULL CHECK(orario IN ('13:00-17:00','14:00-17:00','12:45-16:45')),
  genitore_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note        TEXT,
  attivo      INTEGER DEFAULT 1,
  created_at  TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Abbonamenti mensili
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS abbonamenti (
  id          TEXT PRIMARY KEY,
  bambino_id  TEXT NOT NULL REFERENCES bambini(id) ON DELETE CASCADE,
  mese        TEXT NOT NULL,             -- formato YYYY-MM
  importo     REAL NOT NULL,
  sconto_pct  REAL DEFAULT 0,           -- es. 10 per sconto 10%
  pagato      INTEGER DEFAULT 0,
  data_pag    TEXT,
  note        TEXT
);

-- ------------------------------------------------------------
-- Carnet pasti
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS carnet (
  id            TEXT PRIMARY KEY,
  bambino_id    TEXT NOT NULL REFERENCES bambini(id) ON DELETE CASCADE,
  pasti_totali  INTEGER NOT NULL,
  pasti_residui INTEGER NOT NULL,
  importo       REAL NOT NULL,
  pagato        INTEGER DEFAULT 0,
  data_acquisto TEXT DEFAULT (datetime('now')),
  data_pag      TEXT,
  note          TEXT
);

-- ------------------------------------------------------------
-- Presenze giornaliere
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS presenze (
  id          TEXT PRIMARY KEY,
  bambino_id  TEXT NOT NULL REFERENCES bambini(id) ON DELETE CASCADE,
  data        TEXT NOT NULL,             -- YYYY-MM-DD
  presente    INTEGER DEFAULT 0,
  pasto       INTEGER DEFAULT 0,         -- ha usufruito del pasto mensa
  operatore_id TEXT REFERENCES users(id),
  note        TEXT,
  UNIQUE(bambino_id, data)
);

-- ------------------------------------------------------------
-- Log notifiche email (per evitare duplicati)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS email_log (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id),
  tipo        TEXT NOT NULL,             -- 'saldo_basso', 'magic_link', 'benvenuto', ecc.
  inviata_at  TEXT DEFAULT (datetime('now'))
);

-- ------------------------------------------------------------
-- Dati di seed — sedi (tabella di riferimento)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sedi (
  id          TEXT PRIMARY KEY,
  nome        TEXT NOT NULL,
  istituto    TEXT NOT NULL,
  indirizzo   TEXT NOT NULL,
  orario      TEXT NOT NULL,
  livello     TEXT NOT NULL,
  mensa       TEXT NOT NULL,
  costo_mensa REAL DEFAULT 8.0,
  costo_13_17 REAL,
  costo_14_17 REAL,
  costo_1245  REAL,
  min_iscritti INTEGER DEFAULT 12
);

INSERT OR IGNORE INTO sedi VALUES
  ('orsini',    'Orsini',        'IC7', 'Via Vivaldi 76',      'Lun–Ven 13:00–17:00',  'Primaria e Secondaria', 'Camst (mensa scolastica)',    8, 190, 150, NULL, 12),
  ('zennaro',   'Sante Zennaro', 'IC5', 'Via Pirandello 12',   'Lun–Ven 14:00–17:00',  'Secondaria',            'Gemos (mensa scolastica)',    8, NULL, 150, NULL, 12),
  ('valsalva',  'Valsalva',      'IC4', 'Via Guicciardini 8',  'Lun–Ven 14:00–17:00',  'Secondaria',            'Camst (monoporzione)',        8, NULL, 150, NULL, 12),
  ('campanella','Campanella',    'IC4', 'Via Gioberti 1',       'Mar–Ven 12:45–16:45',  'Primaria',              'Camst (monoporzione)',        8, NULL, NULL, 75,  12);

-- Indici per query frequenti
CREATE INDEX IF NOT EXISTS idx_presenze_data     ON presenze(data);
CREATE INDEX IF NOT EXISTS idx_presenze_bambino  ON presenze(bambino_id);
CREATE INDEX IF NOT EXISTS idx_carnet_bambino    ON carnet(bambino_id);
CREATE INDEX IF NOT EXISTS idx_bambini_sede      ON bambini(sede_id);
CREATE INDEX IF NOT EXISTS idx_bambini_genitore  ON bambini(genitore_id);
CREATE INDEX IF NOT EXISTS idx_magic_token_user  ON magic_tokens(user_id);
