// The page brought back after the system ended its process. Two facts of phones shape it. iOS ends a web content
// process almost always while the app is in the background, where a load started right then is suspended or dropped:
// so on a phone a process that went while the app was away is remembered, and the page is loaded when the app is in
// front again. And a page that dies as it starts must not be loaded over and over: there is one load in a cooldown,
// a process lost inside it is loaded when the cooldown ends, and after a few such losses in a row the page is left
// as it is until the player comes back to the app.
//
// It acts on one signal only, the web view saying its process is gone. A page that is alive is never judged from
// here: it blocks on its requests to Go by design (web/sqlite.ts), and loading over it would throw away a turn in
// flight.
package main

import (
	"sync"
	"time"

	"github.com/egoist/mygo"
)

// recoveredURL is the page's address on a recovery load. The mark is how the page knows this load replaced a page
// the system ended, and comes back where the player was (web/host.ts, tavernHost.recovered; the client's pages.ts).
const recoveredURL = "/?recovered=1"

// recoveryCooldown is the least time between two recovery loads.
const recoveryCooldown = 10 * time.Second

// recoveryTries is how many loads in a row may each be lost inside its cooldown before no more is tried unasked: a
// page that cannot stay up is not memory running short, and loading it again changes nothing.
const recoveryTries = 3

type recovery struct {
	mu sync.Mutex
	// waits: a phone's app, whose load in the background would be lost. A desktop loads at once, in front or not: its
	// window is on the screen either way.
	waits   bool
	active  bool
	pending bool
	// timed: a try is already set for the end of the cooldown.
	timed bool
	// quick counts the losses in a row that came inside the cooldown of the load before them.
	quick int
	last  time.Time
	now   func() time.Time
	// later runs fn on the main thread after d. Replaced by tests.
	later func(d time.Duration, fn func())
	load  func()
}

func newRecovery(waits bool, load func()) *recovery {
	return &recovery{
		waits:  waits,
		active: true,
		now:    time.Now,
		later:  func(d time.Duration, fn func()) { time.AfterFunc(d, func() { mygo.RunOnMain(fn) }) },
		load:   load,
	}
}

// gone: the web view reported its process ended.
func (r *recovery) gone() {
	r.mu.Lock()
	if !r.pending { // told twice of one loss, it is still one
		if r.last.IsZero() || r.now().Sub(r.last) >= recoveryCooldown {
			r.quick = 0 // the page stayed up: this loss starts the count over
		} else {
			r.quick++
		}
	}
	r.pending = true
	r.mu.Unlock()
	r.try()
}

// activated: the app is in front again (or, where the system tells of no such thing, its window took the keyboard).
// The player coming back is reason to try again, whatever was given up on.
func (r *recovery) activated() {
	r.mu.Lock()
	r.active = true
	r.quick = 0
	r.mu.Unlock()
	r.try()
}

// resigned: the app left the front.
func (r *recovery) resigned() {
	r.mu.Lock()
	r.active = false
	r.mu.Unlock()
}

// try loads the page if one is owed and may be loaded now. Main thread only, as its callers are.
func (r *recovery) try() {
	r.mu.Lock()
	if !r.pending || (r.waits && !r.active) {
		r.mu.Unlock()
		return
	}
	now := r.now()
	if wait := recoveryCooldown - now.Sub(r.last); !r.last.IsZero() && wait > 0 {
		if r.quick < recoveryTries && !r.timed {
			r.timed = true
			r.later(wait, func() {
				r.mu.Lock()
				r.timed = false
				r.mu.Unlock()
				r.try()
			})
		}
		r.mu.Unlock()
		return
	}
	r.pending = false
	r.last = now
	r.mu.Unlock()
	r.load()
}
