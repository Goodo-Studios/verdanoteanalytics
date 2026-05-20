#!/usr/bin/env bash
# Deploy all Supabase edge functions.
# Run this after ANY change to supabase/functions/_shared/ — every function
# that imports a shared file must be redeployed to pick up the new snapshot.

set -euo pipefail

cd "$(dirname "$0")/.."

FUNCTIONS=(
  accounts
  ai-chat
  api
  api-auth
  backfill-post-urls
  cleanup-stuck-media
  cleanup-stuck-syncs
  clear-media-cache
  client-insights
  competitor-ads
  create-coda-brief
  creatives
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
  settings
  spend-diagnostic
  sync
  sync-coda-tasks
  system-health-check
  transcribe-ad
  user-management
  webhooks-dispatch
)

TOTAL=${#FUNCTIONS[@]}
PASSED=0
FAILED=0
FAILED_NAMES=()

echo "Deploying $TOTAL edge functions..."
echo ""

for fn in "${FUNCTIONS[@]}"; do
  if supabase functions deploy "$fn" 2>&1; then
    echo "✓ $fn"
    ((PASSED++)) || true
  else
    echo "✗ $fn FAILED"
    ((FAILED++)) || true
    FAILED_NAMES+=("$fn")
  fi
done

echo ""
echo "─────────────────────────────────────"
echo "Results: $PASSED/$TOTAL deployed"

if [[ $FAILED -gt 0 ]]; then
  echo "Failed: ${FAILED_NAMES[*]}"
  exit 1
fi

echo "All functions deployed successfully."
