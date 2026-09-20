PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('document', 'note', 'link', 'pr')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  rendered_html TEXT NOT NULL DEFAULT '',
  url TEXT,
  source_path TEXT UNIQUE,
  toc INTEGER NOT NULL DEFAULT 1 CHECK (toc IN (0, 1)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  starred INTEGER NOT NULL DEFAULT 0 CHECK (starred IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tags (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS taggings (
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, item_id)
);

CREATE VIRTUAL TABLE IF NOT EXISTS items_fts USING fts5(
  title,
  description,
  content,
  content='items',
  content_rowid='id'
);

CREATE TRIGGER IF NOT EXISTS items_ai AFTER INSERT ON items BEGIN
  INSERT INTO items_fts(rowid, title, description, content)
  VALUES (new.id, new.title, new.description, new.content);
END;
CREATE TRIGGER IF NOT EXISTS items_ad AFTER DELETE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description, content)
  VALUES ('delete', old.id, old.title, old.description, old.content);
END;
CREATE TRIGGER IF NOT EXISTS items_au AFTER UPDATE ON items BEGIN
  INSERT INTO items_fts(items_fts, rowid, title, description, content)
  VALUES ('delete', old.id, old.title, old.description, old.content);
  INSERT INTO items_fts(rowid, title, description, content)
  VALUES (new.id, new.title, new.description, new.content);
END;

CREATE INDEX IF NOT EXISTS items_sort ON items(pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS taggings_item ON taggings(item_id);
