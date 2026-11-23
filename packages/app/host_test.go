package main

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/egoist/mygo"
)

func TestBackgroundColor(t *testing.T) {
	for goos, want := range map[string]string{
		"ios":     "light-dark(#fcfcfb, #151515)",
		"android": "light-dark(#fcfcfb, #151515)",
		"darwin":  "light-dark(#f9f9f7, #0b0b0b)",
		"windows": "light-dark(#f9f9f7, #0b0b0b)",
		"linux":   "light-dark(#f9f9f7, #0b0b0b)",
	} {
		if got := backgroundColor(goos); got != want {
			t.Errorf("backgroundColor(%q) = %q, want %q", goos, got, want)
		}
	}
}

// Only macOS has a menu bar to add to: elsewhere the default (none) is left alone.
func TestAppMenuLeavesOtherSystemsAlone(t *testing.T) {
	for _, goos := range []string{"linux", "windows", "ios", "android"} {
		if appMenu(goos) != nil {
			t.Errorf("appMenu(%q) made a menu bar", goos)
		}
	}
}

func TestAppearance(t *testing.T) {
	for raw, want := range map[string]mygo.ThemeSource{
		"system": mygo.ThemeSystem,
		"light":  mygo.ThemeLight,
		"dark":   mygo.ThemeDark,
	} {
		if got, ok := appearance(raw); !ok || got != want {
			t.Errorf("appearance(%q) = %q, %v", raw, got, ok)
		}
	}
	for _, raw := range []string{"", "Dark", "auto", "black"} {
		if got, ok := appearance(raw); ok || got != mygo.ThemeSystem {
			t.Errorf("appearance(%q) = %q, %v: want the system's, refused", raw, got, ok)
		}
	}
}

// The pick outlives the process in the app's user data directory, and a pick that is none of the three changes
// nothing. One that cannot be written still holds for the run, and the page is told.
func TestAppearanceIsKept(t *testing.T) {
	dir := t.TempDir()
	mygo.App.SetPath(mygo.PathUserData, dir)
	t.Cleanup(func() { mygo.App.SetPath(mygo.PathUserData, "") })
	was := setThemeSource
	t.Cleanup(func() { setThemeSource = was })
	var applied []mygo.ThemeSource
	setThemeSource = func(s mygo.ThemeSource) { applied = append(applied, s) }
	t.Cleanup(func() {
		if got := fmt.Sprint(applied); got != "[system dark system light]" {
			t.Errorf("applied %s, want the saved pick at the start, then each pick taken, and nothing else", got)
		}
	})
	if got := savedAppearance(); got != mygo.ThemeSystem {
		t.Fatalf("a new install starts on %q, want the system's", got)
	}
	applyAppearance(savedAppearance()) // as main does before the first window
	if got := (Host{}).Appearance(); got != "system" {
		t.Fatalf("Appearance() = %q on a new install", got)
	}
	if err := (Host{}).SetAppearance("dark"); err != nil {
		t.Fatal(err)
	}
	if got := (Host{}).Appearance(); got != "dark" {
		t.Fatalf("Appearance() = %q after picking dark", got)
	}
	file, err := os.ReadFile(filepath.Join(dir, "preferences.json"))
	if err != nil || !strings.Contains(string(file), `"appearance": "dark"`) {
		t.Fatalf("preferences.json = %q, %v", file, err)
	}
	if err := (Host{}).SetAppearance("sepia"); err == nil {
		t.Fatal("a pick that is none of the three was taken")
	}
	if got := (Host{}).Appearance(); got != "dark" {
		t.Fatalf("Appearance() = %q after a refused pick", got)
	}
	if got := savedAppearance(); got != mygo.ThemeDark {
		t.Fatalf("the next launch would start on %q, want dark", got)
	}
	if err := (Host{}).SetAppearance("system"); err != nil || (Host{}).Appearance() != "system" {
		t.Fatalf("back to the system's: %q, %v", (Host{}).Appearance(), err)
	}
	// nowhere to write: the pick is on the screen for this run, the page hears it was not kept, and the file's stands
	mygo.App.SetPath(mygo.PathUserData, filepath.Join(dir, "preferences.json", "not a directory"))
	if err := (Host{}).SetAppearance("light"); err == nil || !strings.Contains(err.Error(), "could not be saved") {
		t.Fatalf("a pick that could not be written: %v", err)
	}
	if got := (Host{}).Appearance(); got != "light" {
		t.Fatalf("Appearance() = %q, want the pick in force", got)
	}
}

