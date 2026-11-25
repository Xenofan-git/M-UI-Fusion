package app

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Structured diagnostics contain only aggregate counters and known states,
// never proxy addresses, URLs, credentials, or request data.
const diagnosticMaxBytes int64 = 4 << 20
const diagnosticArchives = 3
const diagnosticInterval = 60 * time.Second

type diagnosticRecord struct {
	At   time.Time `json:"at"`
	Kind string    `json:"kind"`
	Data any       `json:"data"`
}
type diagnosticRecorder struct {
	queue   chan diagnosticRecord
	dropped uint64 // accessed only under CoreManager.mu
}
type diagnosticHealth struct {
	Mode            string    `json:"mode"`
	Healthy         int       `json:"healthy"`
	Groups          int       `json:"groups"`
	Running         bool      `json:"running"`
	Last            time.Time `json:"last"`
	Next            time.Time `json:"next"`
	ControlsChecked int       `json:"controlsChecked"`
	ControlsOK      int       `json:"controlsOK"`
	DurationMS      *int64    `json:"durationMs,omitempty"`
}

func diagnosticHealthFrom(s smartStatus, duration *int64) diagnosticHealth {
	d := diagnosticHealth{Mode: s.Mode, Healthy: s.Healthy, Groups: s.Groups, Running: s.Running, Last: s.Last, Next: s.Next, ControlsChecked: len(s.Controls), DurationMS: duration}
	for _, c := range s.Controls {
		if c.OK {
			d.ControlsOK++
		}
	}
	return d
}
func (m *CoreManager) diagnosticLocked(kind string, data any) {
	r := m.diagnostic
	if r == nil {
		return
	}
	if r.dropped > 0 {
		select {
		case r.queue <- diagnosticRecord{time.Now(), "dropped", map[string]uint64{"count": r.dropped}}:
			r.dropped = 0
		default:
		}
	}
	select {
	case r.queue <- diagnosticRecord{time.Now(), kind, data}:
	default:
		r.dropped++
	}
}
func appendDiagnostic(path string, record diagnosticRecord, maxBytes int64, archives int) error {
	b, err := json.Marshal(record)
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if int64(len(b)) > maxBytes {
		return fmt.Errorf("diagnostic record too large")
	}
	if st, e := os.Lstat(path); e == nil {
		if !st.Mode().IsRegular() {
			return fmt.Errorf("diagnostic file is not regular")
		}
		if st.Size()+int64(len(b)) > maxBytes {
			for i := archives; i >= 1; i-- {
				src := path
				if i > 1 {
					src = fmt.Sprintf("%s.%d", path, i-1)
				}
				dst := fmt.Sprintf("%s.%d", path, i)
				// Windows rename cannot overwrite existing destinations.
				if e = os.Remove(dst); e != nil && !os.IsNotExist(e) {
					return e
				}
				if e = os.Rename(src, dst); e != nil && !os.IsNotExist(e) {
					return e
				}
			}
		}
	} else if !os.IsNotExist(e) {
		return e
	}
	f, e := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if e != nil {
		return e
	}
	if e = f.Chmod(0600); e == nil {
		_, e = f.Write(b)
	}
	closeErr := f.Close()
	if e != nil {
		return e
	}
	return closeErr
}
func (m *CoreManager) startDiagnostic() {
	r := &diagnosticRecorder{queue: make(chan diagnosticRecord, 256)}
	m.mu.Lock()
	m.diagnostic = r
	m.diagnosticLocked("panel_start", map[string]any{"version": appVersion, "pid": os.Getpid(), "sampleSeconds": int(diagnosticInterval.Seconds())})
	m.mu.Unlock()
	path := filepath.Join(m.dataDir, "health-diagnostics.jsonl")
	go func() {
		var lastErr time.Time
		var failed uint64
		for record := range r.queue {
			if failed > 0 {
				if e := appendDiagnostic(path, diagnosticRecord{time.Now(), "write_failures", map[string]uint64{"count": failed}}, diagnosticMaxBytes, diagnosticArchives); e == nil {
					failed = 0
				}
			}
			if e := appendDiagnostic(path, record, diagnosticMaxBytes, diagnosticArchives); e != nil {
				failed++
				if time.Since(lastErr) > time.Minute {
					log.Printf("health diagnostics write failed: %v", e)
					lastErr = time.Now()
				}
			}
		}
	}()
	go m.monitorDiagnostic()
}

type diagnosticProc struct {
	PID        int     `json:"pid"`
	RSSBytes   *uint64 `json:"rssBytes,omitempty"`
	CPUTicks   *uint64 `json:"cpuTicks,omitempty"`
	StartTicks uint64  `json:"startTicks,omitempty"`
}

