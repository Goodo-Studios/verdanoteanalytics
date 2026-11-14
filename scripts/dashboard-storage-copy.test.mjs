import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(here, 'dashboard-storage-copy.mjs'), 'utf8');

test('old dashboard calls are sign in, list and download only', () => {
  const calls = [...src.matchAll(/`\$\{(?:SRC|base)\}(\/[^`]+)`/g)].map((m) => m[1]);
  assert.ok(calls.some((c) => c.includes('/object/list/')) && calls.some((c) => c.includes('/object/authenticated/')));
  for (const c of calls) assert.match(c, /^\/(auth\/v1\/token|storage\/v1\/object\/(list|authenticated)\/)/, c);
  assert.ok(!/srcFetch\([^)]*method:\s*'(PUT|DELETE|PATCH)'/.test(src));
});

test('writes go to the staging URL only', () => {
  for (const m of src.matchAll(/fetch\(`\$\{DST\}[^`]*`,\s*\{\s*method: '(\w+)'/g)) assert.equal(m[1], 'POST');
  assert.ok(!/\$\{SRC\}[^`]*`,\s*\{\s*method: '(PUT|DELETE)'/.test(src));
});

test('refuses to run without the confirmation flag and covers the 13 buckets', () => {
  assert.match(src, /--confirm-source/);
  const list = src.match(/const BUCKETS = \[([\s\S]*?)\];/)[1];
  assert.equal([...list.matchAll(/'([a-z-]+)'/g)].length, 13);
  assert.match(list, /moodboard-refs/);
});

test('every bucket the script copies has a migration', () => {
  const migrations = fs.readdirSync(path.join(here, '../supabase/migrations')).filter((f) => f.endsWith('.sql'))
    .map((f) => fs.readFileSync(path.join(here, '../supabase/migrations', f), 'utf8')).join('\n');
  const list = src.match(/const BUCKETS = \[([\s\S]*?)\];/)[1];
  for (const m of list.matchAll(/'([a-z-]+)'/g)) assert.ok(migrations.includes(`values ('${m[1]}', '${m[1]}'`), m[1]);
});
