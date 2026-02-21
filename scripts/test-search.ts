#!/usr/bin/env bun
/**
 * CLI test harness for the native NAPI search engine.
 * Indexes .md files from any directory, searches, and benchmarks query latency.
 *
 * Usage:
 *   bun scripts/test-search.ts <directory> <query> [fuzziness] [--file <path>]
 *
 * Examples:
 *   bun scripts/test-search.ts ~/my-vault powder 2
 *   bun scripts/test-search.ts ~/my-vault powder 1 --file baking/Ingredients/Dairy.md
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

// ── Parse args ──────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let dirArg: string | undefined;
let query: string | undefined;
let fuzziness = "1";
let debugFile: string | undefined;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--file") {
    debugFile = args[++i];
  } else if (!dirArg) {
    dirArg = args[i];
  } else if (!query) {
    query = args[i];
  } else {
    fuzziness = args[i];
  }
}

if (!dirArg || !query) {
  console.error(
    "Usage: bun scripts/test-search.ts <directory> <query> [fuzziness] [--file <path>]",
  );
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

    // Extract headings: ATX (# Heading) and setext (Heading\n=== or Heading\n---)
    const atxHeadings = (content.match(/^#{1,3}\s+(.+)$/gm) || [])
      .map((h) => h.replace(/^#{1,3}\s+/, ""));
    const setextHeadings = (content.match(/^(.+)\n[=-]{2,}$/gm) || [])
      .map((h) => h.split("\n")[0]);
    const headings = [...atxHeadings, ...setextHeadings].join(" ");

    const h1Match = content.match(/^#\s+(.+)$/m)
      ?? content.match(/^(.+)\n={2,}$/m);
    const displayTitle = h1Match ? h1Match[1] : basename;

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
  scoreBreakdown: true,
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

type FieldScoreBreakdown = {
  displayTitle: number;
  directory: number;
  content: number;
  headings: number;
};

type SearchResult = {
  path: string;
  score: number;
  recencyMultiplier: number;
  fieldScores?: FieldScoreBreakdown;
  matches: { matchText: string; offset: number }[];
  matchedTerms: string[];
};

function printResult(r: SearchResult, rank?: number): void {
  const matchTexts = r.matches.map((m) => m.matchText);
  const prefix = rank != null ? `  #${rank}` : "  ";
  console.log(`${prefix} ${r.path}`);
  console.log(`     Score:   ${r.score.toFixed(4)}`);
  if (r.fieldScores) {
    const fs = r.fieldScores;
    const parts: string[] = [];
    if (fs.displayTitle > 0) parts.push(`title:${fs.displayTitle.toFixed(2)}`);
    if (fs.directory > 0) parts.push(`dir:${fs.directory.toFixed(2)}`);
    if (fs.content > 0) parts.push(`content:${fs.content.toFixed(2)}`);
    if (fs.headings > 0) parts.push(`headings:${fs.headings.toFixed(2)}`);
    if (parts.length) console.log(`     Fields:  ${parts.join("  ")}`);
  }
  if (r.recencyMultiplier !== 1.0)
    console.log(`     Recency: ×${r.recencyMultiplier.toFixed(4)}`);
  console.log(`     Matches: [${matchTexts.join(", ")}]`);
}

console.log(`Query: "${query}"  Fuzziness: ${fuzziness}`);
console.log("─".repeat(70));

const results: SearchResult[] = index.search(query, opts);

if (results.length === 0) {
  console.log("No results found.");
} else {
  for (let i = 0; i < results.length; i++) {
    printResult(results[i], i + 1);
  }
}

// ── Debug single file ───────────────────────────────────────────────────
if (debugFile) {
  console.log("\n" + "─".repeat(70));
  console.log(`\nDebug: ${debugFile}`);

  // Search with a high limit to find the file's true rank and score
  const allResults: SearchResult[] = index.search(query, { ...opts, limit: 500 });
  const idx = allResults.findIndex((r) => r.path === debugFile);

  if (idx >= 0) {
    printResult(allResults[idx], idx + 1);
  } else {
    console.log("  No match for this file.");
  }

  // Show indexed doc fields for inspection
  const doc = docs.find((d) => d.path === debugFile);
  if (doc) {
    console.log("\n  Indexed fields:");
    console.log(`     basename:     "${doc.basename}"`);
    console.log(`     displayTitle: "${doc.displayTitle}"`);
    console.log(`     headings:     "${doc.headings}"`);
    console.log(`     content:      ${doc.content.length} chars`);
  } else {
    console.log(`\n  File not found in index. Available paths matching "${path.basename(debugFile, ".md")}":`);
    const needle = path.basename(debugFile, ".md").toLowerCase();
    for (const d of docs) {
      if (d.basename.toLowerCase().includes(needle)) {
        console.log(`     ${d.path}`);
      }
    }
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
