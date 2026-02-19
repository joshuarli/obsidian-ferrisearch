use tantivy::tokenizer::{Token, TokenFilter, TokenStream, Tokenizer};
use unicode_normalization::UnicodeNormalization;

/// Build the separator regex at runtime using actual Unicode characters.
/// This matches the SEPARATORS from omnisearch's globals.ts - all Unicode
/// punctuation, separators, and whitespace that should split tokens.
fn build_separator_pattern() -> String {
    // Build a character class with all the separator chars.
    // We use the Unicode property classes plus specific ranges from omnisearch.
    // The regex crate supports Unicode properties natively.
    // Using \p{P} (punctuation) + \p{Z} (separator) + \p{S} subset + specific chars
    // covers the omnisearch SEPARATORS regex comprehensively.
    let mut chars = String::new();

    // ASCII separators (from the original JS regex character class)
    // | \t \n \r ^ " = space ! through various ASCII punct
    chars.push('|');
    chars.push('\t');
    chars.push('\n');
    chars.push('\r');
    chars.push('^');
    chars.push('"');
    chars.push('=');
    chars.push(' ');
    // Range: ! # $ % & ' ( ) * + , - . /
    for c in '!'..='/' {
        chars.push(c);
    }
    // < > : ; ? @
    for c in '<'..='@' {
        chars.push(c);
    }
    // [ \ ] ^ _ `
    for c in '['..='`' {
        chars.push(c);
    }
    // { } ~
    chars.push('{');
    chars.push('}');

    // Build the pattern: split on Unicode punctuation, separators, or our specific chars
    // We use \p{P} and \p{Z} Unicode categories which cover the vast majority
    // of the omnisearch SEPARATORS range, plus our explicit ASCII chars.
    format!(r"[\p{{P}}\p{{Z}}\p{{Cc}}{}]+", regex::escape(&chars))
}

/// The main Ferrisearch tokenizer that splits on punctuation/separators.
#[derive(Clone)]
pub struct FerrisearchTokenizer {
    separator_regex: regex::Regex,
}

impl FerrisearchTokenizer {
    pub fn new() -> Self {
        let pattern = build_separator_pattern();
        Self {
            separator_regex: regex::Regex::new(&pattern).expect("Invalid separator regex"),
        }
    }
}

impl Default for FerrisearchTokenizer {
    fn default() -> Self {
        Self::new()
    }
}

impl Tokenizer for FerrisearchTokenizer {
    type TokenStream<'a> = FerrisearchTokenStream;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        let mut tokens = Vec::new();
        let mut position = 0;

        // Split on separators, tracking byte offsets
        let mut last_end = 0;
        for mat in self.separator_regex.find_iter(text) {
            let segment = &text[last_end..mat.start()];
            if !segment.is_empty() {
                self.emit_token_variants(&mut tokens, segment, last_end, &mut position);
            }
            last_end = mat.end();
        }
        // Handle trailing segment
        let segment = &text[last_end..];
        if !segment.is_empty() {
            self.emit_token_variants(&mut tokens, segment, last_end, &mut position);
        }

        FerrisearchTokenStream {
            tokens,
            index: usize::MAX, // Will wrap to 0 on first advance()
        }
    }
}

impl FerrisearchTokenizer {
    fn emit_token_variants(
        &self,
        tokens: &mut Vec<Token>,
        segment: &str,
        offset_from: usize,
        position: &mut usize,
    ) {
        let offset_to = offset_from + segment.len();

        // Add the original token (lowercased)
        tokens.push(Token {
            offset_from,
            offset_to,
            position: *position,
            text: segment.to_lowercase(),
            ..Default::default()
        });
        *position += 1;

        // Also emit camelCase splits
        let camel_splits = split_camel_case(segment);
        for part in &camel_splits {
            tokens.push(Token {
                offset_from,
                offset_to,
                position: *position,
                text: part.to_lowercase(),
                ..Default::default()
            });
            *position += 1;
        }

        // Also emit hyphen splits (hyphen is already a separator, but handle
        // cases where the segment itself contains hyphens that weren't caught)
        let hyphen_splits = split_hyphens(segment);
        for part in &hyphen_splits {
            tokens.push(Token {
                offset_from,
                offset_to,
                position: *position,
                text: part.to_lowercase(),
                ..Default::default()
            });
            *position += 1;
        }
    }
}

/// Token stream produced by FerrisearchTokenizer
pub struct FerrisearchTokenStream {
    tokens: Vec<Token>,
    index: usize,
}

impl TokenStream for FerrisearchTokenStream {
    fn advance(&mut self) -> bool {
        self.index = self.index.wrapping_add(1);
        self.index < self.tokens.len()
    }

