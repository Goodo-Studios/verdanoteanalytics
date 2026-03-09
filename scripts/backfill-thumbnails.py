#!/usr/bin/env python3
"""
Verdanote Thumbnail Backfill v3
Two-phase approach:
Phase 1: Fix DB rows for all creatives that already have storage files
Phase 2: Fetch thumbnails for high-spend creatives missing from storage
"""

import requests, json, time, sys, os
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime

SUPABASE_URL = "https://vjjlulifovsdjwphmdsh.supabase.co"
ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZqamx1bGlmb3ZzZGp3cGhtZHNoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA4NTk0NTksImV4cCI6MjA4NjQzNTQ1OX0.z-tGPzV6p0IT2JpbQmz0ScNKqwOXj8jmFNOPC0kClpc"
SADIE_KEY = "sk-sadie-verdanote-7c791bf1dcc73bc624f116336e766356"
FUNCTIONS_BASE = f"{SUPABASE_URL}/functions/v1"
STORAGE_BASE = f"{SUPABASE_URL}/storage/v1"
BUCKET = "ad-thumbnails"
PUBLIC_STORAGE = f"{SUPABASE_URL}/storage/v1/object/public/{BUCKET}"
AUTH = {"Authorization": f"Bearer {ANON_KEY}", "Content-Type": "application/json"}
SADIE = {"x-sadie-key": SADIE_KEY}

ACCOUNTS = [
    ("act_1760345574189340", "Pela Case", 22876),
    ("act_44401754", "Natural Dog Company", 18200),
    ("act_2223094124606317", "Bearaby", 12118),
    ("act_627417354604174", "Sans", 9761),
    ("act_353135616606292", "Everdries", 9667),
    ("act_2654200224627315", "RoYo Bread", 3766),
    ("act_138695479815833", "Galileo Camps", 3081),
    ("act_225473758572595", "Reactive Outdoor", 895),
    ("act_140771744794413", "HAIRLOVE", 326),
    ("act_1058298398102027", "Cane Masters", 208),
    ("act_1502951667585392", "vyv nutrition", 132),
    ("act_26608804", "Sewing Parts Online", 113),
    ("act_740559457651983", "Small Wonder", 49),
    ("act_782159176742035", "Goodo Studios", 9),
]

def get_storage_files(account_id):
    """Return dict of {ad_id: filename} for all files in storage."""
    files = {}
    offset = 0
    while True:
        r = requests.post(f"{STORAGE_BASE}/object/list/{BUCKET}",
            headers=AUTH, json={"prefix": account_id, "limit": 1000, "offset": offset}, timeout=30)
        if r.status_code != 200: break
        items = r.json()
        if not items: break
        for item in items:
            name = item.get("name", "")
            if "." in name:
                files[name.split(".")[0]] = name
        if len(items) < 1000: break
        offset += 1000
    return files

def get_creatives_by_spend(account_id, limit=2000):
    """Get creative IDs sorted by spend from sadie-read."""
    r = requests.get(f"{FUNCTIONS_BASE}/sadie-read/creatives",
        headers=SADIE,
        params={"account_id": account_id, "limit": limit, "order_by": "spend"},
        timeout=30)
    if r.status_code != 200: return []
    data = r.json()
    creatives = data.get("creatives", data if isinstance(data, list) else [])
    return [str(c["ad_id"]) for c in creatives if c.get("ad_id")]

def fetch_thumb(ad_id, account_id, thumbnail_url=None, retries=2):
    """Call fetch-thumbnail for one creative. Returns (status, url)."""
    body = {"ad_id": str(ad_id), "account_id": account_id}
    if thumbnail_url: body["thumbnail_url"] = thumbnail_url
    for attempt in range(retries + 1):
        try:
            r = requests.post(f"{FUNCTIONS_BASE}/fetch-thumbnail",
                headers=AUTH, json=body, timeout=50)
            if r.status_code == 200:
                d = r.json()
                return d.get("status", "unknown"), d.get("public_url") or d.get("cdn_url") or ""
            elif r.status_code == 429:
                print(f"  Rate limited, sleeping 30s...")
                time.sleep(30)
            elif r.status_code >= 500:
                time.sleep(2)
            else:
                return f"error_{r.status_code}", r.text[:80]
        except requests.exceptions.Timeout:
            if attempt < retries: time.sleep(2)
            else: return "timeout", ""
        except Exception as e:
            if attempt < retries: time.sleep(1)
            else: return "exception", str(e)[:80]
    return "failed", ""

