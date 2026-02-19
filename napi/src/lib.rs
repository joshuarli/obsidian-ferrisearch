use napi::bindgen_prelude::*;
use napi_derive::napi;

use ferrisearch_core::index::IndexManager;
use ferrisearch_core::types;

#[napi(object)]
#[derive(Debug, Clone)]
pub struct DocumentInput {
    pub path: String,
    pub basename: String,
    pub display_title: String,
    pub aliases: String,
    pub content: String,
    pub headings1: String,
    pub headings2: String,
    pub headings3: String,
    pub tags: Vec<String>,
    pub unmarked_tags: Vec<String>,
    pub mtime: f64,
}

impl From<DocumentInput> for types::DocumentInput {
    fn from(d: DocumentInput) -> Self {
        types::DocumentInput {
            path: d.path,
            basename: d.basename,
            display_title: d.display_title,
            aliases: d.aliases,
            content: d.content,
            headings1: d.headings1,
            headings2: d.headings2,
            headings3: d.headings3,
            tags: d.tags,
            unmarked_tags: d.unmarked_tags,
            mtime: d.mtime as u64,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct IndexConfig {
    pub ignore_diacritics: Option<bool>,
}

impl From<IndexConfig> for types::IndexConfig {
    fn from(c: IndexConfig) -> Self {
        types::IndexConfig {
            ignore_diacritics: c.ignore_diacritics.unwrap_or(true),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct FieldBoosts {
    pub basename: Option<f64>,
    pub display_title: Option<f64>,
    pub aliases: Option<f64>,
    pub directory: Option<f64>,
    pub headings1: Option<f64>,
    pub headings2: Option<f64>,
    pub headings3: Option<f64>,
    pub tags_text: Option<f64>,
    pub unmarked_tags: Option<f64>,
    pub content: Option<f64>,
}

impl From<FieldBoosts> for types::FieldBoosts {
    fn from(b: FieldBoosts) -> Self {
        types::FieldBoosts {
            basename: b.basename.unwrap_or(10.0) as f32,
            display_title: b.display_title.unwrap_or(10.0) as f32,
            aliases: b.aliases.unwrap_or(10.0) as f32,
            directory: b.directory.unwrap_or(7.0) as f32,
            headings1: b.headings1.unwrap_or(6.0) as f32,
            headings2: b.headings2.unwrap_or(5.0) as f32,
            headings3: b.headings3.unwrap_or(4.0) as f32,
            tags_text: b.tags_text.unwrap_or(2.0) as f32,
            unmarked_tags: b.unmarked_tags.unwrap_or(2.0) as f32,
            content: b.content.unwrap_or(1.0) as f32,
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchOptions {
    pub field_boosts: Option<FieldBoosts>,
    pub fuzziness: Option<String>,
    pub prefix_length: Option<u32>,
    pub limit: Option<u32>,
    pub single_file_path: Option<String>,
    pub recency_boost: Option<String>,
}

impl From<SearchOptions> for types::SearchOptions {
    fn from(o: SearchOptions) -> Self {
        types::SearchOptions {
            field_boosts: o.field_boosts.map(|b| b.into()).unwrap_or_default(),
            fuzziness: o.fuzziness.unwrap_or_else(|| "1".to_string()),
            prefix_length: o.prefix_length.unwrap_or(1) as usize,
            limit: o.limit.unwrap_or(50) as usize,
            single_file_path: o.single_file_path,
            recency_boost: o.recency_boost.unwrap_or_else(|| "0".to_string()),
        }
    }
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct SearchResult {
    pub path: String,
    pub score: f64,
    pub matched_terms: Vec<String>,
    pub basename: String,
    pub display_title: String,
    pub content: String,
    pub mtime: f64,
    pub tags: Vec<String>,
}

impl From<types::SearchResult> for SearchResult {
    fn from(r: types::SearchResult) -> Self {
        SearchResult {
            path: r.path,
            score: r.score,
            matched_terms: r.matched_terms,
            basename: r.basename,
            display_title: r.display_title,
            content: r.content,
            mtime: r.mtime as f64,
            tags: r.tags,
        }
    }
}

#[napi]
pub struct SearchIndex {
    inner: Option<IndexManager>,
}

#[napi]
impl SearchIndex {
    #[napi(constructor)]
    pub fn new(index_path: String, config: Option<IndexConfig>) -> Result<Self> {
        let cfg = config.map(|c| c.into()).unwrap_or_default();
        let inner = IndexManager::new(&index_path, cfg)
            .map_err(|e| Error::from_reason(format!("Failed to create index: {}", e)))?;
        Ok(Self { inner: Some(inner) })
    }

    #[napi]
    pub fn close(&mut self) -> Result<()> {
        self.inner = None;
        Ok(())
    }

    #[napi]
    pub fn add_documents(&mut self, docs: Vec<DocumentInput>) -> Result<()> {
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        let core_docs: Vec<types::DocumentInput> = docs.into_iter().map(|d| d.into()).collect();
        inner
            .add_documents(&core_docs)
            .map_err(|e| Error::from_reason(format!("Failed to add documents: {}", e)))
    }

    #[napi]
    pub fn remove_documents(&mut self, paths: Vec<String>) -> Result<()> {
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        inner.remove_documents(&paths);
        Ok(())
    }

    #[napi]
    pub fn commit(&mut self) -> Result<()> {
        let inner = self
            .inner
            .as_mut()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        inner
            .commit()
            .map_err(|e| Error::from_reason(format!("Failed to commit: {}", e)))
    }

    #[napi]
    pub fn has_document(&self, path: String) -> Result<bool> {
        let inner = self
            .inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        inner
            .has_document(&path)
            .map_err(|e| Error::from_reason(format!("Failed to check document: {}", e)))
    }

    #[napi]
    pub fn document_count(&self) -> Result<f64> {
        let inner = self
            .inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        inner
            .document_count()
            .map(|c| c as f64)
            .map_err(|e| Error::from_reason(format!("Failed to get document count: {}", e)))
    }

    #[napi]
    pub fn search(
        &self,
        query: String,
        options: Option<SearchOptions>,
    ) -> Result<Vec<SearchResult>> {
        let inner = self
            .inner
            .as_ref()
            .ok_or_else(|| Error::from_reason("Index is closed"))?;
        let opts = options.map(|o| o.into()).unwrap_or_default();
        let results = inner
            .search(&query, &opts)
            .map_err(|e| Error::from_reason(format!("Search failed: {}", e)))?;
        Ok(results.into_iter().map(|r| r.into()).collect())
    }
}
