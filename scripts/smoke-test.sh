#!/usr/bin/env bash
# Smoke test for Supabase edge functions.
#
# Tests two things per endpoint:
#   1. OPTIONS preflight — must return 200 with CORS headers (no auth needed)
#   2. Unauthenticated GET — must return 401, not a network/CORS error
#
# A TypeError or curl failure = CORS broken or function not deployed.
# A 401 = function is alive and auth is working correctly.
#
# Usage:
#   ./scripts/smoke-test.sh
#   SUPABASE_URL=https://... ./scripts/smoke-test.sh   # override URL

set -uo pipefail

BASE="${SUPABASE_URL:-https://gwyxaqoaldnaavkjqquv.supabase.co}/functions/v1"

PASS=0
FAIL=0

check_cors() {
  local fn="$1"
  local url="$BASE/$fn"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" -X OPTIONS "$url" \
    -H "Origin: https://verdanote.com" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    --max-time 10 2>/dev/null)

  if [[ "$status" == "200" ]]; then
    echo "  ✓ CORS preflight $fn"
    ((PASS++)) || true
  else
    echo "  ✗ CORS preflight $fn — got $status (expected 200)"
    ((FAIL++)) || true
  fi
}

check_auth_gate() {
  local fn="$1"
  local url="$BASE/$fn"
  local status
  status=$(curl -s -o /dev/null -w "%{http_code}" "$url" \
    --max-time 10 2>/dev/null)

  if [[ "$status" == "401" || "$status" == "403" ]]; then
    echo "  ✓ Auth gate $fn — $status"
    ((PASS++)) || true
  else
    echo "  ✗ Auth gate $fn — got $status (expected 401/403)"
    ((FAIL++)) || true
  fi
}

echo "Smoke test — $BASE"
echo ""

# Core read/write endpoints used in the golden path
CORE_FUNCTIONS=(accounts settings creatives)

echo "── Core endpoints (golden path) ──────────────"
for fn in "${CORE_FUNCTIONS[@]}"; do
  check_cors "$fn"
  check_auth_gate "$fn"
done

echo ""
echo "── All other functions ────────────────────────"
OTHER_FUNCTIONS=(
  ai-chat
  api
  # api-auth is a shared library module (no serve() handler) — not an HTTP endpoint
  backfill-post-urls
  cleanup-stuck-media
  cleanup-stuck-syncs
  clear-media-cache
  client-insights
  competitor-ads
  create-coda-brief
  enrich-thumbnails
  fetch-thumbnail
  portfolio
  quick-save
  refresh-thumbnails
  reports
  sadie-read
  scheduled-reports
  scheduled-sync
  scrape-ad
  send-digest
  spend-diagnostic
  sync
  sync-coda-tasks
  system-health-check
  transcribe-ad
  user-management
  webhooks-dispatch
)

for fn in "${OTHER_FUNCTIONS[@]}"; do
  check_cors "$fn"
done

echo ""
echo "─────────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo "SMOKE TEST FAILED — redeploy affected functions and rerun."
  exit 1
fi

echo "All checks passed."
