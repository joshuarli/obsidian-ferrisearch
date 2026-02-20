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

fn from_js<T: serde::de::DeserializeOwned>(val: JsValue) -> Result<T, JsError> {
    serde_wasm_bindgen::from_value(val).map_err(|e| JsError::new(&e.to_string()))
}

fn to_js<T: serde::Serialize>(val: &T) -> Result<JsValue, JsError> {
    serde_wasm_bindgen::to_value(val).map_err(|e| JsError::new(&e.to_string()))
}

#[wasm_bindgen]
impl SearchIndex {
    #[wasm_bindgen(constructor)]
    pub fn new(config: JsValue) -> Result<SearchIndex, JsError> {
        let cfg: types::IndexConfig = if config.is_undefined() || config.is_null() {
            types::IndexConfig::default()
        } else {
            from_js(config)?
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

    #[wasm_bindgen(js_name = "removeDocuments")]
    pub fn remove_documents(&mut self, paths: JsValue) -> Result<(), JsError> {
        let paths: Vec<String> = from_js(paths)?;
        self.inner_mut()?.remove_documents(&paths);
        Ok(())
    }

    pub fn commit(&mut self) -> Result<(), JsError> {
        self.inner_mut()?.commit().map_err(map_err)
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
            from_js(options)?
        };
        let results = self.inner()?.search(query, &opts).map_err(map_err)?;
        to_js(&results)
    }

    pub fn close(&mut self) {
        self.inner = None;
    }
}
