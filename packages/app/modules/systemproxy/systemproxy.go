// Package systemproxy reads the mobile OS proxy for an outbound URL.
package systemproxy

//mygo:native
type Resolver interface {
	Proxy(address string) (string, error)
}
