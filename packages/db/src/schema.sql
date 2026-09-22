PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- Declared before items, which references it.
CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  kind TEXT NOT NULL,
  -- JSON array of { name, kind: 'file' | 'dir', path }. Every member has every slot.
  slots TEXT NOT NULL DEFAULT '[]'
);

-- app.js rebuilds this table from this statement when an older database lacks
-- the file and dir types, so keep it a single CREATE TABLE statement.
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('document', 'note', 'link', 'pr', 'file', 'dir')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL DEFAULT '',
  rendered_html TEXT NOT NULL DEFAULT '',
  url TEXT,
  source_path TEXT UNIQUE,
  -- Where a file or dir item lives. source_path stays reserved for imported documents.
  path TEXT,
  category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
  -- JSON object of { slot name: path } that overrides the category's slot paths.
  slot_paths TEXT NOT NULL DEFAULT '{}',
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

CREATE TABLE IF NOT EXISTS watched_directories (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE,
  recursive INTEGER NOT NULL DEFAULT 0 CHECK (recursive IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS watched_items (
  watched_directory_id INTEGER NOT NULL REFERENCES watched_directories(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (watched_directory_id, item_id)
);

CREATE INDEX IF NOT EXISTS watched_items_item ON watched_items(item_id);

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

CREATE TABLE IF NOT EXISTS portfolios (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL COLLATE NOCASE UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- tags and types are JSON arrays. Tags are stored by name because tags with no
-- items are deleted, and a card may name a tag before anything carries it.
CREATE TABLE IF NOT EXISTS cards (
  id INTEGER PRIMARY KEY,
  portfolio_id INTEGER NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'query',
  config TEXT NOT NULL DEFAULT '{}',
  tags TEXT NOT NULL DEFAULT '[]',
  types TEXT NOT NULL DEFAULT '[]',
  sort_key TEXT NOT NULL DEFAULT 'created_at' CHECK (sort_key IN ('created_at', 'updated_at', 'title', 'type')),
  sort_dir TEXT NOT NULL DEFAULT 'desc' CHECK (sort_dir IN ('asc', 'desc')),
  max_items INTEGER NOT NULL DEFAULT 100,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS cards_portfolio ON cards(portfolio_id, position);

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

CREATE UNIQUE INDEX IF NOT EXISTS items_path ON items(path) WHERE path IS NOT NULL;
CREATE INDEX IF NOT EXISTS items_category ON items(category_id);

CREATE TABLE IF NOT EXISTS project_parents (
  id INTEGER PRIMARY KEY,
  path TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS items_sort ON items(pinned DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS taggings_item ON taggings(item_id);

CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '',
  recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reminders (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, at TEXT NOT NULL,
  days TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS completions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (task_id, "on"));

CREATE TABLE IF NOT EXISTS github_prs (
  id INTEGER PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL,
  repo TEXT NOT NULL,
  number INTEGER NOT NULL,
  title TEXT NOT NULL,
  author TEXT NOT NULL DEFAULT '',
  is_draft INTEGER NOT NULL DEFAULT 0 CHECK (is_draft IN (0, 1)),
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open', 'closed', 'merged')),
  review_decision TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- issue comments + review comments + reviews
  comments INTEGER NOT NULL DEFAULT 0,
  -- JSON array of { name, status, url, ignored }
  checks TEXT NOT NULL DEFAULT '[]',
  -- JSON array of "mine" | "review_requested"
  lists TEXT NOT NULL DEFAULT '[]',
  watched INTEGER NOT NULL DEFAULT 0 CHECK (watched IN (0, 1)),
  -- JSON array of glob patterns, per PR; settings.github_ignored_checks is global
  ignored_checks TEXT NOT NULL DEFAULT '[]',
  item_id INTEGER REFERENCES items(id) ON DELETE SET NULL,
  fetched_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS github_pr_events (
  id INTEGER PRIMARY KEY,
  pr_id INTEGER NOT NULL REFERENCES github_prs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('state', 'comments', 'checks', 'review')),
  message TEXT NOT NULL,
  at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  seen INTEGER NOT NULL DEFAULT 0 CHECK (seen IN (0, 1))
);

CREATE INDEX IF NOT EXISTS github_pr_events_pr ON github_pr_events(pr_id);
