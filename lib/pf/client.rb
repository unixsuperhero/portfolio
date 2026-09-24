require 'net/http'

module Pf
  class Client
    def initialize(base = Pf.server_url)
      @base = base.end_with?('/') ? base[0...-1] : base
    end

    def absolute(path)
      uri = URI(path.to_s)
      return uri.to_s if uri.absolute?
      "#{@base}#{path.to_s.start_with?('/') ? path : "/#{path}"}"
    end

    def get(path, query: {}) = request(:get, path, query: query)
    def post(path, body = {}) = request(:post, path, body: body)
    def patch(path, body = {}) = request(:patch, path, body: body)
    def delete(path, query: {}) = request(:delete, path, query: query)

    private

    def request(method, path, body: nil, query: {})
      uri = URI(absolute(path))
      unless query.empty?
        params = URI.decode_www_form(uri.query.to_s) + query.reject { |_, v| v.nil? }.map { |k, v| [k.to_s, v.to_s] }
        uri.query = URI.encode_www_form(params)
      end
      klass = { get: Net::HTTP::Get, post: Net::HTTP::Post, patch: Net::HTTP::Patch, delete: Net::HTTP::Delete }.fetch(method)
      req = klass.new(uri)
      req['Content-Type'] = 'application/json'
      req.body = JSON.generate(body) if body
      res = Net::HTTP.start(uri.hostname, uri.port, use_ssl: uri.scheme == 'https', open_timeout: 5, read_timeout: 30) { |http| http.request(req) }
      data = res.body.to_s.empty? ? nil : JSON.parse(res.body)
      return data if res.code.to_i.between?(200, 299)
      message = data.is_a?(Hash) ? (data['error'] || data['message']) : res.body
      raise Pf::Error, "HTTP #{res.code}: #{message || res.message}"
    rescue JSON::ParserError
      raise Pf::Error, "invalid JSON response from #{uri}"
    rescue Errno::ECONNREFUSED, SocketError, Timeout::Error, Net::OpenTimeout, Net::ReadTimeout => e
      raise Pf::Error, "#{uri}: #{e.message}"
    end
  end
end
