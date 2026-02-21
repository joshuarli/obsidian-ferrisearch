// Integration tests that run the WASM module in a real wasm32 environment via wasm-bindgen-test.
// Run with: just test-wasm

use serde::Serialize;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use ferrisearch_wasm::SearchIndex;

fn js(val: &serde_json::Value) -> JsValue {
    // Must use serialize_maps_as_objects so serde_json::Value::Object becomes a plain JS object
    // (not a JS Map), which is what serde_wasm_bindgen::from_value expects for struct deserialization.
    val.serialize(&serde_wasm_bindgen::Serializer::new().serialize_maps_as_objects(true))
        .unwrap()
}

#[wasm_bindgen_test]
fn create_index() {
    let idx = SearchIndex::new(JsValue::NULL).unwrap();
    assert_eq!(idx.document_count().unwrap(), 0.0);
}

#[wasm_bindgen_test]
fn create_index_with_config() {
    let config = serde_json::json!({ "ignoreDiacritics": true });
    let idx = SearchIndex::new(js(&config)).unwrap();
    assert_eq!(idx.document_count().unwrap(), 0.0);
}

#[wasm_bindgen_test]
fn add_documents_and_commit() {
    let config = serde_json::json!({ "ignoreDiacritics": true });
    let mut idx = SearchIndex::new(js(&config)).unwrap();

    let docs = serde_json::json!([{
        "path": "notes/test.md",
        "basename": "test",
        "displayTitle": "Test Note",
        "aliases": "",
        "content": "Hello world, this is a test document about Rust programming",
        "headings": "Introduction",
        "tags": ["#rust", "#code"],
        "unmarkedTags": ["programming"],
        "mtime": 1708300000000.0
    }]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 1.0);
}

#[wasm_bindgen_test]
fn add_multiple_documents() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([
        {
            "path": "a.md", "basename": "a", "displayTitle": "Alpha",
            "aliases": "", "content": "Hello world", "headings": "",
            "tags": [], "unmarkedTags": [], "mtime": 1000.0
        },
        {
            "path": "b.md", "basename": "b", "displayTitle": "Beta",
            "aliases": "", "content": "Goodbye world", "headings": "",
            "tags": [], "unmarkedTags": [], "mtime": 2000.0
        }
    ]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);
}

#[wasm_bindgen_test]
fn search_returns_results() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([
        {
            "path": "notes/hello.md", "basename": "hello", "displayTitle": "Hello",
            "aliases": "", "content": "Hello world, this is a test document",
            "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
        },
        {
            "path": "notes/other.md", "basename": "other", "displayTitle": "Other",
            "aliases": "", "content": "Completely unrelated content here",
            "headings": "", "tags": [], "unmarkedTags": [], "mtime": 2000.0
        }
    ]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();

    let opts = serde_json::json!({
        "fuzziness": "1",
        "prefixLength": 1.0,
        "limit": 10.0
    });
    let results = idx.search("hello", js(&opts)).unwrap();

    // Deserialize results to check them
    let results: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(results).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0]["path"], "notes/hello.md");
}

