//go:build linux

package app

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/binary"
	"encoding/pem"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync/atomic"
	"syscall"
	"testing"
	"time"
)

// This address exists only on lo in a disconnected test namespace. No
// outside hosts or production state are ever used. The normal endpoint
// validation remains enabled in the test binary.
const extendedLabIP = "11.0.0.1"

func extendedLab(t *testing.T) string {
	t.Helper()
	core := os.Getenv("MUI_LAB_CORE")
	if core == "" {
		t.Skip("explicit isolated lab required")
	}
	ifs, e := net.Interfaces()
	if e != nil || len(ifs) != 1 || ifs[0].Name != "lo" {
		t.Fatal("not isolated")
	}
	addrs, e := ifs[0].Addrs()
	if e != nil {
		t.Fatal(e)
	}
	for _, a := range addrs {
		if a.String() == extendedLabIP+"/32" {
			return core
		}
	}
	t.Fatal("missing isolated lab IP")
	return ""
}
func extendedAnswer(q []byte, truncated bool) []byte {
	if len(q) < 12 {
		return nil
	}
	a := append([]byte(nil), q...)
	binary.BigEndian.PutUint16(a[2:4], 0x8180)
	if truncated {
		binary.BigEndian.PutUint16(a[2:4], 0x8380)
		return a
	}
	binary.BigEndian.PutUint16(a[6:8], 1)
	return append(a, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 192, 0, 2, 1)
}
func extendedStream(c net.Conn, allow *atomic.Bool, hits *atomic.Int64) {
	defer c.Close()
	_ = c.SetDeadline(time.Now().Add(3 * time.Second))
	var size [2]byte
	if _, e := io.ReadFull(c, size[:]); e != nil {
		return
	}
	b := make([]byte, int(binary.BigEndian.Uint16(size[:])))
	if _, e := io.ReadFull(c, b); e != nil {
		return
	}
	hits.Add(1)
	if !allow.Load() {
		return
	}
	a := extendedAnswer(b, false)
	if a == nil {
		return
	}
	_, _ = c.Write(append(binary.BigEndian.AppendUint16(nil, uint16(len(a))), a...))
}
func extendedDNS(t *testing.T, allow *atomic.Bool, truncate *atomic.Bool, uh, th *atomic.Int64) {
	t.Helper()
	udp, e := net.ListenPacket("udp4", extendedLabIP+":53")
	if e != nil {
		t.Fatal(e)
	}
	tcp, e := net.Listen("tcp4", extendedLabIP+":53")
	if e != nil {
		udp.Close()
		t.Fatal(e)
	}
	t.Cleanup(func() { udp.Close(); tcp.Close() })
	go func() {
		b := make([]byte, 65535)
		for {
			n, addr, e := udp.ReadFrom(b)
			if e != nil {
				return
			}
			uh.Add(1)
			if allow.Load() {
				_, _ = udp.WriteTo(extendedAnswer(b[:n], truncate.Load()), addr)
			}
		}
	}()
	go func() {
		for {
			c, e := tcp.Accept()
			if e != nil {
				return
			}
			go extendedStream(c, allow, th)
		}
	}()
}
func TestExtendedLabControlProtocols(t *testing.T) {
	extendedLab(t)
	var allow, trunc, bad atomic.Bool
	var uh, th, dh atomic.Int64
	allow.Store(true)
	extendedDNS(t, &allow, &trunc, &uh, &th)
	key, e := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if e != nil {
		t.Fatal(e)
	}
	ca := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "isolated lab root"}, NotBefore: time.Now().Add(-time.Hour), NotAfter: time.Now().Add(time.Hour), IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign}
	caDER, e := x509.CreateCertificate(rand.Reader, ca, ca, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	leaf := &x509.Certificate{SerialNumber: big.NewInt(2), DNSNames: []string{"control.lab.example.org"}, NotBefore: ca.NotBefore, NotAfter: ca.NotAfter, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}, KeyUsage: x509.KeyUsageDigitalSignature}
	certDER, e := x509.CreateCertificate(rand.Reader, leaf, ca, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	root := filepath.Join(t.TempDir(), "ca.pem")
	if e = os.WriteFile(root, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}), 0600); e != nil {
		t.Fatal(e)
	}
	t.Setenv("SSL_CERT_FILE", root)
	cfg := &tls.Config{Certificates: []tls.Certificate{{Certificate: [][]byte{certDER, caDER}, PrivateKey: key}}, MinVersion: tls.VersionTLS12}
	l, e := tls.Listen("tcp4", extendedLabIP+":443", cfg)
	if e != nil {
		t.Fatal(e)
	}
	server := &http.Server{Handler: http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allow.Load() {
			http.Error(w, "down", 503)
			return
		}
		if r.Method == "HEAD" && r.URL.Path == "/" {
			w.WriteHeader(204)
			return
		}
		if r.Method == "POST" && r.URL.Path == "/dns-query" {
			b, _ := io.ReadAll(io.LimitReader(r.Body, 65536))
			w.Header().Set("Content-Type", "application/dns-message")
			a := extendedAnswer(b, false)
			if bad.Load() && len(a) > 0 {
				a[0] ^= 1
			}
			w.Write(a)
			return
		}
		http.Error(w, "unexpected", 400)
	})}
	go server.Serve(l)
	t.Cleanup(func() { server.Close() })
	dot, e := tls.Listen("tcp4", extendedLabIP+":853", cfg)
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { dot.Close() })
	go func() {
		for {
			c, e := dot.Accept()
			if e != nil {
				return
			}
			go extendedStream(c, &allow, &dh)
		}
	}()
	services := []smartService{{"https", "HTTPS", "HTTPS", extendedLabIP, "control.lab.example.org"}, {"doh", "DoH", "DoH", extendedLabIP, "control.lab.example.org"}, {"dot", "DoT", "DoT", extendedLabIP, "control.lab.example.org"}, {"dns", "Do53", "Do53", extendedLabIP, ""}}
	probe := func(s smartService, want bool) {
		t.Helper()
		ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
		defer cancel()
		start := time.Now()
		got := smartProbeControl(ctx, s)
		if got != want {
			t.Fatalf("%s got %v want %v", s.Protocol, got, want)
		}
		t.Logf("%s %v (%s)", s.Protocol, got, time.Since(start).Round(time.Millisecond))
	}
	for _, s := range services {
		probe(s, true)
	}
	if uh.Load() == 0 || th.Load() != 0 || dh.Load() == 0 {
		t.Fatal("wrong DNS transport")
	}
	trunc.Store(true)
	probe(services[3], true)
	if th.Load() == 0 {
		t.Fatal("missing TCP fallback")
	}
	bad.Store(true)
	probe(services[1], false)
	bad.Store(false)
	for _, s := range services[:3] {
		s.TLSName = "wrong.lab.example.org"
		probe(s, false)
	}
	allow.Store(false)
	for _, s := range services {
		probe(s, false)
	}
	allow.Store(true)
	trunc.Store(false)
	for _, s := range services {
		probe(s, true)
	}
	t.Log("real HTTPS/DoH/DoT/Do53 success, failure and recovery; TLS hostname rejection; DoH malformed DNS rejected; Do53 UDP/TCP fallback")
}

