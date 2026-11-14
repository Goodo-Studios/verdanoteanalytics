import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Bundle budget (owner decision, 2026-11-10):
// - initial load: the JavaScript the browser downloads when someone first opens
//   the site must stay under maxInitialLoadBytes. That is every module script
//   and modulepreload link in dist/index.html, plus every chunk those files
//   import statically (dynamic import() chunks are loaded later and are not
//   counted).
// - per chunk: no single JavaScript chunk may exceed maxChunkBytes.
// - the total of all chunks is printed for information only; it is not a cap.
//
// maxInitialLoadBytes was set to the measured first-load size on 2026-11-10
// (764,031 bytes in 5 files) plus about 10 percent.
export const DEFAULT_BUNDLE_BUDGET = {
  maxChunkBytes: 380_000,
  maxInitialLoadBytes: 840_000,
};

const SCRIPT_TAG = /<script\b[^>]*>/gi;
const LINK_TAG = /<link\b[^>]*>/gi;

function attribute(tag, name) {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i"));
  if (!match) return null;
  return match[1] ?? match[2] ?? match[3];
}

function isLocalJavaScript(url) {
  return Boolean(url) && !/^[a-z][a-z0-9+.-]*:|^\/\//i.test(url) && /\.m?js(?:[?#].*)?$/i.test(url);
}

function stripQuery(url) {
  return url.replace(/[?#].*$/, "");
}

// Returns the site-root paths (for example "/assets/main-abc.js") of the
// JavaScript files index.html asks the browser to load on first open.
export function findInitialScripts(html) {
  const urls = [];
  for (const tag of html.match(SCRIPT_TAG) ?? []) {
    const type = (attribute(tag, "type") ?? "").toLowerCase();
    const src = attribute(tag, "src");
    if (type === "module" && isLocalJavaScript(src)) urls.push(stripQuery(src));
  }
  for (const tag of html.match(LINK_TAG) ?? []) {
    const rel = (attribute(tag, "rel") ?? "").toLowerCase().split(/\s+/);
    const href = attribute(tag, "href");
    if (rel.includes("modulepreload") && isLocalJavaScript(href)) urls.push(stripQuery(href));
  }
  return [...new Set(urls)];
}

// Static imports and re-exports in a built ES module: `import"./a.js"`,
// `import{x}from"./a.js"`, `import * as y from "./a.js"`, `export{z}from"./a.js"`,
// `export*from"./a.js"`. Dynamic `import("./a.js")` is not matched: the
// specifier part may not contain "(".
const STATIC_IMPORT =
  /(?:^|[^.\w$])(?:import|export)\s*(?:[\w$*{}\s,]*?\bfrom\s*)?["']([^"'\n]+\.m?js)["']/g;

export function findStaticImports(source) {
  const specifiers = new Set();
  for (const match of source.matchAll(STATIC_IMPORT)) specifiers.add(match[1]);
  return [...specifiers];
}

// Resolves a relative import specifier against the importing file's site path.
export function resolveImport(fromSitePath, specifier) {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(specifier)) return null;
  if (specifier.startsWith("/")) return path.posix.normalize(stripQuery(specifier));
  if (!specifier.startsWith(".")) return null;
  return path.posix.normalize(path.posix.join(path.posix.dirname(fromSitePath), stripQuery(specifier)));
}

// Walks the first-load graph. `readModule(sitePath)` returns
// { bytes, source } for a built file, or null when it does not exist.
export function collectInitialLoad(entryPaths, readModule) {
  const seen = new Map();
  const missing = [];
  const queue = [...entryPaths];
  while (queue.length > 0) {
    const sitePath = queue.shift();
    if (seen.has(sitePath)) continue;
    const module = readModule(sitePath);
    if (!module) {
      missing.push(sitePath);
      seen.set(sitePath, 0);
      continue;
    }
    seen.set(sitePath, module.bytes);
    for (const specifier of findStaticImports(module.source)) {
      const resolved = resolveImport(sitePath, specifier);
      if (resolved && !seen.has(resolved)) queue.push(resolved);
    }
  }
  const files = [...seen].filter(([name]) => !missing.includes(name)).map(([name, bytes]) => ({ name, bytes }));
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  return { files, bytes, missing };
}

export function evaluateBundleBudget({ chunks, initialLoad }, budget = DEFAULT_BUNDLE_BUDGET) {
  const failures = chunks
    .filter((chunk) => chunk.bytes > budget.maxChunkBytes)
    .map((chunk) => `${chunk.name} is ${chunk.bytes} bytes (limit ${budget.maxChunkBytes})`);
  if (initialLoad.files.length === 0) {
    failures.push("index.html loads no JavaScript; the initial-load check found nothing to measure");
  }
  for (const name of initialLoad.missing) {
    failures.push(`${name} is loaded on first open but is not in the build output`);
  }
  if (initialLoad.bytes > budget.maxInitialLoadBytes) {
    failures.push(
      `initial load is ${initialLoad.bytes} bytes across ${initialLoad.files.length} files (limit ${budget.maxInitialLoadBytes})`,
    );
  }
  return failures;
}

function readJavaScriptChunks(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, bytes: statSync(`${directory}/${name}`).size }));
}

export function measureBuild(distDirectory) {
  const html = readFileSync(path.join(distDirectory, "index.html"), "utf8");
  const readModule = (sitePath) => {
    const file = path.join(distDirectory, sitePath);
    if (!file.startsWith(distDirectory) || !existsSync(file)) return null;
    const source = readFileSync(file, "utf8");
    return { bytes: Buffer.byteLength(source), source };
  };
  return {
    chunks: readJavaScriptChunks(path.join(distDirectory, "assets")),
    initialLoad: collectInitialLoad(findInitialScripts(html), readModule),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const measured = measureBuild(path.resolve(process.cwd(), "dist"));
  const total = measured.chunks.reduce((sum, chunk) => sum + chunk.bytes, 0);
  const largest = Math.max(...measured.chunks.map((chunk) => chunk.bytes));
  const failures = evaluateBundleBudget(measured);
  console.log(
    `Initial load: ${measured.initialLoad.bytes} bytes in ${measured.initialLoad.files.length} files ` +
      `(limit ${DEFAULT_BUNDLE_BUDGET.maxInitialLoadBytes}): ${measured.initialLoad.files.map((file) => file.name).join(", ")}`,
  );
  console.log(
    `All chunks (information only, no cap): ${measured.chunks.length} chunks, ${total} total bytes, ` +
      `${largest} largest chunk (limit ${DEFAULT_BUNDLE_BUDGET.maxChunkBytes}).`,
  );
  if (failures.length > 0) {
    console.error(`Bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log("Bundle budget passed.");
  }
}
