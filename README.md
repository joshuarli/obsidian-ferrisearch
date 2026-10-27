# Ferrisearch

Ferrisearch searches Markdown notes in your Obsidian vault with fuzzy text search.
It works on desktop and mobile and requires Obsidian 1.13.0 or later.

## Install

1. Download `ferrisearch.zip` from the [GitHub releases](https://github.com/joshuarli/ferrisearch/releases).
2. Extract the archive into `<vault>/.obsidian/plugins/ferrisearch/`.
3. Restart Obsidian, then enable Ferrisearch in **Settings → Community plugins**.

## Search your vault

Click the Ferrisearch ribbon icon or run **Vault search** from the command palette. Type a query to search note titles, folders, text, and headings. Ferrisearch indexes `.md` files only.

Separate words to require each word in a result. Put words in quotes to search for a phrase. Use `path:` to match a folder or file path, and prefix a word with `-` to exclude it from note text.
Use `ext:` to filter results by file extension.

```text
"project plan" path:work ext:md -draft
```

Use the arrow keys to move through results. Press Enter to open a result. Press Tab to switch to In-file search. Ferrisearch saves a query when you open one of its vault results. Open vault search with an empty query to see the ten most recent saved queries.

From a Markdown editor, run **In-file search** to find matches in the current note. Press Enter to jump to a match.

The default minimum query length is three characters. Adjust it in Ferrisearch settings.

## Settings

Ferrisearch saves its settings through Obsidian. Defaults include:

| Setting | Default |
| --- | --- |
| Minimum query length | 3 characters |
| Maximum results | 10 |
| Jump to matching text | On |
| Fuzziness | Slightly fuzzy |
| Folders to downrank | None |
| Show excerpts | On |
| Render line returns in excerpts | On |
| Highlight matching words | On |
| Show score breakdown | Off |
| File name and declared aliases weight | 10 |
| Directory weight | 7 |
| Headings weight | 5 |
| Tags weight | 2 |
| Recency boost | 7 days |
| Ignore diacritics | On |
| Verbose logging | Off |

Fuzziness also offers **Exact match**, **Fuzzy**, and **Fuzzy results only**. Changing **Ignore diacritics** requires an Obsidian restart. Use **Rebuild index** if results are missing or outdated. **Disable on this device** also takes effect after a restart.

The engine does not search alias metadata, and the alias and tag weight controls do not affect core query scores. Matching tag metadata can still boost a result found by text search.

For the API exposed to other Obsidian plugins, see the [plugin API reference](docs/api.md).

## Help and license

Report problems in the [GitHub issue tracker](https://github.com/joshuarli/ferrisearch/issues). Ferrisearch is distributed under the [GNU Lesser General Public License v3](LICENSE).
