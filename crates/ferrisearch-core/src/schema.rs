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
