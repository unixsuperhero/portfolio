package main

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// apiProxy forwards /health and /api/* from the webview's own origin to the
// sidecar, so the page never makes a cross-origin request: no CORS, no App
// Transport Security, and cookies stay on one origin.
func apiProxy(target string) application.Middleware {
	proxy := reverseProxy(target)
	// With `-tags mcp` and WAILS_MCP_PORT set, /__mcp/* reaches the Wails MCP
	// server the same way, because the page cannot make plain-http requests
	// itself (see frontend/src/lib/mcp-bridge.ts).
	var mcp http.Handler
	if port := os.Getenv("WAILS_MCP_PORT"); port != "" {
		mcp = http.StripPrefix("/__mcp", reverseProxy("http://127.0.0.1:"+port))
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			switch {
			case r.URL.Path == "/health" || strings.HasPrefix(r.URL.Path, "/api/"):
				bufferBody(r)
				proxy.ServeHTTP(w, r)
			case mcp != nil && strings.HasPrefix(r.URL.Path, "/__mcp/"):
				bufferBody(r)
				mcp.ServeHTTP(w, r)
			default:
				next.ServeHTTP(w, r)
			}
		})
	}
}

// bufferBody reads the webview's request body up front. Requests arriving
// through the asset server carry no Content-Length, and upstreams drop the
// chunked body the reverse proxy would otherwise send.
func bufferBody(r *http.Request) {
	if r.Body == nil {
		return
	}
	body, _ := io.ReadAll(r.Body)
	r.Body = io.NopCloser(bytes.NewReader(body))
	r.ContentLength = int64(len(body))
}

func reverseProxy(target string) *httputil.ReverseProxy {
	upstream, err := url.Parse(target)
	if err != nil {
		panic(err)
	}
	proxy := httputil.NewSingleHostReverseProxy(upstream)
	director := proxy.Director
	proxy.Director = func(r *http.Request) {
		director(r)
		r.Host = upstream.Host
	}
	return proxy
}
