// The standalone app (#212): the client and the whole server run in the system web view (web/entry.ts); Go holds
// the library's SQLite (db.go), saves exports where the user picks (save.go), keeps the appearance the player picked
// and writes to the clipboard for the page (host.go), brings the page back when the system ends its process
// (recovery.go), and reaches other origins for the page (MyGo's fetch plugin: no CORS, streams).
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"runtime"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/fetch"
	"github.com/egoist/mygo/plugins/updater"
)

//go:embed all:dist
var dist embed.FS

// external: a web page outside the app, whose own pages are mygo://localhost (https://mygo.localhost on Android).
func external(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && !strings.HasSuffix(u.Hostname(), ".localhost")
}

// phone: the two targets whose app is one full-screen window the system puts in the background and may end there.
func phone(goos string) bool { return goos == "ios" || goos == "android" }

// backgroundColor is what the window paints before the page does, by the client's tokens (tokens.css): a phone's
// top surface is --surface-1, and Android paints the strips behind its system bars with this colour, so it has to be
// the page's own; a desktop's canvas is --surface-0. light-dark() follows the appearance in force (host.go).
func backgroundColor(goos string) string {
	if phone(goos) {
		return "light-dark(#fcfcfb, #151515)"
	}
	return "light-dark(#f9f9f7, #0b0b0b)"
}

func main() {
	// Two desktop instances would write one library at once; a second launch brings the first forward instead.
	if !mygo.App.RequestSingleInstanceLock() {
		return
	}
	web, _ := fs.Sub(dist, "dist")
	files := mygo.FileServer(web)
	mygo.Protocol.HandleFunc("mygo", func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/__db":
			serveDB(w, r)
		case "/__save":
			serveSave(w, r)
		default:
			files.ServeHTTP(w, r)
		}
	})
	mygo.Use(fetch.New(fetchOptions()))
	// checks the v* releases in the background; installs only what the key in mygo.json signed
	mygo.Use(updater.Plugin)
	// what the page asks of the host beyond its files: the clipboard and the appearance (web/host.ts, tavernHost)
	mygo.Bind(Host{})
	mygo.App.WhenReady(func() {
		// Before the first window: its background, the status bar, the keyboard and the page's own
		// prefers-color-scheme then agree from the first frame.
		applyAppearance(savedAppearance())
		if menu := appMenu(runtime.GOOS); menu != nil {
			mygo.App.SetMenu(menu)
		}
		var win *mygo.Window
		var openWindow func(url string) *mygo.Window
		// A web content process the system killed (memory, mostly on phones) leaves Go and the library running: the
		// page is loaded again, whose library opens with a rollback of any write it was in (web/sqlite.ts). By its
		// address and not a reload: with the process gone the web view may hold no page to reload. Android's WebView
		// is dead once its render process is gone: a fresh window replaces it before closing it.
		back := newRecovery(phone(runtime.GOOS), func() {
			if win.IsDestroyed() {
				return
			}
			if runtime.GOOS == "android" {
				dead := win
				win = openWindow(recoveredURL)
				dead.Close()
				return
			}
			if err := win.Page().LoadURL(recoveredURL); err != nil {
				log.Print("the page could not be loaded again after its process ended: ", err)
			}
		})
		openWindow = func(url string) *mygo.Window {
			w := mygo.NewWindow(mygo.WindowOptions{
				Title:           "Effect Tavern",
				Width:           1280,
				Height:          820,
				MinWidth:        360,
				MinHeight:       480,
				StateKey:        "main",
				BackgroundColor: backgroundColor(runtime.GOOS),
				URL:             url,
			})
			w.Page().OnRenderProcessGone(func(string) {
				if w == win {
					back.gone()
				}
			})
			// Windows and Linux tell of no app becoming active: on a desktop the window taking the keyboard is the
			// player coming back to it. A phone's window keeps it in the background, so there it says nothing.
			if !phone(runtime.GOOS) {
				w.OnFocus(back.activated)
			}
			// The window holds the app alone: a web page it would navigate to (a link in a card's text, say) opens in
			// the system's browser instead, where the player can come back from it.
			w.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
				if external(e.URL) {
					e.PreventDefault()
					mygo.Shell.OpenExternal(e.URL)
				}
			})
			// The web view's own menu offers to reload the page and to walk its history, which here is one page
			// holding the server: gone, with the inspector; what the system adds to a selection or a text field
			// (look up, translate, cut and paste, spelling) stays.
			w.Page().OnContextMenu(trimContextMenu)
			return w
		}
		openDB()
		mygo.App.OnQuit(closeDB)
		win = openWindow("/")
		mygo.App.OnDidBecomeActive(back.activated)
		mygo.App.OnDidResignActive(back.resigned)
		if phone(runtime.GOOS) {
			// a phone's app in the background and in front again; a desktop has no use for the watch this starts
			mygo.Power.OnSuspend(back.resigned)
			mygo.Power.OnResume(back.activated)
		}
		show := func() {
			if win.IsDestroyed() {
				win = openWindow("/")
				return
			}
			win.Show()
			win.Restore()
			win.Focus()
		}
		mygo.App.OnSecondInstance(func([]string, string) { show() })
		if runtime.GOOS == "darwin" {
			// A Mac app outlives its last window: it stays in the Dock, the library open, and a click on its icon
			// with no window on screen opens one, or brings back the one that was minimized or hidden.
			mygo.App.OnWindowAllClosed(func() {})
			mygo.App.OnActivate(func(hasVisibleWindows bool) {
				if !hasVisibleWindows {
					show()
				}
			})
		}
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
