require 'sqlite3'
require_relative 'database'

module Pf
  class Store
    attr_reader :db

    PATCH_COLUMNS = %w[type title description content rendered_html url toc pinned starred category_id].freeze

    def initialize(path = Pf.database_path, readonly: true)
      raise Pf::Error, "no database at #{path}" unless File.exist?(path)
      flags = readonly ? SQLite3::Constants::Open::READONLY : SQLite3::Constants::Open::READWRITE
      @db = SQLite3::Database.new(path, flags: flags)
      @db.results_as_hash = true
      @db.busy_timeout = 5_000
      @db.execute('PRAGMA foreign_keys = ON') unless readonly
      Pf::Database.migrate!(@db, path) unless readonly
    end

    def query(sql, *params) = @db.execute(sql, params).map { |row| stringify(row) }
    def one(sql, *params) = query(sql, *params).first
    def close = @db.close

    def get_item(id) = one('SELECT * FROM items WHERE id = ?', id)
    def find_item_by_source(path) = one('SELECT * FROM items WHERE source_path = ?', path)
    def find_item_by_path(path) = one('SELECT * FROM items WHERE path = ?', path)

    def upsert_item(attrs)
      item = stringify(attrs)
      if item['type'] == 'task'
        return @db.transaction do
          title = item['title'].to_s.strip
          raise Pf::Error, 'title is required' if title.empty?
          @db.execute("INSERT INTO tasks(title, notes, recurrence) VALUES (?, ?, 'once')", [title, item['content'] || ''])
          task_id = @db.last_insert_row_id
          entry = one('SELECT id FROM items WHERE task_id = ?', task_id)
          @db.execute('UPDATE items SET description = ? WHERE id = ?', [item['description'] || '', entry['id']])
          entry['id'].to_i
        end
      end
      toc = item.key?('toc') ? (truthy?(item['toc']) ? 1 : 0) : 1
      existing = item['source_path'] && find_item_by_source(item['source_path'])
      if existing
        @db.execute('UPDATE items SET type = ?, title = ?, description = ?, content = ?, rendered_html = ?, url = ?, toc = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [item['type'], item['title'], item['description'] || '', item['content'] || '', item['rendered_html'] || '', item['url'], toc, existing['id']])
        return existing['id'].to_i
      end
      @db.execute(<<~SQL, [item['type'], item['title'], item['description'] || '', item['content'] || '', item['rendered_html'] || '', item['url'], item['source_path'], toc, item['created_at']])
        INSERT INTO items(type, title, description, content, rendered_html, url, source_path, toc, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
      SQL
      @db.last_insert_row_id
    end

    def update_item(id, patch)
      data = stringify(patch)
      sets = []
      values = []
      PATCH_COLUMNS.each do |column|
        next unless data.key?(column)
        sets << "#{column} = ?"
        values << (data[column] == true ? 1 : data[column] == false ? 0 : data[column])
      end
      return !get_item(id).nil? if sets.empty?
      @db.execute("UPDATE items SET #{sets.join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [*values, id])
      @db.changes.positive?
    end

    def set_rendered_html(id, html) = @db.execute('UPDATE items SET rendered_html = ? WHERE id = ?', [html, id])
    def set_path_and_category(id, path, category_id) = @db.execute('UPDATE items SET path = ?, category_id = ? WHERE id = ?', [path, category_id, id])

    def toggle_item_field(id, field)
      raise Pf::Error, 'field must be pinned or starred' unless %w[pinned starred].include?(field.to_s)
      @db.execute("UPDATE items SET #{field} = NOT #{field}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", id)
      @db.changes.positive?
    end

    def set_item_flag(ids, field, value)
      raise Pf::Error, 'field must be pinned or starred' unless %w[pinned starred].include?(field.to_s)
      @db.transaction { ids.each { |id| @db.execute("UPDATE items SET #{field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [value ? 1 : 0, id]) } }
    end

    def delete_items(ids)
      @db.transaction { ids.each { |id| @db.execute('DELETE FROM items WHERE id = ?', id) } }
      prune_tags
    end

    def set_tags(id, names)
      @db.transaction do
        names.each do |name|
          @db.execute('INSERT INTO tags(name) VALUES (?) ON CONFLICT(name) DO NOTHING', name)
          tag = one('SELECT id FROM tags WHERE name = ? COLLATE NOCASE', name)
          @db.execute('INSERT OR IGNORE INTO taggings(tag_id, item_id) VALUES (?, ?)', [tag['id'], id]) if tag
        end
      end
    end

    def remove_tags(id, names)
      @db.transaction { names.each { |name| @db.execute('DELETE FROM taggings WHERE item_id = ? AND tag_id = (SELECT id FROM tags WHERE name = ? COLLATE NOCASE)', [id, name]) } }
      prune_tags
    end

    def prune_tags
      @db.execute('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM taggings)')
      @db.changes
    end

    def find_tag(name) = one('SELECT * FROM tags WHERE name = ? COLLATE NOCASE', name)
    def rename_tag(id, name)
      @db.execute('UPDATE tags SET name = ? WHERE id = ?', [name, id])
      @db.changes.positive?
    end
    def remove_tag(id)
      @db.execute('DELETE FROM tags WHERE id = ?', id)
      @db.changes.positive?
    end

    def create_portfolio(name, description = '')
      name = name.to_s.strip
      raise Pf::Error, 'name is required' if name.empty?
      raise Pf::Error, 'a portfolio with that name already exists' if find_portfolio(name)
      @db.execute('INSERT INTO portfolios(name, description) VALUES (?, ?)', [name, description])
      @db.last_insert_row_id
    end

    def update_portfolio(id, patch)
      current = get_portfolio(id)
      return false unless current
      data = stringify(patch)
      name = (data.key?('name') ? data['name'] : current['name']).to_s.strip
      raise Pf::Error, 'name is required' if name.empty?
      raise Pf::Error, 'a portfolio with that name already exists' if one('SELECT id FROM portfolios WHERE name = ? COLLATE NOCASE AND id != ?', name, id)
      @db.execute('UPDATE portfolios SET name = ?, description = ? WHERE id = ?', [name, data.key?('description') ? data['description'] : current['description'], id])
      true
    end

    def delete_portfolio(id)
      @db.execute('DELETE FROM portfolios WHERE id = ?', id)
      @db.changes.positive?
    end

    def create_card(portfolio_id, input)
      card = Pf::Cards.normalize(input)
      raise Pf::Error, 'title is required' if card['title'].empty?
      @db.execute('INSERT INTO cards(portfolio_id, title, kind, config, tags, types, sort_key, sort_dir, max_items, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM cards WHERE portfolio_id = ?))', [portfolio_id, card['title'], card['kind'], JSON.generate(card['config']), JSON.generate(card['tags']), JSON.generate(card['types']), card['sort_key'], card['sort_dir'], card['max_items'], portfolio_id])
      @db.last_insert_row_id
    end

    def update_card(id, input)
      current = get_card(id)
      return false unless current
      card = Pf::Cards.normalize(current.merge(stringify(input)))
      raise Pf::Error, 'title is required' if card['title'].empty?
      @db.execute('UPDATE cards SET title = ?, kind = ?, config = ?, tags = ?, types = ?, sort_key = ?, sort_dir = ?, max_items = ? WHERE id = ?', [card['title'], card['kind'], JSON.generate(card['config']), JSON.generate(card['tags']), JSON.generate(card['types']), card['sort_key'], card['sort_dir'], card['max_items'], id])
      true
    end

    def delete_card(id)
      @db.execute('DELETE FROM cards WHERE id = ?', id)
      @db.changes.positive?
    end

    def move_card(card, direction)
      neighbor = direction == 'left' ? one('SELECT id, position FROM cards WHERE portfolio_id = ? AND position < ? ORDER BY position DESC LIMIT 1', card['portfolio_id'], card['position']) : one('SELECT id, position FROM cards WHERE portfolio_id = ? AND position > ? ORDER BY position LIMIT 1', card['portfolio_id'], card['position'])
      return false unless neighbor
      @db.transaction do
        @db.execute('UPDATE cards SET position = ? WHERE id = ?', [neighbor['position'], card['id']])
        @db.execute('UPDATE cards SET position = ? WHERE id = ?', [card['position'], neighbor['id']])
      end
      true
    end

    def create_category(input)
      data = stringify(input)
      name = data['name'].to_s.strip
      raise Pf::Error, 'name is required' if name.empty?
      raise Pf::Error, 'invalid kind' unless Pf::ITEM_TYPES.include?(data['kind'])
      raise Pf::Error, 'a category with that name already exists' if find_category(name)
      @db.execute('INSERT INTO categories(name, kind, slots) VALUES (?, ?, ?)', [name, data['kind'], JSON.generate(data['slots'] || [])])
      @db.last_insert_row_id
    end

    def update_category(id, patch)
      current = get_category(id)
      return false unless current
      data = stringify(patch)
      name = (data.key?('name') ? data['name'] : current['name']).to_s.strip
      kind = data.key?('kind') ? data['kind'] : current['kind']
      raise Pf::Error, 'name is required' if name.empty?
      raise Pf::Error, 'invalid kind' unless Pf::ITEM_TYPES.include?(kind)
      raise Pf::Error, 'a category with that name already exists' if one('SELECT id FROM categories WHERE name = ? AND id != ?', name, id)
      raise Pf::Error, "this category still has #{current['kind']} items, so its kind cannot change" if kind != current['kind'] && one('SELECT count(*) count FROM items WHERE category_id = ?', id)['count'].to_i.positive?
      slots = data.key?('slots') ? data['slots'] : current['slots']
      @db.execute('UPDATE categories SET name = ?, kind = ?, slots = ? WHERE id = ?', [name, kind, JSON.generate(slots), id])
      true
    end

    def delete_category(id)
      @db.execute('DELETE FROM categories WHERE id = ?', id)
      @db.changes.positive?
    end

    def set_slot_override(item, slot, path)
      overrides = json_parse(item['slot_paths'] || '{}', {})
      path.to_s.strip.empty? ? overrides.delete(slot) : overrides[slot] = path.to_s.strip
      @db.execute('UPDATE items SET slot_paths = ? WHERE id = ?', [JSON.generate(overrides), item['id']])
    end

    def add_project_parent(path)
      @db.execute('INSERT INTO project_parents(path) VALUES (?) ON CONFLICT(path) DO NOTHING', path)
    end

    def remove_project_parent(id)
      @db.execute('DELETE FROM project_parents WHERE id = ?', id)
      @db.changes.positive?
    end

    def scan_projects
      parents = list_project_parents
      return [] if parents.empty?
      category = find_category('project') || get_category(create_category('name' => 'project', 'kind' => 'dir', 'slots' => [{ 'name' => 'tasks', 'kind' => 'file', 'path' => 'TASKS.md' }]))
      added = []
      parents.each do |parent|
        Pf::Projects.discover(parent['path']).each do |path|
          next if find_item_by_path(path)
          @db.execute('INSERT INTO items(type, title, description, path, category_id) VALUES (?, ?, ?, ?, ?)', ['dir', File.basename(path), Pf.abbreviate_path(path), path, category['id']])
          set_tags(@db.last_insert_row_id, ['project'])
          added << path
        end
      end
      added
    end

    def list_items(filter = {})
      where = ['1=1']; params = []; join = ''
      if (q = filter[:q] || filter['q']).to_s.strip != ''
        join << ' JOIN items_fts ON items_fts.rowid = items.id'
        where << 'items_fts MATCH ?'
        params << fts_query(q, filter[:contents] || filter['contents'])
      end
      if (tag = filter[:tag] || filter['tag'])
        join << ' JOIN taggings filter_tagging ON filter_tagging.item_id = items.id'
        where << 'filter_tagging.tag_id = ?'; params << tag
      end
      if (tag_name = filter[:tag_name] || filter['tag_name'] || filter[:tagName] || filter['tagName'])
        where << 'items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name = ? COLLATE NOCASE)'; params << tag_name
      end
      if (category = filter[:category] || filter['category'])
        where << 'items.category_id = ?'; params << category
      end
      where << 'items.pinned = 1' if filter[:pinned] || filter['pinned']
      where << 'items.starred = 1' if filter[:starred] || filter['starred']
      if (type = filter[:type] || filter['type']) && !type.empty?
        where << 'items.type = ?'; params << type
      end
      limit = (filter[:limit] || filter['limit']).to_i
      sql = "SELECT DISTINCT items.* FROM items#{join} WHERE #{where.join(' AND ')} ORDER BY items.pinned DESC, datetime(items.created_at) DESC, items.id DESC"
      sql += " LIMIT #{limit}" if limit.positive?
      query(sql, *params)
    end

    def view_item(item) = Pf.item_view(item, tag_names_for(item['id']))
    def view_items(items) = items.map { |item| view_item(item) }
    def tag_names_for(id) = query('SELECT tags.name FROM tags JOIN taggings ON taggings.tag_id = tags.id WHERE taggings.item_id = ? ORDER BY tags.name', id).map { |r| r['name'] }
    def list_tags = query('SELECT tags.*, count(taggings.item_id) count FROM tags LEFT JOIN taggings ON taggings.tag_id = tags.id GROUP BY tags.id ORDER BY tags.name')
    def list_portfolios = query('SELECT portfolios.*, count(cards.id) card_count FROM portfolios LEFT JOIN cards ON cards.portfolio_id = portfolios.id GROUP BY portfolios.id ORDER BY portfolios.name')
    def get_portfolio(id) = one('SELECT * FROM portfolios WHERE id = ?', id)
    def find_portfolio(name) = one('SELECT * FROM portfolios WHERE name = ? COLLATE NOCASE', name)
    def portfolio_cards(id) = query('SELECT * FROM cards WHERE portfolio_id = ? ORDER BY position, id', id).map { |r| parse_card(r) }
    def get_card(id) = (r = one('SELECT * FROM cards WHERE id = ?', id)) && parse_card(r)

    def card_items(card)
      tags = card['tags'] || []; types = card['types'] || []
      where = ['1=1']; params = []
      unless tags.empty?
        where << "items.id IN (SELECT taggings.item_id FROM taggings JOIN tags ON tags.id = taggings.tag_id WHERE tags.name IN (#{(['?'] * tags.length).join(', ')}))"; params.concat(tags)
      end
      unless types.empty?
        where << "items.type IN (#{(['?'] * types.length).join(', ')})"; params.concat(types)
      end
      from = "FROM items WHERE #{where.join(' AND ')}"
      total = one("SELECT count(*) count #{from}", *params)['count']
      sort_key = { 'created_at' => 'datetime(items.created_at)', 'updated_at' => 'datetime(items.updated_at)', 'title' => 'items.title COLLATE NOCASE', 'type' => 'items.type' }.fetch(card['sort_key'], 'datetime(items.created_at)')
      sort_dir = card['sort_dir'] == 'asc' ? 'ASC' : 'DESC'
      rows = query("SELECT items.* #{from} ORDER BY #{sort_key} #{sort_dir}, items.id DESC LIMIT ?", *params, card['max_items'].to_i)
      { 'total' => total, 'items' => view_items(rows) }
    end

    def list_categories = query('SELECT categories.*, count(items.id) member_count FROM categories LEFT JOIN items ON items.category_id = categories.id GROUP BY categories.id ORDER BY categories.name').map { |r| parse_category(r) }
    def get_category(id) = (r = one('SELECT * FROM categories WHERE id = ?', id)) && parse_category(r)
    def find_category(name) = (r = one('SELECT * FROM categories WHERE name = ?', name)) && parse_category(r)
    def category_members(id) = query('SELECT * FROM items WHERE category_id = ? ORDER BY pinned DESC, datetime(created_at) DESC, id DESC', id)
    def list_watched_directories = query('SELECT * FROM watched_directories ORDER BY path')
    def claimed_item_ids(id) = query('SELECT item_id FROM watched_items WHERE watched_directory_id = ?', id).map { |r| r['item_id'] }
    def list_project_parents = query("SELECT project_parents.*, (SELECT count(*) FROM items WHERE items.path LIKE project_parents.path || '/%') count FROM project_parents ORDER BY path")

    def member_slots(item)
      return [] unless item['category_id']
      category = get_category(item['category_id'])
      return [] unless category
      overrides = json_parse(item['slot_paths'] || '{}', {})
      category['slots'].map do |slot|
        override = overrides[slot['name']]
        expanded = Pf.expand_path(override || slot['path'])
        path = expanded.start_with?('/') ? File.expand_path(expanded) : (item['path'] ? File.expand_path(expanded, item['path']) : nil)
        slot.merge('path' => path, 'overridden' => !override.nil?, 'exists' => path ? File.exist?(path) : false)
      end
    end

    private

    def stringify(row) = row.each_with_object({}) { |(k, v), h| h[k.to_s] = v unless k.is_a?(Integer) }
    def json_parse(value, fallback) = JSON.parse(value.to_s.empty? ? JSON.generate(fallback) : value)
    def parse_card(row) = row.merge('tags' => json_parse(row['tags'], []), 'types' => json_parse(row['types'], []), 'config' => json_parse(row['config'], {}))
    def parse_category(row) = row.merge('slots' => json_parse(row['slots'], []))
    def fts_query(q, contents)
      phrase = q.to_s.split(/\s+/).reject(&:empty?).map { |t| %Q{"#{t.gsub('"', '""')}"} }.join(' AND ')
      contents ? phrase : "{title description} : (#{phrase})"
    end
    def truthy?(value) = value == true || value.to_s == '1' || value.to_s == 'true'
  end
end
