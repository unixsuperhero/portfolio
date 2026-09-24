# frozen_string_literal: true

require 'pathname'
require 'uri'

module Pf
  DOCUMENT_EXTENSIONS = %w[.md .markdown .html].freeze
  MARKDOWN_EXTENSIONS = %w[.md .markdown].freeze

  module Detect
    module_function

    def expand_path(value, home = nil)
      home ||= ENV.fetch('HOME', '')
      return home if value == '~'
      return File.expand_path(value[2..], home) if value.start_with?('~/')

      value
    end

    def abbreviate_path(path, home = nil)
      home ||= ENV.fetch('HOME', '')
      home != '' && path.start_with?(home + '/') ? "~#{path[home.length..]}" : path
    end

    def normalize_item_path(value, home = nil)
      path = expand_path(value.to_s.strip, home)
      raise Pf::Error, 'path must be absolute or start with ~/' if path.empty? || !Pathname.new(path).absolute?

      File.expand_path(path)
    end

    def markdown_path?(path)
      MARKDOWN_EXTENSIONS.include?(File.extname(path).downcase)
    end

    def html_path?(path)
      File.extname(path).downcase == '.html'
    end

    def document_path?(path)
      DOCUMENT_EXTENSIONS.include?(File.extname(path).downcase)
    end

    def first_heading(markdown)
      markdown.to_s.each_line do |line|
        match = line.match(/^#\s+(.+)$/)
        return match[1].strip if match
      end
      nil
    end

    def first_line(text)
      text.to_s.each_line.map(&:strip).find { |line| !line.empty? }
    end

    def html_title(html)
      html.to_s.match(%r{<title[^>]*>([^<]+)</title>}i)&.[](1)&.strip
    end

    def document_title(content, source_path)
      fallback = File.basename(source_path, File.extname(source_path))
      return html_title(content) || fallback if html_path?(source_path)

      first_heading(content) || fallback
    end

    def text_title(content, max = 80)
      (first_heading(content) || first_line(content) || 'Untitled')[0, max]
    end

    def detect_url(line)
      return nil unless line.match?(%r{\Ahttps?://\S+\z})

      uri = URI.parse(line)
      raise URI::InvalidURIError, line unless uri.host

      host = uri.host.downcase
      github = line.match(%r{github\.com/([^/]+/[^/]+)/pull/(\d+)}i)
      generic = line.match(%r{/(?:pull|merge_requests)/(\d+)})
      if github
        { 'shape' => 'url', 'type' => 'pr', 'url' => line, 'title' => "#{github[1]}##{github[2]}" }
      elsif generic
        { 'shape' => 'url', 'type' => 'pr', 'url' => line, 'title' => "#{host}#{uri.path}" }
      else
        { 'shape' => 'url', 'type' => 'link', 'url' => line, 'title' => "#{host}#{uri.path}".sub(%r{/\z}, '') }
      end
    end

    def detect_path(line, home: nil)
      return nil unless line.match?(%r{\A(~/|/|~\z)})

      path = normalize_item_path(line, home)
      kind = if File.directory?(path)
               'dir'
             elsif File.exist?(path)
               'file'
             end
      type = kind == 'dir' ? 'dir' : (document_path?(path) ? 'document' : 'file')
      title = type == 'document' ? File.basename(path, File.extname(path)) : File.basename(path)
      { 'shape' => 'path', 'type' => type, 'path' => path, 'exists' => !kind.nil?, 'title' => title }
    end

    def detect_text(content)
      { 'shape' => 'text', 'type' => 'note', 'content' => content, 'title' => text_title(content) }
    end

    def detect(raw, home: nil)
      content = raw.to_s.strip
      line = content.include?("\n") ? '' : content
      if !line.empty?
        detected_url = detect_url(line)
        return detected_url if detected_url

        detected_path = detect_path(line, home: home)
        return detected_path if detected_path
      end
      detect_text(content)
    end

    def local_markdown_link(source_path, target)
      return nil if target.nil? || target.empty? || target.start_with?('#') || target.start_with?('//') || target.match?(%r{\A[a-z][a-z0-9+.-]*:}i)

      boundary = target.index(/[?#]/)
      encoded_path = boundary ? target[0...boundary] : target
      return nil if encoded_path.empty?

      begin
        path = URI::DEFAULT_PARSER.unescape(encoded_path)
      rescue ArgumentError, URI::InvalidURIError
        return nil
      end
      return nil unless markdown_path?(path)

      suffix = boundary ? target[boundary..] : ''
      { 'sourcePath' => File.expand_path(path, File.dirname(source_path)), 'suffix' => suffix }
    end
  end

end
