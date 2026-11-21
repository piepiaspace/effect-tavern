// Exports: the page cannot download in a web view (phones' have nowhere to put a file), so it posts the file here
// (web/entry.ts, tavernHost.save) and the user picks where it goes: the save dialog on desktops, Files on iOS, the
// storage access framework on Android.
package main

import (
	"io"
	"net/http"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
)

func serveSave(w http.ResponseWriter, r *http.Request) {
	name := filepath.Base(r.URL.Query().Get("name"))
	if name == "." || name == "/" {
		http.Error(w, "name", http.StatusBadRequest)
		return
	}
	dir, err := os.MkdirTemp("", "export")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
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
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if n == 0 { // an export is never empty: a body lost on the way, which must not land as an empty file
		http.Error(w, "empty body", http.StatusBadRequest)
		return
	}
	saved, err := mygo.Dialog.SaveCopy(path, name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	io.WriteString(w, saved) // "" when the user canceled
}