func TestExtendedLabSubscriptionInterrupted(t *testing.T) {
	extendedLab(t)
	var mode atomic.Int32
	listener, e := net.Listen("tcp4", extendedLabIP+":0")
	if e != nil {
		t.Fatal(e)
	}
	srv := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch mode.Load() {
		case 1:
			c, rw, e := w.(http.Hijacker).Hijack()
			if e == nil {
				_, _ = rw.WriteString("HTTP/1.1 200 OK\r\nContent-Length: 4096\r\nConnection: close\r\n\r\nproxies:\n")
				_ = rw.Flush()
				c.Close()
			}
			return
		case 2:
			http.Error(w, "offline", 503)
			return
		case 3:
			fmt.Fprint(w, "proxies: []")
			return
		default:
			fmt.Fprint(w, "proxies:\n  - {name: A, type: ss, server: a.example, port: 443, cipher: aes-256-gcm, password: fixture}\n  - {name: B, type: ss, server: b.example, port: 443, cipher: aes-256-gcm, password: fixture}\n")
		}
	}))
	srv.Listener.Close()
	srv.Listener = listener
	srv.Start()
	defer srv.Close()
	state := defaultState()
	state.Settings.CorePath = "" // no external subprocess for this persistence test.
	m := &CoreManager{state: state, dataDir: t.TempDir()}
	sub := OutboundSubscription{ID: "sub-lab", Name: "Lab", URL: srv.URL, Enabled: true, IntervalMinutes: 1440}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	b, e := downloadOutboundSubscription(ctx, sub.URL)
	if e != nil {
		t.Fatal(e)
	}
	nodes, e := parseOutboundSubscription(b)
	if e != nil {
		t.Fatal(e)
	}
	if e = m.commitOutboundSubscription(sub, nodes, true); e != nil {
		t.Fatal(e)
	}
	original := append([]MihomoOutbound(nil), m.state.Outbounds...)
	origYAML, e := os.ReadFile(filepath.Join(m.dataDir, "config.yaml"))
	if e != nil {
		t.Fatal(e)
	}
	updated := m.state.OutboundSubscriptions[0].LastUpdated
	for i, kind := range []int32{1, 2, 3, 1, 2} {
		mode.Store(kind)
		if e = m.refreshOutboundSubscription(ctx, m.state.OutboundSubscriptions[0]); e == nil {
			t.Fatal("broken subscription accepted")
		}
		s := m.state.OutboundSubscriptions[0]
		want := i + 1
		if want > 4 {
			want = 4
		}
		if !reflect.DeepEqual(original, m.state.Outbounds) || s.LastUpdated != updated || s.NodeCount != 2 || s.RetryFailures != want || s.LastError == "" {
			t.Fatalf("lost previous state after fault %d", i)
		}
		conf, _ := os.ReadFile(filepath.Join(m.dataDir, "config.yaml"))
		if string(conf) != string(origYAML) {
			t.Fatal("failed refresh altered config")
		}
		dur := []time.Duration{time.Minute, 2 * time.Minute, 4 * time.Minute, 5 * time.Minute, 5 * time.Minute}[i]
		last, _ := time.Parse(time.RFC3339, s.LastAttempt)
		if subscriptionRefreshDue(s, last.Add(dur-time.Second)) || !subscriptionRefreshDue(s, last.Add(dur)) {
			t.Fatal("wrong backoff")
		}
		t.Logf("failed refresh %d, nodes retained=2, retry=%s (clock boundary assertion)", i+1, dur)
	}
	reload := &CoreManager{dataDir: m.dataDir}
	if e = reload.load(); e != nil {
		t.Fatal(e)
	}
	if reload.state.OutboundSubscriptions[0].RetryFailures != 4 || len(reload.state.Outbounds) != len(original) {
		t.Fatal("retry state lost after reload")
	}
	mode.Store(0)
	if e = reload.refreshOutboundSubscription(ctx, reload.state.OutboundSubscriptions[0]); e != nil {
		t.Fatal(e)
	}
	final := reload.state.OutboundSubscriptions[0]
	if final.RetryFailures != 0 || final.LastError != "" || final.NodeCount != 2 {
		t.Fatal("successful recovery failed to reset retry")
	}
	last, _ := time.Parse(time.RFC3339, final.LastAttempt)
	if subscriptionRefreshDue(final, last.Add(5*time.Minute)) || !subscriptionRefreshDue(final, last.Add(24*time.Hour)) {
		t.Fatal("normal cadence")
	}
	t.Log("subscription real truncated body, HTTP503, empty payload; preserved config; persisted retry after reload; successful refresh resets 24h schedule")
}

