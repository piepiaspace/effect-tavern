package main

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/egoist/mygo/netproxy"
	"github.com/egoist/mygo/plugins/fetch"
	desktop "github.com/piepiaspace/effect-tavern/packages/systemproxy"
	"golang.org/x/net/http/httpproxy"
)

// MyGo carries headers across IPC. Move our private option into the context
// before Client.Do, so neither the upstream nor a redirect receives it.
const proxyHeader = "X-Tavern-Fetch-Proxy"

type proxyKey struct{}

func fetchOptions() fetch.Options {
	t := http.DefaultTransport.(*http.Transport).Clone()
	t.Proxy = requestProxy // Transport's connection pools are keyed by proxy.
	return fetch.Options{Client: &http.Client{Transport: t}, Allow: func(r *http.Request) bool {
		option := r.Header.Get(proxyHeader)
		r.Header.Del(proxyHeader)
		if option != "" {
			*r = *r.WithContext(context.WithValue(r.Context(), proxyKey{}, option))
		}
		return true
	}}
}

func requestProxy(r *http.Request) (*url.URL, error) {
	switch option, _ := r.Context().Value(proxyKey{}).(string); option {
	case "direct":
		return nil, nil
	case "":
		return environmentRoute(r, httpproxy.FromEnvironment(), os.Getenv("all_proxy"), os.Getenv("ALL_PROXY"))
	default:
		return parseProxy(option)
	}
}

func parseProxy(raw string) (*url.URL, error) {
	if !strings.Contains(raw, "://") {
		raw = "http://" + raw
	}
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return nil, errors.New("invalid proxy address")
	}
	if u.Scheme == "socks" || u.Scheme == "socks5h" {
		u.Scheme = "socks5"
	}
	if !slices.Contains([]string{"http", "https", "socks5"}, u.Scheme) {
		return nil, errors.New("unsupported proxy protocol")
	}
	return u, nil
}

// MyGo's desktop resolver hands control to the environment if *any* proxy
// variable exists. For a destination with only bypass rules, ask the OS directly.
func environmentRoute(r *http.Request, cfg *httpproxy.Config, lowerAll, upperAll string) (*url.URL, error) {
	host := strings.ToLower(r.URL.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || net.ParseIP(host).IsLoopback() {
		return nil, nil
	}
	raw := cfg.HTTPProxy
	if r.URL.Scheme == "https" {
		raw = cfg.HTTPSProxy
	}
	if raw == "" {
		raw = lowerAll
	}
	if raw == "" {
		raw = upperAll
	}
	if raw == "" && cfg.NoProxy == "" && cfg.HTTPProxy == "" && cfg.HTTPSProxy == "" {
		return systemProxy(r)
	}
	// Let Go match host, port and CIDR exclusions, even without a proxy address.
	match := httpproxy.Config{NoProxy: cfg.NoProxy, HTTPProxy: "http://match", HTTPSProxy: "http://match"}
	selected, err := match.ProxyFunc()(r.URL)
	if selected == nil || err != nil {
		return nil, err
	}
	if raw != "" {
		return parseProxy(raw)
	}
	return osOnlyProxy(r)
}

var systemProxy = netproxy.Proxy
var osOnlyProxy = func(r *http.Request) (*url.URL, error) { return desktop.Lookup(r.Context(), r.URL) }
