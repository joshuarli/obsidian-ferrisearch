# Development

Install Deno and the pinned Rust toolchain in [`rust-toolchain.toml`](../rust-toolchain.toml). Then install pnpm 12.13.0, as pinned in [`package.json`](../package.json), and the project packages:

```sh
deno task bootstrap
pnpm install
```

## Build and check

| Command | Result |
| --- | --- |
| `pnpm run build` | Lint, TypeScript checks, and the plugin bundle |
| `pnpm run build:wasm` | WASM engine and generated bindings |
| `pnpm run build:rust` | Native NAPI module for the current host |
| `pnpm run build:all` | Native module, WASM engine, checks, and plugin bundle |
| `pnpm run dev` | Watch-mode plugin bundle |
| `pnpm run test` | TypeScript tests |
| `cargo test` | Rust tests |
| `pnpm run lint:check` | Oxlint check |
| `pnpm run typecheck` | TypeScript and Deno checks |
| `cargo clippy --all-targets --all-features -- -D warnings` | Rust lint check |

`pnpm run build` does not build Rust or WASM artifacts. Use `pnpm run build:all` when you need all three plugin components. The `pnpm run build:wasm` script expects the matching `wasm-bindgen` CLI on `PATH`. `make build-wasm` installs the locked version if needed. The build scripts are defined in [`package.json`](../package.json) and [`build.ts`](../build.ts).

The native CLI harness requires a macOS arm64 native build and `fd`. Its optional `--file` argument prints that file's rank and indexed fields:

```sh
pnpm run test-search <markdown-directory> <query> [fuzziness] [--file <path>]
```

See [performance](performance.md) for its benchmark method. Use [releases](releases.md) for packaging and installation commands.