def parallel_fetch(items, workers=12, batch_size=24, sleep_between=0.2):
    """Process list of (ad_id, account_id, optional_url) tuples in parallel."""
    results = {"cached": 0, "cdn_only": 0, "no_image_found": 0, "errors": 0}
    for i in range(0, len(items), batch_size):
        batch = items[i:i+batch_size]
        with ThreadPoolExecutor(max_workers=workers) as ex:
            futs = {}
            for item in batch:
                if len(item) == 3:
                    ad_id, acct_id, url = item
                else:
                    ad_id, acct_id = item; url = None
                futs[ex.submit(fetch_thumb, ad_id, acct_id, url)] = ad_id
            for fut in as_completed(futs):
                try:
                    status, _ = fut.result()
                    if status in results: results[status] += 1
                    elif status.startswith("error") or status in ("timeout","exception","failed"):
                        results["errors"] += 1
                    else: results["errors"] += 1
                except Exception: results["errors"] += 1
        if sleep_between: time.sleep(sleep_between)
        if (i + batch_size) % 200 == 0:
            total = sum(results.values())
            print(f"    {i+batch_size}/{len(items)} | cached:{results['cached']} cdn:{results['cdn_only']} no_img:{results['no_image_found']} err:{results['errors']}")
    return results

def process_account(account_id, name, expected):
    t0 = time.time()
    print(f"\n{'='*60}")
    print(f"[{datetime.now():%H:%M:%S}] {name} ({account_id}) -- expected: {expected}")

    stats = {"account": name, "expected": expected,
             "storage_before": 0, "storage_after": 0,
             "phase1_db_fixes": 0, "phase2_new_finds": 0,
             "phase2_no_image": 0, "errors": 0, "duration_s": 0}

    # ---- Phase 1: Fix DB rows for all existing storage files ----
    storage = get_storage_files(account_id)
    stats["storage_before"] = len(storage)
    print(f"  [Phase 1] Storage files: {len(storage)}")

    if storage:
        print(f"  [Phase 1] Updating DB rows for {len(storage)} storage files...")
        items = [(ad_id, account_id, f"{PUBLIC_STORAGE}/{account_id}/{fname}")
                 for ad_id, fname in storage.items()]
        r1 = parallel_fetch(items, workers=15, batch_size=30, sleep_between=0.1)
        stats["phase1_db_fixes"] = r1["cached"] + r1["cdn_only"]
        stats["errors"] += r1["errors"]
        print(f"  [Phase 1] Done: {r1}")

    # ---- Phase 2: Fetch thumbnails for high-spend creatives missing from storage ----
    print(f"  [Phase 2] Getting creative list from sadie-read...")
    creative_ids = get_creatives_by_spend(account_id, limit=2000)
    print(f"  [Phase 2] Got {len(creative_ids)} creative IDs (impressions>0)")

    missing_from_storage = [cid for cid in creative_ids if cid not in storage]
    print(f"  [Phase 2] Missing from storage: {len(missing_from_storage)}")

    if missing_from_storage:
        print(f"  [Phase 2] Fetching {len(missing_from_storage)} thumbnails from Meta API...")
        items2 = [(ad_id, account_id) for ad_id in missing_from_storage]
        r2 = parallel_fetch(items2, workers=8, batch_size=16, sleep_between=1.0)
        stats["phase2_new_finds"] = r2["cached"] + r2["cdn_only"]
        stats["phase2_no_image"] = r2["no_image_found"]
        stats["errors"] += r2["errors"]
        print(f"  [Phase 2] Done: {r2}")

    # ---- Final storage count ----
    final_storage = get_storage_files(account_id)
    stats["storage_after"] = len(final_storage)
    stats["duration_s"] = int(time.time() - t0)

    print(f"\n  RESULT {name}: storage {stats['storage_before']} -> {stats['storage_after']} "
          f"(+{stats['storage_after'] - stats['storage_before']}) | "
          f"DB fixes: {stats['phase1_db_fixes']} | "
          f"New: {stats['phase2_new_finds']} | "
          f"No image: {stats['phase2_no_image']} | "
          f"Errors: {stats['errors']} | "
          f"{stats['duration_s']}s")
    return stats

