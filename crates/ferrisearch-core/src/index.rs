use std::path::Path;

use tantivy::collector::Count;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;
use tantivy::tokenizer::TokenFilter;
use tantivy::{Index, IndexWriter, ReloadPolicy, Term};

use crate::schema::{FieldHandles, build_schema};
use crate::tokenizer::{DiacriticFilter, FerrisearchTokenizer};
use crate::types::{DocumentInput, IndexConfig};

/// Manages a Tantivy index for ferrisearch
pub struct IndexManager {
    pub(crate) index: Index,
    writer: IndexWriter,
    pub(crate) fields: FieldHandles,
    _config: IndexConfig,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("Tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Directory open error: {0}")]
    DirectoryOpen(#[from] tantivy::directory::error::OpenDirectoryError),
    #[error("Directory read error: {0}")]
    DirectoryRead(#[from] tantivy::directory::error::OpenReadError),
}

impl IndexManager {
    /// Create or open an index at the given directory path
    pub fn new<P: AsRef<Path>>(path: P, config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();

        // Create directory if it doesn't exist
        std::fs::create_dir_all(path.as_ref())?;

        let dir = tantivy::directory::MmapDirectory::open(path.as_ref())?;
        let index = if Index::exists(&dir)? {
            Index::open(dir)?
        } else {
            Index::create(dir, schema.clone(), Default::default())?
        };

        // Register our custom tokenizer
        Self::register_tokenizer(&index, &config);

        let writer = index.writer(50_000_000)?; // 50MB heap

        Ok(Self {
            index,
            writer,
            fields,
            _config: config,
        })
    }

    /// Create an in-memory index (for testing)
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema.clone());

        Self::register_tokenizer(&index, &config);

        let writer = index.writer(15_000_000)?;

        Ok(Self {
            index,
            writer,
            fields,
            _config: config,
        })
    }

    fn register_tokenizer(index: &Index, config: &IndexConfig) {
        let base = FerrisearchTokenizer::new();
        if config.ignore_diacritics {
            let tokenizer = DiacriticFilter.transform(base);
            index.tokenizers().register("ferrisearch", tokenizer);
        } else {
            index.tokenizers().register("ferrisearch", base);
        }
    }

    /// Add a single document (upsert: removes existing document with same path first)
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        // Delete existing document with same path
        self.delete_by_path(&doc.path);

        let mut tantivy_doc = tantivy::TantivyDocument::new();

        tantivy_doc.add_text(self.fields.path, &doc.path);
        tantivy_doc.add_text(self.fields.basename, &doc.basename);
        tantivy_doc.add_text(self.fields.display_title, &doc.display_title);

        // Derive directory from path
        let directory = path_without_filename(&doc.path);
        tantivy_doc.add_text(self.fields.directory, &directory);

        tantivy_doc.add_text(self.fields.aliases, &doc.aliases);
        tantivy_doc.add_text(self.fields.content, &doc.content);
        tantivy_doc.add_text(self.fields.headings1, &doc.headings1);
        tantivy_doc.add_text(self.fields.headings2, &doc.headings2);
        tantivy_doc.add_text(self.fields.headings3, &doc.headings3);

        // Tags as space-separated text for full-text matching
        tantivy_doc.add_text(self.fields.tags_text, doc.tags.join(" "));
        tantivy_doc.add_text(self.fields.unmarked_tags, doc.unmarked_tags.join(" "));

        // Tags stored as JSON for post-search boost
        let tags_array: Vec<tantivy::schema::OwnedValue> = doc
            .tags
            .iter()
            .map(|t| tantivy::schema::OwnedValue::Str(t.clone()))
            .collect();
        let mut tags_map = std::collections::BTreeMap::new();
        tags_map.insert(
            "tags".to_string(),
            tantivy::schema::OwnedValue::Array(tags_array),
        );
        tantivy_doc.add_object(self.fields.tags_stored, tags_map);

        tantivy_doc.add_u64(self.fields.mtime, doc.mtime);

        self.writer.add_document(tantivy_doc)?;
        Ok(())
    }

    /// Add multiple documents (upsert semantics)
    pub fn add_documents(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            self.add_document(doc)?;
        }
        Ok(())
    }

    /// Remove multiple documents by path
    pub fn remove_documents(&mut self, paths: &[String]) {
        for path in paths {
            self.delete_by_path(path);
        }
    }

    /// Commit all pending changes
    pub fn commit(&mut self) -> Result<(), IndexError> {
        self.writer.commit()?;
        Ok(())
    }

    /// Check if a document with the given path exists
    pub fn has_document(&self, path: &str) -> Result<bool, IndexError> {
        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let searcher = reader.searcher();
        let term = Term::from_field_text(self.fields.path, path);
        let query = TermQuery::new(term, IndexRecordOption::Basic);
        let count = searcher.search(&query, &Count)?;
        Ok(count > 0)
    }

    /// Get the total number of documents in the index
    pub fn document_count(&self) -> Result<u64, IndexError> {
        let reader = self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let searcher = reader.searcher();
        Ok(searcher.num_docs())
    }

    fn delete_by_path(&mut self, path: &str) {
        let term = Term::from_field_text(self.fields.path, path);
        self.writer.delete_term(term);
    }
}

