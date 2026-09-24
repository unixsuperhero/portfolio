require 'fileutils'

module Pf
  module Database
    module_function

    def schema_path = File.join(Pf.project_root, 'packages/db/src/schema.sql')
    def schema = File.read(schema_path)

    def open(path = Pf.database_path, create: false)
      raise Pf::Error, "no database at #{path}" if !create && !File.exist?(path)
      FileUtils.mkdir_p(File.dirname(path)) if create
      flags = SQLite3::Constants::Open::READWRITE
      flags |= SQLite3::Constants::Open::CREATE if create
      SQLite3::Database.new(path, flags: flags).tap do |db|
        db.results_as_hash = true
        db.busy_timeout = 5_000
        db.execute('PRAGMA foreign_keys = ON')
      end
    end

    def rows(db, sql, *params) = db.execute(sql, params).map { |r| stringify(r) }
    def one(db, sql, *params) = rows(db, sql, *params).first

    def migrate!(db, path = Pf.database_path)
      migrate_item_kinds(db, path)
      migrate_columns(db)
      migrate_reminder_entities(db)
      db.execute_batch(schema)
      db.execute_batch(%q{INSERT INTO items(type, task_id, title, content, created_at) SELECT 'task', tasks.id, tasks.title, tasks.notes, tasks.created_at FROM tasks WHERE NOT EXISTS (SELECT 1 FROM items WHERE items.task_id = tasks.id);})
    end

    def init!(path = Pf.database_path)
      db = open(path, create: true)
      migrate!(db, path)
    ensure
      db&.close
    end

    def columns(db, table)
      rows(db, "PRAGMA table_info(#{table})").map { |r| r['name'] }
    end

    def migrate_item_kinds(db, path)
      current = one(db, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'items'")&.fetch('sql', nil)
      return unless current && !["'file'", "'dir'", "'task'", 'task_id'].all? { |v| current.include?(v) }
      backup = "#{path}.before-tasks"
      db.execute('VACUUM INTO ?', backup) if path != ':memory:' && !File.exist?(backup)
      create = schema.match(/CREATE TABLE IF NOT EXISTS items \([\s\S]*?\n\);/)[0].sub('IF NOT EXISTS items', 'items_next')
      item_columns = columns(db, 'items').join(', ')
      legacy = one(db, 'PRAGMA legacy_alter_table')['legacy_alter_table']
      db.execute_batch('PRAGMA foreign_keys = OFF; PRAGMA legacy_alter_table = ON')
      db.transaction do
        db.execute_batch(create)
        db.execute_batch("INSERT INTO items_next(#{item_columns}) SELECT #{item_columns} FROM items; DROP TABLE items; ALTER TABLE items_next RENAME TO items;")
      end
      puts "rebuilt items for task items; backup at #{backup}"
    ensure
      db.execute_batch("PRAGMA foreign_keys = ON; PRAGMA legacy_alter_table = #{legacy || 0}") if db
    end

    def migrate_columns(db)
      cols = columns(db, 'cards')
      unless cols.empty?
        db.execute_batch("ALTER TABLE cards ADD COLUMN kind TEXT NOT NULL DEFAULT 'query'") unless cols.include?('kind')
        db.execute_batch("ALTER TABLE cards ADD COLUMN config TEXT NOT NULL DEFAULT '{}'") unless cols.include?('config')
      end
      cols = columns(db, 'github_prs')
      db.execute_batch('ALTER TABLE github_prs ADD COLUMN source_dir TEXT') if !cols.empty? && !cols.include?('source_dir')
      cols = columns(db, 'reminders')
      db.execute_batch("ALTER TABLE reminders ADD COLUMN days TEXT NOT NULL DEFAULT '[]'") if !cols.empty? && !cols.include?('days')
      cols = columns(db, 'tasks')
      db.execute_batch('ALTER TABLE tasks ADD COLUMN parent_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL CHECK (parent_id != id)') if !cols.empty? && !cols.include?('parent_id')
    end

    def migrate_reminder_entities(db)
      cols = rows(db, 'PRAGMA table_info(reminders)')
      return if cols.empty?
      if cols.any? { |c| c['name'] == 'title' }
        db.execute_batch(%q{CREATE TABLE IF NOT EXISTS reminder_completions (id INTEGER PRIMARY KEY, reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE, "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (reminder_id, "on"));})
        return
      end
      has_completions = one(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'completions'")
      db.transaction do
        db.execute_batch(%q{
          CREATE TABLE reminders_next (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL, at TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
          INSERT INTO reminders_next(id, title, notes, recurrence, task_id, at, days, active, created_at) SELECT reminders.id, tasks.title, tasks.notes, tasks.recurrence, reminders.task_id, reminders.at, COALESCE(reminders.days, '[]'), tasks.active, tasks.created_at FROM reminders JOIN tasks ON tasks.id = reminders.task_id;
          DROP TABLE reminders; ALTER TABLE reminders_next RENAME TO reminders; CREATE INDEX IF NOT EXISTS reminders_task ON reminders(task_id);
          CREATE TABLE IF NOT EXISTS reminder_completions (id INTEGER PRIMARY KEY, reminder_id INTEGER NOT NULL REFERENCES reminders(id) ON DELETE CASCADE, "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE (reminder_id, "on"));
        })
        if has_completions
          db.execute_batch(%q{INSERT INTO reminder_completions(reminder_id, "on", at) SELECT reminders.id, completions."on", completions.at FROM reminders JOIN completions ON completions.task_id = reminders.task_id WHERE true ON CONFLICT(reminder_id, "on") DO NOTHING;})
        end
      end
    end

    def stringify(row) = row.each_with_object({}) { |(k, v), h| h[k.to_s] = v unless k.is_a?(Integer) }
  end
end
