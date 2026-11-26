#!/usr/bin/env sh
# Offline card verification loop: check → optional scenario test → optional view HTML preview.
# Usage:
#   skills/card-author/scripts/verify-card.sh <card.yaml> [scenario.yaml] [preview.html]
set -eu

if [ $# -lt 1 ]; then
  echo "Usage: $0 <card.yaml> [scenario.yaml] [preview.html]" >&2
  exit 2
fi

card="$1"
scenario="${2:-}"
html="${3:-}"

echo "==> card check: $card"
bun run tavern card check "$card"

if [ -n "$scenario" ]; then
  echo "==> card test: $card ($scenario)"
  bun run tavern card test "$card" "$scenario"
fi

if [ -n "$html" ]; then
  echo "==> card view --views: $html"
  if [ -n "$scenario" ]; then
    bun run tavern card view "$card" --views --scenario "$scenario" --html "$html"
  else
    bun run tavern card view "$card" --views --html "$html"
  fi
fi
