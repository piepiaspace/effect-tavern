import CFNetwork
import Foundation

func makeResolver() -> any Resolver { SystemResolver() }

private final class SystemResolver: Resolver {
    func proxy(address: String) throws -> String {
        guard let url = URL(string: address),
              let settings = CFNetworkCopySystemProxySettings()?.takeRetainedValue(),
              let entries = CFNetworkCopyProxiesForURL(url as CFURL, settings).takeRetainedValue() as? [[String: Any]],
              let first = entries.first,
              let type = first[kCFProxyTypeKey as String] as? String,
              type != kCFProxyTypeNone as String else { return "" }
        guard let host = first[kCFProxyHostNameKey as String] as? String else {
            return "pac"
        }
        var proxy = URLComponents()
        proxy.scheme = type == kCFProxyTypeSOCKS as String ? "socks5" : "http"
        proxy.host = host
        proxy.port = first[kCFProxyPortNumberKey as String] as? Int
        proxy.user = first[kCFProxyUsernameKey as String] as? String
        proxy.password = first[kCFProxyPasswordKey as String] as? String
        return proxy.string ?? ""
    }
}
