package main

import (
	"encoding/json"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestDBBatch(t *testing.T) {
	t.Setenv("TAVERN_DB", filepath.Join(t.TempDir(), "tavern.db"))
	openDB()
	defer closeDB()
	call := func(body string, status int) string {
		t.Helper()
		w := httptest.NewRecorder()
		serveDB(w, httptest.NewRequest("POST", "/__db", strings.NewReader(body)))
		if w.Code != status {
			t.Fatalf("status %d: %s", w.Code, w.Body.String())
		}
		return w.Body.String()
	}
	body := call(`{"mode":"batch","steps":[{"mode":"exec","sql":"create table probe(n integer unique)"},{"mode":"run","sql":"insert into probe values (?)","params":[12]},{"mode":"rows","sql":"select n,typeof(n) from probe"},{"mode":"run","sql":"insert into probe values(13)"}]}`, 200)
	var reply struct{ Results []json.RawMessage }
	if err := json.Unmarshal([]byte(body), &reply); err != nil || len(reply.Results) != 4 || !strings.Contains(string(reply.Results[2]), `[[12,"integer"]]`) {
		t.Fatal(body)
	}
	call(`{"mode":"batch","steps":[{"mode":"run","sql":"delete from probe where n=13"},{"mode":"run","sql":"insert into probe values(12)"}]}`, 422)
	if body := call(`{"mode":"rows","sql":"select n from probe order by n"}`, 200); !strings.Contains(body, `[[12],[13]]`) {
		t.Fatal(body)
	}
}

func TestCloseDBLifecycle(t *testing.T) {
	closeDB() // safe before openDB (e.g. MYGO_GENERATE exits before WhenReady)
	t.Setenv("TAVERN_DB", filepath.Join(t.TempDir(), "tavern.db"))
	openDB()
	closeDB()
	closeDB() // idempotent
}

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
		// names Windows takes for devices, whatever their case or what follows the first dot
		"NUL":           "_NUL",
		"nul.md":        "_nul.md",
		"Con.pack.json": "_Con.pack.json",
		"PRN.yaml":      "_PRN.yaml",
		"aux":           "_aux",
		"COM1.md":       "_COM1.md",
		"com9":          "_com9",
		"LPT1.json":     "_LPT1.json",
		"lpt9.tar.gz":   "_lpt9.tar.gz",
		"NUL .md":       "_NUL .md",
		"COM².md":       "_COM².md",
		// and names that only look like them
		"NULL.md":    "NULL.md",
		"CONSOLE.md": "CONSOLE.md",
		"COM.md":     "COM.md",
		"COM10.md":   "COM10.md",
		"LPT.md":     "LPT.md",
		"my.NUL":     "my.NUL",
		"auxiliary":  "auxiliary",
	} {
		if got := cleanName(raw); got != want {
			t.Errorf("cleanName(%q) = %q, want %q", raw, got, want)
		}
	}
}
