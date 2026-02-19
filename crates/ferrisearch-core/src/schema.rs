use tantivy::schema::*;

#[derive(Debug, Clone)]
pub struct FieldHandles {
    pub path: Field,
    pub basename: Field,
    pub display_title: Field,
    pub directory: Field,
    pub aliases: Field,
    pub content: Field,
    pub headings1: Field,
    pub headings2: Field,
    pub headings3: Field,
    pub tags_text: Field,
    pub unmarked_tags: Field,
    pub tags_stored: Field,
    pub mtime: Field,
}

impl FieldHandles {
    /// All searchable text fields with their names (excludes path, tags_stored, mtime).
    pub fn text_fields(&self) -> [(&'static str, Field); 10] {
        [
            ("basename", self.basename),
            ("display_title", self.display_title),
            ("directory", self.directory),
            ("aliases", self.aliases),
            ("content", self.content),
            ("headings1", self.headings1),
            ("headings2", self.headings2),
            ("headings3", self.headings3),
            ("tags_text", self.tags_text),
            ("unmarked_tags", self.unmarked_tags),
        ]
    }
}

pub fn build_schema() -> (Schema, FieldHandles) {
    let mut b = Schema::builder();

    let path = b.add_text_field("path", STRING | STORED);

    let indexed_stored = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("ferrisearch")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();

    let indexed = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("ferrisearch")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );

    let basename = b.add_text_field("basename", indexed_stored.clone());
    let display_title = b.add_text_field("display_title", indexed_stored.clone());
    let directory = b.add_text_field("directory", indexed.clone());
    let aliases = b.add_text_field("aliases", indexed.clone());
    let content = b.add_text_field("content", indexed_stored);
    let headings1 = b.add_text_field("headings1", indexed.clone());
    let headings2 = b.add_text_field("headings2", indexed.clone());
    let headings3 = b.add_text_field("headings3", indexed.clone());
    let tags_text = b.add_text_field("tags_text", indexed.clone());
    let unmarked_tags = b.add_text_field("unmarked_tags", indexed);
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
            headings1,
            headings2,
            headings3,
            tags_text,
            unmarked_tags,
            tags_stored,
            mtime,
        },
    )
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
            "headings1",
            "headings2",
            "headings3",
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
    fn test_text_fields_returns_10_searchable_fields() {
        let (_, handles) = build_schema();
        let fields = handles.text_fields();
        assert_eq!(fields.len(), 10);
        let names: Vec<&str> = fields.iter().map(|(n, _)| *n).collect();
        assert!(!names.contains(&"path"));
        assert!(!names.contains(&"tags_stored"));
        assert!(!names.contains(&"mtime"));
    }
}
