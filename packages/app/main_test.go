package main

import "testing"

func TestExternal(t *testing.T) {
	for raw, want := range map[string]bool{
		"https://example.com/a":     true,
		"http://example.com":        true,
		"mygo://localhost/":         false,
		"https://mygo.localhost/x":  false,
		"about:blank":               false,
		"data:text/plain,hi":        false,
		"blob:mygo://localhost/123": false,
	} {
		if got := external(raw); got != want {
			t.Errorf("external(%q) = %v, want %v", raw, got, want)
		}
	}
}
