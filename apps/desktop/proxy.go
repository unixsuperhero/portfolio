package main

import (
	"log"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// apiProxy forwards /health and /api/* from the webview's own origin to the
// sidecar, so the page never makes a cross-origin request: no CORS, no App
// Transport Security, and cookies stay on one origin.
func apiProxy(target string) application.Middleware {
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
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			if r.URL.Path == "/health" || strings.HasPrefix(r.URL.Path, "/api/") {
				log.Printf("proxy %s %s", r.Method, r.URL.RequestURI())
				proxy.ServeHTTP(w, r)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}
