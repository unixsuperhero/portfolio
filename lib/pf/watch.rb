# frozen_string_literal: true

require "time"
require_relative "detect"
require_relative "render"

module Pf
  module Watch
    DOCUMENT_EXTENSIONS = [".md", ".markdown", ".html"].freeze

    module_function

    def absolute_dir(value)
      raise Pf::Error, "directory required" if value.to_s.empty?
      path = File.expand_path(Pf.expand_path(value))
      raise Pf::Error, "#{path} is not a directory" unless File.directory?(path)
      path
    end

    def scan_directory(path, recursive: false)
      raise Pf::Error, "Path is not a directory." unless File.directory?(path)
      scan_paths(path, recursive: recursive).each_with_object({}) do |source_path, documents|
        content = File.read(source_path)
        documents[source_path] = { "title" => document_title(content, source_path), "html" => html_path?(source_path), "sourcePath" => source_path, "content" => content }
      end
    end

    def scan_rows(path, recursive: false)
      scan_directory(path, recursive: recursive).values.map do |doc|
        { "title" => doc["title"], "kind" => doc["html"] ? "html" : "md", "path" => Pf.abbreviate_path(doc["sourcePath"]) }
      end
    end

    def document_path?(path)
      DOCUMENT_EXTENSIONS.include?(File.extname(path).downcase)
    end

    def html_path?(path)
      File.extname(path).downcase == ".html"
    end

    def document_title(content, path) = Pf::Detect.document_title(content, path)

    def add(path, recursive: false)
      with_store do |store|
        raise Pf::Error, "That directory is already being watched." if store.one("SELECT id FROM watched_directories WHERE path = ?", path)
        store.db.execute("INSERT INTO watched_directories(path, recursive) VALUES (?, ?)", [path, recursive ? 1 : 0])
        id = store.db.last_insert_row_id
        result = reconcile(store)
        result.merge("id" => id)
      end
    end
    def set(id, recursive:)
      with_store do |store|
        store.db.execute("UPDATE watched_directories SET recursive = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [recursive ? 1 : 0, id])
        raise Pf::Error, "no such watch" if store.db.changes.zero?
        reconcile(store)
      end
    end

    def remove(id)
      with_store do |store|
        item_ids = claimed_item_ids(store, id)
        removed = 0
        store.db.transaction do
          store.db.execute("DELETE FROM watched_directories WHERE id = ?", id)
          item_ids.each do |item_id|
            next if has_claim?(store, item_id)
            store.db.execute("DELETE FROM items WHERE id = ?", item_id)
            removed += 1
          end
          prune_tags(store)
        end
        { "removed" => removed }
      end
    end

    def sync
      with_store { |store| reconcile(store) }
    end

    def reconcile(store, directories = store.list_watched_directories)
      scans = {}
      documents = {}
      failures = {}
      directories.each do |directory|
        begin
          scan = scan_directory(directory["path"], recursive: truthy?(directory["recursive"]))
          scans[directory["id"]] = scan
          scan.each { |path, document| documents[path] = document }
        rescue StandardError => e
          failures[directory["id"]] = e
        end
      end

      removed = 0
      store.db.transaction do
        previous = []
        directories.each do |directory|
          next unless scans.key?(directory["id"])
          previous.concat(claimed_item_ids(store, directory["id"]))
          store.db.execute("DELETE FROM watched_items WHERE watched_directory_id = ?", directory["id"])
        end

        ids = {}
        documents.values.sort_by { |doc| doc["sourcePath"] }.each do |document|
          ids[document["sourcePath"]] = upsert_watched_document(store, document)
        end
        scans.each do |directory_id, scan|
          scan.keys.each { |path| store.db.execute("INSERT OR IGNORE INTO watched_items(watched_directory_id, item_id) VALUES (?, ?)", [directory_id, ids.fetch(path)]) }
        end
        previous.uniq.each do |item_id|
          next if has_claim?(store, item_id)
          store.db.execute("DELETE FROM items WHERE id = ?", item_id)
          removed += 1
        end
        prune_tags(store)

        sources = source_item_ids(store)
        documents.values.each do |document|
          next if document["html"]
          id = ids.fetch(document["sourcePath"])
          item = store.one("SELECT title, toc FROM items WHERE id = ?", id)
          html = Pf::Render.render_markdown(document["content"], title: item["title"], toc: truthy?(item["toc"]), source_path: document["sourcePath"], resolve_id: ->(path) { sources[path] })
          store.db.execute("UPDATE items SET rendered_html = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [html, id])
        end
      end

      synced_at = Time.now.utc.iso8601
      states = directories.map do |directory|
        failure = failures[directory["id"]]
        scan = scans[directory["id"]]
        { "id" => directory["id"], "error" => failure&.message, "lastSyncedAt" => failure ? nil : synced_at, "count" => scan ? scan.length : 0 }
      end
      { "states" => states, "upserted" => documents.length, "removed" => removed }
    end

    def upsert_watched_document(store, document)
      existing = store.one("SELECT id FROM items WHERE source_path = ?", document["sourcePath"])
      content = document["html"] ? "" : document["content"]
      rendered = document["html"] ? document["content"] : ""
      if existing
        store.db.execute("UPDATE items SET type = 'document', title = ?, content = ?, rendered_html = ?, url = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?", [document["title"], content, rendered, existing["id"]])
        existing["id"]
      else
        store.db.execute("INSERT INTO items(type, title, content, rendered_html, source_path, toc) VALUES ('document', ?, ?, ?, ?, 1)", [document["title"], content, rendered, document["sourcePath"]])
        store.db.last_insert_row_id
      end
    end

    def source_item_ids(store)
      store.query("SELECT id, source_path FROM items WHERE type IN ('document', 'note') AND source_path IS NOT NULL").to_h { |row| [row["source_path"], row["id"]] }
    end

    def claimed_item_ids(store, id)
      store.query("SELECT item_id FROM watched_items WHERE watched_directory_id = ?", id).map { |row| row["item_id"] }
    end

    def has_claim?(store, item_id)
      !!store.one("SELECT 1 FROM watched_items WHERE item_id = ? LIMIT 1", item_id)
    end

    def prune_tags(store)
      store.db.execute("DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM taggings)")
    end

    def with_store
      store = Pf.writable_store
      yield store
    ensure
      store&.close
    end

    def signature(directory)
      paths = scan_paths(directory["path"], recursive: truthy?(directory["recursive"]))
      paths.map { |path| st = File.stat(path); [path, st.mtime.to_f, st.size] }
    rescue SystemCallError => e
      [["ERROR", e.message]]
    end

    def scan_paths(path, recursive: false)
      pattern = recursive ? File.join(path, "**", "*") : File.join(path, "*")
      Dir.glob(pattern).select { |candidate| File.file?(candidate) && document_path?(candidate) }.sort
    end

    def sync_lines(result)
      states = result["states"] || []
      lines = states.map { |state| "##{state["id"]}: #{state["error"] ? "error #{state["error"]}" : "#{state["count"]} documents"}" }
      lines << "removed #{result.fetch("removed", 0)}" if result.key?("removed")
      lines
    end

    def truthy?(value)
      value == true || value.to_i == 1
    end
  end
end
