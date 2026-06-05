// Type declarations for static .wasm imports in Cloudflare Workers
declare module "*.wasm" {
  const module: WebAssembly.Module;
  export default module;
}
