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
