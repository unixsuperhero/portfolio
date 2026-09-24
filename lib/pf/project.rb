module Pf
  class << self
    def project_root = ENV['PORTFOLIO_HOME'] || File.expand_path('../..', __dir__)
    def database_path = ENV['PORTFOLIO_DB'] || File.join(project_root, 'portfolio.sqlite')
    def server_url = (ENV['PORTFOLIO_SERVER'] || ENV['HDOCS_SERVER'] || 'http://127.0.0.1:4387').delete_suffix('/')

    def abbreviate_path(path)
      path.start_with?(Dir.home + '/') ? "~#{path.delete_prefix(Dir.home)}" : path
    end

    def expand_path(path)
      return Dir.home if path == '~'
      path.start_with?('~/') ? File.expand_path(path) : path
    end

    def item_href(item)
      %w[link pr].include?(item['type']) && item['url'] ? item['url'] : "/items/#{item['id']}"
    end

    def item_url(item)
      href = item_href(item)
      href.start_with?('/') ? "#{server_url}#{href}" : href
    end

    def item_view(item, tags)
      item.slice('id', 'type', 'title', 'description', 'url', 'source_path', 'task_id', 'path', 'pinned', 'starred', 'created_at', 'updated_at').merge(
        'pinned' => item['pinned'] == true || item['pinned'] == 1,
        'starred' => item['starred'] == true || item['starred'] == 1,
        'href' => item_href(item), 'tags' => tags
      )
    end

    def label(item) = "#{item['title']} [#{item['type']} ##{item['id']}]"
    def parse_tags(value) = value.to_s.split(',').map(&:strip).reject(&:empty?).uniq
  end
end
