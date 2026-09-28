import { readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const DEFAULT_BUNDLE_BUDGET = {
  maxChunkBytes: 380_000,
  maxTotalBytes: 2_150_000,
};

export function evaluateBundleBudget(assets, budget = DEFAULT_BUNDLE_BUDGET) {
  const failures = assets
    .filter((asset) => asset.bytes > budget.maxChunkBytes)
    .map((asset) => `${asset.name} is ${asset.bytes} bytes (limit ${budget.maxChunkBytes})`);
  const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
  if (total > budget.maxTotalBytes) {
    failures.push(`total JavaScript is ${total} bytes (limit ${budget.maxTotalBytes})`);
  }
  return failures;
}

function readJavaScriptAssets(directory) {
  return readdirSync(directory)
    .filter((name) => name.endsWith(".js"))
    .map((name) => ({ name, bytes: statSync(`${directory}/${name}`).size }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const assets = readJavaScriptAssets(`${process.cwd()}/dist/assets`);
  const failures = evaluateBundleBudget(assets);
  if (failures.length > 0) {
    console.error(`Bundle budget exceeded:\n${failures.map((failure) => `- ${failure}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    const total = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    const largest = Math.max(...assets.map((asset) => asset.bytes));
    console.log(`Bundle budget passed: ${assets.length} chunks, ${total} total bytes, ${largest} largest chunk.`);
  }
}
