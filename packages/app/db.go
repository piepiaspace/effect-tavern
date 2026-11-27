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

type dbStep struct {
	SQL    string `json:"sql"`
	Params []any  `json:"params"`
	Mode   string `json:"mode"` // exec | run | rows
}

type dbCall struct {
	dbStep
	Steps []dbStep `json:"steps"`
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
	if dbConn != nil {
		dbConn.Close()
		dbConn = nil
	}
	if db != nil {
		db.Close()
		db = nil
	}
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
	dbMu.Lock()
	defer dbMu.Unlock()
	ctx := context.Background()
	var result any
	var err error
	if c.Mode == "batch" {
		var results []any
		results, err = dbBatch(ctx, c.Steps)
		result = map[string]any{"results": results}
	} else {
		result, err = dbSingle(ctx, c.dbStep)
	}
	if err != nil {
		status := http.StatusUnprocessableEntity
		if errors.Is(err, errDBMode) {
			status = http.StatusBadRequest
		}
		fail(status, err)
		return
	}
	json.NewEncoder(w).Encode(result)
}

var errDBMode = errors.New("unknown database operation")

func dbBatch(ctx context.Context, steps []dbStep) ([]any, error) {
	if _, err := dbConn.ExecContext(ctx, "begin immediate"); err != nil {
		return nil, err
	}
	committed := false
	defer func() {
		if !committed {
			dbConn.ExecContext(ctx, "rollback")
		}
	}()
	results := make([]any, 0, len(steps))
	for _, step := range steps {
		result, err := dbSingle(ctx, step)
		if err != nil {
			return nil, err
		}
		results = append(results, result)
	}
	if _, err := dbConn.ExecContext(ctx, "commit"); err != nil {
		return nil, err
	}
	committed = true
	return results, nil
}

func dbSingle(ctx context.Context, c dbStep) (any, error) {
	for i, p := range c.Params {
		c.Params[i] = param(p)
	}
	switch c.Mode {
	case "exec", "run":
		res, err := dbConn.ExecContext(ctx, c.SQL, c.Params...)
		if err != nil {
			return nil, err
		}
		n, _ := res.RowsAffected()
		id, _ := res.LastInsertId()
		return map[string]int64{"changes": n, "lastInsertRowid": id}, nil
	case "rows":
		rows, err := dbConn.QueryContext(ctx, c.SQL, c.Params...)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		cols, err := rows.Columns()
		if err != nil {
			return nil, err
		}
		out := [][]any{}
		for rows.Next() {
			vals := make([]any, len(cols))
			ptrs := make([]any, len(cols))
			for i := range vals {
				ptrs[i] = &vals[i]
			}
			if err := rows.Scan(ptrs...); err != nil {
				return nil, err
			}
			for i, v := range vals {
				if b, ok := v.([]byte); ok {
					vals[i] = string(b)
				}
			}
			out = append(out, vals)
		}
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return map[string]any{"columns": cols, "rows": out}, nil
	default:
		return nil, errDBMode
	}
}