func extendedProc(pid int) (rss int64, ticks int64) {
	b, _ := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			f := strings.Fields(line)
			if len(f) > 1 {
				rss, _ = strconv.ParseInt(f[1], 10, 64)
			}
		}
	}
	b, _ = os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	s := string(b)
	i := strings.LastIndex(s, ")")
	if i < 0 {
		return
	}
	f := strings.Fields(s[i+1:])
	if len(f) > 12 {
		u, _ := strconv.ParseInt(f[11], 10, 64)
		v, _ := strconv.ParseInt(f[12], 10, 64)
		ticks = u + v
	}
	return
}

func TestExtendedLabStress160AndHang(t *testing.T) {
	core := extendedLab(t)
	var up, controlUp, trunc, slow atomic.Bool
	var hits, uh, th atomic.Int64
	up.Store(true)
	controlUp.Store(true)
	extendedDNS(t, &controlUp, &trunc, &uh, &th)
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Method != "CONNECT" || r.Host != "192.0.2.1:80" {
			http.Error(w, "unexpected", 400)
			return
		}
		c, rw, e := w.(http.Hijacker).Hijack()
		if e != nil {
			return
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(3 * time.Second))
		if slow.Load() {
			time.Sleep(150 * time.Millisecond)
		}
		if !up.Load() {
			return
		}
		_, _ = rw.WriteString("HTTP/1.1 200 Connection established\r\n\r\n")
		if rw.Flush() != nil {
			return
		}
		req, e := http.ReadRequest(rw.Reader)
		if e != nil {
			return
		}
		req.Body.Close()
		_, _ = rw.WriteString("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
		_ = rw.Flush()
	}))
	defer proxy.Close()
	_, port, _ := net.SplitHostPort(proxy.Listener.Addr().String())
	free := func() string {
		l, e := net.Listen("tcp4", "127.0.0.1:0")
		if e != nil {
			t.Fatal(e)
		}
		s := l.Addr().String()
		l.Close()
		return s
	}
	addr := free()
	_, mixed, _ := net.SplitHostPort(free())
	var y strings.Builder
	fmt.Fprintf(&y, "mixed-port: %s\nallow-lan: false\nbind-address: 127.0.0.1\nmode: rule\nlog-level: warning\nexternal-controller: %s\nsecret: lab-only\nipv6: false\ndns:\n  enable: false\nproxies:\n", mixed, addr)
	names := make([]string, 160)
	for i := range names {
		names[i] = fmt.Sprintf("node-%03d", i)
		fmt.Fprintf(&y, "  - {name: %s, type: http, server: 127.0.0.1, port: %s}\n", names[i], port)
	}
	fmt.Fprintf(&y, "proxy-groups:\n  - {name: FOREIGN, type: url-test, proxies: [%s], url: 'http://192.0.2.1/health', interval: 0, lazy: false, timeout: 2000}\n  - {name: RUSSIA, type: url-test, proxies: [%s], url: 'http://192.0.2.1/health', interval: 0, lazy: false, timeout: 2000}\nrules:\n  - MATCH,FOREIGN\n%s\n", strings.Join(names[:145], ", "), strings.Join(names[145:159], ", "), smartHealthMarker)
	conf := []byte(y.String())
	cfg := defaultSmartHealth()
	cfg.Enabled = true
	cfg.Services = []string{"labdns"}
	cfg.Catalog = []smartService{{"labdns", "Lab DNS", "Do53", extendedLabIP, ""}}
	state := defaultState()
	state.SmartHealth = &cfg
	basics := effectiveMihomoBasics(state)
	basics.WatchdogEnabled = true
	state.MihomoBasics = &basics
	state.Settings.APIAddress = addr
	state.Settings.APISecret = "lab-only"
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if e := os.WriteFile(path, conf, 0600); e != nil {
		t.Fatal(e)
	}
	m := &CoreManager{state: state, dataDir: dir}
	m.setCoreWanted(true)
	if e := m.testCoreConfig(core, path); e != nil {
		t.Fatal(e)
	}
	m.mu.Lock()
	e := m.launchCoreLocked(core, path, conf, addr, "lab-only")
	m.mu.Unlock()
	if e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = m.stopCore() })
	ready := func() {
		t.Helper()
		deadline := time.Now().Add(10 * time.Second)
		for time.Now().Before(deadline) {
			if watchdogProbe(context.Background(), addr, "lab-only") == "healthy" {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		t.Fatal("core not ready")
	}
	ready()
	time.Sleep(1600 * time.Millisecond)
	m.mu.Lock()
	cmd := m.cmd
	plan := m.smartHealth.applied
	m.mu.Unlock()
	if plan == nil || len(plan.Groups) != 2 || len(plan.Groups[0].Members) != 145 || len(plan.Groups[1].Members) != 14 {
		t.Fatal("lab groups wrong")
	}
	pid := cmd.Process.Pid
	scan := func(want string, count int, label string) {
		t.Helper()
		m.mu.Lock()
		m.smartHealth.status.Next = time.Now()
		m.mu.Unlock()
		rss0, cpu0 := extendedProc(pid)
		r0, p0 := extendedProc(os.Getpid())
		n0 := hits.Load()
		start := time.Now()
		m.smartHealthTick()
		elapsed := time.Since(start)
		rss1, cpu1 := extendedProc(pid)
		r1, p1 := extendedProc(os.Getpid())
		m.mu.Lock()
		s := m.smartHealth.status
		m.mu.Unlock()
		if s.Mode != want || s.Healthy != count {
			t.Fatalf("%s got mode %s healthy %d", label, s.Mode, s.Healthy)
		}
		t.Logf("%s: %s nodes=%d duration=%s proxy_connections=%d core_RSS=%d->%dKiB core_CPU_ticks=%d panel_RSS=%d->%dKiB panel_CPU_ticks=%d", label, want, count, elapsed.Round(time.Millisecond), hits.Load()-n0, rss0, rss1, cpu1-cpu0, r0, r1, p1-p0)
	}
	scan("normal", 159, "160 configured, 159 group members")
	up.Store(false)
	scan("degraded", 0, "all proxies fail, DNS works")
	controlUp.Store(false)
	scan("offline", 0, "full loss")
	before := hits.Load()
	for i := 0; i < 12; i++ {
		m.mu.Lock()
		m.smartHealth.status.Next = time.Now()
		m.mu.Unlock()
		m.smartHealthTick()
		m.mu.Lock()
		s := m.smartHealth.status
		m.mu.Unlock()
		if s.Mode != "offline" || hits.Load() != before {
			t.Fatal("offline proxy probes")
		}
	}
	t.Log("12 accelerated offline cycles, no proxy connections (not a real 2min wait)")
	controlUp.Store(true)
	up.Store(true)
	scan("normal", 159, "recovery after DNS answer")
	for i := 0; i < 8; i++ {
		up.Store(false)
		scan("degraded", 0, fmt.Sprintf("flap %d down", i+1))
		up.Store(true)
		scan("normal", 159, fmt.Sprintf("flap %d up", i+1))
	}
	m.coreWatchdogTick(time.Now().Add(20 * time.Second))
	m.mu.Lock()
	same := m.cmd == cmd && len(m.watchdog.attempts) == 0
	m.mu.Unlock()
	if !same {
		t.Fatal("network failure restarted core")
	}
	// Break connectivity while a genuine 159-member cycle is in progress.
	slow.Store(true)
	up.Store(true)
	n := hits.Load()
	m.mu.Lock()
	m.smartHealth.status.Next = time.Now()
	m.mu.Unlock()
	done := make(chan struct{})
	go func() { m.smartHealthTick(); close(done) }()
	deadline := time.Now().Add(2 * time.Second)
	for hits.Load() == n && time.Now().Before(deadline) {
		time.Sleep(time.Millisecond)
	}
	if hits.Load() == n {
		t.Fatal("no in-flight check")
	}
	up.Store(false)
	select {
	case <-done:
	case <-time.After(12 * time.Second):
		t.Fatal("scan stuck on mid-cycle failure")
	}
	m.mu.Lock()
	s := m.smartHealth.status
	m.mu.Unlock()
	if s.Mode != "degraded" || s.Healthy != 0 || s.Running {
		t.Fatalf("midcycle wrong mode=%s healthy=%d running=%v", s.Mode, s.Healthy, s.Running)
	}
	slow.Store(false)
	up.Store(true)
	scan("normal", 159, "midcycle fault recovered")
	// Freeze only the lab child. Three actual timeout requests; ticks advanced
	// to avoid waiting the two full watchdog intervals.
	if e := cmd.Process.Signal(syscall.SIGSTOP); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = cmd.Process.Signal(syscall.SIGCONT) })
	now := time.Now().Add(20 * time.Second)
	for i := 0; i < 3; i++ {
		m.coreWatchdogTick(now.Add(time.Duration(i) * watchdogInterval))
		m.mu.Lock()
		same := m.cmd == cmd
		attempts := len(m.watchdog.attempts)
		m.mu.Unlock()
		if i < 2 && (!same || attempts != 0) {
			t.Fatal("premature restart")
		}
		if i == 2 && (same || attempts != 1) {
			t.Fatal("hang not recovered")
		}
	}
	ready()
	m.mu.Lock()
	newCmd := m.cmd
	m.mu.Unlock()
	pid = newCmd.Process.Pid
	time.Sleep(1500 * time.Millisecond)
	scan("normal", 159, "real frozen child recovered")
	t.Log("real SIGSTOP: two failures no restart, third failure one recovery (accelerated watchdog ticks); production untouched")
}