#[wasm_bindgen_test]
fn search_with_field_boosts() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([{
        "path": "a.md", "basename": "a", "displayTitle": "A",
        "aliases": "", "content": "Some content with keyword",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();

    let opts = serde_json::json!({
        "fieldBoosts": {
            "basename": 10.0,
            "displayTitle": 10.0,
            "aliases": 10.0,
            "directory": 7.0,
            "headings": 5.0,
            "tagsText": 2.0,
            "unmarkedTags": 2.0,
            "content": 1.0
        },
        "fuzziness": "1",
        "prefixLength": 1.0,
        "limit": 10.0,
        "recencyBoost": "0"
    });

    let results = idx.search("keyword", js(&opts)).unwrap();
    let results: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(results).unwrap();
    assert_eq!(results.len(), 1);
}

#[wasm_bindgen_test]
fn remove_documents() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([
        { "path": "a.md", "basename": "a", "displayTitle": "A", "aliases": "", "content": "alpha", "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0 },
        { "path": "b.md", "basename": "b", "displayTitle": "B", "aliases": "", "content": "beta", "headings": "", "tags": [], "unmarkedTags": [], "mtime": 2000.0 }
    ]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);

    let paths = serde_json::json!(["a.md"]);
    idx.remove_documents(js(&paths)).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 1.0);
    assert!(!idx.has_document("a.md").unwrap());
    assert!(idx.has_document("b.md").unwrap());
}

#[wasm_bindgen_test]
fn warm_up_does_not_panic() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([{
        "path": "a.md", "basename": "a", "displayTitle": "A",
        "aliases": "", "content": "hello", "headings": "",
        "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();
    idx.warm_up().unwrap();
}

#[wasm_bindgen_test]
fn close_and_rejects_after() {
    let config = serde_json::json!({ "ignoreDiacritics": true });
    let mut idx = SearchIndex::new(js(&config)).unwrap();
    idx.close();
    assert!(idx.search("hello", JsValue::NULL).is_err());
}

#[wasm_bindgen_test]
fn serialize_and_load_blob() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([
        {
            "path": "notes/hello.md", "basename": "hello", "displayTitle": "Hello Note",
            "aliases": "hi howdy", "content": "Hello world, this is about Rust",
            "headings": "Introduction Summary", "tags": ["#rust", "#code"],
            "unmarkedTags": ["programming"], "mtime": 1708300000000.0
        },
        {
            "path": "notes/other.md", "basename": "other", "displayTitle": "Other Note",
            "aliases": "", "content": "Completely different topic here",
            "headings": "Overview", "tags": ["#misc"],
            "unmarkedTags": [], "mtime": 1708400000000.0
        }
    ]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);

    // Serialize to blob
    let blob = idx.serialize_index().unwrap();
    assert!(!blob.is_empty());

    // Load from blob
    let loaded = SearchIndex::load_from_blob(&blob, JsValue::NULL).unwrap();
    assert_eq!(loaded.document_count().unwrap(), 2.0);
    assert!(loaded.has_document("notes/hello.md").unwrap());
    assert!(loaded.has_document("notes/other.md").unwrap());

    // Search works on loaded index
    let results = loaded.search("hello", JsValue::NULL).unwrap();
    let results: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(results).unwrap();
    assert!(!results.is_empty());
    assert_eq!(results[0]["path"], "notes/hello.md");
}

#[wasm_bindgen_test]
fn serialize_empty_index() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();
    idx.commit().unwrap();

    let blob = idx.serialize_index().unwrap();
    let loaded = SearchIndex::load_from_blob(&blob, JsValue::NULL).unwrap();
    assert_eq!(loaded.document_count().unwrap(), 0.0);
}

#[wasm_bindgen_test]
fn fuzzy_only_finds_typo_wasm() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([{
        "path": "note.md", "basename": "note", "displayTitle": "Recipe",
        "aliases": "", "content": "50g milk powder is key. This is where milk pwoder comes in.",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();

    // Fuzzy-only mode (fuzziness "3")
    let opts = serde_json::json!({
        "fuzziness": "3",
        "prefixLength": 1.0,
        "limit": 10.0
    });
    let results = idx.search("powder", js(&opts)).unwrap();
    let results: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(results).unwrap();

    assert!(
        !results.is_empty(),
        "fuzzy-only search for 'powder' should find doc with 'pwoder'"
    );
    assert_eq!(results[0]["path"], "note.md");
}

#[wasm_bindgen_test]
fn fuzzy_only_single_file_wasm() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([{
        "path": "note.md", "basename": "note", "displayTitle": "Recipe",
        "aliases": "", "content": "50g milk powder is key. This is where milk pwoder comes in.",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]);

    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();

    // Fuzzy-only mode with singleFilePath (in-file search)
    let opts = serde_json::json!({
        "fuzziness": "3",
        "prefixLength": 1.0,
        "limit": 10.0,
        "singleFilePath": "note.md"
    });
    let results = idx.search("powder", js(&opts)).unwrap();
    let results: Vec<serde_json::Value> = serde_wasm_bindgen::from_value(results).unwrap();

    assert!(
        !results.is_empty(),
        "fuzzy-only in-file search should find doc with 'pwoder'"
    );
    assert_eq!(results[0]["path"], "note.md");
}

#[wasm_bindgen_test]
fn load_blob_then_add_more_docs() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = serde_json::json!([{
        "path": "a.md", "basename": "a", "displayTitle": "Alpha",
        "aliases": "", "content": "alpha bravo", "headings": "",
        "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]);
    idx.add_documents(js(&docs)).unwrap();
    idx.commit().unwrap();

    // Serialize and load
    let blob = idx.serialize_index().unwrap();
    let mut loaded = SearchIndex::load_from_blob(&blob, JsValue::NULL).unwrap();
    assert_eq!(loaded.document_count().unwrap(), 1.0);

    // Add more documents after loading from blob
    let more_docs = serde_json::json!([{
        "path": "b.md", "basename": "b", "displayTitle": "Beta",
        "aliases": "", "content": "charlie delta", "headings": "",
        "tags": [], "unmarkedTags": [], "mtime": 2000.0
    }]);
    loaded.add_documents(js(&more_docs)).unwrap();
    loaded.commit().unwrap();
    assert_eq!(loaded.document_count().unwrap(), 2.0);
    assert!(loaded.has_document("a.md").unwrap());
    assert!(loaded.has_document("b.md").unwrap());
}
