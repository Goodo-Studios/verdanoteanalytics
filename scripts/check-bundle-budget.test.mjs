import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_BUNDLE_BUDGET,
  collectInitialLoad,
  evaluateBundleBudget,
  findInitialScripts,
  findStaticImports,
  measureBuild,
  resolveImport,
} from "./check-bundle-budget.mjs";

const BUDGET = { maxChunkBytes: 300, maxInitialLoadBytes: 500 };

function initialLoad(files, missing = []) {
  return { files, bytes: files.reduce((sum, file) => sum + file.bytes, 0), missing };
}

test("default budget keeps the 380,000 byte per-chunk cap and has no total cap", () => {
  assert.equal(DEFAULT_BUNDLE_BUDGET.maxChunkBytes, 380_000);
  assert.equal(DEFAULT_BUNDLE_BUDGET.maxInitialLoadBytes, 840_000);
  assert.equal("maxTotalBytes" in DEFAULT_BUNDLE_BUDGET, false);
});

test("budget passes when every chunk and the initial load are within their caps", () => {
  const chunks = [
    { name: "main.js", bytes: 200 },
    { name: "page.js", bytes: 300 },
  ];
  assert.deepEqual(evaluateBundleBudget({ chunks, initialLoad: initialLoad([{ name: "/assets/main.js", bytes: 200 }]) }, BUDGET), []);
});

test("budget fails a chunk over the per-chunk cap", () => {
  const chunks = [
    { name: "main.js", bytes: 200 },
    { name: "chart.js", bytes: 301 },
  ];
  assert.deepEqual(
    evaluateBundleBudget({ chunks, initialLoad: initialLoad([{ name: "/assets/main.js", bytes: 200 }]) }, BUDGET),
    ["chart.js is 301 bytes (limit 300)"],
  );
});

test("budget fails when the initial load is over its cap", () => {
  const files = [
    { name: "/assets/main.js", bytes: 300 },
    { name: "/assets/vendor.js", bytes: 201 },
  ];
  assert.deepEqual(evaluateBundleBudget({ chunks: [], initialLoad: initialLoad(files) }, BUDGET), [
    "initial load is 501 bytes across 2 files (limit 500)",
  ]);
});

test("a large total across many lazy chunks does not fail the budget", () => {
  const chunks = Array.from({ length: 20 }, (_, index) => ({ name: `page-${index}.js`, bytes: 300 }));
  assert.deepEqual(
    evaluateBundleBudget({ chunks, initialLoad: initialLoad([{ name: "/assets/main.js", bytes: 100 }]) }, BUDGET),
    [],
  );
});

test("budget fails closed when index.html loads nothing or names a missing file", () => {
  assert.deepEqual(evaluateBundleBudget({ chunks: [], initialLoad: initialLoad([]) }, BUDGET), [
    "index.html loads no JavaScript; the initial-load check found nothing to measure",
  ]);
  assert.deepEqual(
    evaluateBundleBudget(
      { chunks: [], initialLoad: initialLoad([{ name: "/assets/main.js", bytes: 10 }], ["/assets/gone.js"]) },
      BUDGET,
    ),
    ["/assets/gone.js is loaded on first open but is not in the build output"],
  );
});

test("findInitialScripts reads module scripts and modulepreload links only", () => {
  const html = `
    <script type="module" crossorigin src="/assets/main-abc.js"></script>
    <script src="/legacy.js"></script>
    <script type="module" src="https://cdn.example.com/x.js"></script>
    <link rel="modulepreload" crossorigin href="/assets/vendor-react-def.js">
    <link rel="stylesheet" href="/assets/main.css">
    <link rel="preload" href="/assets/font.woff2">
    <link rel='modulepreload' href='/assets/vendor-query.js?v=1'>
    <script type="module" src="/assets/main-abc.js"></script>`;
  assert.deepEqual(findInitialScripts(html), [
    "/assets/main-abc.js",
    "/assets/vendor-react-def.js",
    "/assets/vendor-query.js",
  ]);
});

