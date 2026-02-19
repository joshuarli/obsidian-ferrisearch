use std::path::PathBuf;
use std::time::{Duration, Instant};

use ferrisearch_core::index::IndexManager;
use ferrisearch_core::types::{DocumentInput, IndexConfig, SearchOptions};

const ITERATIONS: usize = 1000;

// ── Corpus loading ─────────────────────────────────────────────────────────

fn corpus_dir() -> PathBuf {
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest.parent().unwrap().parent().unwrap();
    workspace.join("bench/corpus/content")
}

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

fn frontmatter_value<'a>(frontmatter: &'a str, key: &str) -> Option<&'a str> {
    for line in frontmatter.lines() {
        if let Some(rest) = line.strip_prefix(key)
            && let Some(value) = rest.strip_prefix(": ")
        {
            return Some(value.trim());
        }
    }
    None
}

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

            let (frontmatter, body) = if let Some(rest) = content.strip_prefix("---\n") {
                match rest.find("\n---\n") {
                    Some(end) => (&rest[..end], &rest[end + 5..]),
                    None => ("", content.as_str()),
                }
            } else {
                ("", content.as_str())
            };

            let title = frontmatter_value(frontmatter, "title")
                .unwrap_or(&basename)
                .to_string();

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
                headings: [h1.join(" "), h2.join(" "), h3.join(" ")].join(" "),
                tags: vec![],
                unmarked_tags: vec![],
                mtime: 1700000000,
            })
        })
        .collect()
}

fn build_index(docs: &[DocumentInput]) -> IndexManager {
    let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
    for chunk in docs.chunks(500) {
        mgr.add_documents(chunk).unwrap();
    }
    mgr.commit().unwrap();
    mgr
}

// ── Benchmark harness ──────────────────────────────────────────────────────

struct BenchResult {
    name: String,
    query: String,
    median: Duration,
    p95: Duration,
    p99: Duration,
}

fn bench(name: &str, query: &str, mgr: &IndexManager, opts: &SearchOptions) -> BenchResult {
    // Warmup
    for _ in 0..50 {
        let _ = mgr.search(query, opts);
    }

    let mut times = Vec::with_capacity(ITERATIONS);
    for _ in 0..ITERATIONS {
        let start = Instant::now();
        let _ = mgr.search(query, opts);
        times.push(start.elapsed());
    }
    times.sort();

    BenchResult {
        name: name.into(),
        query: query.into(),
        median: times[ITERATIONS / 2],
        p95: times[ITERATIONS * 95 / 100],
        p99: times[ITERATIONS * 99 / 100],
    }
}

fn fmt_us(d: Duration) -> String {
    let us = d.as_micros();
    if us >= 1000 {
        format!("{:.2} ms", us as f64 / 1000.0)
    } else {
        format!("{us} us")
    }
}

/// Parse a duration string like "3.25 ms" or "348 us" back into microseconds.
fn parse_us(s: &str) -> Option<f64> {
    let s = s.trim();
    if let Some(rest) = s.strip_suffix(" ms") {
        rest.trim().parse::<f64>().ok().map(|v| v * 1000.0)
    } else if let Some(rest) = s.strip_suffix(" us") {
        rest.trim().parse::<f64>().ok()
    } else {
        None
    }
}

/// Load previous results from bench/results.md, keyed by benchmark name.
fn load_previous(path: &std::path::Path) -> std::collections::HashMap<String, f64> {
    let mut prev = std::collections::HashMap::new();
    let content = match std::fs::read_to_string(path) {
        Ok(c) => c,
        Err(_) => return prev,
    };
    for line in content.lines() {
        if !line.starts_with("| ") || line.starts_with("| Benchmark") || line.starts_with("|---") {
            continue;
        }
        let cols: Vec<&str> = line.split('|').collect();
        // cols: ["", " name ", " query ", " median ", " p95 ", " p99 ", " change? ", ""]
        if cols.len() >= 5 {
            let name = cols[1].trim().to_string();
            if let Some(us) = parse_us(cols[3]) {
                prev.insert(name, us);
            }
        }
    }
    prev
}

fn fmt_change(
    current_us: f64,
    prev: &std::collections::HashMap<String, f64>,
    name: &str,
) -> String {
    match prev.get(name) {
        Some(&old_us) if old_us > 0.0 => {
            let pct = (current_us - old_us) / old_us * 100.0;
            if pct.abs() < 1.0 {
                "~".into()
            } else {
                format!("{pct:+.0}%")
            }
        }
        _ => String::new(),
    }
}

fn main() {
    let docs = load_corpus();
    let doc_count = docs.len();
    let mgr = build_index(&docs);

    let default_opts = SearchOptions::default();
    let fuzzy_opts = SearchOptions {
        fuzziness: "2".into(),
        ..Default::default()
    };
    // Load previous results before overwriting
    let manifest = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let workspace = manifest.parent().unwrap().parent().unwrap();
    let results_path = workspace.join("bench/results.md");
    let prev = load_previous(&results_path);

    let results = vec![
        bench("single_term", "repository", &mgr, &default_opts),
        bench("multi_term", "pull request", &mgr, &default_opts),
        bench("phrase", "\"pull request\"", &mgr, &default_opts),
        bench("phrase+term", "\"pull request\" merge", &mgr, &default_opts),
        bench("fuzzy", "repositry", &mgr, &fuzzy_opts),
        bench("short", "git", &mgr, &default_opts),
        bench("rare", "graphql", &mgr, &default_opts),
        bench("no_results", "xyzzyplugh", &mgr, &default_opts),
    ];

    let mut out = String::new();
    out.push_str(&format!(
        "# Query Benchmarks\n\n{doc_count} documents, {ITERATIONS} iterations per query\n\n"
    ));
    out.push_str("| Benchmark | Query | Median | p95 | p99 | vs last |\n");
    out.push_str("|-----------|-------|--------|-----|-----|--------|\n");
    for r in &results {
        let median_us = r.median.as_micros() as f64;
        let change = fmt_change(median_us, &prev, &r.name);
        out.push_str(&format!(
            "| {} | `{}` | {} | {} | {} | {} |\n",
            r.name,
            r.query,
            fmt_us(r.median),
            fmt_us(r.p95),
            fmt_us(r.p99),
            change,
        ));
    }

    print!("{out}");

    std::fs::write(&results_path, &out).expect("failed to write bench/results.md");
    eprintln!("\nWrote {}", results_path.display());
}
