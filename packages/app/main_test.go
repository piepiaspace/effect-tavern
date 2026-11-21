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

func TestCleanName(t *testing.T) {
	for raw, want := range map[string]string{
		"wuxia.yaml":          "wuxia.yaml",
		"雨夜刀客.md":             "雨夜刀客.md",
		"古风/武侠.pack.json":     "古风_武侠.pack.json",
		`a:b*c?"d<e>f|g.json`: "a_b_c__d_e_f_g.json",
		"bad\x00name\n.yaml":  "badname.yaml",
		"":                    "",
		".":                   "",
		"..":                  "",
		" / ":                 "_",
	} {
		if got := cleanName(raw); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", raw, got, want)
		}
	}
}
