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
  backfill-daily-history
  backfill-destination-key
  backfill-launch-dates
  backfill-play-curves
  backfill-post-urls
  backfill-retag
  creative-rotation
  cache-creative-image
  cleanup-stuck-media
  cleanup-stuck-syncs
  clear-media-cache
  client-insights
  drain-media-queue
  competitor-ads
  create-coda-brief
  creatives
  enrich-thumbnails
  fetch-thumbnail
  ingest-reviews
  landing-pages
  leaderboard
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
  sync-coda-names
  system-health-check
  transcribe-ad
  user-management
  vault-ads
  vault-analyze
  vault-embed
  vault-extract
  vault-extract-webhook
  vault-frame-analyze
  vault-save
  vault-save-creative
  vault-search
  vault-share-item
  vault-slack-connect
  vault-slack-events
  vault-slack-import
  vault-status
  vault-transcribe
  webhooks-dispatch
  write-brief
)

TOTAL=${#FUNCTIONS[@]}
PASSED=0
FAILED=0
FAILED_NAMES=()

echo "Deploying $TOTAL edge functions..."
echo ""

DEPLOY_ARGS=()
if [[ -n "${SUPABASE_PROJECT_ID:-}" ]]; then
  DEPLOY_ARGS=(--project-ref "$SUPABASE_PROJECT_ID")
fi

for fn in "${FUNCTIONS[@]}"; do
  if supabase functions deploy "$fn" "${DEPLOY_ARGS[@]+"${DEPLOY_ARGS[@]}"}" 2>&1; then
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
