CREATE TABLE IF NOT EXISTS berita  (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  category TEXT,
  status TEXT,
  date TEXT,
  subjudul TEXT,
  thumbnail TEXT,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS publikasi  (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  author TEXT,
  category TEXT,
  status TEXT,
  date TEXT,
  subjudul TEXT,
  thumbnail TEXT,
  content TEXT,
  pdf TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS kalender_kegiatan  (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  location TEXT,
  date TEXT,
  time TEXT,
  category TEXT,
  image TEXT,
  summary TEXT,
  description TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  id TEXT PRIMARY KEY,
  user_sub TEXT NOT NULL,
  user_email TEXT NOT NULL,
  user_name TEXT NOT NULL,
  user_roles JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_apps JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_token_hash
ON auth_refresh_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_tokens_expires_at
ON auth_refresh_tokens (expires_at);

CREATE TABLE IF NOT EXISTS sispandalwas_coverage_areas (
  id SERIAL PRIMARY KEY,
  tracker_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  polygon_geojson JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sispandalwas_tracker_configs (
  id SERIAL PRIMARY KEY,
  feed_id TEXT NOT NULL UNIQUE,
  tracker_name TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'public',
  feed_password TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_polled_at TIMESTAMPTZ,
  last_success_at TIMESTAMPTZ,
  last_error TEXT,
  last_message_count INTEGER NOT NULL DEFAULT 0,
  last_inserted_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_sispandalwas_tracker_configs_visibility
    CHECK (visibility IN ('public', 'private'))
);

CREATE INDEX IF NOT EXISTS idx_sispandalwas_tracker_configs_is_active
ON sispandalwas_tracker_configs (is_active);

CREATE TABLE IF NOT EXISTS sispandalwas_track_points (
  id BIGSERIAL PRIMARY KEY,
  tracker_id TEXT NOT NULL,
  tracker_name TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL,
  message_type TEXT,
  battery_state TEXT,
  source_message_id TEXT,
  dedupe_key TEXT NOT NULL UNIQUE,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  ingest_source TEXT NOT NULL DEFAULT 'spot',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sispandalwas_track_points_tracker_recorded
ON sispandalwas_track_points (tracker_id, recorded_at DESC);

CREATE INDEX IF NOT EXISTS idx_sispandalwas_track_points_recorded_at
ON sispandalwas_track_points (recorded_at DESC);
