package main

import (
	"encoding/base64"
	"strings"
	"sync"
	"testing"
	"time"
)

// TestPtyServiceCreateAndRead runs `echo hello` in a pty session and confirms
// the output comes back through the emitted "pty:data" events.
func TestPtyServiceCreateAndRead(t *testing.T) {
	var (
		mu  sync.Mutex
		out strings.Builder
	)

	svc := &PtyService{
		emit: func(name string, data any) {
			if name != "pty:data" {
				return
			}
			evt, ok := data.(PtyDataEvent)
			if !ok {
				return
			}
			decoded, err := base64.StdEncoding.DecodeString(evt.Data)
			if err != nil {
				t.Errorf("decoding pty:data payload: %v", err)
				return
			}
			mu.Lock()
			out.Write(decoded)
			mu.Unlock()
		},
	}

	id, err := svc.Create(PtyOptions{Command: "echo hello"})
	if err != nil {
		t.Fatalf("Create: %v", err)
	}
	defer svc.Close(id)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		mu.Lock()
		got := out.String()
		mu.Unlock()
		if strings.Contains(got, "hello") {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}

	mu.Lock()
	defer mu.Unlock()
	t.Fatalf("expected output to contain %q, got %q", "hello", out.String())
}
