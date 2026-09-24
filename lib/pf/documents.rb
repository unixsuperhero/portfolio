# frozen_string_literal: true

require 'net/http'
require 'securerandom'
require_relative 'crawl'
require_relative 'render'

module Pf
  module Documents
    module_function

    def flag?(opts, name)
      predicate = :"#{name}?"
      opts.respond_to?(predicate) ? opts.public_send(predicate) : opts.public_send(name)
    end

    def toc_enabled?(opts)
      !flag?(opts, :no_toc)
    end

    def read_files(paths)
      paths.to_h { |path| [path, File.read(path, encoding: 'UTF-8')] }
    end

    def import_files(args, opts)
      raise Pf::Error, 'at least one file is required' if args.empty?

      store = Pf.writable_store
      crawl = Pf::Crawl.crawl_markdown(args, recursive: flag?(opts, :recursive))
      contents = read_files(crawl['files'])
      ids = {}
      toc = toc_enabled?(opts)
      store.db.transaction do
        crawl['files'].each do |path|
          content = contents.fetch(path)
          root = path == crawl['roots'][0]
          html = Pf::Detect.html_path?(path)
          title = root && opts.title ? opts.title : Pf::Detect.document_title(content, path)
          ids[path] = store.upsert_item('type' => 'document', 'title' => title, 'description' => root ? opts.desc.to_s : '', 'content' => html ? '' : content, 'rendered_html' => html ? content : '', 'source_path' => path, 'toc' => toc ? 1 : 0)
        end
        crawl['files'].each do |path|
          next unless Pf::Detect.markdown_path?(path)

          item = store.get_item(ids.fetch(path))
          store.set_rendered_html(item['id'], Pf::Render.render_markdown(contents.fetch(path), title: item['title'], toc: toc, source_path: path, resolve_id: ->(target) { ids[target] || store.find_item_by_source(target)&.fetch('id') }))
        end
      end
      roots = crawl['roots'].map { |path| store.get_item(ids.fetch(path)) }
      { 'imported' => crawl['files'].length, 'roots' => roots.map { |item| store.view_item(item) } }
    end

    def rerender(args, opts)
      store = Pf.writable_store
      items = if opts.all?
                store.list_items.select { |item| !item['content'].to_s.empty? }
              else
                args.map { |id| store.get_item(Pf.number_arg(id)) }.compact
              end
      count = 0
      items.each do |item|
        content = item['content'].to_s
        if opts.disk? && item['source_path'] && File.exist?(item['source_path'])
          content = File.read(item['source_path'], encoding: 'UTF-8')
          store.update_item(item['id'], 'content' => content)
        end
        next if content.empty?

        store.set_rendered_html(item['id'], Pf::Render.render_markdown(content, title: item['title'], toc: item['toc'] == true || item['toc'].to_i == 1, source_path: item['source_path'], resolve_id: ->(path) { store.find_item_by_source(path)&.fetch('id') }))
        count += 1
      end
      count
    end

    def push_files(args, opts)
      raise Pf::Error, 'at least one file is required' if args.empty?

      crawl = Pf::Crawl.crawl_markdown(args, recursive: flag?(opts, :recursive))
      documents = crawl['files'].map { |path| { 'sourcePath' => path, 'content' => File.read(path, encoding: 'UTF-8') } }
      create_documents(documents, 'roots' => crawl['roots'], 'title' => opts.title, 'description' => opts.desc, 'toc' => toc_enabled?(opts))
    end

    def create_documents(documents, options)
      boundary = "----pf-docs-#{SecureRandom.hex(12)}"
      body = +''
      add_part = lambda do |name, value, filename: nil, content_type: nil|
        body << "--#{boundary}\r\n"
        disposition = "form-data; name=\"#{name}\""
        disposition << "; filename=\"#{filename}\"" if filename
        body << "Content-Disposition: #{disposition}\r\n"
        body << "Content-Type: #{content_type}\r\n" if content_type
        body << "\r\n#{value}\r\n"
      end
      add_part.call('roots', JSON.generate(options['roots']))
      add_part.call('title', options['title'].to_s)
      add_part.call('description', options['description'].to_s)
      add_part.call('toc', String(options.fetch('toc', true)))
      documents.each do |document|
        add_part.call('file', document['content'], filename: File.basename(document['sourcePath']), content_type: 'text/plain')
        add_part.call('source_path', document['sourcePath'])
      end
      body << "--#{boundary}--\r\n"

      uri = URI(Pf.client.absolute('/api/documents'))
      req = Net::HTTP::Post.new(uri)
      req['Content-Type'] = "multipart/form-data; boundary=#{boundary}"
      req.body = body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 5, read_timeout: 30) { |http| http.request(req) }
      data = res.body.to_s.empty? ? nil : JSON.parse(res.body)
      return data if res.code.to_i.between?(200, 299)

      message = data.is_a?(Hash) ? (data['error'] || data['message']) : res.body
      raise Pf::Error, "HTTP #{res.code}: #{message || res.message}"
    rescue JSON::ParserError
      raise Pf::Error, "invalid JSON response from #{uri}"
    rescue Errno::ECONNREFUSED, SocketError, Timeout::Error, Net::OpenTimeout, Net::ReadTimeout => e
      raise Pf::Error, "#{uri}: #{e.message}"
    end
  end
end
