module Pf
  ITEM_TYPES = %w[document note link pr file dir task].freeze
  LIST_OPTIONS = %i[type tag pinned starred contents limit json full].freeze

  class << self
    def add_list_options(hiiro)
      hiiro.add_option :type, short: 't', desc: 'only this item type'
      hiiro.add_option :tag, short: 'g', desc: 'only items with this tag name'
      hiiro.add_option :limit, short: 'l', type: :integer, desc: 'at most N items'
      hiiro.add_flag :pinned, short: 'p', desc: 'pinned only'
      hiiro.add_flag :starred, short: 's', desc: 'starred only'
      hiiro.add_flag :contents, short: 'c', desc: 'search inside contents too'
      hiiro.add_flag :json, short: 'j', desc: 'print JSON'
      hiiro.add_flag :full, short: 'f', desc: 'show paths and urls'
      LIST_OPTIONS
    end

    def find_items(store, args, opts)
      values = opts.to_h
      type = values[:type]
      raise Error, "invalid type #{type}" if type && !ITEM_TYPES.include?(type)
      store.list_items(q: args.join(' '), type: type, tag_name: values[:tag], pinned: values[:pinned], starred: values[:starred], contents: values[:contents], limit: values[:limit])
    end

    def pick_item(store, args, opts)
      if args.length == 1 && args[0].match?(/\A\d+\z/)
        return store.get_item(args[0].to_i) || raise(Error, "no item ##{args[0]}")
      end
      items = find_items(store, args, opts)
      raise Error, 'no matches' if items.empty?
      pick_one(items) { |item| label(item) }
    end

    def print_items(store, items, opts)
      views = store.view_items(items)
      if opts.json?
        puts json(views)
      elsif views.empty?
        puts '(no items)'
      elsif opts.full?
        puts table(views.map { |item| { id: item['id'], type: item['type'], title: item['title'], tags: item['tags'].join(','), created: item['created_at'][0, 10], where: item['url'] || ((item['path'] || item['source_path']) && abbreviate_path(item['path'] || item['source_path'])) || '' } })
      else
        views.each { |item| puts "#{item['pinned'] ? '📌 ' : ''}#{item['starred'] ? '★ ' : ''}#{label(item)}#{item['tags'].empty? ? '' : "  ##{item['tags'].join(' #')}"}" }
      end
    end
  end
end
