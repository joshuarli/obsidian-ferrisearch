use tantivy::schema::*;

/// Field handles for quick access after schema creation
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
    /// Returns all searchable text fields with their names (excluding path)
    pub fn text_fields(&self) -> Vec<(&'static str, Field)> {
        vec![
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

/// Build the Tantivy schema and return (schema, field handles)
pub fn build_schema() -> (Schema, FieldHandles) {
    let mut builder = Schema::builder();

    // path: unique ID, exact match only, stored for retrieval
    let path = builder.add_text_field("path", STRING | STORED);

    // Custom tokenizer options: indexed with freqs+positions for BM25
    let text_options = TextOptions::default()
        .set_indexing_options(
            TextFieldIndexing::default()
                .set_tokenizer("ferrisearch")
                .set_index_option(IndexRecordOption::WithFreqsAndPositions),
        )
        .set_stored();

    let text_not_stored = TextOptions::default().set_indexing_options(
        TextFieldIndexing::default()
            .set_tokenizer("ferrisearch")
            .set_index_option(IndexRecordOption::WithFreqsAndPositions),
    );

    let basename = builder.add_text_field("basename", text_options.clone());
    let display_title = builder.add_text_field("display_title", text_options.clone());
    let directory = builder.add_text_field("directory", text_not_stored.clone());
    let aliases = builder.add_text_field("aliases", text_not_stored.clone());
    let content = builder.add_text_field("content", text_options.clone());
    let headings1 = builder.add_text_field("headings1", text_not_stored.clone());
    let headings2 = builder.add_text_field("headings2", text_not_stored.clone());
    let headings3 = builder.add_text_field("headings3", text_not_stored.clone());
    let tags_text = builder.add_text_field("tags_text", text_not_stored.clone());
    let unmarked_tags = builder.add_text_field("unmarked_tags", text_not_stored);

    // Tags stored as JSON for post-search boost
    let tags_stored = builder.add_json_field("tags_stored", STORED);

    // Modification time: stored and fast for sorting/scoring
    let mtime = builder.add_u64_field("mtime", STORED | FAST);

    let schema = builder.build();
    let handles = FieldHandles {
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
    };

    (schema, handles)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_schema_returns_all_fields() {
        let (schema, handles) = build_schema();
        // Verify all fields exist by looking them up by name
        assert!(schema.get_field("path").is_ok());
        assert!(schema.get_field("basename").is_ok());
        assert!(schema.get_field("display_title").is_ok());
        assert!(schema.get_field("directory").is_ok());
        assert!(schema.get_field("aliases").is_ok());
        assert!(schema.get_field("content").is_ok());
        assert!(schema.get_field("headings1").is_ok());
        assert!(schema.get_field("headings2").is_ok());
        assert!(schema.get_field("headings3").is_ok());
        assert!(schema.get_field("tags_text").is_ok());
        assert!(schema.get_field("unmarked_tags").is_ok());
        assert!(schema.get_field("tags_stored").is_ok());
        assert!(schema.get_field("mtime").is_ok());

        // Verify handles match schema lookups
        assert_eq!(handles.path, schema.get_field("path").unwrap());
        assert_eq!(handles.basename, schema.get_field("basename").unwrap());
        assert_eq!(handles.content, schema.get_field("content").unwrap());
        assert_eq!(handles.mtime, schema.get_field("mtime").unwrap());
    }

    #[test]
    fn test_text_fields_returns_10_searchable_fields() {
        let (_schema, handles) = build_schema();
        let text_fields = handles.text_fields();
        assert_eq!(text_fields.len(), 10);

        let names: Vec<&str> = text_fields.iter().map(|(name, _)| *name).collect();
        assert!(names.contains(&"basename"));
        assert!(names.contains(&"display_title"));
        assert!(names.contains(&"directory"));
        assert!(names.contains(&"aliases"));
        assert!(names.contains(&"content"));
        assert!(names.contains(&"headings1"));
        assert!(names.contains(&"headings2"));
        assert!(names.contains(&"headings3"));
        assert!(names.contains(&"tags_text"));
        assert!(names.contains(&"unmarked_tags"));
    }

    #[test]
    fn test_text_fields_excludes_non_searchable() {
        let (_schema, handles) = build_schema();
        let text_fields = handles.text_fields();
        let names: Vec<&str> = text_fields.iter().map(|(name, _)| *name).collect();
        // path, tags_stored, mtime should not be in text_fields
        assert!(!names.contains(&"path"));
        assert!(!names.contains(&"tags_stored"));
        assert!(!names.contains(&"mtime"));
    }

}
