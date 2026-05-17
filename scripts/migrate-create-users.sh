#!/usr/bin/env bash
# Creates all 14 users in the new Supabase project, preserving original UUIDs.
# Users will need to reset passwords via "Forgot Password" — hashes cannot be migrated.
# Run with: SUPABASE_SERVICE_ROLE_KEY=<key> bash scripts/migrate-create-users.sh
set -euo pipefail

NEW_PROJECT_URL="https://gwyxaqoaldnaavkjqquv.supabase.co"
ADMIN_API="${NEW_PROJECT_URL}/auth/v1/admin/users"
KEY="${SUPABASE_SERVICE_ROLE_KEY:?Set SUPABASE_SERVICE_ROLE_KEY env var}"

create_user() {
  local id="$1"
  local email="$2"
  echo "Creating $email ($id)..."
  response=$(curl -s -w "\n%{http_code}" -X POST "$ADMIN_API" \
    -H "Authorization: Bearer $KEY" \
    -H "apikey: $KEY" \
    -H "Content-Type: application/json" \
    -d "{
      \"id\": \"$id\",
      \"email\": \"$email\",
      \"email_confirm\": true,
      \"user_metadata\": {}
    }")
  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$ d')
  if [[ "$http_code" == "200" || "$http_code" == "201" ]]; then
    echo "  ✓ Created"
  elif echo "$body" | grep -q "already been registered"; then
    echo "  ✓ Already exists"
  else
    echo "  ✗ Failed (HTTP $http_code): $body"
  fi
}

echo "=== Creating 14 users in new Supabase project ==="
echo ""

create_user "83b04526-3ebc-4127-971e-e33ba67df954" "matthew@goodostudios.com"
create_user "afffe342-258a-4b82-a291-c71a8672c034" "sadie@goodostudios.com"
create_user "97feabd5-65e5-4cd3-8211-277761a94b1a" "amandagordon@goodostudios.com"
create_user "c4a73c17-b4d6-462f-b5fa-1ab907660b9a" "denzel.adame.0315@gmail.com"
create_user "dac05807-cf0b-4087-9a24-67e7d66bf643" "rendyabipratama@gmail.com"
create_user "a5eca8a3-2eb8-4ebf-b8e4-8567275cad71" "adrian@goodostudios.com"
create_user "3992ccc5-36c2-40a2-bc82-b7cdfb0c8040" "jenmahoney@goodostudios.com"
create_user "fec999d0-9878-4fc1-9383-1e0b70cf43d6" "damian@goodostudios.com"
create_user "6af6e1a5-5cd3-492a-81fd-de30e027fd8a" "chloe@goodostudios.com"
create_user "c8d440d7-f5f6-46bd-a0d9-0c89c3a71a1a" "ricky@goodostudios.com"
create_user "ad07d1fb-ab2e-461c-83ab-e328cd5004cc" "pawelliberda14@gmail.com"
create_user "63756742-d2a3-47bb-b316-0339ac9a5376" "rachelmatulle@goodostudios.com"
create_user "c7812770-ad0c-443f-ac63-128970575c36" "francoisranola15@gmail.com"
create_user "91e3051f-1e80-47fe-aa45-53f55024b38e" "sabina@goodostudios.com"

echo ""
echo "=== Done. Users must reset passwords via 'Forgot Password' ==="
