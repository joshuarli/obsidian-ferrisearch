# Releases

The manual [GitHub Actions workflow](../.github/workflows/build.yml) checks lint, types, and TypeScript tests before packaging a prerelease on a macOS 26 arm64 runner. Run **Build prerelease** with `workflow_dispatch`. The workflow publishes `ferrisearch.zip` as a prerelease asset.

On macOS arm64, build and install into a vault with:

```sh
make install
```

`make install` builds native, WASM, and plugin files. It uses the release profile by default and installs the `wasm-bindgen` CLI version from `Cargo.lock` if needed. Set `PROFILE=dev-fast` for iteration builds.

Set the `VAULT_PLUGIN` Make variable to choose an install destination. Both install targets default to the vault path in the [`Makefile`](../Makefile). Create the release archive with `make package`. Install the newest prerelease with `make install-remote`. That target requires the GitHub CLI and `unzip`.
