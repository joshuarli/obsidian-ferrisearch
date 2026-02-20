#[cfg(feature = "filesystem")]
use std::path::Path;

#[cfg(feature = "filesystem")]
use tantivy::IndexWriter;
use tantivy::collector::Count;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;
use tantivy::tokenizer::TokenFilter;
use tantivy::{Index, IndexReader, ReloadPolicy, Term};

use crate::schema::{FieldHandles, build_schema};
use crate::tokenizer::{DiacriticFilter, FerrisearchTokenizer};
use crate::types::{DocumentInput, IndexConfig};

pub struct IndexManager {
    index: Index,
    #[cfg(feature = "filesystem")]
    writer: IndexWriter,
    pub(crate) reader: IndexReader,
    pub(crate) fields: FieldHandles,
    pub(crate) ignore_diacritics: bool,
    /// WASM: buffer documents in memory, rebuild index on commit()
    /// using SingleSegmentIndexWriter (no threads needed).
    #[cfg(not(feature = "filesystem"))]
    docs_buffer: Vec<DocumentInput>,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("Tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[cfg(feature = "filesystem")]
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[cfg(feature = "filesystem")]
    #[error("Directory open error: {0}")]
    DirectoryOpen(#[from] tantivy::directory::error::OpenDirectoryError),
    #[error("Directory read error: {0}")]
    DirectoryRead(#[from] tantivy::directory::error::OpenReadError),
}

impl IndexManager {
    /// Create or open an index at the given directory path.
    #[cfg(feature = "filesystem")]
    pub fn new<P: AsRef<Path>>(path: P, config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        std::fs::create_dir_all(path.as_ref())?;

        let dir = tantivy::directory::MmapDirectory::open(path.as_ref())?;
        let index = if Index::exists(&dir)? {
            Index::open(dir)?
        } else {
            Index::create(dir, schema, Default::default())?
        };

        Self::register_tokenizer(&index, &config);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        // Single thread: Obsidian vaults are small enough that multi-threaded
        // indexing adds overhead without benefit.
        let writer = index.writer_with_num_threads(1, 50_000_000)?;
        Ok(Self {
            index,
            writer,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
        })
    }

    /// Create an in-memory index.
    #[cfg(feature = "filesystem")]
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        Self::register_tokenizer(&index, &config);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        // Single thread — see new() comment
        let writer = index.writer_with_num_threads(1, 15_000_000)?;
        Ok(Self {
            index,
            writer,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
        })
    }

    /// Create an in-memory index (WASM — no threads, uses SingleSegmentIndexWriter on commit).
    #[cfg(not(feature = "filesystem"))]
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        // Disable the dedicated compression thread (WASM has no threads)
        let settings = tantivy::IndexSettings {
            docstore_compress_dedicated_thread: false,
            ..Default::default()
        };
        let index = Index::create(tantivy::directory::RamDirectory::create(), schema, settings)?;
        Self::register_tokenizer(&index, &config);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        Ok(Self {
            index,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
            docs_buffer: Vec::new(),
        })
    }

    fn register_tokenizer(index: &Index, config: &IndexConfig) {
        if config.ignore_diacritics {
            index.tokenizers().register(
                "ferrisearch",
                DiacriticFilter.transform(FerrisearchTokenizer::new()),
            );
        } else {
            index
                .tokenizers()
                .register("ferrisearch", FerrisearchTokenizer::new());
        }
    }

    /// Build a TantivyDocument from a DocumentInput.
    fn build_tantivy_doc(fields: &FieldHandles, doc: &DocumentInput) -> tantivy::TantivyDocument {
        use std::collections::BTreeMap;
        use tantivy::schema::OwnedValue;

        let mut d = tantivy::TantivyDocument::new();
        d.add_text(fields.path, &doc.path);
        d.add_text(fields.basename, &doc.basename);
        d.add_text(fields.display_title, &doc.display_title);
        d.add_text(fields.directory, path_without_filename(&doc.path));
        d.add_text(fields.aliases, &doc.aliases);
        d.add_text(fields.content, &doc.content);
        d.add_text(fields.headings, &doc.headings);
        d.add_text(fields.tags_text, doc.tags.join(" "));
        d.add_text(fields.unmarked_tags, doc.unmarked_tags.join(" "));

        let tags_array: Vec<OwnedValue> = doc
            .tags
            .iter()
            .map(|t| OwnedValue::Str(t.clone()))
            .collect();
        d.add_object(
            fields.tags_stored,
            BTreeMap::from([("tags".into(), OwnedValue::Array(tags_array))]),
        );

        d.add_u64(fields.mtime, doc.mtime as u64);
        d
    }

    // ── Desktop (threaded IndexWriter) ──────────────────────────────────────

    /// Add a single document (upsert: removes existing document with same path first).
    #[cfg(feature = "filesystem")]
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        self.delete_by_path(&doc.path);
        let d = Self::build_tantivy_doc(&self.fields, doc);
        self.writer.add_document(d)?;
        Ok(())
    }

