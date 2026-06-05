# Rust Environment

This project uses Rust for `crates/crypto-core` and `wasm-pack` for browser-ready WASM output.

## Installed Local Tooling

The local development machine was initialized with a minimal `rustup` toolchain:

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
. "$HOME/.cargo/env"
rustup target add wasm32-unknown-unknown
cargo install wasm-pack --locked
```

Current verified versions:

```sh
cargo 1.96.0
rustc 1.96.0
wasm-pack 0.15.0
```

## Verification

```sh
. "$HOME/.cargo/env"
npx npx pnpm test:rust
npx pnpm wasm:build
npx pnpm typecheck
npx pnpm test
npx pnpm build
```

`npx pnpm wasm:build` writes the generated package to `packages/crypto-core-wasm/pkg`.

## Uninstall

To remove the Rust environment after development:

```sh
. "$HOME/.cargo/env"
cargo uninstall wasm-pack
rustup self uninstall
```

Then remove the cargo environment line from shell startup files if it is still present:

```sh
grep -R "cargo/env" -n ~/.zprofile ~/.zshrc ~/.profile ~/.bash_profile 2>/dev/null
```

On this machine the installer added:

```sh
. "$HOME/.cargo/env"
```

to `~/.profile`.

`wasm-pack` may also leave a cached `wasm-bindgen` install under:

```sh
~/Library/Caches/.wasm-pack
```

Remove that cache if the Rust/WASM toolchain is no longer needed.