// A clock the test moves, the loads the recovery asked for, and the tries it set for later.
type recovering struct {
	*recovery
	at     time.Time
	loads  int
	timers []timer
}

type timer struct {
	at time.Time
	fn func()
}

func newRecovering(waits bool) *recovering {
	r := &recovering{at: time.Unix(1_700_000_000, 0)}
	r.recovery = newRecovery(waits, func() { r.loads++ })
	r.now = func() time.Time { return r.at }
	r.later = func(d time.Duration, fn func()) { r.timers = append(r.timers, timer{r.at.Add(d), fn}) }
	return r
}

// after moves the clock on, running what was set for a time it passes.
func (r *recovering) after(d time.Duration) {
	r.at = r.at.Add(d)
	due := r.timers
	r.timers = nil
	for _, t := range due {
		if t.at.After(r.at) {
			r.timers = append(r.timers, t)
			continue
		}
		t.fn()
	}
}

func (r *recovering) want(t *testing.T, loads int, why string) {
	t.Helper()
	if r.loads != loads {
		t.Fatalf("%s: %d loads, want %d", why, r.loads, loads)
	}
}

func TestRecoveryOnAPhone(t *testing.T) {
	r := newRecovering(true)
	r.activated()
	r.want(t, 0, "coming to the front with the page alive loads nothing")
	r.gone()
	r.want(t, 1, "a process gone in front is loaded at once")

	r.after(time.Hour)
	r.resigned()
	r.gone()
	r.want(t, 1, "a process gone in the background waits")
	r.after(time.Hour)
	r.activated()
	r.want(t, 2, "and is loaded when the app is in front again")
	r.activated()
	r.want(t, 2, "once")

	// lost again at once: one load a cooldown, at its end, with nothing for the player to do
	r.after(time.Second)
	r.gone()
	r.gone()
	r.want(t, 2, "gone again within the cooldown: no load yet")
	r.after(time.Second)
	r.resigned()
	r.activated()
	r.want(t, 2, "back in front still inside the cooldown: no load yet")
	if len(r.timers) != 1 {
		t.Fatalf("%d tries set for the end of the cooldown, want one", len(r.timers))
	}
	r.after(recoveryCooldown)
	r.want(t, 3, "the cooldown over with the app in front: loaded")

	// the cooldown ending with the app away loads nothing: the load waits for the player
	r.after(time.Second)
	r.gone()
	r.resigned()
	r.after(time.Hour)
	r.want(t, 3, "the cooldown over in the background: no load")
	r.activated()
	r.want(t, 4, "until the app is in front again")
}

func TestRecoveryOnADesktop(t *testing.T) {
	r := newRecovering(false)
	r.resigned()
	r.gone()
	r.want(t, 1, "a desktop loads at once, in front or not")
	r.after(time.Second)
	r.gone()
	r.want(t, 1, "gone again within the cooldown: no load yet")
	r.activated()
	r.want(t, 1, "nor by coming back to the window inside it")
	r.after(recoveryCooldown - 2*time.Second)
	r.want(t, 1, "nor a moment before it ends")
	r.after(time.Second)
	r.want(t, 2, "loaded when the cooldown ends")
	r.after(time.Hour)
	r.want(t, 2, "and a page that stays up is left alone")
}

