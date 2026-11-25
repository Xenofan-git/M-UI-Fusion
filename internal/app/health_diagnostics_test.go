package app

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestHealthDiagnosticRotation(t *testing.T) {
	path := filepath.Join(t.TempDir(), "health-diagnostics.jsonl")
	const limit int64 = 280
	for i := 0; i < 25; i++ {
		if err := appendDiagnostic(path, diagnosticRecord{time.Now(), "sample", map[string]int{"sequence": i}}, limit, 3); err != nil {
			t.Fatal(err)
		}
	}
	files, err := filepath.Glob(path + "*")
	if err != nil || len(files) != 4 {
		t.Fatalf("rotation files %v %v", files, err)
	}
	newest := -1
	for _, p := range files {
		info, e := os.Stat(p)
		if e != nil || info.Size() > limit {
			t.Fatalf("size %v %v", info, e)
		}
		if runtime.GOOS != "windows" && info.Mode().Perm() != 0600 {
			t.Fatal("file permission")
		}
		f, e := os.Open(p)
		if e != nil {
			t.Fatal(e)
		}
		scan := bufio.NewScanner(f)
		for scan.Scan() {
			var r struct {
				Kind string
				Data struct{ Sequence int }
			}
			if e = json.Unmarshal(scan.Bytes(), &r); e != nil || r.Kind != "sample" {
				t.Fatalf("invalid line %v", e)
			}
			if r.Data.Sequence > newest {
				newest = r.Data.Sequence
			}
		}
		e = scan.Err()
		f.Close()
		if e != nil {
			t.Fatal(e)
		}
	}
	if newest != 24 {
		t.Fatal("latest record lost")
	}
	// Reopening/appending must preserve the prior record.
	if err = appendDiagnostic(path, diagnosticRecord{time.Now(), "panel_start", map[string]int{"pid": 42}}, limit, 3); err != nil {
		t.Fatal(err)
	}
	b, err := os.ReadFile(path)
	if err != nil || !strings.Contains(string(b), "panel_start") {
		t.Fatal("restart record not retained")
	}
}
func TestHealthDiagnosticQueue(t *testing.T) {
	m := &CoreManager{}
	m.diagnosticLocked("ignored", nil)
	r := &diagnosticRecorder{queue: make(chan diagnosticRecord, 2)}
	m.diagnostic = r
	m.smartModeLocked("starting")
	m.smartModeLocked("starting")
	m.smartModeLocked("normal")
	m.diagnosticLocked("overflow", nil)
	if r.dropped != 1 || len(r.queue) != 2 {
		t.Fatal("queue overflow accounting")
	}
	a, b := <-r.queue, <-r.queue
	if a.Kind != "health_mode" || a.Data.(diagnosticHealth).Mode != "starting" || b.Data.(diagnosticHealth).Mode != "normal" {
		t.Fatal("transition capture")
	}
	m.diagnosticLocked("next", nil)
	dropped := <-r.queue
	if dropped.Kind != "dropped" || dropped.Data.(map[string]uint64)["count"] != 1 || (<-r.queue).Kind != "next" || r.dropped != 0 {
		t.Fatal("missing loss marker")
	}
}
func TestHealthDiagnosticProc(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux procfs")
	}
	p := readDiagnosticProc(os.Getpid())
	if p.RSSBytes == nil || *p.RSSBytes == 0 || p.CPUTicks == nil || p.StartTicks == 0 {
		t.Fatalf("invalid process sample %+v", p)
	}
	total, idle, ok := diagnosticCPUCounters()
	if !ok || total == 0 || idle > total {
		t.Fatal("invalid host CPU counters")
	}
}
func TestHealthDiagnosticRedaction(t *testing.T) {
	s := smartStatus{Mode: "normal", Healthy: 12, Groups: 2, Controls: []smartServiceResult{{ID: "do-not-record-service-id", OK: true}}}
	ms := int64(123)
	b, e := json.Marshal(diagnosticHealthFrom(s, &ms))
	if e != nil {
		t.Fatal(e)
	}
	if strings.Contains(string(b), "do-not-record-service-id") || !strings.Contains(string(b), "\"durationMs\":123") || !strings.Contains(string(b), "\"controlsOK\":1") {
		t.Fatal("diagnostic fields")
	}
}
