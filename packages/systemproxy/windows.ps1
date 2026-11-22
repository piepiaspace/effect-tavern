$ErrorActionPreference = 'Stop'
$url = [uri]$env:TAVERN_PROXY_TARGET
$p = [Net.WebRequest]::GetSystemWebProxy()
if (!$p.IsBypassed($url)) { $p.GetProxy($url).AbsoluteUri }