    #[cfg(feature = "filesystem")]
    pub fn add_documents(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            self.add_document(doc)?;
        }
        Ok(())
    }

    #[cfg(feature = "filesystem")]
    pub fn remove_documents(&mut self, paths: &[String]) {
        for path in paths {
            self.delete_by_path(path);
        }
    }

    #[cfg(feature = "filesystem")]
    pub fn commit(&mut self) -> Result<(), IndexError> {
        self.writer.commit()?;
        let segment_ids = self.index.searchable_segment_ids()?;
        if segment_ids.len() > 1 {
            let _ = self.writer.merge(&segment_ids).wait();
        }
        self.reader.reload()?;
        Ok(())
    }

    #[cfg(feature = "filesystem")]
    fn delete_by_path(&mut self, path: &str) {
        self.writer
            .delete_term(Term::from_field_text(self.fields.path, path));
    }

    // ── WASM (single-threaded, rebuild on commit) ───────────────────────────

    #[cfg(not(feature = "filesystem"))]
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        self.docs_buffer.retain(|d| d.path != doc.path);
        self.docs_buffer.push(doc.clone());
        Ok(())
    }

    #[cfg(not(feature = "filesystem"))]
    pub fn add_documents(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            self.add_document(doc)?;
        }
        Ok(())
    }

    #[cfg(not(feature = "filesystem"))]
    pub fn remove_documents(&mut self, paths: &[String]) {
        self.docs_buffer.retain(|d| !paths.contains(&d.path));
    }

    /// Rebuild the entire index from the docs buffer using SingleSegmentIndexWriter
    /// (no background threads — safe for WASM).
    #[cfg(not(feature = "filesystem"))]
    pub fn commit(&mut self) -> Result<(), IndexError> {
        use tantivy::SingleSegmentIndexWriter;

        let (schema, fields) = build_schema();
        let settings = tantivy::IndexSettings {
            docstore_compress_dedicated_thread: false,
            ..Default::default()
        };
        let index = Index::create(tantivy::directory::RamDirectory::create(), schema, settings)?;
        Self::register_tokenizer(
            &index,
            &IndexConfig {
                ignore_diacritics: self.ignore_diacritics,
            },
        );

        let mut writer = SingleSegmentIndexWriter::new(index.clone(), 15_000_000)?;
        for doc in &self.docs_buffer {
            writer.add_document(Self::build_tantivy_doc(&fields, doc))?;
        }
        writer.finalize()?;

        self.reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        self.index = index;
        self.fields = fields;
        Ok(())
    }

    /// Pre-warm term dictionaries by loading FSTs into the OS page cache.
    /// Call once after initial indexing and when opening the search modal.
    pub fn warm_up(&self) -> Result<(), IndexError> {
        let searcher = self.reader.searcher();
        for reader in searcher.segment_readers() {
            for (_, field) in self.fields.text_fields() {
                let inv = reader.inverted_index(field)?;
                // Access the term dictionary to fault in the mmap'd FST pages
                let _ = inv.terms().num_terms();
            }
        }
        Ok(())
    }

    pub fn has_document(&self, path: &str) -> Result<bool, IndexError> {
        let searcher = self.reader.searcher();
        let term = Term::from_field_text(self.fields.path, path);
        let count = searcher.search(&TermQuery::new(term, IndexRecordOption::Basic), &Count)?;
        Ok(count > 0)
    }

    pub fn document_count(&self) -> Result<u64, IndexError> {
        Ok(self.reader.searcher().num_docs())
    }
}

