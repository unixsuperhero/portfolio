require 'json'
require 'open3'
require 'fileutils'
require 'pathname'
require 'uri'
FileUtils.mkdir_p(File.join(Dir.home, '.config', 'hiiro'))
gem 'hiiro', '= 0.1.384'
require 'hiiro'

module Pf
  class Error < Hiiro::Error; end

  def self.run(external_commands: false, &block)
    hiiro = Hiiro.init(*ARGV, bin_name: $PROGRAM_NAME, builtin_commands: false, external_commands: external_commands, &block)
    if ARGV.length == 1 && %w[-h --help].include?(ARGV.first)
      hiiro.list_runners(hiiro.runners.all_runners)
      puts hiiro.options.help_text
      return
    end
    def hiiro.handle_result(result)
      exit(result.is_a?(Integer) ? result : result == false ? 1 : 0)
    end
    hiiro.run
  rescue Pf::Error, SQLite3::Exception, SystemCallError => e
    warn "ERROR: #{e.message}"
    exit 1
  rescue Interrupt
    exit 130
  end

  def self.client = Pf::Client.new
  def self.store = Pf::Store.new
  def self.writable_store = Pf::Store.new(readonly: false)
end

require_relative 'pf/project'
require_relative 'pf/io'
require_relative 'pf/client'
require_relative 'pf/store'
require_relative 'pf/list_opts'
