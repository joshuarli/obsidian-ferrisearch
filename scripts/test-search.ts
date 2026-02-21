#!/usr/bin/env bun
/**
 * CLI test harness for the native NAPI search engine.
 * Indexes .md files from any directory, searches, and benchmarks query latency.
 *
 * Usage:
 *   bun scripts/test-search.ts <directory> <query> [fuzziness]
 *
 * Examples:
 *   bun scripts/test-search.ts ~/my-vault powder 2
 *   bun scripts/test-search.ts ~/my-vault restaurant 1
 *   bun scripts/test-search.ts ~/my-vault "github actions" 0
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dir, "..");
const NODE_FILE = path.join(ROOT, "ferrisearch.darwin-arm64.node");

if (!fs.existsSync(NODE_FILE)) {
  console.error(`Native binary not found: ${NODE_FILE}`);
  console.error(
    "Run: cargo build --release -p ferrisearch-napi && cp target/release/libferrisearch_napi.dylib ferrisearch.darwin-arm64.node",
  );
  process.exit(1);
}

const dirArg = process.argv[2];
const query = process.argv[3];
const fuzziness = process.argv[4] || "1";

if (!dirArg || !query) {
  console.error("Usage: bun scripts/test-search.ts <directory> <query> [fuzziness]");
  process.exit(1);
}

const VAULT_DIR = path.resolve(dirArg);

if (!fs.existsSync(VAULT_DIR) || !fs.statSync(VAULT_DIR).isDirectory()) {
  console.error(`Directory not found: ${VAULT_DIR}`);
  process.exit(1);
}

// ── Collect .md files via fd ─────────────────────────────────────────────
async function collectMdFiles(): Promise<string[]> {
  const proc = Bun.spawn(["fd", "-e", "md", "-t", "f", ".", VAULT_DIR], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [text, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  await proc.exited;
  if (proc.exitCode !== 0) {
    console.error(stderr || "fd failed — is it installed? (brew install fd)");
    process.exit(1);
  }
  if (!text.length) return [];
  return text.trimEnd().split("\n").map((p) => path.relative(VAULT_DIR, p));
}

const crawlStart = performance.now();
const mdPaths = await collectMdFiles();
const crawlMs = performance.now() - crawlStart;
console.log(`Found ${mdPaths.length} .md files in ${crawlMs.toFixed(1)}ms`);

// ── Read files + build document inputs (parallel async I/O) ─────────────
const readStart = performance.now();
const docs = await Promise.all(
  mdPaths.map(async (relPath) => {
    const fullPath = path.join(VAULT_DIR, relPath);
    const [content, stat] = await Promise.all([
      Bun.file(fullPath).text(),
      fs.promises.stat(fullPath),
    ]);
    const basename = path.basename(relPath, ".md");

    const h1Match = content.match(/^#\s+(.+)$/m);
    const displayTitle = h1Match ? h1Match[1] : basename;

    const headings = (content.match(/^#{1,3}\s+(.+)$/gm) || [])
      .map((h) => h.replace(/^#{1,3}\s+/, ""))
      .join(" ");

    return {
      path: relPath,
      basename,
      displayTitle,
      aliases: "",
      content,
      headings,
      tags: [] as string[],
      unmarkedTags: [] as string[],
      mtime: stat.mtimeMs,
    };
  }),
);
const readMs = performance.now() - readStart;
console.log(`Read ${docs.length} files in ${readMs.toFixed(1)}ms`);

// ── Index ───────────────────────────────────────────────────────────────
const native = require(NODE_FILE);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ferrisearch-test-"));
const indexPath = path.join(tmpDir, "tantivy-index");
const index = new native.SearchIndex(indexPath, { ignoreDiacritics: true });

const indexStart = performance.now();
index.addDocuments(docs);
index.commit();
const indexMs = performance.now() - indexStart;
console.log(`Indexed ${docs.length} files in ${indexMs.toFixed(1)}ms`);
console.log(`Total: ${(crawlMs + readMs + indexMs).toFixed(1)}ms\n`);

// ── Search ──────────────────────────────────────────────────────────────
const opts = {
  fuzziness,
  prefixLength: 1,
  limit: 10,
  recencyBoost: "0",
  fieldBoosts: {
    basename: 10,
    displayTitle: 10,
    aliases: 10,
    directory: 7,
    headings: 5,
    tagsText: 2,
    unmarkedTags: 2,
    content: 1,
  },
};

console.log(`Query: "${query}"  Fuzziness: ${fuzziness}`);
console.log("─".repeat(70));

const results = index.search(query, opts);

if (results.length === 0) {
  console.log("No results found.");
} else {
  for (const r of results) {
    const matchTexts = r.matches.map(
      (m: { matchText: string; offset: number }) => m.matchText,
    );
    console.log(`\n  Path:    ${r.path}`);
    console.log(`  Score:   ${r.score.toFixed(4)}`);
    console.log(`  Matches: [${matchTexts.join(", ")}]`);
  }
}

console.log("\n" + "─".repeat(70));

// ── Benchmark ───────────────────────────────────────────────────────────
const RUNS = 100;
const latencies = new Float64Array(RUNS);

// Warm up (5 runs, discarded)
for (let i = 0; i < 5; i++) index.search(query, opts);

for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  index.search(query, opts);
  latencies[i] = performance.now() - t0;
}

latencies.sort();

const p50 = latencies[Math.floor(RUNS * 0.5)];
const mean = latencies.reduce((a, b) => a + b, 0) / RUNS;
const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / RUNS;
const stddev = Math.sqrt(variance);

console.log(`\nBenchmark (${RUNS} runs):`);
console.log(`  p50:    ${p50.toFixed(3)}ms`);
console.log(`  mean:   ${mean.toFixed(3)}ms`);
console.log(`  stddev: ${stddev.toFixed(3)}ms`);
console.log(`  3σ:     ${(mean + 3 * stddev).toFixed(3)}ms`);

// Cleanup
index.close();
fs.rmSync(tmpDir, { recursive: true });
