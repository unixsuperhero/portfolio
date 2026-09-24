module Pf
  module Cards
    ITEM_TYPES = %w[document note link pr file dir task].freeze
    CARD_SORT_KEYS = %w[created_at updated_at title type].freeze
    CARD_KINDS = %w[query tasks reminders ports clock note services].freeze
    CARD_MAX_DEFAULT = 100
    CARD_MAX_MIN = 1
    CARD_MAX_MAX = 1000

    module_function

    def normalize_config(value)
      return value if value.is_a?(Hash)
      return {} unless value.is_a?(String)

      parsed = JSON.parse(value)
      parsed.is_a?(Hash) ? parsed : {}
    rescue JSON::ParserError
      {}
    end

    def normalize(input)
      raw_types = input[:types] || input["types"]
      types = raw_types.is_a?(Array) ? raw_types : Pf.parse_tags(raw_types)
      types = ITEM_TYPES.select { |type| types.include?(type) }
      max = Integer(input[:max_items] || input["max_items"] || CARD_MAX_DEFAULT, exception: false) || CARD_MAX_DEFAULT

      {
        "title" => String(input[:title] || input["title"] || "").strip,
        "tags" => normalize_tags(input[:tags] || input["tags"]),
        "types" => types.length == ITEM_TYPES.length ? [] : types,
        "sort_key" => CARD_SORT_KEYS.include?(input[:sort_key] || input["sort_key"]) ? (input[:sort_key] || input["sort_key"]) : "created_at",
        "sort_dir" => (input[:sort_dir] || input["sort_dir"]) == "asc" ? "asc" : "desc",
        "max_items" => [[max, CARD_MAX_MIN].max, CARD_MAX_MAX].min,
        "kind" => CARD_KINDS.include?(input[:kind] || input["kind"]) ? (input[:kind] || input["kind"]) : "query",
        "config" => normalize_config(input.key?(:config) ? input[:config] : input["config"]),
      }
    end

    def normalize_tags(value)
      if value.is_a?(Array)
        value.map { |tag| tag.to_s.strip }.reject(&:empty?).uniq
      else
        Pf.parse_tags(value)
      end
    end

    def describe(card)
      tags = Array(card["tags"] || card[:tags]).map { |tag| "##{tag}" }
      types = Array(card["types"] || card[:types])
      max = card["max_items"] || card[:max_items]
      text = (tags + types).empty? ? "everything" : (tags + types).join(" ")
      text += " · #{card["sort_key"] || card[:sort_key]} #{card["sort_dir"] || card[:sort_dir]}"
      text += " · max #{max}" if max.to_i < CARD_MAX_MAX
      text
    end

  end
end
