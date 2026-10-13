#!/usr/bin/env bash
# Runs `ma-ext test` (popular → search → details → episodes → streams, with the app's checks) against the real
# sites, four at a time, one result line per extension; exits 1 when any failed. Defaults to every extension.
#   scripts/live.sh                      # all
#   scripts/live.sh src/id/anoboy ...    # some
root=$(cd "$(dirname "$0")/.." && pwd)
dirs=("$@")
[ ${#dirs[@]} -eq 0 ] && dirs=("$root"/src/*/*/)
out=$(printf '%s\n' "${dirs[@]}" | xargs -P 4 -I{} bash -c '
  if (cd "{}" && timeout 300 pnpm exec ma-ext test . > /dev/null 2>&1); then echo "ok   $(basename "{}")"; else echo "FAIL $(basename "{}")"; fi')
sort <<< "$out"
! grep -q '^FAIL' <<< "$out"
