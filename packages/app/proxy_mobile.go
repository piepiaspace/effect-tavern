//go:build ios || android

package main

import (
	"errors"
	"net/http"
	"net/url"

	"github.com/piepiaspace/effect-tavern/packages/app/modules/systemproxy"
)

func init() {
	systemProxy = func(r *http.Request) (*url.URL, error) {
		resolver, err := systemproxy.NewResolver()
		if err != nil {
			return nil, nil
		}
		address, err := resolver.Proxy(r.URL.String())
		if err != nil || address == "" {
			return nil, nil
		}
		if address == "pac" {
			return nil, errors.New("automatic proxy settings require a manual proxy address in Tavern")
		}
		return url.Parse(address)
	}
	osOnlyProxy = systemProxy
}
