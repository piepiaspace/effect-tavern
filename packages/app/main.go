// The standalone app (#212): the client and the whole server run in the system web view (web/entry.ts); Go holds
// the library's SQLite (db.go), saves exports where the user picks (save.go), and reaches other origins for the page
// (MyGo's fetch plugin: no CORS, streams).
package main

import (
	"embed"
	"io/fs"
	"log"
	"net/http"
	"net/url"
	"strings"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/fetch"
)

//go:embed all:dist
var dist embed.FS

// external: a web page outside the app, whose own pages are mygo://localhost (https://mygo.localhost on Android).
func external(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && !strings.HasSuffix(u.Hostname(), ".localhost")
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
	mygo.Use(fetch.Plugin)
	openDB()
	mygo.App.OnQuit(closeDB)
	mygo.App.WhenReady(func() {
		win := mygo.NewWindow(mygo.WindowOptions{
			Title:           "Effect Tavern",
			Width:           1280,
			Height:          820,
			MinWidth:        360,
			MinHeight:       480,
			StateKey:        "main",
			BackgroundColor: "light-dark(#fcfcfb, #151515)",
			URL:             "/",
		})
		// A web content process the system killed (memory, mostly on phones) leaves Go and the library running:
		// load the page again, whose library opens with a rollback of any write it was in (web/sqlite.ts).
		win.Page().OnRenderProcessGone(func(string) { win.Page().Reload() })
		// The window holds the app alone: a web page it would navigate to (a link in a card's text, say) opens in the
		// system's browser instead, where the player can come back from it.
		win.Page().OnWillNavigate(func(e *mygo.NavigateEvent) {
			if external(e.URL) {
				e.PreventDefault()
				mygo.Shell.OpenExternal(e.URL)
			}
		})
		mygo.App.OnSecondInstance(func([]string, string) {
			win.Show()
			win.Restore()
			win.Focus()
		})
	})
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}