def main():
    print(f"Verdanote Backfill v3 -- {datetime.now():%Y-%m-%d %H:%M:%S}")
    all_stats = []
    for account_id, name, expected in ACCOUNTS:
        try:
            s = process_account(account_id, name, expected)
            all_stats.append(s)
        except Exception as e:
            print(f"  FATAL ERROR for {name}: {e}")
            all_stats.append({"account": name, "expected": expected,
                "storage_before": 0, "storage_after": 0,
                "phase1_db_fixes": 0, "phase2_new_finds": 0,
                "phase2_no_image": 0, "errors": 1, "duration_s": 0})
        time.sleep(3)

    # Write report
    write_report(all_stats)
    print(f"\nDone! Report: /home/matthewgattozzi/.openclaw/workspace/ops/verdanote/2026-03-08-media-backfill-report.md")

def write_report(stats_list):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    total_before = sum(s["storage_before"] for s in stats_list)
    total_after = sum(s["storage_after"] for s in stats_list)
    total_db = sum(s["phase1_db_fixes"] for s in stats_list)
    total_new = sum(s["phase2_new_finds"] for s in stats_list)
    total_no_img = sum(s["phase2_no_image"] for s in stats_list)

    lines = [
        "# Verdanote Media Backfill Report",
        "Date: 2026-03-08",
        f"Completed: {now}",
        "",
        "## Summary",
        f"- Storage files before: {total_before}",
        f"- Storage files after: {total_after}",
        f"- Net new files cached: {total_after - total_before}",
        f"- DB rows updated (storage URL fixed): {total_db}",
        f"- New thumbnails discovered via Meta: {total_new}",
        f"- Creatives with no image available: {total_no_img}",
        "",
        "## Per-Account Results",
        "| Account | Expected | Storage Before | Storage After | DB Fixes | New Finds | No Image |",
        "|---------|----------|----------------|---------------|----------|-----------|----------|",
    ]
    for s in stats_list:
        lines.append(
            f"| {s['account']} | {s['expected']} | {s['storage_before']} | "
            f"{s['storage_after']} | {s['phase1_db_fixes']} | "
            f"{s['phase2_new_finds']} | {s['phase2_no_image']} |"
        )
    lines += [
        "",
        "## Root Cause",
        "- `refresh-thumbnails` edge function had a bug: it queries `last_media_sync` column",
        "  which doesn't exist in the live database (migration 20260307000001 not applied).",
        "- This caused refresh-thumbnails to return 'all_accounts_within_cooldown' every call.",
        "- `enrich-thumbnails` only processes NULL thumbnails -- won't retry no-thumbnail sentinels.",
        "- Previous broken runs set many thumbnails to 'no-thumbnail' sentinel.",
        "",
        "## Fix Applied",
        "- Phase 1: Called fetch-thumbnail for all creatives with existing storage files",
        "  to update DB rows that still said 'no-thumbnail' despite having storage files.",
        "- Phase 2: Called fetch-thumbnail for high-spend creatives missing from storage",
        "  to discover new thumbnails from Meta API.",
        "",
        "## Remaining Work",
        "- Deploy fixed `refresh-thumbnails` (needs Supabase personal access token / DB password)",
        "- Apply migration 20260307000001 to add `last_media_sync` column",
        "- Large accounts still have low-spend creatives not in storage -- need ongoing processing",
        "- Consider running this backfill script weekly via cron until coverage improves",
    ]
    path = "/home/matthewgattozzi/.openclaw/workspace/ops/verdanote/2026-03-08-media-backfill-report.md"
    with open(path, "w") as f:
        f.write("\n".join(lines))
    print(f"\n--- FINAL SUMMARY ---")
    print(f"Storage before: {total_before} -- after: {total_after} -- net: +{total_after-total_before}")
    print(f"DB rows fixed: {total_db} | New thumbnails: {total_new} | No image: {total_no_img}")

if __name__ == "__main__":
    main()
