# Install the released tavern binary on Windows, in %LOCALAPPDATA%\Programs\tavern, and put it on the user's PATH.
#   irm https://github.com/waylon256yhw/effect-tavern/releases/latest/download/install.ps1 | iex
# Start it with tavern start. The same release contract as install.sh: release.txt's first line is the tag, the
# binary is <asset>.gz beside it (names from release/targets.ts); TAVERN_MIRROR replaces the download directory.
# English only: Windows PowerShell 5.1 reads a script piped from irm as Latin-1, so Chinese words would arrive garbled
# (ponytail: carry them as UTF-8 bytes decoded here if Chinese is wanted).
# Run through iex, `exit` would close the person's own window: a failure throws to the one catch at the end instead.
$Repo = "waylon256yhw/effect-tavern"

function Fail($what, $why, $next) {
  Write-Host "x $what" -ForegroundColor Red
  Write-Host "  $why"
  Write-Host "  > $next"
  throw "tavern-install-failed"
}

function Install-Tavern {
  $ErrorActionPreference = "Stop"
  $ProgressPreference = "SilentlyContinue"

  # The machine's own architecture, not this PowerShell's: an x64 shell emulated on ARM64 still gets the ARM64 build.
  $arch = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment").PROCESSOR_ARCHITECTURE
  $asset = switch ($arch) {
    "ARM64" { "tavern-windows-arm64.exe" }
    "AMD64" { "tavern-windows-x64.exe" }
    default {
      Fail "No ready-made tavern for this computer" `
        "Windows builds are 64-bit only; this is $arch." `
        "run it from source, see $Repo on GitHub"
    }
  }

  $mirror = if ($env:TAVERN_MIRROR) { $env:TAVERN_MIRROR } elseif ($env:TAVERN_URL) { $env:TAVERN_URL } else { "" }
  $base = if ($mirror) { $mirror.TrimEnd("/") } else { "https://github.com/$Repo/releases/latest/download" }
  try {
    $notes = (Invoke-WebRequest -UseBasicParsing "$base/release.txt").Content
  } catch {
    Fail "Could not read the latest release" "No network, or GitHub cannot be reached." `
      "check the network and run it again"
  }
  if ($notes -is [byte[]]) { $notes = [Text.Encoding]::UTF8.GetString($notes) }
  $tag = ($notes -split "\r?\n")[0].Trim()
  if ($tag -notmatch "^v?\d+\.\d+[A-Za-z0-9._-]*$") {
    Fail "Could not read the latest release" "The first line of release.txt is not a tag." `
      "check the network and run it again"
  }
  $version = $tag -replace "^v", ""
  if (-not $mirror) { $base = "https://github.com/$Repo/releases/download/$tag" }

  $dir = Join-Path $env:LOCALAPPDATA "Programs\tavern"
  $bin = Join-Path $dir "tavern.exe"
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $part = Join-Path $dir ".tavern-$PID.exe"
  $gz = "$part.gz"
  Write-Host "Installing Effect Tavern $tag"
  Write-Host "  downloading  $asset.gz"
  try {
    Invoke-WebRequest -UseBasicParsing "$base/$asset.gz" -OutFile $gz
    $in = [IO.File]::OpenRead($gz)
    $out = [IO.File]::Create($part)
    try {
      $unzip = New-Object IO.Compression.GZipStream($in, [IO.Compression.CompressionMode]::Decompress)
      $unzip.CopyTo($out)
    } finally {
      $out.Dispose()
      $in.Dispose()
    }
    Remove-Item $gz -Force
    $got = (& $part --version 2>$null | Select-Object -First 1)
  } catch {
    Remove-Item $gz, $part -Force -ErrorAction SilentlyContinue
    Fail "Could not download $asset.gz" "No network, or this release lacks the file." `
      "check the network and run it again"
  }
  if ($got -ne "tavern $version") {
    Remove-Item $part -Force -ErrorAction SilentlyContinue
    Fail "The downloaded program does not run" "It answered '$got', not tavern $version." `
      "run it again; if it fails again, send these lines to whoever helps you"
  }

  # a tavern still running keeps its .exe from being replaced, not from being renamed
  Remove-Item "$bin.old" -Force -ErrorAction SilentlyContinue
  if (Test-Path $bin) { Rename-Item $bin "tavern.exe.old" }
  Move-Item $part $bin

  $path = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($path -split ";") -contains $dir)) {
    [Environment]::SetEnvironmentVariable("Path", (@($path, $dir) | Where-Object { $_ }) -join ";", "User")
    $env:Path = "$env:Path;$dir"
  }

  Write-Host "+ Installed tavern $version" -ForegroundColor Green
  Write-Host "  where   $dir"
  Write-Host "  start   tavern start"
  Write-Host "  update  tavern update"
  Write-Host "  A new terminal is needed before tavern is found by name."
}

try {
  Install-Tavern
} catch {
  if ("$_" -ne "tavern-install-failed") { Write-Host "x $_" -ForegroundColor Red }
}