/// Extract directory from a file path (everything before the last /)
fn path_without_filename(path: &str) -> String {
    match path.rfind('/') {
        Some(pos) => path[..pos].to_string(),
        None => String::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::IndexConfig;

    fn make_doc(path: &str, content: &str) -> DocumentInput {
        DocumentInput {
            path: path.to_string(),
            basename: path
                .rsplit('/')
                .next()
                .unwrap_or(path)
                .trim_end_matches(".md")
                .to_string(),
            display_title: String::new(),
            aliases: String::new(),
            content: content.to_string(),
            headings1: String::new(),
            headings2: String::new(),
            headings3: String::new(),
            tags: vec![],
            unmarked_tags: vec![],
            mtime: 1000,
        }
    }

    #[test]
    fn test_add_and_count() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn test_has_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert!(mgr.has_document("notes/test.md").unwrap());
        assert!(!mgr.has_document("notes/other.md").unwrap());
    }

    #[test]
    fn test_upsert() {
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
    fn test_remove_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world"))
            .unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);

        mgr.remove_documents(&["notes/test.md".to_string()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 0);
    }

    #[test]
    fn test_add_multiple() {
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
    fn test_path_without_filename() {
        assert_eq!(path_without_filename("notes/sub/test.md"), "notes/sub");
        assert_eq!(path_without_filename("test.md"), "");
        assert_eq!(path_without_filename("a/b.md"), "a");
    }

    #[test]
    fn test_persist_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index");

        // Create and populate index
        {
            let mut mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            mgr.add_document(&make_doc("test.md", "hello world"))
                .unwrap();
            mgr.commit().unwrap();
        }

        // Reopen and verify
        {
            let mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            assert_eq!(mgr.document_count().unwrap(), 1);
            assert!(mgr.has_document("test.md").unwrap());
        }
    }

    #[test]
    fn test_remove_documents_batch() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        let docs = vec![
            make_doc("a.md", "alpha"),
            make_doc("b.md", "beta"),
            make_doc("c.md", "gamma"),
        ];
        mgr.add_documents(&docs).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 3);

        mgr.remove_documents(&["a.md".to_string(), "c.md".to_string()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
        assert!(!mgr.has_document("a.md").unwrap());
        assert!(mgr.has_document("b.md").unwrap());
        assert!(!mgr.has_document("c.md").unwrap());
    }

    #[test]
    fn test_remove_nonexistent_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("a.md", "alpha")).unwrap();
        mgr.commit().unwrap();

        // Removing a document that doesn't exist should not error
        mgr.remove_documents(&["nonexistent.md".to_string()]);
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn test_add_document_with_all_fields() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        let doc = DocumentInput {
            path: "notes/sub/test.md".to_string(),
            basename: "test".to_string(),
            display_title: "Test Title".to_string(),
            aliases: "alias1 alias2".to_string(),
            content: "Full content here".to_string(),
            headings1: "Heading One".to_string(),
            headings2: "Heading Two".to_string(),
            headings3: "Heading Three".to_string(),
            tags: vec!["#rust".to_string(), "#code".to_string()],
            unmarked_tags: vec!["programming".to_string()],
            mtime: 42000,
        };
        mgr.add_document(&doc).unwrap();
        mgr.commit().unwrap();

        assert_eq!(mgr.document_count().unwrap(), 1);
        assert!(mgr.has_document("notes/sub/test.md").unwrap());
    }

    #[test]
    fn test_upsert_replaces_content() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("a.md", "version one")).unwrap();
        mgr.commit().unwrap();

        mgr.add_document(&make_doc("a.md", "version two")).unwrap();
        mgr.commit().unwrap();

        // Should still be 1 document (upsert, not duplicate)
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn test_diacritics_disabled() {
        let config = IndexConfig {
            ignore_diacritics: false,
        };
        let mut mgr = IndexManager::new_in_memory(config).unwrap();
        mgr.add_document(&make_doc("a.md", "hello")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn test_disk_index_reopen_add_more() {
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
