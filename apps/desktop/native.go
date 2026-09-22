package main

import (
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// NativeService wraps macOS `open`/`osascript` integrations and clipboard access.
type NativeService struct{}

func (n *NativeService) ServiceName() string { return "NativeService" }

// Reveal shows path in Finder, highlighting it.
func (n *NativeService) Reveal(path string) error {
	return exec.Command("open", "-R", path).Run()
}

// OpenPath opens path with its default application.
func (n *NativeService) OpenPath(path string) error {
	return exec.Command("open", path).Run()
}

// OpenWith opens path with the named application.
func (n *NativeService) OpenWith(path, app string) error {
	return exec.Command("open", "-a", app, path).Run()
}

// OpenUrl opens url in the system default browser.
func (n *NativeService) OpenUrl(url string) error {
	return exec.Command("open", url).Run()
}

// CopyText copies text to the system clipboard, via the Wails clipboard API
// with a pbcopy fallback.
func (n *NativeService) CopyText(text string) error {
	if app := application.Get(); app != nil {
		if app.Clipboard.SetText(text) {
			return nil
		}
	}

	cmd := exec.Command("pbcopy")
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("native: pbcopy stdin: %w", err)
	}
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("native: starting pbcopy: %w", err)
	}
	if _, err := stdin.Write([]byte(text)); err != nil {
		return fmt.Errorf("native: writing to pbcopy: %w", err)
	}
	if err := stdin.Close(); err != nil {
		return fmt.Errorf("native: closing pbcopy stdin: %w", err)
	}
	return cmd.Wait()
}

// Notify shows a macOS notification via osascript.
func (n *NativeService) Notify(title, body string) error {
	script := fmt.Sprintf(
		"display notification %s with title %s",
		osascriptQuote(body),
		osascriptQuote(title),
	)
	return exec.Command("osascript", "-e", script).Run()
}

// Home returns $HOME.
func (n *NativeService) Home() string {
	return os.Getenv("HOME")
}

// PickDirectory shows a native directory picker. start "" defaults to
// $HOME; title "" defaults to "Choose a directory". Cancel returns "" and a
// nil error.
func (n *NativeService) PickDirectory(title string, start string) (string, error) {
	if title == "" {
		title = "Choose a directory"
	}
	if start == "" {
		start = os.Getenv("HOME")
	}

	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("native: application not initialized")
	}

	return app.Dialog.OpenFile().
		SetTitle(title).
		SetDirectory(start).
		CanChooseDirectories(true).
		CanChooseFiles(false).
		CanCreateDirectories(true).
		PromptForSingleSelection()
}

// PickFile shows a native file picker. start "" defaults to $HOME; title ""
// defaults to "Choose a file". Cancel returns "" and a nil error.
func (n *NativeService) PickFile(title string, start string) (string, error) {
	if title == "" {
		title = "Choose a file"
	}
	if start == "" {
		start = os.Getenv("HOME")
	}

	app := application.Get()
	if app == nil {
		return "", fmt.Errorf("native: application not initialized")
	}

	return app.Dialog.OpenFile().
		SetTitle(title).
		SetDirectory(start).
		CanChooseFiles(true).
		CanChooseDirectories(false).
		PromptForSingleSelection()
}

// osascriptQuote produces an AppleScript string literal for s, escaping
// backslashes and double quotes.
func osascriptQuote(s string) string {
	s = strings.ReplaceAll(s, `\`, `\\`)
	s = strings.ReplaceAll(s, `"`, `\"`)
	return `"` + s + `"`
}
