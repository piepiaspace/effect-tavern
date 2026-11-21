//go:build e2e

// Test builds only (go build -tags e2e): another process drives the app through MYGO_AUTOMATION.
package main

import _ "github.com/egoist/mygo/plugins/automation"
