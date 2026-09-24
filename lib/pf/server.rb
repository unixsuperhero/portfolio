# frozen_string_literal: true

module Pf
  module Server
    module_function

    def label
      "com.#{ENV["USER"] || "user"}.portfolio"
    end


    def domain
      "gui/#{Process.uid}"
    end

    def target
      "#{domain}/#{label}"
    end

    def plist_path
      File.join(Dir.home, "Library", "LaunchAgents", "#{label}.plist")
    end

    def logs_dir
      File.join(Pf.project_root, "logs")
    end

    def loaded?
      system("launchctl", "print", target, out: File::NULL, err: File::NULL)
    end

    def launchctl(*args)
      system("launchctl", *args)
      $?.exitstatus || 1
    end

    def run_installer
      installer = File.join(Pf.project_root, "bin", "install")
      raise Pf::Error, "installer not found: #{installer}" unless File.exist?(installer)
      system(installer)
      $?.exitstatus || 1
    end

    def require_plist!
      raise Pf::Error, "LaunchAgent not installed (#{plist_path}); run pf-server setup" unless File.exist?(plist_path)
    end

    def start(restart: false)
      require_plist!
      code = if loaded?
        launchctl("kickstart", *(restart ? ["-k"] : []), target)
      else
        launchctl("bootstrap", domain, plist_path)
      end
      puts(restart ? "restarted" : "started") if code.zero?
      code
    end

  end
end
