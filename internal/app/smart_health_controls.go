package app

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/tls"
	"encoding/binary"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"strings"
	"time"
)

// These are read-only availability checks. No proxy env, no redirects,
// standard certificate verification, IPv4 only. Kernel/upstream routing is
// outside this application's control.
var smartForbiddenV4 = []netip.Prefix{
	netip.MustParsePrefix("0.0.0.0/8"), netip.MustParsePrefix("10.0.0.0/8"),
	netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("127.0.0.0/8"),
	netip.MustParsePrefix("169.254.0.0/16"), netip.MustParsePrefix("172.16.0.0/12"),
	netip.MustParsePrefix("192.0.0.0/24"), netip.MustParsePrefix("192.0.2.0/24"),
	netip.MustParsePrefix("192.88.99.0/24"), netip.MustParsePrefix("192.168.0.0/16"),
	netip.MustParsePrefix("198.18.0.0/15"), netip.MustParsePrefix("198.51.100.0/24"),
	netip.MustParsePrefix("203.0.113.0/24"), netip.MustParsePrefix("224.0.0.0/4"),
	netip.MustParsePrefix("240.0.0.0/4"),
}

func smartPublicV4(ip netip.Addr) bool {
	if !ip.Is4() || !ip.IsGlobalUnicast() {
		return false
	}
	for _, p := range smartForbiddenV4 {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}
func smartPublicDial(ctx context.Context, address string) (net.Conn, error) {
	return smartPublicNetworkDial(ctx, "tcp4", address)
}
func smartPublicNetworkDial(ctx context.Context, network, address string) (net.Conn, error) {
	host, port, err := net.SplitHostPort(address)
	if err != nil || !smartValidEndpoint(host) || !(network == "tcp4" && (port == "443" || port == "853" || port == "53") || network == "udp4" && port == "53") {
		return nil, fmt.Errorf("invalid public control endpoint")
	}
	var ips []netip.Addr
	if ip, e := netip.ParseAddr(host); e == nil {
		ips = []netip.Addr{ip}
	} else {
		ips, err = net.DefaultResolver.LookupNetIP(ctx, "ip4", host)
		if err != nil {
			return nil, err
		}
	}
	for _, ip := range ips {
		if !smartPublicV4(ip.Unmap()) {
			return nil, fmt.Errorf("non-public control endpoint")
		}
	}
	d := net.Dialer{Timeout: 1500 * time.Millisecond}
	for i, ip := range ips {
		if i >= 4 {
			break
		}
		conn, e := d.DialContext(ctx, network, net.JoinHostPort(ip.Unmap().String(), port))
		if e == nil {
			return conn, nil
		}
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, fmt.Errorf("control endpoint unavailable")
}
func smartControlTransport(s smartService) *http.Transport {
	return &http.Transport{Proxy: nil, DisableKeepAlives: true, TLSClientConfig: &tls.Config{ServerName: s.tlsName(), MinVersion: tls.VersionTLS12}, DialContext: func(ctx context.Context, network, address string) (net.Conn, error) {
		if s.Host == smartYandexDNSHost && s.Protocol == "DoH" {
			return smartYandexDial(ctx, "443")
		}
		return smartPublicDial(ctx, net.JoinHostPort(s.Host, "443"))
	}, TLSHandshakeTimeout: 3 * time.Second}
}
func smartProbeControl(ctx context.Context, s smartService) bool {
	if !smartValidServiceEndpoint(s) {
		return false
	}
	switch s.Protocol {
	case "DoH":
		return smartDoH(ctx, s)
	case "DoT":
		return smartDoT(ctx, s)
	case "Do53":
		return smartDo53(ctx, func(ctx context.Context, network string) (net.Conn, error) {
			return smartPublicNetworkDial(ctx, network, net.JoinHostPort(s.Host, "53"))
		})
	case "HTTPS":
		req, err := http.NewRequestWithContext(ctx, http.MethodHead, "https://"+s.tlsName()+"/", nil)
		if err != nil {
			return false
		}
		tr := smartControlTransport(s)
		defer tr.CloseIdleConnections()
		client := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
		resp, err := client.Do(req)
		if err != nil {
			return false
		}
		defer resp.Body.Close()
		return resp.StatusCode >= 200 && resp.StatusCode < 500
	}
	return false
}
func smartDNSQuestion() ([]byte, error) {
	q := make([]byte, 12)
	if _, err := rand.Read(q[:2]); err != nil {
		return nil, err
	}
	binary.BigEndian.PutUint16(q[2:4], 0x0100)
	binary.BigEndian.PutUint16(q[4:6], 1)
	for _, label := range strings.Split("ya.ru", ".") {
		q = append(q, byte(len(label)))
		q = append(q, label...)
	}
	q = append(q, 0, 0, 1, 0, 1)
	return q, nil
}

// The check requires an actual matching, successful DNS answer, not simply
// an open HTTPS/TLS socket. Bounded parser; reject truncation and bad lengths.
func smartDNSAnswer(q, b []byte) bool {
	if len(q) < 17 || len(b) < len(q) || !bytes.Equal(q[:2], b[:2]) {
		return false
	}
	flags := binary.BigEndian.Uint16(b[2:4])
	if flags&0x8000 == 0 || flags&0x0200 != 0 || flags&0x780f != 0 || binary.BigEndian.Uint16(b[4:6]) != 1 || !bytes.Equal(q[12:], b[12:len(q)]) {
		return false
	}
	count := int(binary.BigEndian.Uint16(b[6:8]))
	off := len(q)
	found := false
	for i := 0; i < count; i++ {
		// Skip owner name (labels or a compression pointer).
		for {
			if off >= len(b) {
				return false
			}
			n := int(b[off])
			off++
			if n == 0 {
				break
			}
			if n&0xc0 == 0xc0 {
				if off >= len(b) {
					return false
				}
				ptr := (n&0x3f)<<8 | int(b[off])
				if ptr >= len(b) {
					return false
				}
				off++
				break
			}
			if n > 63 || off+n > len(b) {
				return false
			}
			off += n
		}
		if off+10 > len(b) {
			return false
		}
		typ := binary.BigEndian.Uint16(b[off : off+2])
		class := binary.BigEndian.Uint16(b[off+2 : off+4])
		size := int(binary.BigEndian.Uint16(b[off+8 : off+10]))
		off += 10
		if off+size > len(b) {
			return false
		}
		if typ == 1 && class == 1 && size == 4 {
			found = true
		}
		off += size
	}
	return found
}

// The published Yandex basic resolver IPv4 addresses match the TLS
// hostname. Avoid the system resolver for these two checks.
const smartYandexDNSHost = "common.dot.dns.yandex.net"

func smartYandexDial(ctx context.Context, port string) (net.Conn, error) {
	var last error
	for _, ip := range []string{"77.88.8.8", "77.88.8.1"} {
		d := net.Dialer{Timeout: 1500 * time.Millisecond}
		conn, err := d.DialContext(ctx, "tcp4", net.JoinHostPort(ip, port))
		if err == nil {
			return conn, nil
		}
		last = err
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
	}
	return nil, last
}
func smartDoH(ctx context.Context, s smartService) bool {
	q, err := smartDNSQuestion()
	if err != nil {
		return false
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://"+s.tlsName()+"/dns-query", bytes.NewReader(q))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/dns-message")
	req.Header.Set("Accept", "application/dns-message")
	tr := smartControlTransport(s)
	defer tr.CloseIdleConnections()
	client := &http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	resp, err := client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	media, _, err := mime.ParseMediaType(resp.Header.Get("Content-Type"))
	if err != nil || media != "application/dns-message" || resp.StatusCode != 200 {
		return false
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, 65536))
	return err == nil && smartDNSAnswer(q, data)
}
func smartDoT(ctx context.Context, s smartService) bool {
	q, err := smartDNSQuestion()
	if err != nil {
		return false
	}
	var raw net.Conn
	if s.Host == smartYandexDNSHost {
		raw, err = smartYandexDial(ctx, "853")
	} else {
		raw, err = smartPublicDial(ctx, net.JoinHostPort(s.Host, "853"))
	}
	if err != nil {
		return false
	}
	secured := tls.Client(raw, &tls.Config{ServerName: s.tlsName(), MinVersion: tls.VersionTLS12})
	if err = secured.HandshakeContext(ctx); err != nil {
		raw.Close()
		return false
	}
	defer secured.Close()
	return smartDNSStream(ctx, secured, q)
}

// DNS over TCP/TLS uses a length-prefixed message. Context bounds all I/O.
func smartDNSStream(ctx context.Context, conn net.Conn, q []byte) bool {
	if deadline, ok := ctx.Deadline(); ok {
		_ = conn.SetDeadline(deadline)
	}
	stop := context.AfterFunc(ctx, func() { _ = conn.Close() })
	defer stop()
	framed := binary.BigEndian.AppendUint16(nil, uint16(len(q)))
	framed = append(framed, q...)
	n, err := conn.Write(framed)
	if err != nil || n != len(framed) {
		return false
	}
	size := make([]byte, 2)
	if _, err = io.ReadFull(conn, size); err != nil {
		return false
	}
	length := int(binary.BigEndian.Uint16(size))
	if length < 12 {
		return false
	}
	answer := make([]byte, length)
	_, err = io.ReadFull(conn, answer)
	return err == nil && smartDNSAnswer(q, answer)
}

// A bounded UDP attempt followed by TCP fallback. Only a matching valid
// DNS answer counts as success; no arbitrary-port or LAN probing.
func smartDo53(ctx context.Context, dial func(context.Context, string) (net.Conn, error)) bool {
	q, err := smartDNSQuestion()
	if err != nil {
		return false
	}
	udpCtx, cancel := context.WithTimeout(ctx, 1200*time.Millisecond)
	ok := func() bool {
		conn, err := dial(udpCtx, "udp4")
		if err != nil {
			return false
		}
		defer conn.Close()
		deadline, _ := udpCtx.Deadline()
		_ = conn.SetDeadline(deadline)
		stop := context.AfterFunc(udpCtx, func() { _ = conn.Close() })
		defer stop()
		n, err := conn.Write(q)
		if err != nil || n != len(q) {
			return false
		}
		answer := make([]byte, 65535)
		n, err = conn.Read(answer)
		return err == nil && smartDNSAnswer(q, answer[:n])
	}()
	cancel()
	if ok {
		return true
	}
	if ctx.Err() != nil {
		return false
	}
	tcp, err := dial(ctx, "tcp4")
	if err != nil {
		return false
	}
	defer tcp.Close()
	return smartDNSStream(ctx, tcp, q)
}
