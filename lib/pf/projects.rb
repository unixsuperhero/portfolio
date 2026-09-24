module Pf
  module Projects
    SCAN_DEPTH = 4

    module_function

    def discover(parent, depth = SCAN_DEPTH)
      found = []
      walk(File.expand_path(parent), 1, depth.to_i, found)
      found
    end

    def walk(directory, level, depth, found)
      entries = Dir.children(directory)
    rescue SystemCallError
      return
    else
      entries.sort.each do |name|
        next if name.start_with?(".") || name == "node_modules"
        path = File.join(directory, name)
        next unless File.directory?(path) && !File.symlink?(path)

        repository = File.exist?(File.join(path, ".git"))
        found << path if level == 1 || repository
        walk(path, level + 1, depth, found) if !repository && level < depth
      end
    end
  end
end