    fn token(&self) -> &Token {
        &self.tokens[self.index]
    }

    fn token_mut(&mut self) -> &mut Token {
        &mut self.tokens[self.index]
    }
}

/// Split camelCase: "fooBarBAZ" -> ["foo", "Bar", "BAZ"]
/// Returns empty vec if no camelCase boundary found.
fn split_camel_case(text: &str) -> Vec<String> {
    // Check if there's at least one lowercase->uppercase boundary
    let has_camel = text
        .chars()
        .zip(text.chars().skip(1))
        .any(|(a, b)| a.is_lowercase() && b.is_uppercase());

    if !has_camel {
        return Vec::new();
    }

    let mut parts = Vec::new();
    let mut current = String::new();

    for ch in text.chars() {
        if ch.is_uppercase() && !current.is_empty() {
            // Check if current ends with lowercase (camelCase boundary)
            if current.chars().last().is_some_and(|c| c.is_lowercase()) {
                parts.push(current);
                current = String::new();
            }
        }
        current.push(ch);
    }
    if !current.is_empty() {
        parts.push(current);
    }

    if parts.len() <= 1 { Vec::new() } else { parts }
}

/// Split on hyphens: "foo-bar-baz" -> ["foo", "bar", "baz"]
/// Returns empty vec if no hyphens found.
fn split_hyphens(text: &str) -> Vec<String> {
    if !text.contains('-') {
        return Vec::new();
    }
    text.split('-')
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Token filter that strips diacritics via NFD decomposition
#[derive(Clone)]
pub struct DiacriticFilter;

impl TokenFilter for DiacriticFilter {
    type Tokenizer<T: Tokenizer> = DiacriticFilterWrapper<T>;

    fn transform<T: Tokenizer>(self, tokenizer: T) -> Self::Tokenizer<T> {
        DiacriticFilterWrapper { inner: tokenizer }
    }
}

#[derive(Clone)]
pub struct DiacriticFilterWrapper<T> {
    inner: T,
}

impl<T: Tokenizer> Tokenizer for DiacriticFilterWrapper<T> {
    type TokenStream<'a> = DiacriticFilterStream<T::TokenStream<'a>>;

    fn token_stream<'a>(&'a mut self, text: &'a str) -> Self::TokenStream<'a> {
        DiacriticFilterStream {
            inner: self.inner.token_stream(text),
        }
    }
}

pub struct DiacriticFilterStream<T> {
    inner: T,
}

impl<T: TokenStream> TokenStream for DiacriticFilterStream<T> {
    fn advance(&mut self) -> bool {
        if !self.inner.advance() {
            return false;
        }
        // Strip diacritics: NFD decompose, remove combining marks, NFC normalize
        let text = &self.inner.token().text;
        let stripped: String = text
            .nfd()
            .filter(|c| !unicode_normalization::char::is_combining_mark(*c))
            .nfc()
            .collect();
        self.inner.token_mut().text = stripped;
        true
    }

    fn token(&self) -> &Token {
        self.inner.token()
    }

    fn token_mut(&mut self) -> &mut Token {
        self.inner.token_mut()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tokenize(text: &str) -> Vec<String> {
        let mut tokenizer = FerrisearchTokenizer::new();
        let mut stream = tokenizer.token_stream(text);
        let mut tokens = Vec::new();
        while stream.advance() {
            tokens.push(stream.token().text.clone());
        }
        tokens
    }

    #[test]
    fn test_basic_tokenization() {
        let tokens = tokenize("hello world");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
    }

    #[test]
    fn test_punctuation_split() {
        let tokens = tokenize("foo.bar,baz");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn test_camel_case_split() {
        let tokens = tokenize("fooBarBaz");
        assert!(tokens.contains(&"foobarbaz".to_string())); // Original lowercased
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn test_hyphen_split() {
        // Since hyphen is a separator, "foo-bar-baz" will be split into segments
        // by the regex. The individual segments won't contain hyphens.
        let tokens = tokenize("foo-bar-baz");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn test_no_camel_case_for_all_lower() {
        let splits = split_camel_case("lowercase");
        assert!(splits.is_empty());
    }

    #[test]
    fn test_no_hyphens_for_plain_word() {
        let splits = split_hyphens("nohyphen");
        assert!(splits.is_empty());
    }

    #[test]
    fn test_unicode_separator_split() {
        // EN DASH (U+2013) should be a separator
        let tokens = tokenize("foo\u{2013}bar");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
    }

    #[test]
    fn test_empty_input() {
        let tokens = tokenize("");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_camel_case_function() {
        let parts = split_camel_case("fooBarBAZLorem");
        // Splits at lowercase->uppercase boundaries:
        // foo|Bar|BAZLorem
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[0], "foo");
        assert_eq!(parts[1], "Bar");
        assert_eq!(parts[2], "BAZLorem");
    }

    #[test]
    fn test_lowercasing() {
        let tokens = tokenize("HELLO World");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
    }

    #[test]
    fn test_consecutive_separators() {
        let tokens = tokenize("foo...bar!!!baz");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn test_leading_trailing_separators() {
        let tokens = tokenize("  ...hello world...  ");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"world".to_string()));
        // No empty tokens
        assert!(!tokens.contains(&"".to_string()));
    }

    #[test]
    fn test_only_separators() {
        let tokens = tokenize("...   !!!");
        assert!(tokens.is_empty());
    }

    #[test]
    fn test_camel_case_single_boundary() {
        let parts = split_camel_case("fooBar");
        assert_eq!(parts, vec!["foo", "Bar"]);
    }

    #[test]
    fn test_camel_case_all_upper() {
        // ALL_CAPS has no lowercase->uppercase boundary
        let parts = split_camel_case("ALLCAPS");
        assert!(parts.is_empty());
    }

    #[test]
    fn test_camel_case_single_char_parts() {
        // "aB" has lowercase->uppercase boundary
        let parts = split_camel_case("aB");
        assert_eq!(parts, vec!["a", "B"]);
    }

    #[test]
    fn test_hyphens_leading_trailing() {
        let parts = split_hyphens("-foo-bar-");
        // Leading/trailing hyphens produce empty strings that are filtered
        assert_eq!(parts, vec!["foo", "bar"]);
    }

    #[test]
    fn test_hyphens_double() {
        let parts = split_hyphens("foo--bar");
        assert_eq!(parts, vec!["foo", "bar"]);
    }

    #[test]
    fn test_hyphens_single_segment() {
        // A single segment with leading hyphen
        let parts = split_hyphens("-only");
        assert_eq!(parts, vec!["only"]);
    }

    #[test]
    fn test_unicode_tokenization() {
        // CJK and mixed scripts
        let tokens = tokenize("hello 世界");
        assert!(tokens.contains(&"hello".to_string()));
        assert!(tokens.contains(&"世界".to_string()));
    }

    #[test]
    fn test_tab_and_newline_separators() {
        let tokens = tokenize("foo\tbar\nbaz");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
        assert!(tokens.contains(&"baz".to_string()));
    }

    #[test]
    fn test_pipe_separator() {
        let tokens = tokenize("foo|bar");
        assert!(tokens.contains(&"foo".to_string()));
        assert!(tokens.contains(&"bar".to_string()));
    }

    #[test]
    fn test_diacritic_filter_integration() {
        use tantivy::tokenizer::TokenFilter;
        let base = FerrisearchTokenizer::new();
        let mut tokenizer = DiacriticFilter.transform(base);
        let mut stream = tokenizer.token_stream("café résumé");
        let mut tokens = Vec::new();
        while stream.advance() {
            tokens.push(stream.token().text.clone());
        }
        assert!(tokens.contains(&"cafe".to_string()));
        assert!(tokens.contains(&"resume".to_string()));
    }

    #[test]
    fn test_camel_case_in_tokenizer() {
        // Verify camelCase splits are emitted by the tokenizer
        let tokens = tokenize("myVariableName");
        assert!(tokens.contains(&"myvariablename".to_string())); // full lowercased
        assert!(tokens.contains(&"my".to_string())); // camel split
        assert!(tokens.contains(&"variable".to_string()));
        assert!(tokens.contains(&"name".to_string()));
    }

    #[test]
    fn test_token_positions_increment() {
        let mut tokenizer = FerrisearchTokenizer::new();
        let mut stream = tokenizer.token_stream("hello world");
        let mut positions = Vec::new();
        while stream.advance() {
            positions.push(stream.token().position);
        }
        // Positions should be strictly increasing
        for window in positions.windows(2) {
            assert!(window[1] > window[0]);
        }
    }

    #[test]
    fn test_token_offsets() {
        let mut tokenizer = FerrisearchTokenizer::new();
        let text = "hello world";
        let mut stream = tokenizer.token_stream(text);
        let mut found_hello = false;
        while stream.advance() {
            if stream.token().text == "hello" {
                assert_eq!(stream.token().offset_from, 0);
                assert_eq!(stream.token().offset_to, 5);
                found_hello = true;
            }
        }
        assert!(found_hello);
    }
}
