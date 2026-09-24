# frozen_string_literal: true
require "time"

module Pf
  module Ports
    LOCAL_HOSTS = ["*", "::", "0.0.0.0", "::1", "127.0.0.1", "localhost"].freeze

    module_function

    def scanner_bin(root = Pf.project_root)
      ENV["PORTS_SCAN_BIN"] || File.join(root, "bin", "ports-scan")
    end

    def scan(bin = scanner_bin)
      stdout, stderr, status = Open3.capture3(bin)
      unless status.success?
        return empty((stderr.lines.first || "scanner exited with #{status.exitstatus}").strip)
      end
      payload = JSON.parse(stdout)
      raise Pf::Error, "scanner returned no ports array" unless payload["ports"].is_a?(Array)
      payload
    rescue JSON::ParserError => e
      empty(e.message)
    rescue SystemCallError, Pf::Error => e
      empty(e.message)
    end

    def empty(error)
      { "scanned_at" => Time.now.utc.iso8601, "herdr_available" => false, "ports" => [], "warnings" => [], "error" => error }
    end

    def find_by_port(snapshot, port)
      snapshot.fetch("ports", []).select { |entry| entry["port"] == port }
    end

    def find_port_entry(snapshot, pid, port = nil)
      matches = snapshot.fetch("ports", []).select { |entry| entry["pid"] == pid }
      return nil if matches.empty?
      return matches.find { |entry| entry["port"] == port } || matches.first if port.is_a?(Integer)
      matches.first
    end

    def site_url(entry)
      host = entry["host"] || entry[:host]
      port = entry["port"] || entry[:port]
      host = "localhost" if host.nil? || LOCAL_HOSTS.include?(host)
      target = host.include?(":") && !host.start_with?("[") ? "[#{host}]" : host
      "http://#{target}:#{port}"
    end

    def rows(snapshot)
      snapshot.fetch("ports", []).map do |entry|
        herdr = entry["herdr"]
        ai = entry["ai"]
        {
          "port" => entry["port"] || "",
          "host" => entry["host"] || "",
          "process" => "#{entry["command"]} ##{entry["pid"]}",
          "uptime" => entry["elapsed"] || "",
          "cwd" => entry["cwd"] || "",
          "herdr" => herdr ? [herdr["workspace_label"] || herdr["workspace_id"] || "", herdr["pane_id"] || ""].join(" ").strip + (herdr["match"] == "cwd" ? " ~" : "") : "",
          "ai" => ai && ai["session"] ? "#{ai["kind"] || ""} #{ai["session"].to_s[0, 8]}".strip : (ai && ai["kind"] || "")
        }
      end
    end

    def kill_listener(pid, signal: "TERM", snapshot: nil, self_pid: Process.pid)
      return { "ok" => false, "status" => 422, "message" => "invalid pid" } unless pid.is_a?(Integer) && pid > 1
      return { "ok" => false, "status" => 403, "message" => "refusing to kill this process" } if pid == self_pid
      normalized_signal = signal.to_s.upcase == "KILL" ? "KILL" : "TERM"
      snap = snapshot || scan
      if snap["error"] && snap.fetch("ports", []).empty?
        return { "ok" => false, "status" => 502, "message" => "cannot verify listeners: #{snap["error"]}" }
      end
      return { "ok" => false, "status" => 404, "message" => "pid is not a current TCP listener" } unless find_port_entry(snap, pid)

      begin
        Process.kill(normalized_signal, pid)
      rescue Errno::ESRCH
        return { "ok" => false, "status" => 404, "message" => "no such process" }
      rescue Errno::EPERM
        return { "ok" => false, "status" => 403, "message" => "no permission to signal that process" }
      rescue SystemCallError => e
        return { "ok" => false, "status" => 500, "message" => "failed to signal process: #{e.message}" }
      end
      { "ok" => true, "status" => 200, "message" => "signalled", "pid" => pid, "signal" => "SIG#{normalized_signal}" }
    end
  end
end
