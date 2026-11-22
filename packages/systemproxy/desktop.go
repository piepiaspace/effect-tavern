// Package systemproxy queries desktop settings independently of proxy environment variables.
package systemproxy

import (
	"context"
	_ "embed"
	"fmt"
	"net/url"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"
)

//go:embed macos.jxa
var mac string

//go:embed windows.ps1
var windows string

func Lookup(ctx context.Context, target *url.URL) (*url.URL, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.CommandContext(ctx, "/usr/bin/osascript", "-l", "JavaScript", "-e", mac, target.String())
	case "windows":
		cmd = exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive", "-Command", windows)
		cmd.Env = append(os.Environ(), "TAVERN_PROXY_TARGET="+target.String())
	case "linux":
		cmd = exec.CommandContext(ctx, "gdbus", "call", "--session", "--dest", "org.freedesktop.portal.Desktop", "--object-path", "/org/freedesktop/portal/desktop", "--method", "org.freedesktop.portal.ProxyResolver.Lookup", target.String())
	default:
		return nil, nil
	}
	out, err := cmd.Output()
	if err != nil {
		return nil, nil
	}
	raw := strings.TrimSpace(string(out))
	if runtime.GOOS == "linux" {
		// gdbus prints a GVariant tuple containing an ordered array of URIs.
		_, rest, ok := strings.Cut(raw, "'")
		if !ok {
			return nil, fmt.Errorf("system proxy resolver returned no route")
		}
		raw, _, _ = strings.Cut(rest, "'")
	}
	if raw == "" || raw == "direct://" {
		return nil, nil
	}
	if raw == "pac" {
		return nil, fmt.Errorf("automatic proxy settings require a manual proxy address in Tavern")
	}
	return url.Parse(raw)
}
