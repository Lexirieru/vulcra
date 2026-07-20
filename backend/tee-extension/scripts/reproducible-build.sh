#!/usr/bin/env bash
#
# reproducible-build.sh — build the Vulcra TEE extension binary reproducibly and
# print its SHA-256. Go compiles bit-for-bit reproducibly (single static
# binary), so the same source + SOURCE_DATE_EPOCH yields the same code hash on
# any machine — the hash you whitelist on-chain (Bounty 2 attestation story).
#
# Usage:
#   ./scripts/reproducible-build.sh                 # epoch from last git commit
#   SOURCE_DATE_EPOCH=1700000000 ./scripts/reproducible-build.sh   # pin explicitly
#
# NOTE: building requires the fce-extension-scaffold framework to be vendored
# (see go.mod). The pure decision packages build offline on their own:
#   go build ./internal/keeper/... ./internal/guardian/... ./internal/config/... ./pkg/...
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

# Deterministic timestamp: last commit time unless the caller pinned one.
if [[ -z "${SOURCE_DATE_EPOCH:-}" ]]; then
  if git -C "$ROOT" rev-parse --git-dir >/dev/null 2>&1; then
    SOURCE_DATE_EPOCH="$(git -C "$ROOT" log -1 --format=%ct)"
  else
    SOURCE_DATE_EPOCH=0
  fi
fi
export SOURCE_DATE_EPOCH
echo "SOURCE_DATE_EPOCH=$SOURCE_DATE_EPOCH ($(date -u -r "$SOURCE_DATE_EPOCH" '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo n/a))"

OUT="${OUT:-build/vulcra-extension}"
mkdir -p "$(dirname "$OUT")"

# Reproducibility flags:
#   CGO_ENABLED=0        static binary, no libc linkage
#   -trimpath            strip absolute filesystem paths from the binary
#   -buildvcs=false      do not embed VCS state (would vary by checkout)
#   -ldflags "-s -w      strip symbol/debug tables
#             -buildid=" clear the build id (otherwise non-deterministic)
CGO_ENABLED=0 GOFLAGS="-trimpath -buildvcs=false" \
  go build -ldflags="-s -w -buildid=" -o "$OUT" ./cmd/extension

echo "built: $OUT"
if command -v sha256sum >/dev/null 2>&1; then
  sha256sum "$OUT"
else
  shasum -a 256 "$OUT"
fi
