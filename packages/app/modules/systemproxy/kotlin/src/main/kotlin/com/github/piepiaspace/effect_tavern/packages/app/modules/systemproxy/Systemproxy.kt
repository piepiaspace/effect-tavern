package com.github.piepiaspace.effect_tavern.packages.app.modules.systemproxy

import java.net.InetSocketAddress
import java.net.Proxy
import java.net.ProxySelector
import java.net.URI

fun makeResolver(): Resolver = AndroidResolver()

private class AndroidResolver : Resolver {
    override fun proxy(address: String): String {
        val proxy = ProxySelector.getDefault()?.select(URI(address))?.firstOrNull() ?: return ""
        val socket = proxy.address() as? InetSocketAddress ?: return ""
        val scheme = if (proxy.type() == Proxy.Type.SOCKS) "socks5" else "http"
        return URI(scheme, null, socket.hostString, socket.port, null, null, null).toString()
    }
}
