PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  year INTEGER NOT NULL UNIQUE,
  name_th TEXT NOT NULL,
  name_en TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','public','archived')),
  map_background_key TEXT,
  map_background_type TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT,
  role TEXT NOT NULL CHECK (role IN ('owner','admin','exhibitor')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exhibitors (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  name_th TEXT NOT NULL DEFAULT '',
  name_en TEXT NOT NULL DEFAULT '',
  description_th TEXT NOT NULL DEFAULT '',
  description_en TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  social_links_json TEXT NOT NULL DEFAULT '[]',
  public_status TEXT NOT NULL DEFAULT 'hidden' CHECK (public_status IN ('hidden','published')),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_exhibitors_event ON exhibitors(event_id);
CREATE INDEX IF NOT EXISTS idx_exhibitors_status ON exhibitors(public_status);

CREATE TABLE IF NOT EXISTS booths (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  booth_number TEXT NOT NULL,
  x REAL NOT NULL DEFAULT 0,
  y REAL NOT NULL DEFAULT 0,
  width REAL NOT NULL DEFAULT 10,
  height REAL NOT NULL DEFAULT 8,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_visible INTEGER NOT NULL DEFAULT 1,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, booth_number)
);
CREATE INDEX IF NOT EXISTS idx_booths_event ON booths(event_id);

CREATE TABLE IF NOT EXISTS exhibitor_booths (
  exhibitor_id TEXT NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  booth_id TEXT NOT NULL REFERENCES booths(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exhibitor_id, booth_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_exhibitor_per_booth ON exhibitor_booths(booth_id);

CREATE TABLE IF NOT EXISTS exhibitor_accounts (
  exhibitor_id TEXT NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (exhibitor_id, user_id)
);

CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  exhibitor_id TEXT NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  alt_th TEXT NOT NULL DEFAULT '',
  alt_en TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  exhibitor_id TEXT NOT NULL REFERENCES exhibitors(id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('draft','pending','published','returned','rejected')),
  payload_json TEXT NOT NULL,
  review_note TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT REFERENCES users(id),
  reviewed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_submissions_exhibitor ON submissions(exhibitor_id, created_at DESC);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  event_id TEXT REFERENCES events(id),
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT REFERENCES users(id),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS backup_records (
  id TEXT PRIMARY KEY,
  created_by TEXT REFERENCES users(id),
  storage_key TEXT NOT NULL,
  backup_type TEXT NOT NULL CHECK (backup_type IN ('full','entity')),
  entity_type TEXT,
  entity_id TEXT,
  size_bytes INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created','verified','failed','restored')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
