module Pf
  class << self
    def json(value) = JSON.pretty_generate(value)

    def table(rows, columns: nil, max: 60, header: true)
      return '(no results)' if rows.empty?
      columns ||= rows.first.keys
      cell = lambda do |value|
        text = value.to_s.gsub(/\s+/, ' ')
        text.length > max ? text[0, max - 1] + '…' : text
      end
      values = rows.map { |row| columns.map { |column| cell.call(row[column]) } }
      widths = columns.each_index.map { |i| [columns[i].to_s.length, *values.map { |row| row[i].length }].max }
      line = ->(row) { row.each_with_index.map { |value, i| value.to_s.ljust(widths[i]) }.join('  ').rstrip }
      lines = values.map { |row| line.call(row) }
      lines.unshift(line.call(columns), line.call(widths.map { |width| '-' * width })) if header
      lines.join("\n")
    end

    def number_arg(value, what = 'id')
      number = Float(value, exception: false)
      unless number&.finite? && number.positive? && number == number.to_i
        raise Error, "#{what} must be a positive integer, got #{JSON.generate(value || '')}"
      end
      number.to_i
    end

    def which(name)
      ENV.fetch('PATH', '').split(File::PATH_SEPARATOR).map { |dir| File.join(dir, name) }.find { |path| File.file?(path) && File.executable?(path) }
    end

    def open_default(target)
      system(RUBY_PLATFORM.include?('darwin') ? 'open' : 'xdg-open', target)
      $?.exitstatus
    end

    def edit_files(paths, max_splits = 3)
      editor = ENV['EDITOR'] || which('nvim') || which('vim') || 'vi'
      args = editor.match?(/vim/i) ? [paths.length > max_splits ? "-O#{max_splits}" : '-O', *paths] : paths
      system(editor, *args)
      $?.exitstatus
    end

    def copy_to_clipboard(text)
      bin = ENV['PORTFOLIO_PBCOPY_BIN'] || which('pbcopy')
      return false unless bin
      _, status = Open3.capture2(bin, stdin_data: text)
      status.success?
    end

    def read_stdin = STDIN.read.delete_suffix("\n")

    def confirm(question, assume: nil)
      return assume unless assume.nil?
      return false unless STDIN.tty?
      print "#{question} [y/N]"
      STDIN.gets.to_s.strip.match?(/\Ay(?:es)?\z/i)
    end

    def pick_one(items, prompt: nil)
      return items.first if items.length <= 1
      bin = ENV['PF_PICKER'] || which('sk') || which('fzf')
      raise Error, 'no fuzzy picker: install sk or fzf, or pass an exact match' unless bin
      labels = items.map { |item| yield item }
      args = prompt ? ['--prompt', prompt] : []
      output, = Open3.capture2(bin, *args, stdin_data: labels.join("\n") + "\n")
      chosen = output.lines.map(&:strip).reject(&:empty?).first
      index = labels.index(chosen)
      index && items[index]
    end
  end
end
