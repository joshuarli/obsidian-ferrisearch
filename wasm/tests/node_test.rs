use js_sys::{Array, JSON, Reflect};
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use ferrisearch_wasm::SearchIndex;

fn js(json_text: &str) -> JsValue {
    JSON::parse(json_text).expect("test JSON must parse")
}

fn get_str(value: &JsValue, key: &str) -> String {
    Reflect::get(value, &JsValue::from_str(key))
        .expect("key must exist")
        .as_string()
        .expect("value must be a string")
}

fn first_result(results: &JsValue) -> JsValue {
    Array::from(results).get(0)
}

const DOC_A: &str = r##"[{
    "path": "a.md", "basename": "a", "displayTitle": "A",
    "aliases": "", "content": "alpha bravo", "headings": "",
    "tags": [], "unmarkedTags": [], "mtime": 1000.0
}]"##;

#[wasm_bindgen_test]
fn create_index() {
    let idx = SearchIndex::new(JsValue::NULL).unwrap();
    assert_eq!(idx.document_count().unwrap(), 0.0);
}

#[wasm_bindgen_test]
fn create_index_with_config() {
    let config = js(r##"{ "ignoreDiacritics": true }"##);
    let idx = SearchIndex::new(config).unwrap();
    assert_eq!(idx.document_count().unwrap(), 0.0);
}

#[wasm_bindgen_test]
fn add_documents_and_commit() {
    let config = js(r##"{ "ignoreDiacritics": true }"##);
    let mut idx = SearchIndex::new(config).unwrap();

    let docs = js(r##"[{
        "path": "notes/test.md",
        "basename": "test",
        "displayTitle": "Test Note",
        "aliases": "",
        "content": "Hello world, this is a test document about Rust programming",
        "headings": "Introduction",
        "tags": ["#rust", "#code"],
        "unmarkedTags": ["programming"],
        "mtime": 1708300000000.0
    }]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 1.0);
}

#[wasm_bindgen_test]
fn add_multiple_documents() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[
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
    ]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);
}

#[wasm_bindgen_test]
fn search_returns_results() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[
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
    ]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();

    let opts = js(r##"{
        "fuzziness": "1",
        "prefixLength": 1.0,
        "limit": 10.0
    }"##);
    let results = idx.search("hello", opts).unwrap();

    assert!(Array::from(&results).length() > 0);
    assert_eq!(get_str(&first_result(&results), "path"), "notes/hello.md");
}

#[wasm_bindgen_test]
fn search_with_field_boosts() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[{
        "path": "a.md", "basename": "a", "displayTitle": "A",
        "aliases": "", "content": "Some content with keyword",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();

    let opts = js(r##"{
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
    }"##);

    let results = idx.search("keyword", opts).unwrap();
    assert_eq!(Array::from(&results).length(), 1);
}

#[wasm_bindgen_test]
fn remove_documents() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[
        { "path": "a.md", "basename": "a", "displayTitle": "A", "aliases": "", "content": "alpha", "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0 },
        { "path": "b.md", "basename": "b", "displayTitle": "B", "aliases": "", "content": "beta", "headings": "", "tags": [], "unmarkedTags": [], "mtime": 2000.0 }
    ]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);

    let paths = js(r##"["a.md"]"##);
    idx.remove_documents(paths).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 1.0);
    assert!(!idx.has_document("a.md").unwrap());
    assert!(idx.has_document("b.md").unwrap());
}

#[wasm_bindgen_test]
fn warm_up_does_not_panic() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[{
        "path": "a.md", "basename": "a", "displayTitle": "A",
        "aliases": "", "content": "hello", "headings": "",
        "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();
    idx.warm_up().unwrap();
}

#[wasm_bindgen_test]
fn close_and_rejects_after() {
    let config = js(r##"{ "ignoreDiacritics": true }"##);
    let mut idx = SearchIndex::new(config).unwrap();
    idx.close();
    assert!(idx.search("hello", JsValue::NULL).is_err());
}

#[wasm_bindgen_test]
fn serialize_and_load_blob() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[
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
    ]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();
    assert_eq!(idx.document_count().unwrap(), 2.0);

    let blob = idx.serialize_index().unwrap();
    assert!(!blob.is_empty());

    let loaded = SearchIndex::load_from_blob(&blob, JsValue::NULL).unwrap();
    assert_eq!(loaded.document_count().unwrap(), 2.0);
    assert!(loaded.has_document("notes/hello.md").unwrap());
    assert!(loaded.has_document("notes/other.md").unwrap());

    let results = loaded.search("hello", JsValue::NULL).unwrap();
    assert!(Array::from(&results).length() > 0);
    assert_eq!(
        get_str(&first_result(&results), "path"),
        "notes/hello.md"
    );
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

    let docs = js(r##"[{
        "path": "note.md", "basename": "note", "displayTitle": "Recipe",
        "aliases": "", "content": "50g milk powder is key. This is where milk pwoder comes in.",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();

    let opts = js(r##"{
        "fuzziness": "3",
        "prefixLength": 1.0,
        "limit": 10.0
    }"##);
    let results = idx.search("powder", opts).unwrap();

    assert!(
        Array::from(&results).length() > 0,
        "fuzzy-only search for 'powder' should find doc with 'pwoder'"
    );
    assert_eq!(get_str(&first_result(&results), "path"), "note.md");
}

#[wasm_bindgen_test]
fn fuzzy_only_single_file_wasm() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    let docs = js(r##"[{
        "path": "note.md", "basename": "note", "displayTitle": "Recipe",
        "aliases": "", "content": "50g milk powder is key. This is where milk pwoder comes in.",
        "headings": "", "tags": [], "unmarkedTags": [], "mtime": 1000.0
    }]"##);

    idx.add_documents(docs).unwrap();
    idx.commit().unwrap();

    let opts = js(r##"{
        "fuzziness": "3",
        "prefixLength": 1.0,
        "limit": 10.0,
        "singleFilePath": "note.md"
    }"##);
    let results = idx.search("powder", opts).unwrap();

    assert!(
        Array::from(&results).length() > 0,
        "fuzzy-only in-file search should find doc with 'pwoder'"
    );
    assert_eq!(get_str(&first_result(&results), "path"), "note.md");
}

#[wasm_bindgen_test]
fn load_blob_then_add_more_docs() {
    let mut idx = SearchIndex::new(JsValue::NULL).unwrap();

    idx.add_documents(js(DOC_A)).unwrap();
    idx.commit().unwrap();

    let blob = idx.serialize_index().unwrap();
    let mut loaded = SearchIndex::load_from_blob(&blob, JsValue::NULL).unwrap();
    assert_eq!(loaded.document_count().unwrap(), 1.0);

    let more_docs = js(r##"[{
        "path": "b.md", "basename": "b", "displayTitle": "Beta",
        "aliases": "", "content": "charlie delta", "headings": "",
        "tags": [], "unmarkedTags": [], "mtime": 2000.0
    }]"##);
    loaded.add_documents(more_docs).unwrap();
    loaded.commit().unwrap();
    assert_eq!(loaded.document_count().unwrap(), 2.0);
    assert!(loaded.has_document("a.md").unwrap());
    assert!(loaded.has_document("b.md").unwrap());
}