test("findStaticImports finds static imports and re-exports but not dynamic import()", () => {
  const source =
    'import{j as e}from"./vendor-react.js";import"./side-effect.js";' +
    'import * as Q from "./vendor-query.js";export{a as b}from"./shared.js";export*from"./all.js";' +
    'const P=()=>import("./lazy-page.js");x.import("./not-a-module.js");';
  assert.deepEqual(findStaticImports(source).sort(), [
    "./all.js",
    "./shared.js",
    "./side-effect.js",
    "./vendor-query.js",
    "./vendor-react.js",
  ]);
});

test("resolveImport resolves relative and root paths and ignores bare and remote ones", () => {
  assert.equal(resolveImport("/assets/main.js", "./vendor.js"), "/assets/vendor.js");
  assert.equal(resolveImport("/assets/main.js", "../sw.js"), "/sw.js");
  assert.equal(resolveImport("/assets/main.js", "/assets/x.js?v=2"), "/assets/x.js");
  assert.equal(resolveImport("/assets/main.js", "react"), null);
  assert.equal(resolveImport("/assets/main.js", "https://esm.sh/x.js"), null);
});

test("collectInitialLoad follows static imports Vite did not list and skips lazy chunks", () => {
  const modules = {
    "/assets/main.js": { bytes: 100, source: 'import"./shared.js";const p=()=>import("./lazy.js");' },
    "/assets/shared.js": { bytes: 40, source: 'import{x}from"./deep.js";import{y}from"./main.js";' },
    "/assets/deep.js": { bytes: 7, source: "" },
    "/assets/lazy.js": { bytes: 1000, source: "" },
  };
  const result = collectInitialLoad(["/assets/main.js"], (name) => modules[name] ?? null);
  assert.deepEqual(result.files.map((file) => file.name).sort(), ["/assets/deep.js", "/assets/main.js", "/assets/shared.js"]);
  assert.equal(result.bytes, 147);
  assert.deepEqual(result.missing, []);
});

test("collectInitialLoad reports a listed file that is missing", () => {
  const result = collectInitialLoad(["/assets/main.js", "/assets/gone.js"], (name) =>
    name === "/assets/main.js" ? { bytes: 5, source: "" } : null,
  );
  assert.equal(result.bytes, 5);
  assert.deepEqual(result.missing, ["/assets/gone.js"]);
});

test("measureBuild measures a dist directory end to end", () => {
  const dist = mkdtempSync(path.join(tmpdir(), "bundle-budget-"));
  try {
    mkdirSync(path.join(dist, "assets"));
    writeFileSync(
      path.join(dist, "index.html"),
      '<script type="module" src="/assets/main.js"></script><link rel="modulepreload" href="/assets/vendor.js">',
    );
    writeFileSync(path.join(dist, "assets", "main.js"), 'import"./vendor.js";import"./hidden.js";import("./lazy.js");');
    writeFileSync(path.join(dist, "assets", "vendor.js"), "v".repeat(100));
    writeFileSync(path.join(dist, "assets", "hidden.js"), "h".repeat(50));
    writeFileSync(path.join(dist, "assets", "lazy.js"), "l".repeat(400));
    const measured = measureBuild(dist);
    assert.equal(measured.chunks.length, 4);
    assert.equal(measured.initialLoad.files.length, 3);
    assert.equal(measured.initialLoad.bytes, 60 + 100 + 50);
    assert.deepEqual(evaluateBundleBudget(measured, { maxChunkBytes: 400, maxInitialLoadBytes: 210 }), []);
    assert.deepEqual(evaluateBundleBudget(measured, { maxChunkBytes: 399, maxInitialLoadBytes: 209 }), [
      "lazy.js is 400 bytes (limit 399)",
      "initial load is 210 bytes across 3 files (limit 209)",
    ]);
  } finally {
    rmSync(dist, { recursive: true, force: true });
  }
});
