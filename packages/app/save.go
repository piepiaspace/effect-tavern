// Exports: the page cannot download in a web view (phones' have nowhere to put a file), so it posts the file here
// (web/host.ts, tavernHost.save) and the user picks where it goes: the save dialog on desktops, Files on iOS, the
// storage access framework on Android.
//
// The answer comes in two parts. Android's web view waits a minute for a response to begin and no longer, and a
// player may well spend longer than that choosing a folder: so the response begins as soon as the file is in hand,
// before the picker opens, and what became of it follows in the body, however long the player took. A failure before
// that point has its own status; one after it can only travel in the body, the status being sent already.
package main

import (
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/egoist/mygo"
)

var unsafeName = strings.NewReplacer(`\`, "_", "/", "_", ":", "_", "*", "_", "?", "_", `"`, "_", "<", "_", ">", "_", "|", "_")

// reserved: whether Windows takes a file of this name for a device, whatever follows its first dot (NUL, nul.md,
// COM1.tar.gz), and so cannot hold a file under it.
func reserved(name string) bool {
	stem, _, _ := strings.Cut(name, ".")
	stem = strings.ToUpper(strings.TrimRight(stem, " "))
	switch stem {
	case "CON", "PRN", "AUX", "NUL":
		return true
	}
	port, ok := strings.CutPrefix(stem, "COM")
	if !ok {
		port, ok = strings.CutPrefix(stem, "LPT")
	}
	if !ok {
		return false
	}
	switch port { // the digits, and the three superscript ones Windows reads as digits here
	case "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³":
		return true
	}
	return false
}

func cleanName(raw string) string {
	s := strings.Map(func(r rune) rune {
		if r < 0x20 || r == 0x7f {
			return -1
		}
		return r
	}, unsafeName.Replace(strings.TrimSpace(raw)))
	name := strings.Trim(filepath.Base(s), ". ")
	if name == "" || name == "." || name == "/" {
		return ""
	}
	if reserved(name) {
		return "_" + name // the name the story or card has, kept readable, and no device's any more
	}
	return name
}

// saveOutcome is the body of a save that got as far as the picker: saved or not (the player canceled), or why not.
type saveOutcome struct {
	Saved bool   `json:"saved"`
	Error string `json:"error,omitempty"`
}

func serveSave(w http.ResponseWriter, r *http.Request) {
	name := cleanName(r.URL.Query().Get("name"))
	if name == "" {
		http.Error(w, "The export has no file name to be saved under.", http.StatusBadRequest)
		return
	}
	dir, err := os.MkdirTemp("", "export")
	if err != nil {
		http.Error(w, "The export could not be prepared: "+err.Error(), http.StatusInternalServerError)
		return
	}
	defer os.RemoveAll(dir)
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	var n int64
	if err == nil {
		n, err = io.Copy(f, r.Body)
		if cerr := f.Close(); err == nil {
			err = cerr
		}
	}
	if err != nil {
		http.Error(w, "The export could not be prepared: "+err.Error(), http.StatusInternalServerError)
		return
	}
	if n == 0 { // an export is never empty: a body lost on the way, which must not land as an empty file
		http.Error(w, "The export arrived empty, so nothing was saved.", http.StatusBadRequest)
		return
	}
	// The response begins here, ahead of the picker. The type is named, or it would be guessed from a body not
	// written yet.
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	if f, ok := w.(http.Flusher); ok {
		f.Flush()
	}
	saved, err := saveCopy(path, name)
	out := saveOutcome{Saved: saved != ""} // "" when the user canceled
	if err != nil {
		out = saveOutcome{Error: "The file could not be saved: " + err.Error()}
	}
	json.NewEncoder(w).Encode(out)
}

// saveCopy has the user pick where the file goes. Replaced by tests, which have no picker.
var saveCopy = mygo.Dialog.SaveCopy
