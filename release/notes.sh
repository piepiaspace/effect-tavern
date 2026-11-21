#!/bin/sh
# The release's notes: the feat/fix/perf subjects since the tag before $1 (a commit or tag), one "- " line each.
# release.txt and its GitHub release, and the app's update window (its CHANGELOG.md section), read the same list.
set -e
prev=$(git describe --tags --abbrev=0 "$1^" 2>/dev/null || true)
git log --no-merges --format='- %s' ${prev:+"$prev.."}"$1" | grep -E '^- (feat|fix|perf)' || echo '- (no user-facing changes)'
