use wasm_bindgen::prelude::*;

use ferrisearch_core::index::IndexManager;
use ferrisearch_core::types;

#[wasm_bindgen]
pub struct SearchIndex {
    inner: Option<IndexManager>,
}

fn map_err(e: ferrisearch_core::index::IndexError) -> JsError {
    JsError::new(&e.to_string())
}

fn from_js<T: miniserde::Deserialize>(val: JsValue) -> Result<T, JsError> {
    let json = js_sys::JSON::stringify(&val)
        .map_err(|_| JsError::new("Ferrisearch - Failed to serialize JS value"))?;
    let text = json
        .as_string()
        .ok_or_else(|| JsError::new("Ferrisearch - Expected a JSON-serializable value"))?;
    miniserde::json::from_str(&text)
        .map_err(|_| JsError::new("Ferrisearch - Invalid search input"))
}

fn to_js<T: miniserde::Serialize>(val: &T) -> Result<JsValue, JsError> {
    let text = miniserde::json::to_string(val);
    js_sys::JSON::parse(&text).map_err(|_| JsError::new("Ferrisearch - Failed to build JS value"))
}

#[wasm_bindgen]
impl SearchIndex {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<SearchIndex, JsError> {
        let cfg: types::IndexConfig = if config.is_undefined() || config.is_null() {
            types::IndexConfig::default()
        } else {
            from_js::<types::PartialIndexConfig>(config).map(types::IndexConfig::from)?
        };
        let inner = IndexManager::new_in_memory(cfg).map_err(map_err)?;
        Ok(Self { inner: Some(inner) })
    }

    fn inner(&self) -> Result<&IndexManager, JsError> {
        self.inner
            .as_ref()
            .ok_or_else(|| JsError::new("Index is closed"))
    }

    fn inner_mut(&mut self) -> Result<&mut IndexManager, JsError> {
        self.inner
            .as_mut()
            .ok_or_else(|| JsError::new("Index is closed"))
    }

    #[wasm_bindgen(js_name = "addDocuments")]
    pub fn add_documents(&mut self, docs: JsValue) -> Result<(), JsError> {
        let core_docs: Vec<types::DocumentInput> = from_js(docs)?;
        self.inner_mut()?.add_documents(&core_docs).map_err(map_err)
    }

    #[wasm_bindgen(js_name = "addDocumentsBulk")]
    pub fn add_documents_bulk(&mut self, docs: JsValue) -> Result<(), JsError> {
        let core_docs: Vec<types::DocumentInput> = from_js(docs)?;
        self.inner_mut()?
            .add_documents_bulk(&core_docs)
            .map_err(map_err)
    }

    #[wasm_bindgen(js_name = "removeDocuments")]
    pub fn remove_documents(&mut self, paths: JsValue) -> Result<(), JsError> {
        let paths: Vec<String> = from_js(paths)?;
        self.inner_mut()?.remove_documents(&paths);
        Ok(())
    }

    pub fn commit(&mut self) -> Result<(), JsError> {
        self.inner_mut()?.commit().map_err(map_err)
    }

    #[wasm_bindgen(js_name = "commitNoMerge")]
    pub fn commit_no_merge(&mut self) -> Result<(), JsError> {
        self.inner_mut()?.commit_no_merge().map_err(map_err)
    }

    #[wasm_bindgen(js_name = "warmUp")]
    pub fn warm_up(&self) -> Result<(), JsError> {
        self.inner()?.warm_up().map_err(map_err)
    }

    #[wasm_bindgen(js_name = "hasDocument")]
    pub fn has_document(&self, path: &str) -> Result<bool, JsError> {
        self.inner()?.has_document(path).map_err(map_err)
    }

    #[wasm_bindgen(js_name = "documentCount")]
    pub fn document_count(&self) -> Result<f64, JsError> {
        self.inner()?
            .document_count()
            .map(|c| c as f64)
            .map_err(map_err)
    }

    pub fn search(&self, query: &str, options: JsValue) -> Result<JsValue, JsError> {
        let opts: types::SearchOptions = if options.is_undefined() || options.is_null() {
            types::SearchOptions::default()
        } else {
            from_js::<types::PartialSearchOptions>(options).map(types::SearchOptions::from)?
        };
        let results = self.inner()?.search(query, &opts).map_err(map_err)?;
        to_js(&results)
    }

    #[wasm_bindgen(js_name = "serializeIndex")]
    pub fn serialize_index(&self) -> Result<Vec<u8>, JsError> {
        self.inner()?.serialize_to_blob().map_err(map_err)
    }

    #[wasm_bindgen(js_name = "loadFromBlob")]
    pub fn load_from_blob(blob: &[u8], config: JsValue) -> Result<SearchIndex, JsError> {
        let cfg: types::IndexConfig = if config.is_undefined() || config.is_null() {
            types::IndexConfig::default()
        } else {
            from_js::<types::PartialIndexConfig>(config).map(types::IndexConfig::from)?
        };
        let mut inner = IndexManager::load_from_blob(blob, cfg).map_err(map_err)?;
        inner.reconstruct_docs_buffer().map_err(map_err)?;
        Ok(Self { inner: Some(inner) })
    }

    pub fn close(&mut self) {
        self.inner = None;
    }
}
