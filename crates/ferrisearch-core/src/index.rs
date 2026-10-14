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
#[cfg(not(feature = "filesystem"))]
use crate::schema::{doc_text, extract_tags};
use crate::tokenizer::{DiacriticFilter, FerrisearchTokenizer};
use crate::types::{DocumentInput, IndexConfig};

pub struct IndexManager {
    index: Index,
    #[cfg(feature = "filesystem")]
    writer: IndexWriter,
    pub(crate) reader: IndexReader,
    pub(crate) fields: FieldHandles,
    pub(crate) ignore_diacritics: bool,
    #[cfg(not(feature = "filesystem"))]
    docs_buffer: Vec<DocumentInput>,
}

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("Tantivy error: {0}")]
    Tantivy(#[from] tantivy::TantivyError),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[cfg(feature = "filesystem")]
    #[error("Directory open error: {0}")]
    DirectoryOpen(#[from] tantivy::directory::error::OpenDirectoryError),
    #[error("Directory read error: {0}")]
    DirectoryRead(#[from] tantivy::directory::error::OpenReadError),
    #[error("Blob error: {0}")]
    Blob(String),
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
        let writer = index.writer_with_num_threads(4, 120_000_000)?;
        Ok(Self {
            index,
            writer,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
        })
    }

    #[cfg(feature = "filesystem")]
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        Self::register_tokenizer(&index, &config);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let writer = index.writer_with_num_threads(1, 15_000_000)?;
        Ok(Self {
            index,
            writer,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
        })
    }

    #[cfg(not(feature = "filesystem"))]
    pub fn new_in_memory(config: IndexConfig) -> Result<Self, IndexError> {
        let (schema, fields) = build_schema();
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


    #[cfg(feature = "filesystem")]
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        self.delete_by_path(&doc.path);
        let d = Self::build_tantivy_doc(&self.fields, doc);
        self.writer.add_document(d)?;
        Ok(())
    }

    pub fn add_documents(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            self.add_document(doc)?;
        }
        Ok(())
    }

    /// Add documents without upserting (no delete_by_path before insert).
    /// Use during bulk indexing when removes are handled separately.
    #[cfg(feature = "filesystem")]
    pub fn add_documents_bulk(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        for doc in docs {
            let d = Self::build_tantivy_doc(&self.fields, doc);
            self.writer.add_document(d)?;
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

    /// Commit without force-merging segments. Use during bulk indexing
    /// where the merge cost isn't worth blocking on.
    #[cfg(feature = "filesystem")]
    pub fn commit_no_merge(&mut self) -> Result<(), IndexError> {
        self.writer.commit()?;
        self.reader.reload()?;
        Ok(())
    }

    #[cfg(feature = "filesystem")]
    fn delete_by_path(&mut self, path: &str) {
        self.writer
            .delete_term(Term::from_field_text(self.fields.path, path));
    }


    #[cfg(not(feature = "filesystem"))]
    fn add_document(&mut self, doc: &DocumentInput) -> Result<(), IndexError> {
        self.docs_buffer.retain(|d| d.path != doc.path);
        self.docs_buffer.push(doc.clone());
        Ok(())
    }

    /// Bulk add without dedup — caller guarantees no duplicates.
    #[cfg(not(feature = "filesystem"))]
    pub fn add_documents_bulk(&mut self, docs: &[DocumentInput]) -> Result<(), IndexError> {
        self.docs_buffer.extend(docs.iter().cloned());
        Ok(())
    }

    #[cfg(not(feature = "filesystem"))]
    pub fn remove_documents(&mut self, paths: &[String]) {
        self.docs_buffer.retain(|d| !paths.contains(&d.path));
    }

    /// Alias for commit() — WASM has no merge step.
    #[cfg(not(feature = "filesystem"))]
    pub fn commit_no_merge(&mut self) -> Result<(), IndexError> {
        self.commit()
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


    const BLOB_MAGIC: &'static [u8; 4] = b"FERI";
    const BLOB_VERSION: u32 = 1;

    /// Serialize the current index to a binary blob.
    pub fn serialize_to_blob(&self) -> Result<Vec<u8>, IndexError> {
        use std::path::Path;
        use tantivy::directory::Directory;

        let dir = self.index.directory();

        let mut files: Vec<(String, Vec<u8>)> = Vec::new();

        let meta_bytes = dir.atomic_read(Path::new("meta.json"))?;
        files.push(("meta.json".into(), meta_bytes));

        let metas = self.index.searchable_segment_metas()?;
        for meta in &metas {
            for file_path in meta.list_files() {
                match dir.atomic_read(&file_path) {
                    Ok(data) => {
                        files.push((file_path.to_string_lossy().into_owned(), data));
                    }
                    Err(tantivy::directory::error::OpenReadError::FileDoesNotExist(_)) => continue,
                    Err(e) => return Err(e.into()),
                }
            }
        }

        let mut blob = Vec::new();
        blob.extend_from_slice(Self::BLOB_MAGIC);
        blob.extend_from_slice(&Self::BLOB_VERSION.to_le_bytes());
        blob.push(self.ignore_diacritics as u8);

        blob.extend_from_slice(&(files.len() as u32).to_le_bytes());
        for (name, data) in &files {
            let name_bytes = name.as_bytes();
            blob.extend_from_slice(&(name_bytes.len() as u32).to_le_bytes());
            blob.extend_from_slice(name_bytes);
            blob.extend_from_slice(&(data.len() as u64).to_le_bytes());
            blob.extend_from_slice(data);
        }

        Ok(blob)
    }

    /// Load an index from a previously serialized blob.
    pub fn load_from_blob(blob: &[u8], config: IndexConfig) -> Result<Self, IndexError> {
        use std::path::Path;
        use tantivy::directory::{Directory, RamDirectory};

        if blob.len() < 9 {
            return Err(IndexError::Blob("blob too short".into()));
        }
        if &blob[0..4] != Self::BLOB_MAGIC {
            return Err(IndexError::Blob("invalid magic".into()));
        }
        let version = u32::from_le_bytes(blob[4..8].try_into().unwrap());
        if version != Self::BLOB_VERSION {
            return Err(IndexError::Blob(format!("unsupported version: {version}")));
        }
        let stored_diacritics = blob[8] != 0;
        if stored_diacritics != config.ignore_diacritics {
            return Err(IndexError::Blob("diacritics config mismatch".into()));
        }

        let mut cursor = 9usize;
        let read_u32 = |c: &mut usize| -> Result<u32, IndexError> {
            if *c + 4 > blob.len() {
                return Err(IndexError::Blob("unexpected end of blob".into()));
            }
            let val = u32::from_le_bytes(blob[*c..*c + 4].try_into().unwrap());
            *c += 4;
            Ok(val)
        };
        let read_u64 = |c: &mut usize| -> Result<u64, IndexError> {
            if *c + 8 > blob.len() {
                return Err(IndexError::Blob("unexpected end of blob".into()));
            }
            let val = u64::from_le_bytes(blob[*c..*c + 8].try_into().unwrap());
            *c += 8;
            Ok(val)
        };

        let file_count = read_u32(&mut cursor)? as usize;
        let dir = RamDirectory::create();

        for _ in 0..file_count {
            let name_len = read_u32(&mut cursor)? as usize;
            if cursor + name_len > blob.len() {
                return Err(IndexError::Blob("unexpected end of blob".into()));
            }
            let name = std::str::from_utf8(&blob[cursor..cursor + name_len])
                .map_err(|e| IndexError::Blob(format!("invalid filename: {e}")))?;
            cursor += name_len;

            let data_len = read_u64(&mut cursor)? as usize;
            if cursor + data_len > blob.len() {
                return Err(IndexError::Blob("unexpected end of blob".into()));
            }
            let data = &blob[cursor..cursor + data_len];
            cursor += data_len;

            dir.atomic_write(Path::new(name), data)?;
        }

        let index = Index::open(dir)?;
        Self::register_tokenizer(&index, &config);
        let reader = index
            .reader_builder()
            .reload_policy(ReloadPolicy::Manual)
            .try_into()?;
        let (_, fields) = build_schema();

        Ok(Self {
            #[cfg(feature = "filesystem")]
            writer: index.writer_with_num_threads(1, 15_000_000)?,
            index,
            reader,
            fields,
            ignore_diacritics: config.ignore_diacritics,
            #[cfg(not(feature = "filesystem"))]
            docs_buffer: Vec::new(),
        })
    }

    /// Reconstruct docs_buffer by reading all stored documents from the index.
    /// Must be called after load_from_blob() before any add/remove/commit operations.
    /// On desktop (filesystem feature), this is a no-op.
    #[cfg(feature = "filesystem")]
    pub fn reconstruct_docs_buffer(&mut self) -> Result<(), IndexError> {
        Ok(())
    }

    /// Reconstruct docs_buffer by reading all stored documents from the index.
    /// Must be called after load_from_blob() before any add/remove/commit operations.
    #[cfg(not(feature = "filesystem"))]
    pub fn reconstruct_docs_buffer(&mut self) -> Result<(), IndexError> {
        use tantivy::schema::Value;

        let searcher = self.reader.searcher();
        let f = &self.fields;
        let mut buffer = Vec::new();

        for segment_reader in searcher.segment_readers() {
            let store_reader = segment_reader.get_store_reader(1)?;
            for doc_id in 0..segment_reader.num_docs() {
                let doc: tantivy::TantivyDocument = store_reader.get(doc_id)?;

                let unmarked_tags_text = doc_text(&doc, f.unmarked_tags);
                let unmarked_tags: Vec<String> = if unmarked_tags_text.is_empty() {
                    vec![]
                } else {
                    unmarked_tags_text
                        .split_whitespace()
                        .map(String::from)
                        .collect()
                };

                buffer.push(DocumentInput {
                    path: doc_text(&doc, f.path),
                    basename: doc_text(&doc, f.basename),
                    display_title: doc_text(&doc, f.display_title),
                    aliases: doc_text(&doc, f.aliases),
                    content: doc_text(&doc, f.content),
                    headings: doc_text(&doc, f.headings),
                    tags: extract_tags(&doc, f.tags_stored),
                    unmarked_tags,
                    mtime: doc.get_first(f.mtime).and_then(|v| v.as_u64()).unwrap_or(0) as f64,
                });
            }
        }

        self.docs_buffer = buffer;
        Ok(())
    }

    /// Pre-warm term dictionaries by loading FSTs into the OS page cache.
    /// Call once after initial indexing and when opening the search modal.
    pub fn warm_up(&self) -> Result<(), IndexError> {
        let searcher = self.reader.searcher();
        for reader in searcher.segment_readers() {
            for (_, field) in self.fields.text_fields() {
                let inv = reader.inverted_index(field)?;
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

    #[test]
    fn serialize_and_load_blob() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.add_documents(&[
            make_doc("a.md", "alpha bravo"),
            make_doc("b.md", "charlie delta"),
        ])
        .unwrap();
        mgr.commit().unwrap();

        let blob = mgr.serialize_to_blob().unwrap();
        assert!(!blob.is_empty());

        let loaded = IndexManager::load_from_blob(&blob, IndexConfig::default()).unwrap();
        assert_eq!(loaded.document_count().unwrap(), 2);
        assert!(loaded.has_document("a.md").unwrap());
        assert!(loaded.has_document("b.md").unwrap());
    }

    #[test]
    fn serialize_empty_index() {
        let mut mgr = IndexManager::new_in_memory(IndexConfig::default()).unwrap();
        mgr.commit().unwrap();

        let blob = mgr.serialize_to_blob().unwrap();
        let loaded = IndexManager::load_from_blob(&blob, IndexConfig::default()).unwrap();
        assert_eq!(loaded.document_count().unwrap(), 0);
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
