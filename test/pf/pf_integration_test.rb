# frozen_string_literal: true

require 'fileutils'
require 'json'
require 'minitest/autorun'
require 'open3'
require 'rbconfig'
require 'sqlite3'
require 'tmpdir'

class PfIntegrationTest < Minitest::Test
  ROOT = File.expand_path('../..', __dir__)
  RUBY = RbConfig.ruby
  BIN = File.join(ROOT, 'bin')
  BASELINE = ENV['PF_BASELINE_BIN']
  TS_CONFIG = File.join(ROOT, 'tsconfig.json')
  STAMP = '2024-01-02 03:04:05'

  CommandResult = Struct.new(:stdout, :stderr, :status, keyword_init: true) do
    def success? = status.success?
  end

  def setup
    @tmp = Dir.mktmpdir('pf-ruby-test-')
    @home = File.join(@tmp, 'home')
    @db_path = File.join(@tmp, 'portfolio.sqlite')
    @docs = File.join(@tmp, 'docs')
    @projects = File.join(@tmp, 'projects')
    @repo = File.join(@projects, 'repo')
    FileUtils.mkdir_p([@home, @docs, File.join(@repo, '.git'), File.join(@projects, 'group', 'nested', '.git')])
    File.write(File.join(@repo, 'TASKS.md'), "# Work\n")
    File.write(File.join(@docs, 'guide.md'), "# Guide\n\n[Next](linked.md#next)\n")
    File.write(File.join(@docs, 'linked.md'), "# Next\n\n[Back](guide.md)\n")
    File.write(File.join(@docs, 'preview.html'), '<title>Preview</title><h1>Preview</h1>')
    seed_database
  end

  def teardown
    @db&.close
    FileUtils.rm_rf(@tmp) if @tmp
  end

  def test_read_commands_match_original_when_baseline_is_available_and_keep_literal_behaviour
    parity_commands = [
      %w[pf-detect https://github.com/example/project/pull/42 --json],
      ['pf-detect', File.join(@docs, 'guide.md'), '--json'],
      ['pf-detect', 'a plain note', '--type'],
      %w[pf-items ls --json],
      %w[pf-items ls --full],
      %w[pf-items ls],
      %w[pf-items search Alpha --json],
      %w[pf-items search body-only-needle --contents --json],
      %w[pf-items ls --tag work --type note --json],
      %w[pf-items ls --pinned --json],
      %w[pf-items ls --starred --json],
      %w[pf-items recent 2 --json],
      %w[pf-items count],
      ['pf-items', 'show', @directory_id.to_s],
      ['pf-items', 'cat', @note_id.to_s],
      ['pf-items', 'cat', @link_id.to_s],
      %w[pf-items path],
      %w[pf-items export --type note],
      %w[pf-tags ls --json],
      %w[pf-tags ls],
      %w[pf-tags items work --json],
      %w[pf-portfolios ls --json],
      %w[pf-portfolios ls],
      %w[pf-portfolios show Baseline --json],
      %w[pf-cards ls Baseline --json],
      %w[pf-cards ls Baseline],
      ['pf-cards', 'show', @card_id.to_s, '--json'],
      ['pf-cards', 'show', @card_id.to_s],
      %w[pf-cards preview --tags work --types note --sort title --json],
      %w[pf-categories ls --json],
      %w[pf-categories ls],
      %w[pf-categories items project --json],
      ['pf-categories', 'slots', @directory_id.to_s, '--json'],
      %w[pf-projects ls --json],
      %w[pf-projects parents ls --json],
      ['pf-projects', 'discover', @projects, '--json'],
      %w[pf-watch ls --json],
      ['pf-watch', 'scan', @docs, '--json'],
      ['pf-docs', 'links', File.join(@docs, 'guide.md'), '--json'],
      %w[pf-docs tracked --json],
      %w[pf-db q SELECT id,title FROM items ORDER BY id --json],
      ['pf-render', '--fragment', File.join(@docs, 'guide.md')]
    ]

    failures = []
    parity_commands.each do |args|
      actual = command(args, success: false)
      expected = BASELINE ? command(args, old: true, success: false) : nil
      begin
        assert_predicate actual, :success?
        if expected
          assert_predicate expected, :success?, "legacy command failed: #{args.join(' ')}\n#{expected.stderr}\n#{expected.stdout}"
          assert_equal parsed_output(expected.stdout), parsed_output(actual.stdout), args.join(' ')
        end
      rescue Minitest::Assertion => e
        failures << "#{args.join(' ')}: #{e.message}"
      end
    end
    assert_empty failures, failures.join("\n\n")

    assert_equal [@note_id], json_command(%w[pf-items ls --pinned --json]).map { |item| item.fetch('id') }
    assert_equal [@link_id], json_command(%w[pf-items ls --starred --json]).map { |item| item.fetch('id') }
    assert_equal [@note_id], json_command(['pf-cards', 'show', @card_id.to_s, '--json']).fetch('items').map { |item| item.fetch('id') }
    assert_equal File.join(@repo, 'TASKS.md'), json_command(['pf-categories', 'slots', @directory_id.to_s, '--json']).first.fetch('path')
    assert_equal ROOT, run_command(%w[pf root]).strip
    assert_equal @db_path, run_command(%w[pf db-path]).strip
    assert_equal @note_id, json_command(%w[pf it ls --pinned --json]).first.fetch('id')
    assert_equal @note_id, json_command(%w[h-pf items ls --pinned --json]).first.fetch('id')
  end

  def test_offline_mutations_write_sqlite_directly_without_server
    with_server_unavailable do
      added = json_command(['pf-add', '# CLI note', '--title', 'Added title', '--tags', 'one,two', '--json'])
      assert_equal 'Added title', added.fetch('title')
      assert_equal %w[one two], tag_names(added.fetch('id'))
      task = json_command(['pf-add', 'Ship the Ruby CLI', '--type', 'task', '--json'])
      task_record = row('SELECT * FROM tasks WHERE id = ?', task.fetch('task_id'))
      assert_equal 'Ship the Ruby CLI', task_record.fetch('title')
      assert_equal 'once', task_record.fetch('recurrence')
      assert_equal task_record.fetch('notes'), item(task.fetch('id')).fetch('content')

      run_command(['pf-items', 'pin', added.fetch('id').to_s])
      run_command(['pf-items', 'star', added.fetch('id').to_s])
      assert_equal 1, item(added.fetch('id')).fetch('pinned')
      assert_equal 1, item(added.fetch('id')).fetch('starred')
      run_command(['pf-items', 'toggle', added.fetch('id').to_s, 'starred'])
      assert_equal 0, item(added.fetch('id')).fetch('starred')
      run_command(['pf-items', 'set', added.fetch('id').to_s, 'title', 'Changed title'])
      assert_equal 'Changed title', item(added.fetch('id')).fetch('title')

      run_command(['pf-items', 'tag', added.fetch('id').to_s, 'space tag,slash/tag,NoCase'])
      run_command(['pf-items', 'untag', added.fetch('id').to_s, 'space tag,nocase'])
      assert_equal ['one', 'slash/tag', 'two'], tag_names(added.fetch('id'))
      run_command(%w[pf-tags rename slash/tag renamed])
      run_command(['pf-tags', 'add', 'shared', added.fetch('id').to_s, @note_id.to_s])
      run_command(%w[pf-tags rm renamed])
      assert_equal ['one', 'shared', 'two'], tag_names(added.fetch('id'))
      run_command(%w[pf-tags prune])
      assert_nil row('SELECT id FROM tags WHERE name = ?', 'renamed')

      refused = command(['pf-items', 'rm', added.fetch('id').to_s], success: false, input: "n\n")
      refute_predicate refused, :success?
      assert_equal 'Changed title', item(added.fetch('id')).fetch('title')
      run_command(['pf-items', 'rm', added.fetch('id').to_s, '--yes'])
      assert_nil item(added.fetch('id'))

      source = File.join(@tmp, 'delete-me.md')
      File.write(source, '# delete me')
      file_id = insert_item(type: 'document', title: 'Delete source', source_path: source, content: '# delete me')
      run_command(['pf-items', 'rm', file_id.to_s, '--files', '--yes'])
      assert_nil item(file_id)
      refute_path_exists source
    end
  end

  def test_portfolios_cards_categories_projects_and_database_commands
    with_server_unavailable do
      run_command(['pf-portfolios', 'new', 'CLI board'])
      run_command(['pf-portfolios', 'rename', 'CLI board', 'Renamed board'])
      run_command(['pf-cards', 'add', 'Renamed board', 'CLI card', '--tags', 'work', '--types', 'note', '--max', '2'])
      board = row('SELECT * FROM portfolios WHERE name = ?', 'Renamed board')
      new_card = row('SELECT * FROM cards WHERE portfolio_id = ?', board.fetch('id'))
      assert_equal ['work'], JSON.parse(new_card.fetch('tags'))
      assert_equal 'CLI card', new_card.fetch('title')
      run_command(['pf-cards', 'edit', new_card.fetch('id').to_s, '--max', '3'])
      edited = row('SELECT * FROM cards WHERE id = ?', new_card.fetch('id'))
      assert_equal 'CLI card', edited.fetch('title'), 'editing only options must preserve title'
      assert_equal ['work'], JSON.parse(edited.fetch('tags')), 'editing empty tags must preserve existing tags'
      assert_equal 3, edited.fetch('max_items')
      run_command(['pf-cards', 'move', new_card.fetch('id').to_s, 'left'])
      run_command(['pf-cards', 'rm', new_card.fetch('id').to_s])
      run_command(['pf-portfolios', 'rm', 'Renamed board'])
      assert_nil row('SELECT * FROM portfolios WHERE name = ?', 'Renamed board')

      run_command(['pf-categories', 'add', 'Files', '--kind', 'file', '-s', 'notes | file | ~/notes.md'])
      run_command(['pf-categories', 'assign', @file_id.to_s, 'Files'])
      run_command(['pf-categories', 'override', @file_id.to_s, 'notes', File.join(@tmp, 'override.md')])
      assert_equal File.join(@tmp, 'override.md'), JSON.parse(item(@file_id).fetch('slot_paths')).fetch('notes')
      run_command(['pf-categories', 'unassign', @file_id.to_s])
      run_command(['pf-categories', 'rm', 'Files'])
      assert_nil item(@file_id).fetch('category_id')

      run_command(%w[pf-projects parents add] + [@projects])
      parents = json_command(%w[pf-projects parents ls --json])
      assert_equal [@projects], parents.map { |parent| parent.fetch('path') }
      run_command(%w[pf-projects scan])
      assert_equal 'dir', row('SELECT type FROM items WHERE path = ?', File.join(@projects, 'group', 'nested')).fetch('type')
      project = row('SELECT * FROM items WHERE path = ?', File.join(@projects, 'group', 'nested'))
      assert_equal ['project'], tag_names(project.fetch('id'))
      assert_equal project.fetch('path'), project.fetch('description')

      backup = File.join(@tmp, 'backup.sqlite')
      run_command(['pf-db', 'backup', backup])
      backup_db = SQLite3::Database.new(backup, results_as_hash: true)
      assert_equal 'Alpha note', stringified(backup_db.get_first_row('SELECT title FROM items WHERE id = ?', @note_id)).fetch('title')
      backup_db.close
      run_command(%w[pf-db reindex])
      assert_equal [@note_id], json_command(%w[pf-items search Alpha --json]).map { |found| found.fetch('id') }
    end
  end

  def test_documents_detection_render_crawl_import_cycles_rerender_and_watch
    with_server_unavailable do
      assert_equal 'document', json_command(['pf-detect', File.join(@docs, 'guide.md'), '--json']).fetch('type')
      rendered = run_command(['pf-render', '--fragment', File.join(@docs, 'guide.md')])
      assert_includes rendered, '<h1'
      assert_includes rendered, 'Guide'

      imported = json_command(['pf-docs', 'add', File.join(@docs, 'guide.md'), '--recursive', '--title', 'Imported guide', '--json'])
      assert_equal 2, imported.fetch('imported')
      linked = row('SELECT * FROM items WHERE source_path = ?', File.join(@docs, 'linked.md'))
      assert_match %r{/items/#{linked.fetch('id')}#next}, item(@guide_id).fetch('rendered_html')
      links = json_command(['pf-docs', 'links', File.join(@docs, 'guide.md'), '--json'])
      assert_includes links.fetch('files'), File.join(@docs, 'linked.md')
      assert_includes links.fetch('edges').fetch(File.join(@docs, 'linked.md')), File.join(@docs, 'guide.md')

      File.write(File.join(@docs, 'guide.md'), "# Changed from disk\n")
      run_command(['pf-docs', 'rerender', @guide_id.to_s, '--disk'])
      assert_match(/Changed from disk/, item(@guide_id).fetch('rendered_html'))
      html = json_command(['pf-add', File.join(@docs, 'preview.html'), '--json'])
      assert_equal '<title>Preview</title><h1>Preview</h1>', item(html.fetch('id')).fetch('rendered_html')
      assert_equal 'file', row('SELECT type FROM items WHERE path = ?', File.join(@docs, 'preview.html')).fetch('type')

      watched = File.join(@tmp, 'watched')
      FileUtils.mkdir_p(File.join(watched, 'nested'))
      File.write(File.join(watched, 'a.html'), '<title>A</title>')
      File.write(File.join(watched, 'nested', 'b.html'), '<title>B</title>')
      run_command(['pf-watch', 'add', watched, '--recursive'])
      watch = row('SELECT * FROM watched_directories WHERE path = ?', watched)
      assert_equal 2, count('SELECT count(*) FROM watched_items WHERE watched_directory_id = ?', watch.fetch('id'))
      File.write(File.join(watched, 'c.md'), '# C')
      run_command(%w[pf-watch sync])
      assert row('SELECT * FROM items WHERE source_path = ?', File.join(watched, 'c.md'))
      run_command(['pf-watch', 'set', watch.fetch('id').to_s, 'flat'])
      assert_equal 2, count('SELECT count(*) FROM watched_items WHERE watched_directory_id = ?', watch.fetch('id'))
      FileUtils.rm_f(File.join(watched, 'a.html'))
      run_command(%w[pf-watch sync])
      assert_nil row('SELECT * FROM items WHERE source_path = ?', File.join(watched, 'a.html'))
      run_command(['pf-watch', 'rm', watch.fetch('id').to_s])
      assert_nil row('SELECT * FROM watched_directories WHERE id = ?', watch.fetch('id'))
      assert_nil row('SELECT * FROM items WHERE source_path = ?', File.join(watched, 'c.md'))
      assert_path_exists File.join(watched, 'nested', 'b.html'), 'removing a watch must not delete source files'
    end
  end

  def test_pf_db_init_reinit_and_legacy_migration_are_disposable
    fresh_db = File.join(@tmp, 'fresh.sqlite')
    env = isolated_env.merge('PORTFOLIO_DB' => fresh_db)
    run_command(%w[pf-db init], env: env)
    first_tables = table_names(fresh_db)
    run_command(%w[pf-db init], env: env)
    assert_equal first_tables, table_names(fresh_db)

    legacy = File.join(@tmp, 'legacy.sqlite')
    legacy_db = SQLite3::Database.new(legacy, results_as_hash: true)
    legacy_db.execute_batch(<<~SQL)
      PRAGMA foreign_keys = OFF;
      CREATE TABLE items (id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK (type IN ('document','note','link','pr')), title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', content TEXT NOT NULL DEFAULT '', rendered_html TEXT NOT NULL DEFAULT '', url TEXT, source_path TEXT UNIQUE, path TEXT, category_id INTEGER, slot_paths TEXT NOT NULL DEFAULT '{}', toc INTEGER NOT NULL DEFAULT 1, pinned INTEGER NOT NULL DEFAULT 0, starred INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE tasks (id INTEGER PRIMARY KEY, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recurrence TEXT NOT NULL CHECK (recurrence IN ('daily','once')), active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE reminders (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, at TEXT NOT NULL, days TEXT NOT NULL DEFAULT '[]');
      CREATE TABLE completions (id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL, "on" TEXT NOT NULL, at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
      INSERT INTO tasks(id, title, notes, recurrence, created_at) VALUES (7, 'Legacy task', 'legacy notes', 'once', '#{STAMP}');
      INSERT INTO reminders(id, task_id, at, days) VALUES (8, 7, '09:00', '["mon"]');
      INSERT INTO completions(task_id, "on", at) VALUES (7, '2024-01-03', '#{STAMP}');
    SQL
    legacy_db.close

    run_command(%w[pf-db init], env: isolated_env.merge('PORTFOLIO_DB' => legacy))
    migrated = SQLite3::Database.new(legacy, results_as_hash: true)
    assert_equal 'Legacy task', stringified(migrated.get_first_row('SELECT title FROM items WHERE task_id = 7')).fetch('title')
    assert_equal 'Legacy task', stringified(migrated.get_first_row('SELECT title FROM reminders WHERE id = 8')).fetch('title')
    assert_equal '2024-01-03', stringified(migrated.get_first_row('SELECT "on" FROM reminder_completions WHERE reminder_id = 8')).fetch('on')
    migrated.close
  end

  def test_help_does_not_open_database_or_consume_input
    missing = File.join(@tmp, 'missing.sqlite')
    env = isolated_env.merge('PORTFOLIO_DB' => missing)
    %w[pf h-pf pf-add pf-cards pf-categories pf-db pf-detect pf-docs pf-items pf-portfolios pf-ports pf-projects pf-render pf-server pf-tags pf-watch].each do |tool|
      command([tool, '--help'], env: env)
    end
    refute_path_exists missing
    %w[pf-add pf-detect pf-render].each do |tool|
      command([tool, '--help', 'this-input-must-not-be-used'], env: env)
    end
    refute_path_exists missing
  end

  def command(args, success: true, input: '', env: isolated_env, old: false)
    executable = old ? ['bun', '--tsconfig-override', TS_CONFIG] : [RUBY]
    bin_dir = old ? BASELINE : BIN
    raise 'PF_BASELINE_BIN is not set' if old && (bin_dir.nil? || bin_dir.empty?)

    stdout, stderr, status = Open3.capture3(env, *executable, File.join(bin_dir, args.first), *args.drop(1), stdin_data: input, chdir: ROOT)
    result = CommandResult.new(stdout: stdout, stderr: stderr, status: status)
    assert result.success?, "#{args.join(' ')} failed (#{status.exitstatus}):\n#{stderr}\n#{stdout}" if success
    result
  end

  def run_command(args, **kwargs) = command(args, **kwargs).stdout
  def json_command(args, **kwargs) = JSON.parse(run_command(args, **kwargs))

  def with_server_unavailable
    old = ENV['PORTFOLIO_SERVER']
    ENV['PORTFOLIO_SERVER'] = 'http://127.0.0.1:9'
    yield
  ensure
    ENV['PORTFOLIO_SERVER'] = old
  end

  def isolated_env
    @isolated_env ||= ENV.to_h.merge(
      'HOME' => @home,
      'PORTFOLIO_HOME' => ROOT,
      'PORTFOLIO_DB' => @db_path,
      'PORTFOLIO_SERVER' => 'http://127.0.0.1:9',
      'HDOCS_SERVER' => 'http://127.0.0.1:9',
      'PATH' => [File.dirname(RUBY), BIN, ENV.fetch('PATH', '')].join(File::PATH_SEPARATOR)
    ).reject { |key, _| key == 'BUNDLE_GEMFILE' }
  end

  def parsed_output(output)
    JSON.parse(output)
  rescue JSON::ParserError
    output
  end

  def seed_database
    @db = SQLite3::Database.new(@db_path, results_as_hash: true)
    @db.execute_batch(File.read(File.join(ROOT, 'packages/db/src/schema.sql')))
    @category_id = insert_category('project', 'dir', [{ 'name' => 'tasks', 'kind' => 'file', 'path' => 'TASKS.md' }])
    @note_id = insert_item(type: 'note', title: 'Alpha note', description: 'focus', content: 'body-only-needle')
    @link_id = insert_item(type: 'link', title: 'Zebra reference', url: 'https://example.com/reference')
    @guide_id = insert_item(type: 'document', title: 'Guide', content: File.read(File.join(@docs, 'guide.md')), source_path: File.join(@docs, 'guide.md'))
    @directory_id = insert_item(type: 'dir', title: 'Workspace', path: @repo, category_id: @category_id)
    @file_id = insert_item(type: 'file', title: 'Task file', path: File.join(@repo, 'TASKS.md'))
    insert_item(type: 'document', title: 'Preview', source_path: File.join(@docs, 'preview.html'), rendered_html: '<h1>Preview</h1>')
    @db.execute('INSERT INTO tasks(title, notes, recurrence, created_at) VALUES (?, ?, ?, ?)', ['Ship baseline', 'task notes', 'once', STAMP])
    set_tags(@note_id, %w[work ideas])
    set_tags(@link_id, %w[reference])
    set_tags(@guide_id, %w[work docs])
    @db.execute('UPDATE items SET pinned = 1 WHERE id = ?', @note_id)
    @db.execute('UPDATE items SET starred = 1 WHERE id = ?', @link_id)
    @portfolio_id = insert_portfolio('Baseline', 'Fixture portfolio')
    insert_portfolio('Empty', '')
    @card_id = insert_card(@portfolio_id, title: 'Reading', tags: ['work'], types: ['note', 'document'], sort_key: 'title', sort_dir: 'asc', max_items: 1)
    insert_card(@portfolio_id, title: 'Clock', kind: 'clock', config: { 'timezone' => 'UTC' })
    @db.execute('INSERT INTO project_parents(path) VALUES (?)', @projects)
    @db.execute('UPDATE items SET created_at = ?, updated_at = ?', [STAMP, STAMP])
  end

  def insert_item(attrs)
    fields = { type: nil, title: nil, description: '', content: '', rendered_html: '', url: nil, source_path: nil, path: nil, category_id: nil, slot_paths: '{}', toc: 1, pinned: 0, starred: 0, created_at: STAMP, updated_at: STAMP }.merge(attrs)
    keys = fields.keys
    @db.execute("INSERT INTO items(#{keys.join(',')}) VALUES (#{(['?'] * keys.length).join(',')})", keys.map { |key| fields.fetch(key) })
    @db.last_insert_row_id
  end

  def insert_category(name, kind, slots)
    @db.execute('INSERT INTO categories(name, kind, slots) VALUES (?, ?, ?)', [name, kind, JSON.generate(slots)])
    @db.last_insert_row_id
  end

  def insert_portfolio(name, description)
    @db.execute('INSERT INTO portfolios(name, description, created_at) VALUES (?, ?, ?)', [name, description, STAMP])
    @db.last_insert_row_id
  end

  def insert_card(portfolio_id, title:, kind: 'query', config: {}, tags: [], types: [], sort_key: 'created_at', sort_dir: 'desc', max_items: 100)
    position = count('SELECT count(*) FROM cards WHERE portfolio_id = ?', portfolio_id)
    @db.execute('INSERT INTO cards(portfolio_id, title, kind, config, tags, types, sort_key, sort_dir, max_items, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [portfolio_id, title, kind, JSON.generate(config), JSON.generate(tags), JSON.generate(types), sort_key, sort_dir, max_items, position])
    @db.last_insert_row_id
  end

  def set_tags(item_id, names)
    names.each do |name|
      @db.execute('INSERT OR IGNORE INTO tags(name, created_at) VALUES (?, ?)', [name, STAMP])
      tag_id = row('SELECT id FROM tags WHERE name = ?', name).fetch('id')
      @db.execute('INSERT OR IGNORE INTO taggings(tag_id, item_id) VALUES (?, ?)', [tag_id, item_id])
    end
  end

  def item(id) = row('SELECT * FROM items WHERE id = ?', id)
  def tag_names(id) = @db.execute('SELECT tags.name FROM tags JOIN taggings ON taggings.tag_id = tags.id WHERE taggings.item_id = ? ORDER BY tags.name', id).map { |r| stringified(r).fetch('name') }
  def count(sql, *params) = row(sql, *params).values.first
  def row(sql, *params) = stringified(@db.get_first_row(sql, *params))
  def stringified(row) = row&.each_with_object({}) { |(key, value), hash| hash[key.to_s] = value unless key.is_a?(Integer) }

  def table_names(path)
    db = SQLite3::Database.new(path, results_as_hash: true)
    db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").map { |r| r['name'] }
  ensure
    db&.close
  end
end
