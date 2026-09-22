package main

import (
	"fmt"
	"net/url"
	"sync"
	"sync/atomic"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

var browserWindowCounter atomic.Int64

// BrowserWindow describes an open in-app browser window.
type BrowserWindow struct {
	Name  string
	Url   string
	Title string
}

// BrowserService opens URLs in dedicated, trackable webview windows so the
// frontend's "open in in-app browser" action has somewhere to go.
type BrowserService struct {
	mu      sync.Mutex
	windows map[string]*BrowserWindow
}

func (b *BrowserService) ServiceName() string { return "BrowserService" }

func (b *BrowserService) init() {
	if b.windows == nil {
		b.windows = make(map[string]*BrowserWindow)
	}
}

// Open creates a new in-app browser window loading url and returns the
// window's name.
func (b *BrowserService) Open(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", fmt.Errorf("browser: invalid url %q: %w", rawURL, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("browser: unsupported scheme %q (must be http or https)", parsed.Scheme)
	}

	title := parsed.Host
	if title == "" {
		title = rawURL
	}
	name := fmt.Sprintf("browser-%d", browserWindowCounter.Add(1))

	win := application.InvokeSyncWithResult(func() *application.WebviewWindow {
		return application.Get().Window.NewWithOptions(application.WebviewWindowOptions{
			Name:   name,
			Title:  title,
			URL:    rawURL,
			Width:  1280,
			Height: 900,
		})
	})

	entry := &BrowserWindow{Name: name, Url: rawURL, Title: title}

	b.mu.Lock()
	b.init()
	b.windows[name] = entry
	b.mu.Unlock()

	win.OnWindowEvent(events.Common.WindowClosing, func(_ *application.WindowEvent) {
		b.mu.Lock()
		delete(b.windows, name)
		b.mu.Unlock()
	})

	return name, nil
}

// List returns every currently tracked in-app browser window.
func (b *BrowserService) List() []BrowserWindow {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.init()

	windows := make([]BrowserWindow, 0, len(b.windows))
	for _, w := range b.windows {
		windows = append(windows, *w)
	}
	return windows
}

// Close closes the named in-app browser window.
func (b *BrowserService) Close(name string) error {
	b.mu.Lock()
	b.init()
	_, ok := b.windows[name]
	b.mu.Unlock()
	if !ok {
		return fmt.Errorf("browser: unknown window %q", name)
	}

	win, found := application.Get().Window.Get(name)
	if !found {
		return fmt.Errorf("browser: window %q not found", name)
	}
	application.InvokeSync(func() { win.Close() })

	b.mu.Lock()
	delete(b.windows, name)
	b.mu.Unlock()

	return nil
}
