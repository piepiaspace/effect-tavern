// The library: SQLite on a file in the app's user data directory, one connection for the app's life, so the page's
// begin and commit land on it in order. The page reaches it through web/sqlite.ts, one synchronous request per
// statement to /__db, which keeps the server's data.ts synchronous.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"

	"github.com/egoist/mygo"
	_ "modernc.org/sqlite"
)

type dbCall struct {
	SQL    string `json:"sql"`
	Params []any  `json:"params"`
	Mode   string `json:"mode"` // exec | run | rows
}

var (
	dbMu   sync.Mutex
	db     *sql.DB
	dbConn *sql.Conn
)

func openDB() {
	path := os.Getenv("TAVERN_DB") // tests: a library of their own
	if path == "" {
		dir, err := mygo.App.Path(mygo.PathUserData)
		if err != nil {
			log.Fatal(err)
		}
		path = filepath.Join(dir, "tavern.db")
	}
	var err error
	if db, err = sql.Open("sqlite", path); err != nil {
		log.Fatal(err)
	}
	db.SetMaxOpenConns(1)
	if dbConn, err = db.Conn(context.Background()); err != nil {
		log.Fatal(err)
	}
}

// closeDB on quit: the last connection's close checkpoints the WAL into the file.
func closeDB() {
	dbMu.Lock()
	defer dbMu.Unlock()
	dbConn.Close()
	db.Close()
}

// param: JSON numbers as SQLite would take them from bun:sqlite, integers as integers.
func param(v any) any {
	n, ok := v.(json.Number)
	if !ok {
		return v
	}
	if i, err := n.Int64(); err == nil {
		return i
	}
	f, _ := n.Float64()
	return f
}

func serveDB(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	fail := func(status int, err error) {
		w.WriteHeader(status)
		json.NewEncoder(w).Encode(map[string]string{"error": err.Error()})
	}
	var c dbCall
	dec := json.NewDecoder(r.Body)
	dec.UseNumber()
	if err := dec.Decode(&c); err != nil {
		fail(http.StatusBadRequest, err)
		return
	}
	for i, p := range c.Params {
		c.Params[i] = param(p)
	}
	dbMu.Lock()
	defer dbMu.Unlock()
	ctx := context.Background()
	switch c.Mode {
	case "exec", "run":
		res, err := dbConn.ExecContext(ctx, c.SQL, c.Params...)
		if err != nil {
			fail(http.StatusUnprocessableEntity, err)
			return
		}
		n, _ := res.RowsAffected()
		id, _ := res.LastInsertId()
		json.NewEncoder(w).Encode(map[string]int64{"changes": n, "lastInsertRowid": id})
	case "rows":
		rows, err := dbConn.QueryContext(ctx, c.SQL, c.Params...)
		if err != nil {
			fail(http.StatusUnprocessableEntity, err)
			return
		}
		defer rows.Close()
		cols, _ := rows.Columns()
		out := [][]any{}
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				fail(http.StatusUnprocessableEntity, err)
				return
			}
			for i, v := range vals {
				if b, ok := v.([]byte); ok {
					vals[i] = string(b)
				}
			}
			out = append(out, vals)
		}
		if err := rows.Err(); err != nil {
			fail(http.StatusUnprocessableEntity, err)
			return
		}
		json.NewEncoder(w).Encode(map[string]any{"columns": cols, "rows": out})
	default:
		fail(http.StatusBadRequest, errors.New("mode: exec, run or rows"))
	}
}
