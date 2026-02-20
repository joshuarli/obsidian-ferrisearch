The Node.js and Electron APIs are only available in the desktop version of Obsidian. For example, Node.js packages like fs, crypto, and os, are only available on desktop.

I guess we should build napis for all platforms like darwin-amd64, linux, windows, android etc. This needs to be done in github actions build.yml and then an optional step after the build to upload a release if it's a tagged commit. Then the typescript code needs to detect platform and select the right thing to load. Is there any prior art of a plugin that does this?

is it possible to search "milk powder" and match "milk pwoder"?
my notes have a lot of typos

tab to switch to in-file search is broken
