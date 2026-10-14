use tantivy::TantivyDocument;
use tantivy::schema::*;

#[derive(Debug, Clone)]
pub struct FieldHandles {
    pub path: Field,
    pub basename: Field,
    pub display_title: Field,
    pub directory: Field,
    pub aliases: Field,
    pub content: Field,
    pub headings: Field,
    pub tags_text: Field,
    pub unmarked_tags: Field,
    pub tags_stored: Field,
    pub mtime: Field,
}

impl FieldHandles {
    /// Primary searchable text fields (excludes basename, tags, aliases, path, tags_stored, mtime).
    pub fn text_fields(&self) -> [(&'static str, Field); 4] {
        [
            ("display_title", self.display_title),
            ("directory", self.directory),
            ("content", self.content),
            ("headings", self.headings),
        ]
    }
}

pub fn build_schema() -> (Schema, FieldHandles) {
    let mut b = Schema::builder();

    let path = b.add_text_field("path", STRING | STORED);

    let indexing = TextFieldIndexing::default()
        .set_tokenizer("ferrisearch")
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let indexing_no_norms = indexing.clone().set_fieldnorms(false);

    let content_opts = TextOptions::default()
        .set_indexing_options(indexing)
        .set_stored();

    let searchable_short_stored = TextOptions::default()
        .set_indexing_options(indexing_no_norms.clone())
        .set_stored();

    let stored_only = TextOptions::default().set_stored();

    let short = TextOptions::default().set_indexing_options(indexing_no_norms);

    let basename = b.add_text_field("basename", stored_only.clone());
    let display_title = b.add_text_field("display_title", searchable_short_stored.clone());
    let directory = b.add_text_field("directory", short.clone());
    let aliases = b.add_text_field("aliases", stored_only.clone());
    let content = b.add_text_field("content", content_opts);
    let headings = b.add_text_field("headings", searchable_short_stored);
    let tags_text = b.add_text_field("tags_text", TextOptions::default());
    let unmarked_tags = b.add_text_field("unmarked_tags", stored_only);
    let tags_stored = b.add_json_field("tags_stored", STORED);
    let mtime = b.add_u64_field("mtime", STORED | FAST);

    (
        b.build(),
        FieldHandles {
            path,
            basename,
            display_title,
            directory,
            aliases,
            content,
            headings,
            tags_text,
            unmarked_tags,
            tags_stored,
            mtime,
        },
    )
}

pub(crate) fn doc_text(doc: &TantivyDocument, field: Field) -> String {
    doc.get_first(field)
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

pub(crate) fn extract_tags(doc: &TantivyDocument, tags_stored: Field) -> Vec<String> {
    doc.get_first(tags_stored)
        .and_then(|v| v.as_object())
        .and_then(|obj| obj.into_iter().find(|(k, _)| *k == "tags"))
        .and_then(|(_, v)| v.as_array())
        .map(|arr| {
            arr.into_iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_schema_returns_all_fields() {
        let (schema, handles) = build_schema();
        for name in [
            "path",
            "basename",
            "display_title",
            "directory",
            "aliases",
            "content",
            "headings",
            "tags_text",
            "unmarked_tags",
            "tags_stored",
            "mtime",
        ] {
            assert!(schema.get_field(name).is_ok(), "missing field: {name}");
        }
        assert_eq!(handles.path, schema.get_field("path").unwrap());
        assert_eq!(handles.content, schema.get_field("content").unwrap());
        assert_eq!(handles.mtime, schema.get_field("mtime").unwrap());
    }

    #[test]
    fn test_text_fields_returns_searchable_fields() {
        let (_, handles) = build_schema();
        let fields = handles.text_fields();
        assert_eq!(fields.len(), 4);
        let names: Vec<&str> = fields.iter().map(|(n, _)| *n).collect();
        assert!(names.contains(&"display_title"));
        assert!(names.contains(&"directory"));
        assert!(names.contains(&"content"));
        assert!(names.contains(&"headings"));
    }
}
