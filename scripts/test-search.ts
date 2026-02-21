#!/usr/bin/env bun
/**
 * CLI smoke test for the native NAPI search engine.
 * Reads .md files from scripts/test-vault/, indexes them, searches, prints results.
 *
 * Usage:
 *   bun scripts/test-search.ts [query] [fuzziness]
 *
 * Examples:
 *   bun scripts/test-search.ts powder 2
 *   bun scripts/test-search.ts powder 3
 *   bun scripts/test-search.ts restaurant 1
 */

import path from "node:path";
import os from "node:os";
import fs from "node:fs";

const ROOT = path.resolve(import.meta.dir, "..");
const NODE_FILE = path.join(ROOT, "ferrisearch.darwin-arm64.node");
const VAULT_DIR = path.join(ROOT, "scripts", "test-vault");

if (!fs.existsSync(NODE_FILE)) {
  console.error(`Native binary not found: ${NODE_FILE}`);
  console.error(
    "Run: cargo build --release -p ferrisearch-napi && cp target/release/libferrisearch_napi.dylib ferrisearch.darwin-arm64.node",
  );
  process.exit(1);
}

if (!fs.existsSync(VAULT_DIR)) {
  console.error(`Test vault not found: ${VAULT_DIR}`);
  console.error("Create .md files in scripts/test-vault/");
  process.exit(1);
}

// ── Collect all .md files recursively ───────────────────────────────────
function collectMdFiles(dir: string, base: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMdFiles(full, base));
    } else if (entry.name.endsWith(".md")) {
      files.push(path.relative(base, full));
    }
  }
  return files;
}

const mdPaths = collectMdFiles(VAULT_DIR, VAULT_DIR);

// ── Build document inputs from files ────────────────────────────────────
const docs = mdPaths.map((relPath) => {
  const fullPath = path.join(VAULT_DIR, relPath);
  const content = fs.readFileSync(fullPath, "utf-8");
  const basename = path.basename(relPath, ".md");

  // Extract first H1 as display title
  const h1Match = content.match(/^#\s+(.+)$/m);
  const displayTitle = h1Match ? h1Match[1] : basename;

  // Extract headings (H1-H3)
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
    mtime: fs.statSync(fullPath).mtimeMs,
  };
});

// ── Index ───────────────────────────────────────────────────────────────
const native = require(NODE_FILE);
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ferrisearch-test-"));
const indexPath = path.join(tmpDir, "tantivy-index");
const index = new native.SearchIndex(indexPath, { ignoreDiacritics: true });

index.addDocuments(docs);
index.commit();
console.log(`Indexed ${docs.length} files from ${VAULT_DIR}\n`);

// ── Search ──────────────────────────────────────────────────────────────
const query = process.argv[2] || "powder";
const fuzziness = process.argv[3] || "2";

const opts = {
  fuzziness,
  prefixLength: 1,
  limit: 10,
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

console.log(`Query: "${query}"  Fuzziness: ${fuzziness}\n`);
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

// Cleanup
index.close();
fs.rmSync(tmpDir, { recursive: true });
