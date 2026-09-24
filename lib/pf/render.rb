# frozen_string_literal: true

require 'json'
require 'open3'
require 'date'
require_relative 'detect'

module Pf
  module Render
    MARKDOWN_READER = 'markdown+lists_without_preceding_blankline-blank_before_header-blank_before_blockquote+autolink_bare_uris+emoji+mark+wikilinks_title_before_pipe'
    DEFAULT_TEMPLATE = File.expand_path('../../packages/render/templates/document.html', __dir__)

    module_function

    def pandoc_bin
      return ENV['PANDOC_BIN'] if ENV['PANDOC_BIN'] && !ENV['PANDOC_BIN'].empty?

      @pandoc_bin ||= begin
        path = ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).map { |dir| File.join(dir, 'pandoc') }.find { |candidate| File.executable?(candidate) }
        path || %w[/opt/homebrew/bin/pandoc /usr/local/bin/pandoc].find { |candidate| File.exist?(candidate) } || 'pandoc'
      end
    end

    def pandoc_available?(bin = pandoc_bin)
      File.executable?(bin) || ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).any? { |dir| File.executable?(File.join(dir, bin)) }
    end

    def run_pandoc(args, input, bin = pandoc_bin)
      stdout, stderr, status = Open3.capture3(bin, *args, stdin_data: input.to_s)
      raise Pf::Error, (stderr.empty? ? 'pandoc failed' : stderr) unless status.success?

      stdout
    end

    def markdown_to_ast(markdown, bin: nil)
      JSON.parse(run_pandoc(["--from=#{MARKDOWN_READER}", '--to=json'], markdown, bin || pandoc_bin))
    end

    def ast_links(node)
      found = []
      walk = lambda do |value|
        case value
        when Array
          value.each { |child| walk.call(child) }
        when Hash
          if value['t'] == 'Link' && value['c'].is_a?(Array) && value['c'][2].is_a?(Array) && value['c'][2][0].is_a?(String)
            found << value['c'][2][0]
          end
          value.each_value { |child| walk.call(child) }
        end
      end
      walk.call(node)
      found
    end

    def rewrite_links(ast, source_path)
      walk = lambda do |value, resolve_id|
        case value
        when Array
          value.each { |child| walk.call(child, resolve_id) }
        when Hash
          if value['t'] == 'Link' && value['c'].is_a?(Array) && value['c'][2].is_a?(Array)
            target = value['c'][2]
            local = Pf::Detect.local_markdown_link(source_path, target[0])
            id = local && resolve_id.call(local['sourcePath'])
            target[0] = "/items/#{id}#{local['suffix']}" if id
          end
          value.each_value { |child| walk.call(child, resolve_id) }
        end
      end
      lambda do |resolve_id|
        walk.call(ast, resolve_id)
        ast
      end
    end

    def render_markdown(markdown, title:, toc: true, source_path: nil, resolve_id: nil, template: nil, bin: nil, date: nil, highlight: nil)
      input = markdown.to_s
      from = "--from=#{MARKDOWN_READER}"
      if source_path && resolve_id
        ast = markdown_to_ast(markdown, bin: bin)
        input = JSON.generate(rewrite_links(ast, source_path).call(resolve_id))
        from = '--from=json'
      end
      args = [
        from,
        "--template=#{template || DEFAULT_TEMPLATE}",
        "--syntax-highlighting=#{highlight || 'breezedark'}",
        '--standalone',
        '--section-divs',
        '--html-q-tags',
        '--wrap=none',
        '--metadata', "title=#{title}",
        '--metadata', "date=#{date || Date.today.strftime('%B %-d, %Y')}"
      ]
      args.concat(['--toc', '--toc-depth=3']) if toc.nil? || toc
      run_pandoc(args, input, bin || pandoc_bin)
    end

    def render_fragment(markdown, bin: nil)
      run_pandoc(["--from=#{MARKDOWN_READER}", '--to=html', '--wrap=none'], markdown, bin || pandoc_bin)
    end
  end
end