func TestExtendedLabReloadAndLongOffline(t *testing.T) {
	core := extendedLab(t)
	var up atomic.Bool
	up.Store(true)
	var hits atomic.Int64
	proxy := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Method != "CONNECT" || r.Host != "192.0.2.1:80" {
			http.Error(w, "unexpected", 400)
			return
		}
		c, rw, e := w.(http.Hijacker).Hijack()
		if e != nil {
			return
		}
		defer c.Close()
		_ = c.SetDeadline(time.Now().Add(2 * time.Second))
		if !up.Load() {
			return
		}
		_, _ = rw.WriteString("HTTP/1.1 200 Connection established\r\n\r\n")
		if rw.Flush() != nil {
			return
		}
		req, e := http.ReadRequest(rw.Reader)
		if e != nil {
			return
		}
		req.Body.Close()
		_, _ = rw.WriteString("HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n")
		_ = rw.Flush()
	}))
	defer proxy.Close()
	_, portText, _ := net.SplitHostPort(proxy.Listener.Addr().String())
	port, _ := strconv.Atoi(portText)
	newNode := func(name string) MihomoOutbound {
		return MihomoOutbound{Kind: "proxy", Type: "http", Name: name, Server: "127.0.0.1", Port: port}
	}
	free, e := net.Listen("tcp4", "127.0.0.1:0")
	if e != nil {
		t.Fatal(e)
	}
	addr := free.Addr().String()
	free.Close()
	state := defaultState()
	state.Settings.CorePath = core
	state.Settings.APIAddress = addr
	state.Settings.APISecret = "lab-only"
	state.Settings.AllowLAN = false
	state.Outbounds = []MihomoOutbound{newNode("Manual"), {Kind: "group", Name: "lab", Type: "url-test", Proxies: []string{"Manual"}, Interval: 60, Timeout: 1000, TestURL: "http://192.0.2.1/health"}}
	state.RoutingRules = []MihomoRoutingRule{{ID: "match", Type: "MATCH", Target: "lab"}}
	cfg := defaultSmartHealth()
	cfg.Enabled = true
	cfg.Services = []string{"labdns"}
	cfg.Catalog = []smartService{{"labdns", "Lab DNS", "Do53", "11.0.0.2", ""}}
	state.SmartHealth = &cfg
	basics := effectiveMihomoBasics(state)
	basics.WatchdogEnabled = true
	state.MihomoBasics = &basics
	dir := t.TempDir()
	m := &CoreManager{state: state, dataDir: dir}
	sub := OutboundSubscription{ID: "sub-lab", Name: "Lab", URL: "https://provider.example.org/sub", Group: "lab", Enabled: true, IntervalMinutes: 1440}
	if e = m.commitOutboundSubscription(sub, []MihomoOutbound{newNode("A"), newNode("B")}, true); e != nil {
		t.Fatal(e)
	}
	if e = m.startCore(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = m.stopCore() })
	ready := func(m *CoreManager, want int) {
		t.Helper()
		deadline := time.Now().Add(15 * time.Second)
		for time.Now().Before(deadline) {
			if watchdogProbe(context.Background(), addr, "lab-only") == "healthy" {
				m.mu.Lock()
				m.smartHealth.status.Next = time.Now()
				m.mu.Unlock()
				m.smartHealthTick()
				m.mu.Lock()
				s := m.smartHealth.status
				m.mu.Unlock()
				if s.Mode == "normal" && s.Healthy == want {
					return
				}
			}
			time.Sleep(300 * time.Millisecond)
		}
		t.Fatal("core/groups not ready")
	}
	ready(m, 3)
	m.mu.Lock()
	first := m.cmd
	m.mu.Unlock()
	if e = m.commitOutboundSubscription(sub, []MihomoOutbound{newNode("A"), newNode("C"), newNode("D")}, false); e != nil {
		t.Fatal(e)
	}
	ready(m, 4)
	m.mu.Lock()
	same := m.cmd == first
	attempts := len(m.watchdog.attempts)
	m.mu.Unlock()
	if !same || attempts != 0 {
		t.Fatal("hot reload restarted healthy core")
	}
	t.Log("real core subscription commit + hot reload: 3 -> 4 group nodes, same child, new plan")
	if e = m.stopCore(); e != nil {
		t.Fatal(e)
	}
	recovered := &CoreManager{dataDir: dir}
	if e = recovered.load(); e != nil {
		t.Fatal(e)
	}
	if !effectiveSmartHealth(recovered.state).Enabled || !effectiveMihomoBasics(recovered.state).WatchdogEnabled || len(recovered.state.OutboundSubscriptions) != 1 {
		t.Fatal("settings lost on reload")
	}
	if e = recovered.startCore(); e != nil {
		t.Fatal(e)
	}
	t.Cleanup(func() { _ = recovered.stopCore() })
	ready(recovered, 4)
	t.Log("new manager loaded persistent state and started real core with both monitors enabled")
	up.Store(false)
	recovered.mu.Lock()
	recovered.smartHealth.status.Next = time.Now()
	recovered.mu.Unlock()
	recovered.smartHealthTick()
	recovered.mu.Lock()
	s := recovered.smartHealth.status
	cmd := recovered.cmd
	recovered.mu.Unlock()
	if s.Mode != "offline" || s.Healthy != 0 {
		t.Fatalf("expected offline got %s", s.Mode)
	}
	before := hits.Load()
	start := time.Now()
	for i := 0; i < 180; i++ {
		recovered.mu.Lock()
		recovered.smartHealth.status.Next = time.Now()
		recovered.mu.Unlock()
		recovered.smartHealthTick()
		recovered.coreWatchdogTick(time.Now().Add(20*time.Second + time.Duration(i)*10*time.Second))
		recovered.mu.Lock()
		s = recovered.smartHealth.status
		same := recovered.cmd == cmd && len(recovered.watchdog.attempts) == 0
		recovered.mu.Unlock()
		if s.Mode != "offline" || s.Running || hits.Load() != before || !same {
			t.Fatalf("offline cycle %d failed", i)
		}
	}
	t.Logf("180 accelerated offline polls (nominal 30min), no proxy scans or watchdog restart, elapsed %s", time.Since(start).Round(time.Millisecond))
}
