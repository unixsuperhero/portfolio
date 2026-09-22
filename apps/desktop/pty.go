package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"time"

	"github.com/creack/pty"
	"github.com/wailsapp/wails/v3/pkg/application"
)

func newSessionID() string {
	buf := make([]byte, 16)
	_, _ = rand.Read(buf)
	return hex.EncodeToString(buf)
}

// PtyOptions configures a new pty session.
type PtyOptions struct {
	Cwd     string
	Cols    int
	Rows    int
	Command string
}

// PtyInfo describes a live (or recently exited) pty session.
type PtyInfo struct {
	Id      string
	Cwd     string
	Command string
	Pid     int
	Running bool
}

// PtyDataEvent is emitted on "pty:data" as bytes are read from a session.
// Data is base64 of the raw bytes read from the pty (binary safe).
type PtyDataEvent struct {
	Id   string
	Data string
}

// PtyExitEvent is emitted on "pty:exit" once a session's process exits.
type PtyExitEvent struct {
	Id   string
	Code int
}

const ptyReadChunk = 32 * 1024

type ptySession struct {
	id      string
	cwd     string
	command string
	cmd     *exec.Cmd
	file    *os.File
	mu      sync.Mutex
	running bool
}

// PtyService manages pty-backed shell sessions for the in-app terminal.
type PtyService struct {
	mu       sync.Mutex
	sessions map[string]*ptySession

	// emit sends a named event with its payload. It defaults to the running
	// Wails app's event bus, but can be overridden (e.g. in tests) to
	// observe emitted events without a live application.
	emit func(name string, data any)
}

func (p *PtyService) ServiceName() string { return "PtyService" }

func (p *PtyService) init() {
	if p.sessions == nil {
		p.sessions = make(map[string]*ptySession)
	}
	if p.emit == nil {
		p.emit = func(name string, data any) {
			if app := application.Get(); app != nil {
				app.Event.Emit(name, data)
			}
		}
	}
}

// Create starts a new pty session and returns its id. Command "" starts a
// login shell ($SHELL -l); otherwise the command runs via $SHELL -l -c.
func (p *PtyService) Create(opts PtyOptions) (string, error) {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	var cmd *exec.Cmd
	if opts.Command == "" {
		cmd = exec.Command(shell, "-l")
	} else {
		cmd = exec.Command(shell, "-l", "-c", opts.Command)
	}

	cwd := opts.Cwd
	if cwd == "" {
		cwd = os.Getenv("HOME")
	}
	cmd.Dir = cwd

	env := os.Environ()
	env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
	if os.Getenv("LANG") == "" {
		env = append(env, "LANG=en_US.UTF-8")
	}
	cmd.Env = env
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}

	cols, rows := opts.Cols, opts.Rows
	if cols <= 0 {
		cols = 80
	}
	if rows <= 0 {
		rows = 24
	}

	f, err := pty.StartWithSize(cmd, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
	if err != nil {
		return "", fmt.Errorf("pty: starting session: %w", err)
	}

	id := newSessionID()
	sess := &ptySession{
		id:      id,
		cwd:     cwd,
		command: opts.Command,
		cmd:     cmd,
		file:    f,
		running: true,
	}

	p.mu.Lock()
	p.init()
	p.sessions[id] = sess
	p.mu.Unlock()

	go p.readLoop(sess)
	go p.waitLoop(sess)

	return id, nil
}

func (p *PtyService) readLoop(sess *ptySession) {
	buf := make([]byte, ptyReadChunk)
	for {
		n, err := sess.file.Read(buf)
		if n > 0 {
			data := base64.StdEncoding.EncodeToString(buf[:n])
			p.emit("pty:data", PtyDataEvent{Id: sess.id, Data: data})
		}
		if err != nil {
			return
		}
	}
}

func (p *PtyService) waitLoop(sess *ptySession) {
	err := sess.cmd.Wait()

	sess.mu.Lock()
	sess.running = false
	sess.mu.Unlock()

	code := 0
	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			code = exitErr.ExitCode()
		} else {
			code = -1
		}
	}

	p.emit("pty:exit", PtyExitEvent{Id: sess.id, Code: code})
}

// Write sends raw text typed by the user to the session's pty.
func (p *PtyService) Write(id string, data string) error {
	sess, err := p.get(id)
	if err != nil {
		return err
	}
	_, err = sess.file.Write([]byte(data))
	return err
}

// Resize changes the pty's terminal size.
func (p *PtyService) Resize(id string, cols, rows int) error {
	sess, err := p.get(id)
	if err != nil {
		return err
	}
	return pty.Setsize(sess.file, &pty.Winsize{Cols: uint16(cols), Rows: uint16(rows)})
}

// Close kills the session's process group and releases its pty.
func (p *PtyService) Close(id string) error {
	sess, err := p.get(id)
	if err != nil {
		return err
	}

	if sess.cmd.Process != nil {
		_ = syscall.Kill(-sess.cmd.Process.Pid, syscall.SIGTERM)
		go func() {
			time.Sleep(2 * time.Second)
			sess.mu.Lock()
			running := sess.running
			sess.mu.Unlock()
			if running && sess.cmd.Process != nil {
				_ = syscall.Kill(-sess.cmd.Process.Pid, syscall.SIGKILL)
			}
		}()
	}
	_ = sess.file.Close()

	p.mu.Lock()
	delete(p.sessions, id)
	p.mu.Unlock()

	return nil
}

// List returns info for every known session.
func (p *PtyService) List() []PtyInfo {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.init()

	infos := make([]PtyInfo, 0, len(p.sessions))
	for _, sess := range p.sessions {
		sess.mu.Lock()
		running := sess.running
		sess.mu.Unlock()
		pid := 0
		if sess.cmd.Process != nil {
			pid = sess.cmd.Process.Pid
		}
		infos = append(infos, PtyInfo{
			Id:      sess.id,
			Cwd:     sess.cwd,
			Command: sess.command,
			Pid:     pid,
			Running: running,
		})
	}
	return infos
}

func (p *PtyService) get(id string) (*ptySession, error) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.init()
	sess, ok := p.sessions[id]
	if !ok {
		return nil, fmt.Errorf("pty: unknown session %q", id)
	}
	return sess, nil
}
