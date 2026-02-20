#!/usr/bin/env bash
adb shell mkdir -p "/sdcard/Documents/Test/.obsidian/plugins/ferrisearch"
adb push dist/main.js dist/manifest.json dist/styles.css dist/ferrisearch_wasm_bg.wasm /sdcard/Documents/Test/.obsidian/plugins/ferrisearch
