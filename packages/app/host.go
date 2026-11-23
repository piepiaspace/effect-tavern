// What the page asks of the host by name (web/host.ts, tavernHost; the page calls Host.<Method> over MyGo's bridge):
// the system clipboard, and the appearance the player picked. The pick is Go's to keep because the window's first
// frame is Go's to paint: the background, the status bar and the keyboard take their side before any page runs.
package main

import (
	"fmt"
	"log"
	"sync"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/preferences"
	"github.com/egoist/mygo/transfer"
)

// Host is the service bound for the page. Its methods are the page's whole reach into Go beyond the app's own scheme.
type Host struct{}

// Copy puts text on the system clipboard. The page's own clipboard needs a secure page and a tap still fresh, and a
// key is fetched between the tap and the write; this one needs neither. concealed marks a secret for the clipboard
// managers that honour the platform's mark (kept out of histories and off the player's other devices).
func (Host) Copy(text string, concealed bool) error {
	return mygo.Clipboard.Write(transfer.TextData(text), mygo.ClipboardOptions{Concealed: concealed})
}

// appearanceKey names the pick in preferences.json, in the app's user data directory beside the library.
const appearanceKey = "appearance"

// appearance reads a pick as the page words it: system, light or dark.
func appearance(raw string) (mygo.ThemeSource, bool) {
	switch s := mygo.ThemeSource(raw); s {
	case mygo.ThemeSystem, mygo.ThemeLight, mygo.ThemeDark:
		return s, true
	}
	return mygo.ThemeSystem, false
}

// savedAppearance is the pick kept from an earlier run: the system's until the player picked a side, and again when
// the file holds something else.
func savedAppearance() mygo.ThemeSource {
	var raw string
	preferences.Get(appearanceKey, &raw)
	s, _ := appearance(raw)
	return s
}

// inForce is the pick this run is on: the saved one from the start, then whatever the player picked since, kept or
// not.
var inForce struct {
	sync.Mutex
	pick mygo.ThemeSource
}

// applyAppearance pins the app to a side or lets it follow the system: the windows' backgrounds, the system's bars
// and keyboard, the title bar, and the page's prefers-color-scheme with them, which is why the page pins nothing of
// its own in the app.
func applyAppearance(s mygo.ThemeSource) {
	inForce.Lock()
	inForce.pick = s
	inForce.Unlock()
	setThemeSource(s)
}

// setThemeSource is MyGo's. Replaced by tests, which run no app for it to reach.
var setThemeSource = mygo.Theme.SetSource

// Appearance answers the pick in force, for the page's button to show.
func (Host) Appearance() string {
	inForce.Lock()
	defer inForce.Unlock()
	if inForce.pick == "" {
		return string(mygo.ThemeSystem)
	}
	return string(inForce.pick)
}

// SetAppearance applies the pick now and keeps it for the next launch. Android keeps an override itself; iOS and the
// desktops forget theirs with the process, so the file is what every platform starts from. A pick that could not be
// written still holds for this run, and the page is told.
func (Host) SetAppearance(raw string) error {
	s, ok := appearance(raw)
	if !ok {
		return fmt.Errorf("the appearance is system, light or dark, not %q", raw)
	}
	applyAppearance(s)
	if err := preferences.Set(appearanceKey, string(s)); err != nil {
		log.Print("the appearance could not be saved for the next launch: ", err)
		return fmt.Errorf("the appearance holds until the app closes, but could not be saved for the next launch: %w", err)
	}
	return nil
}