// A page that dies every time it starts is loaded a few times and then left: no load goes on for ever unasked. The
// player coming back to the app is asked for, and a page that stayed up starts the count over.
func TestRecoveryGivesUp(t *testing.T) {
	r := newRecovering(false)
	r.gone()
	loads := 1
	r.want(t, loads, "the first loss is loaded at once")
	for range recoveryTries - 1 {
		r.after(time.Second)
		r.gone()
		r.want(t, loads, "lost inside the cooldown: not yet")
		r.after(recoveryCooldown)
		loads++
		r.want(t, loads, "loaded when the cooldown ends")
	}
	r.after(time.Second)
	r.gone()
	r.after(24 * time.Hour)
	r.want(t, loads, "lost inside the cooldown once too often: left as it is")
	if len(r.timers) != 0 {
		t.Fatalf("%d tries still set after giving up", len(r.timers))
	}
	r.activated()
	loads++
	r.want(t, loads, "the player back at the app: one more load")

	r.after(time.Hour)
	r.gone()
	loads++
	r.want(t, loads, "a page that stayed up and then went is loaded at once")
	r.after(time.Second)
	r.gone()
	r.after(recoveryCooldown)
	loads++
	r.want(t, loads, "and its count starts over")
}

// save posts body as an export named name and answers what the page gets: the status, and the body.
func save(t *testing.T, name, body string, pick func(path, name string) (string, error)) (int, string) {
	t.Helper()
	was := saveCopy
	t.Cleanup(func() { saveCopy = was })
	rec := httptest.NewRecorder()
	saveCopy = func(path, name string) (string, error) {
		// what the Android web view needs: the response has begun before the picker is on screen
		if !rec.Flushed || rec.Code != http.StatusOK {
			t.Errorf("the picker opened before the response began (flushed %v, status %d)", rec.Flushed, rec.Code)
		}
		if got, err := os.ReadFile(path); err != nil || string(got) != body {
			t.Errorf("the picker was handed %q, %v, want the body", got, err)
		}
		return pick(path, name)
	}
	serveSave(rec, httptest.NewRequest(http.MethodPost, "/__save?name="+name, strings.NewReader(body)))
	return rec.Code, strings.TrimSpace(rec.Body.String())
}

func TestSaveAnswers(t *testing.T) {
	never := func(string, string) (string, error) {
		t.Error("the picker opened for an export that was refused")
		return "", nil
	}
	if code, body := save(t, "a.md", "text", func(_, name string) (string, error) {
		if name != "a.md" {
			t.Errorf("offered as %q", name)
		}
		return "/somewhere/a.md", nil
	}); code != 200 || body != `{"saved":true}` {
		t.Errorf("saved: %d %s", code, body)
	}
	if code, body := save(t, "a.md", "text", func(string, string) (string, error) { return "", nil }); code != 200 || body != `{"saved":false}` {
		t.Errorf("canceled: %d %s", code, body)
	}
	// the status is sent by then: the failure travels in the body
	if code, body := save(t, "a.md", "text", func(string, string) (string, error) {
		return "", errors.New("disk full")
	}); code != 200 || body != `{"saved":false,"error":"The file could not be saved: disk full"}` {
		t.Errorf("failed in the picker: %d %s", code, body)
	}
	// before the picker, a failure keeps its status
	if code, body := save(t, "a.md", "", never); code != 400 || !strings.Contains(body, "empty") {
		t.Errorf("an empty body: %d %s", code, body)
	}
	if code, _ := save(t, "..", "text", never); code != 400 {
		t.Errorf("no name: %d", code)
	}
	if code, body := save(t, "NUL.md", "text", func(path, name string) (string, error) {
		if name != "_NUL.md" || filepath.Base(path) != "_NUL.md" {
			t.Errorf("a device's name reached the picker: %q at %q", name, path)
		}
		return path, nil
	}); code != 200 || body != `{"saved":true}` {
		t.Errorf("a reserved name: %d %s", code, body)
	}
}