func readDiagnosticProc(pid int) diagnosticProc {
	p := diagnosticProc{PID: pid}
	if runtime.GOOS != "linux" || pid <= 0 {
		return p
	}
	b, e := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if e == nil {
		for _, line := range strings.Split(string(b), "\n") {
			if strings.HasPrefix(line, "VmRSS:") {
				f := strings.Fields(line)
				if len(f) >= 2 {
					if n, e := strconv.ParseUint(f[1], 10, 64); e == nil {
						n *= 1024
						p.RSSBytes = &n
					}
				}
			}
		}
	}
	b, e = os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if e == nil {
		s := string(b)
		if i := strings.LastIndex(s, ")"); i >= 0 {
			f := strings.Fields(s[i+1:])
			if len(f) > 19 {
				u, eu := strconv.ParseUint(f[11], 10, 64)
				v, ev := strconv.ParseUint(f[12], 10, 64)
				start, es := strconv.ParseUint(f[19], 10, 64)
				if eu == nil && ev == nil && es == nil {
					n := u + v
					p.CPUTicks = &n
					p.StartTicks = start
				}
			}
		}
	}
	return p
}
func diagnosticCPUCounters() (total, idle uint64, ok bool) {
	b, e := os.ReadFile("/proc/stat")
	if e != nil {
		return
	}
	line, _, _ := strings.Cut(string(b), "\n")
	f := strings.Fields(line)
	if len(f) < 5 || f[0] != "cpu" {
		return
	}
	// Linux guest time is already included in user/nice.
	for i := 1; i < len(f) && i <= 8; i++ {
		v, e := strconv.ParseUint(f[i], 10, 64)
		if e != nil {
			return 0, 0, false
		}
		total += v
		if i == 4 || i == 5 {
			idle += v
		}
	}
	return total, idle, total > 0
}
func (m *CoreManager) monitorDiagnostic() {
	ticker := time.NewTicker(diagnosticInterval)
	defer ticker.Stop()
	var oldTotal, oldIdle uint64
	var oldPanel, oldCore diagnosticProc
	for {
		m.mu.Lock()
		pid := 0
		if m.cmd != nil && m.cmd.Process != nil {
			pid = m.cmd.Process.Pid
		}
		health := diagnosticHealthFrom(m.smartStatusLocked(), nil)
		watchdog := m.watchdogStatusLocked(time.Now())
		m.mu.Unlock()
		total, idle, ok := diagnosticCPUCounters()
		panel, core := readDiagnosticProc(os.Getpid()), readDiagnosticProc(pid)
		data := map[string]any{"health": health, "watchdog": watchdog, "panel": panel, "core": core}
		if ok && oldTotal > 0 && total > oldTotal && idle >= oldIdle && idle-oldIdle <= total-oldTotal {
			delta := total - oldTotal
			data["hostCPUPercent"] = 100 * float64(delta-(idle-oldIdle)) / float64(delta)
			for _, p := range []struct {
				name              string
				current, previous diagnosticProc
			}{{"panelCPUHostPercent", panel, oldPanel}, {"coreCPUHostPercent", core, oldCore}} {
				a, b := p.current, p.previous
				if a.PID == b.PID && a.StartTicks == b.StartTicks && a.CPUTicks != nil && b.CPUTicks != nil && *a.CPUTicks >= *b.CPUTicks {
					data[p.name] = 100 * float64(*a.CPUTicks-*b.CPUTicks) / float64(delta)
				}
			}
		}
		oldTotal, oldIdle, oldPanel, oldCore = total, idle, panel, core
		if b, e := os.ReadFile("/proc/meminfo"); e == nil {
			mem := map[string]uint64{}
			for _, line := range strings.Split(string(b), "\n") {
				f := strings.Fields(line)
				if len(f) >= 2 && (f[0] == "MemTotal:" || f[0] == "MemAvailable:") {
					if n, e := strconv.ParseUint(f[1], 10, 64); e == nil {
						mem[strings.TrimSuffix(f[0], ":")] = n * 1024
					}
				}
			}
			if len(mem) == 2 && mem["MemTotal"] >= mem["MemAvailable"] {
				data["hostRAMTotalBytes"] = mem["MemTotal"]
				data["hostRAMUsedBytes"] = mem["MemTotal"] - mem["MemAvailable"]
			}
		}
		m.mu.Lock()
		m.diagnosticLocked("sample", data)
		m.mu.Unlock()
		<-ticker.C
	}
}
