package main

import (
	"crypto/x509"
	"golang.org/x/net/http/httpproxy"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestProxyRedirect(t *testing.T) {
	for _, scheme := range []string{"http", "https"} {
		t.Run(scheme, func(t *testing.T) {
			seen := 0
			handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				seen++
				if r.Header.Get(proxyHeader) != "" {
					t.Error("proxy option escaped IPC")
				}
				if r.URL.Path == "/start" {
					http.Redirect(w, r, "http://second.invalid/end", http.StatusFound)
					return
				}
				io.WriteString(w, r.Host)
			})
			proxy := httptest.NewUnstartedServer(handler)
			opts := fetchOptions()
			if scheme == "https" {
				proxy.StartTLS()
				roots := x509.NewCertPool()
				roots.AddCert(proxy.Certificate())
				opts.Client.Transport.(*http.Transport).TLSClientConfig.RootCAs = roots
			} else {
				proxy.Start()
			}
			defer proxy.Close()
			req, err := http.NewRequest("GET", "http://first.invalid/start", nil)
			if err != nil {
				t.Fatal(err)
			}
			req.Header.Set(proxyHeader, proxy.URL)
			opts.Allow(req)
			res, err := opts.Client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			defer res.Body.Close()
			b, err := io.ReadAll(res.Body)
			if err != nil || string(b) != "second.invalid" || seen != 2 {
				t.Fatalf("redirect: %q, %d requests, %v", b, seen, err)
			}
		})
	}
}

func TestEnvironmentRoute(t *testing.T) {
	original := osOnlyProxy
	t.Cleanup(func() { osOnlyProxy = original })
	osOnlyProxy = func(*http.Request) (*url.URL, error) { return url.Parse("http://system.test:80") }
	for _, tc := range []struct {
		host, https, all, want string
	}{
		{"other.test", "", "", "http://system.test:80"},
		{"intranet.test", "", "", ""},
		{"10.8.0.7", "", "socks5h://proxy.test:1080", ""},
		{"[::1]", "", "socks://proxy.test:1080", ""},
		{"thing.localhost", "", "", ""},
		{"other.test", "", "socks5h://proxy.test:1080", "socks5://proxy.test:1080"},
		{"other.test", "socks://proxy.test:1080", "", "socks5://proxy.test:1080"},
		{"other.test", "proxy.test:7890", "", "http://proxy.test:7890"},
	} {
		req := httptest.NewRequest("GET", "https://"+tc.host, nil)
		got, err := environmentRoute(req, &httpproxy.Config{NoProxy: "intranet.test,10.0.0.0/8", HTTPSProxy: tc.https}, tc.all, "")
		if err != nil || (got == nil && tc.want != "") || (got != nil && got.String() != tc.want) {
			t.Errorf("%+v: got %v, %v", tc, got, err)
		}
	}
}
