# frozen_string_literal: true

require_relative 'detect'
require_relative 'render'

module Pf
  module Crawl
    module_function

    def crawl_markdown(root_paths, recursive: false, bin: nil, read: nil)
      reader = read || ->(path) { File.read(path, encoding: 'UTF-8') }
      roots = root_paths.map { |path| File.expand_path(path) }
      seen = {}
      edges = {}
      queue = roots.sort

      until queue.empty?
        path = queue.shift
        next if seen[path]
        raise Pf::Error, "linked Markdown not found: #{path}" unless File.exist?(path)

        seen[path] = true
        next unless recursive && Pf::Detect.markdown_path?(path)

        children = []
        Pf::Render.ast_links(Pf::Render.markdown_to_ast(reader.call(path), bin: bin)).each do |target|
          child = Pf::Detect.local_markdown_link(path, target)
          next unless child
          child_path = child['sourcePath']
          raise Pf::Error, "linked Markdown not found: #{child_path} (from #{path})" unless File.exist?(child_path)

          children << child_path
          queue << child_path unless seen[child_path]
        end
        edges[path] = children.uniq
        queue.sort!
      end

      { 'roots' => roots, 'files' => seen.keys.sort, 'edges' => edges }
    end
  end
end