fn path_without_filename(path: &str) -> &str {
    match path.rfind('/') {
        Some(pos) => &path[..pos],
        None => "",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::IndexConfig;

    fn make_doc(path: &str, content: &str) -> DocumentInput {
        DocumentInput {
            path: path.into(),
            basename: path
                .rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".md")
                .into(),
            display_title: String::new(),
            aliases: String::new(),
            content: content.into(),
            headings: String::new(),
            tags: vec![],
            unmarked_tags: vec![],
            mtime: 1000.0,
        }
    }

    #[test]
    fn add_and_count() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn has_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert!(mgr.has_document("notes/test.md").unwrap());
        assert!(!mgr.has_document("notes/other.md").unwrap());
    }

    #[test]
    fn upsert() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "version 1"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);

        mgr.add_document(&make_doc("notes/test.md", "version 2"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn remove_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);

        mgr.remove_documents(&["notes/test.md".into()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 0);
    }

    #[test]
    fn add_multiple() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        let docs = vec![
            make_doc("a.md", "alpha"),
            make_doc("b.md", "beta"),
            make_doc("c.md", "gamma"),
        ];
        mgr.add_documents(&docs).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 3);
    }

    #[test]
    fn path_dir_extraction() {
        assert_eq!(path_without_filename("notes/sub/test.md"), "notes/sub");
        assert_eq!(path_without_filename("test.md"), "");
        assert_eq!(path_without_filename("a/b.md"), "a");
    }

    #[cfg(feature = "filesystem")]
    #[test]
    fn persist_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index");

        {
            let mut mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            mgr.add_document(&make_doc("test.md", "hello world"))
                .unwrap();
            mgr.commit().unwrap();
        }

        {
            let mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            assert_eq!(mgr.document_count().unwrap(), 1);
            assert!(mgr.has_document("test.md").unwrap());
        }
    }

    #[test]
    fn remove_batch() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_documents(&[
            make_doc("a.md", "alpha"),
            make_doc("b.md", "beta"),
            make_doc("c.md", "gamma"),
        ])
        .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 3);

        mgr.remove_documents(&["a.md".into(), "c.md".into()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
        assert!(!mgr.has_document("a.md").unwrap());
        assert!(mgr.has_document("b.md").unwrap());
        assert!(!mgr.has_document("c.md").unwrap());
    }

    #[test]
    fn remove_nonexistent() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("a.md", "alpha")).unwrap();
        mgr.commit().unwrap();

        mgr.remove_documents(&["nonexistent.md".into()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn add_document_with_all_fields() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        let doc = DocumentInput {
            path: "notes/sub/test.md".into(),
            basename: "test".into(),
            display_title: "Test Title".into(),
            aliases: "alias1 alias2".into(),
            content: "Full content here".into(),
            headings: "Heading One Heading Two Heading Three".into(),
            tags: vec!["#rust".into(), "#code".into()],
            unmarked_tags: vec!["programming".into()],
            mtime: 42000.0,
        };
        mgr.add_document(&doc).unwrap();
        mgr.commit().unwrap();

        assert_eq!(mgr.document_count().unwrap(), 1);
        assert!(mgr.has_document("notes/sub/test.md").unwrap());
    }

    #[test]
    fn upsert_replaces_content() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("a.md", "version one")).unwrap();
        mgr.commit().unwrap();
        mgr.add_document(&make_doc("a.md", "version two")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn diacritics_disabled() {
        let config = IndexConfig {
            ignore_diacritics: false,
        };
        let mut mgr = IndexManager::new_in_memory(config).unwrap();
        mgr.add_document(&make_doc("a.md", "hello")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[cfg(feature = "filesystem")]
    #[test]
    fn disk_index_reopen_add_more() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index");

        {
            let mut mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            mgr.add_document(&make_doc("a.md", "alpha")).unwrap();
            mgr.commit().unwrap();
        }

        {
            let mut mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            assert_eq!(mgr.document_count().unwrap(), 1);
            mgr.add_document(&make_doc("b.md", "beta")).unwrap();
            mgr.commit().unwrap();
            assert_eq!(mgr.document_count().unwrap(), 2);
        }
    }
}
