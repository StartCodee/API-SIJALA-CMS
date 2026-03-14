CREATE TABLE berita  (
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

CREATE TABLE publikasi  (
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

CREATE TABLE kalender_kegiatan  (
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