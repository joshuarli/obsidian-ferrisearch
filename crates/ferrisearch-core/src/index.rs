use std::path::Path;

use tantivy::collector::Count;
use tantivy::query::TermQuery;
use tantivy::schema::IndexRecordOption;
use tantivy::tokenizer::TokenFilter;
use tantivy::{Index, IndexReader, IndexWriter, ReloadPolicy, Term};

use crate::schema::{FieldHandles, build_schema};
use crate::tokenizer::{DiacriticFilter, FerrisearchTokenizer};
use crate::types::{DocumentInput, IndexConfig};

pub struct IndexManager {
    pub(crate) index: Index,
    writer: IndexWriter,
    pub(crate) fields: FieldHandles,
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
    /// Create or open an index at the given directory path.
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
        let writer = index.writer(50_000_000)?;
        Ok(Self { index, writer, fields })
    }

    /// Create an in-memory index (for testing).
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        Self::register_tokenizer(&index, &config);
        let writer = index.writer(15_000_000)?;
        Ok(Self { index, writer, fields })
    }

    fn register_tokenizer(index: &Index, config: &IndexConfig) {
        if config.ignore_diacritics {
            index
                .tokenizers()
                .register("ferrisearch", DiacriticFilter.transform(FerrisearchTokenizer::new()));
        } else {
            index
                .tokenizers()
                .register("ferrisearch", FerrisearchTokenizer::new());
        }
    }

    pub(crate) fn reader(&self) -> Result<IndexReader, IndexError> {
        Ok(self
            .index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?)
    }

    /// Add a single document (upsert: removes existing document with same path first).
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        self.delete_by_path(&doc.path);

        let f = &self.fields;
        let mut d = tantivy::TantivyDocument::new();

        d.add_text(f.path, &doc.path);
        d.add_text(f.basename, &doc.basename);
        d.add_text(f.display_title, &doc.display_title);
        d.add_text(f.directory, path_without_filename(&doc.path));
        d.add_text(f.aliases, &doc.aliases);
        d.add_text(f.content, &doc.content);
        d.add_text(f.headings1, &doc.headings1);
        d.add_text(f.headings2, &doc.headings2);
        d.add_text(f.headings3, &doc.headings3);
        d.add_text(f.tags_text, doc.tags.join(" "));
        d.add_text(f.unmarked_tags, doc.unmarked_tags.join(" "));

        // Tags stored as JSON for post-search retrieval
        use std::collections::BTreeMap;
        use tantivy::schema::OwnedValue;
        let tags_array: Vec<OwnedValue> = doc.tags.iter().map(|t| OwnedValue::Str(t.clone())).collect();
        d.add_object(f.tags_stored, BTreeMap::from([("tags".into(), OwnedValue::Array(tags_array))]));

        d.add_u64(f.mtime, doc.mtime);
        self.writer.add_document(d)?;
        Ok(())
    }

    /// Add multiple documents (upsert semantics).
    pub fn add_documents(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            self.add_document(doc)?;
        }
        Ok(())
    }

    /// Remove multiple documents by path.
    pub fn remove_documents(&mut self, paths: &[String]) {
        for path in paths {
            self.delete_by_path(path);
        }
    }

    pub fn commit(&mut self) -> Result<(), IndexError> {
        self.writer.commit()?;
        Ok(())
    }

    pub fn has_document(&self, path: &str) -> Result<bool, IndexError> {
        let searcher = self.reader()?.searcher();
        let term = Term::from_field_text(self.fields.path, path);
        let count = searcher.search(&TermQuery::new(term, IndexRecordOption::Basic), &Count)?;
        Ok(count > 0)
    }

    pub fn document_count(&self) -> Result<u64, IndexError> {
        Ok(self.reader()?.searcher().num_docs())
    }

    fn delete_by_path(&mut self, path: &str) {
        self.writer
            .delete_term(Term::from_field_text(self.fields.path, path));
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
            headings1: String::new(),
            headings2: String::new(),
            headings3: String::new(),
            tags: vec![],
            unmarked_tags: vec![],
            mtime: 1000,
        }
    }

    #[test]
    fn add_and_count() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn has_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world")).unwrap();
        mgr.commit().unwrap();
        assert!(mgr.has_document("notes/test.md").unwrap());
        assert!(!mgr.has_document("notes/other.md").unwrap());
    }

    #[test]
    fn upsert() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "version 1")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);

        mgr.add_document(&make_doc("notes/test.md", "version 2")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

    #[test]
    fn remove_document() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_document(&make_doc("notes/test.md", "hello world")).unwrap();
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

    #[test]
    fn persist_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index");

        {
            let mut mgr = IndexManager::new(&path, IndexConfig::default()).unwrap();
            mgr.add_document(&make_doc("test.md", "hello world")).unwrap();
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
            headings1: "Heading One".into(),
            headings2: "Heading Two".into(),
            headings3: "Heading Three".into(),
            tags: vec!["#rust".into(), "#code".into()],
            unmarked_tags: vec!["programming".into()],
            mtime: 42000,
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
        let config = IndexConfig { ignore_diacritics: false };
        let mut mgr = IndexManager::new_in_memory(config).unwrap();
        mgr.add_document(&make_doc("a.md", "hello")).unwrap();
        mgr.commit().unwrap();
        assert_eq!(mgr.document_count().unwrap(), 1);
    }

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
