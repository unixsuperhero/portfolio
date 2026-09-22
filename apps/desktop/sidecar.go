package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
)

const sidecarPort = "4388"
const sidecarURL = "http://127.0.0.1:" + sidecarPort

// SidecarStatus reports the state of the @portfolio/api sidecar process.
type SidecarStatus struct {
	Url     string `json:"Url"`
	Running bool   `json:"Running"`
	Pid     int    `json:"Pid"`
	Error   string `json:"Error"`
}

// SidecarService starts and stops the @portfolio/api sidecar process.
type SidecarService struct {
	mu      sync.Mutex
	cmd     *exec.Cmd
	adopted bool
	lastErr string
}

func (s *SidecarService) ServiceName() string { return "SidecarService" }

// Status returns the current state of the sidecar.
func (s *SidecarService) Status() SidecarStatus {
	s.mu.Lock()
	defer s.mu.Unlock()

	status := SidecarStatus{Url: sidecarURL, Error: s.lastErr}
	if s.adopted {
		status.Running = healthy(500 * time.Millisecond)
		return status
	}
	if s.cmd != nil && s.cmd.Process != nil {
		status.Pid = s.cmd.Process.Pid
		status.Running = s.cmd.ProcessState == nil
	}
	return status
}

// ServiceStartup locates REPO, adopts an already-running API server if one
// answers /health, or spawns `bun run packages/api/src/server.ts` as a
// sidecar and waits for it to become healthy.
func (s *SidecarService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	if healthy(500 * time.Millisecond) {
		s.mu.Lock()
		s.adopted = true
		s.mu.Unlock()
		go s.watch(ctx)
		return nil
	}
	if err := s.spawn(); err != nil {
		return err
	}
	go s.watch(ctx)
	return nil
}

// spawn starts `bun run packages/api/src/server.ts` in REPO and waits for
// /health. It replaces any previous child.
func (s *SidecarService) spawn() error {
	repo, err := findRepo()
	if err != nil {
		s.setError(err.Error())
		return fmt.Errorf("sidecar: %w", err)
	}

	logDir := filepath.Join(repo, "logs")
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return fmt.Errorf("sidecar: creating log dir: %w", err)
	}
	logFile, err := os.OpenFile(filepath.Join(logDir, "desktop-api.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return fmt.Errorf("sidecar: opening log file: %w", err)
	}

	bunPath, err := findBun()
	if err != nil {
		logFile.Close()
		return fmt.Errorf("sidecar: %w", err)
	}

	cmd := exec.Command(bunPath, "run", "packages/api/src/server.ts")
	cmd.Dir = repo
	cmd.Env = append(os.Environ(), "PORTFOLIO_API_PORT="+sidecarPort)
	cmd.Stdout = logFile
	cmd.Stderr = logFile
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	if err := cmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("sidecar: starting bun: %w", err)
	}
	go func() { _ = cmd.Wait(); logFile.Close() }()

	s.mu.Lock()
	s.cmd = cmd
	s.adopted = false
	s.lastErr = ""
	s.mu.Unlock()

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if healthy(500 * time.Millisecond) {
			return nil
		}
		time.Sleep(200 * time.Millisecond)
	}

	s.setError("sidecar did not become healthy within 10s")
	return fmt.Errorf("sidecar: did not become healthy within 10s (see %s)", filepath.Join(logDir, "desktop-api.log"))
}

// watch re-spawns the API when it stops answering /health three checks in a
// row, whether it was adopted (and killed by whoever owned it) or our own
// child that crashed. It never touches the page: the frontend only sees the
// status dot change.
func (s *SidecarService) watch(ctx context.Context) {
	ticker := time.NewTicker(10 * time.Second)
	defer ticker.Stop()
	misses := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
		if healthy(2 * time.Second) {
			misses = 0
			continue
		}
		misses++
		if misses < 3 {
			continue
		}
		misses = 0
		log.Printf("sidecar: api unhealthy for 30s, respawning")
		s.stopChild()
		if err := s.spawn(); err != nil {
			log.Printf("sidecar: respawn failed: %v", err)
		}
	}
}

func (s *SidecarService) setError(message string) {
	s.mu.Lock()
	s.lastErr = message
	s.mu.Unlock()
}

// stopChild kills our own child process group, if any. Adopted servers are left alone.
func (s *SidecarService) stopChild() {
	s.mu.Lock()
	cmd := s.cmd
	adopted := s.adopted
	s.cmd = nil
	s.mu.Unlock()
	if adopted || cmd == nil || cmd.Process == nil || cmd.ProcessState != nil {
		return
	}
	pid := cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	time.Sleep(500 * time.Millisecond)
	if cmd.ProcessState == nil {
		_ = syscall.Kill(-pid, syscall.SIGKILL)
	}
}

// ServiceShutdown terminates the spawned sidecar process, if any.
func (s *SidecarService) ServiceShutdown() error {
	s.mu.Lock()
	cmd := s.cmd
	adopted := s.adopted
	s.mu.Unlock()

	if adopted || cmd == nil || cmd.Process == nil {
		return nil
	}

	pid := cmd.Process.Pid
	_ = syscall.Kill(-pid, syscall.SIGTERM)
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if cmd.ProcessState != nil {
			return nil
		}
		time.Sleep(50 * time.Millisecond)
	}
	_ = syscall.Kill(-pid, syscall.SIGKILL)
	return nil
}

func healthy(timeout time.Duration) bool {
	client := http.Client{Timeout: timeout}
	resp, err := client.Get(sidecarURL + "/health")
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	var body struct {
		Ok bool `json:"ok"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return false
	}
	return body.Ok
}

// findRepo locates the monorepo root: PORTFOLIO_HOME if set, else walk up
// from the executable's directory and from the current working directory
// until a package.json with "name": "portfolio" is found.
func findRepo() (string, error) {
	if home := os.Getenv("PORTFOLIO_HOME"); home != "" {
		return home, nil
	}

	if exe, err := os.Executable(); err == nil {
		if repo, ok := walkUpForRepo(filepath.Dir(exe)); ok {
			return repo, nil
		}
	}

	if cwd, err := os.Getwd(); err == nil {
		if repo, ok := walkUpForRepo(cwd); ok {
			return repo, nil
		}
	}

	return "", fmt.Errorf("could not locate the portfolio repo root (set PORTFOLIO_HOME)")
}

func walkUpForRepo(start string) (string, bool) {
	dir := start
	for {
		pkgPath := filepath.Join(dir, "package.json")
		if data, err := os.ReadFile(pkgPath); err == nil {
			var pkg struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(data, &pkg) == nil && pkg.Name == "portfolio" {
				return dir, true
			}
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", false
		}
		dir = parent
	}
}

// findBun locates the bun executable: on PATH, else the Homebrew default.
func findBun() (string, error) {
	if path, err := exec.LookPath("bun"); err == nil {
		return path, nil
	}
	const homebrewBun = "/opt/homebrew/bin/bun"
	if info, err := os.Stat(homebrewBun); err == nil && !info.IsDir() {
		return homebrewBun, nil
	}
	return "", fmt.Errorf("bun not found on PATH or at %s", homebrewBun)
}
