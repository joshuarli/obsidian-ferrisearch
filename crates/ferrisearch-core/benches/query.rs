use std::path::PathBuf;

use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};
use ferrisearch_core::index::IndexManager;
use ferrisearch_core::types::{DocumentInput, IndexConfig, SearchOptions};

/// Locate the bench/corpus/content/ directory relative to the workspace root.
fn corpus_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest.parent().unwrap().parent().unwrap();
    workspace.join("bench/corpus/content")
}

/// Recursively collect all .md files under a directory.
fn collect_md_files(dir: &std::path::Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return files,
    };
    for entry in entries.filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_dir() {
            files.extend(collect_md_files(&path));
        } else if path.extension().is_some_and(|ext| ext == "md") {
            files.push(path);
        }
    }
    files
}

/// Parse YAML frontmatter value for a given key (simple single-line values only).
fn frontmatter_value<'a>(frontmatter: &'a str, key: &str) -> Option<&'a str> {
    for line in frontmatter.lines() {
        if let Some(rest) = line.strip_prefix(key) {
            if let Some(value) = rest.strip_prefix(": ") {
                return Some(value.trim());
            }
        }
    }
    None
}

/// Load GitHub docs corpus into DocumentInput structs.
fn load_corpus() -> Vec<DocumentInput> {
    let dir = corpus_dir();
    if !dir.exists() {
        panic!(
            "Corpus not found at {}.\nRun: zstd -d --long=31 bench/gh-docs.tar.zst --stdout | tar -x -C bench/corpus",
            dir.display()
        );
    }

    let mut files = collect_md_files(&dir);
    files.sort();

    files
        .into_iter()
        .filter_map(|path| {
            let content = std::fs::read_to_string(&path).ok()?;
            let rel_path = path.strip_prefix(&dir).ok()?;
            let note_path = rel_path.to_string_lossy().to_string();
            let basename = path
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();

            // Split frontmatter from body
            let (frontmatter, body) = if content.starts_with("---\n") {
                match content[4..].find("\n---\n") {
                    Some(end) => (&content[4..4 + end], &content[4 + end + 5..]),
                    None => ("", content.as_str()),
                }
            } else {
                ("", content.as_str())
            };

            let title = frontmatter_value(frontmatter, "title")
                .unwrap_or(&basename)
                .to_string();

            // Extract markdown headings
            let mut h1 = Vec::new();
            let mut h2 = Vec::new();
            let mut h3 = Vec::new();
            for line in body.lines() {
                let trimmed = line.trim();
                if let Some(h) = trimmed.strip_prefix("### ") {
                    h3.push(h);
                } else if let Some(h) = trimmed.strip_prefix("## ") {
                    h2.push(h);
                } else if let Some(h) = trimmed.strip_prefix("# ") {
                    h1.push(h);
                }
            }

            Some(DocumentInput {
                path: note_path,
                basename,
                display_title: title,
                aliases: String::new(),
                content: body.to_string(),
                headings1: h1.join(" "),
                headings2: h2.join(" "),
                headings3: h3.join(" "),
                tags: vec![],
                unmarked_tags: vec![],
                mtime: 1700000000,
            })
        })
        .collect()
}

/// Build an in-memory index from the corpus. Done once, shared across benchmarks.
fn build_index(docs: &[DocumentInput]) -> IndexManager {
    let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
    for chunk in docs.chunks(500) {
        mgr.add_documents(chunk).unwrap();
    }
    mgr.commit().unwrap();
    eprintln!("Index built: {} documents", mgr.document_count().unwrap());
    mgr
}

fn bench_queries(c: &mut Criterion) {
    let docs = load_corpus();
    let mgr = build_index(&docs);
    let doc_count = mgr.document_count().unwrap();

    let default_opts = SearchOptions::default();
    let fuzzy_opts = SearchOptions {
        fuzziness: "2".into(),
        ..Default::default()
    };
    let no_fuzzy_opts = SearchOptions {
        fuzziness: "0".into(),
        ..Default::default()
    };

    let mut group = c.benchmark_group("query");
    group.significance_level(0.05).sample_size(200);

    // ── Single term ────────────────────────────────────────────────────
    for term in ["repository", "workflow", "authentication", "deploy"] {
        group.bench_with_input(BenchmarkId::new("single_term", term), &term, |b, term| {
            b.iter(|| mgr.search(term, &default_opts).unwrap());
        });
    }

    // ── Multi-term (AND) ───────────────────────────────────────────────
    for query in [
        "pull request",
        "github actions",
        "secret scanning",
        "code review",
    ] {
        group.bench_with_input(BenchmarkId::new("multi_term", query), &query, |b, query| {
            b.iter(|| mgr.search(query, &default_opts).unwrap());
        });
    }

    // ── Phrase queries ─────────────────────────────────────────────────
    for phrase in [
        "\"pull request\"",
        "\"github actions\"",
        "\"secret scanning\"",
        "\"code review\"",
    ] {
        group.bench_with_input(BenchmarkId::new("phrase", phrase), &phrase, |b, phrase| {
            b.iter(|| mgr.search(phrase, &default_opts).unwrap());
        });
    }

    // ── Phrase + term ──────────────────────────────────────────────────
    group.bench_function("phrase_plus_term", |b| {
        b.iter(|| mgr.search("\"pull request\" merge", &default_opts).unwrap());
    });

    // ── Fuzzy queries ──────────────────────────────────────────────────
    for term in ["repositry", "deploymnt", "authentcation"] {
        group.bench_with_input(BenchmarkId::new("fuzzy", term), &term, |b, term| {
            b.iter(|| mgr.search(term, &fuzzy_opts).unwrap());
        });
    }

    // ── No-fuzzy (exact + prefix only) ─────────────────────────────────
    group.bench_function("no_fuzzy", |b| {
        b.iter(|| mgr.search("repository", &no_fuzzy_opts).unwrap());
    });

    // ── Short queries ──────────────────────────────────────────────────
    for term in ["a", "pr", "git"] {
        group.bench_with_input(BenchmarkId::new("short", term), &term, |b, term| {
            b.iter(|| mgr.search(term, &default_opts).unwrap());
        });
    }

    // ── Rare term (few matches) ────────────────────────────────────────
    group.bench_function("rare_term", |b| {
        b.iter(|| mgr.search("graphql", &default_opts).unwrap());
    });

    // ── No results ─────────────────────────────────────────────────────
    group.bench_function("no_results", |b| {
        b.iter(|| mgr.search("xyzzyplugh", &default_opts).unwrap());
    });

    group.finish();

    eprintln!("\nCorpus: {doc_count} documents");
}

criterion_group!(benches, bench_queries);
criterion_main!(benches);
