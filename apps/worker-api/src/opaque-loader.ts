// Custom OPAQUE WASM loader for Cloudflare Workers
// Uses static .wasm import instead of WebAssembly.compile() which is disallowed in Workers

// Static WASM import — produces WebAssembly.Module in Workers runtime
import opaqueWasmModule from "./opaque.wasm";

// ── Internal state ──────────────────────────────────────────────────────────

let wasm: any;
let WASM_VECTOR_LEN = 0;
let cachedDataViewMemory0: DataView | null = null;
let cachedUint8ArrayMemory0: Uint8Array | null = null;

const cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();

const cachedTextEncoder = new TextEncoder();

// ── Helper functions ────────────────────────────────────────────────────────

function getUint8ArrayMemory0(): Uint8Array {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}

function getDataViewMemory0(): DataView {
  if (
    cachedDataViewMemory0 === null ||
    (cachedDataViewMemory0 as any).buffer.detached === true ||
    ((cachedDataViewMemory0 as any).buffer.detached === undefined &&
      cachedDataViewMemory0.buffer !== wasm.memory.buffer)
  ) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}

function isLikeNone(x: unknown): x is undefined | null {
  return x === undefined || x === null;
}

function addToExternrefTable0(obj: unknown): number {
  const idx = wasm.__externref_table_alloc();
  wasm.__wbindgen_externrefs.set(idx, obj);
  return idx;
}

function takeFromExternrefTable0(idx: number): unknown {
  const value = wasm.__wbindgen_externrefs.get(idx);
  wasm.__externref_table_dealloc(idx);
  return value;
}

function handleError(f: Function, args: IArguments): unknown {
  try {
    return f.apply(undefined, Array.from(args));
  } catch (e) {
    const idx = addToExternrefTable0(e);
    wasm.__wbindgen_exn_store(idx);
    return undefined;
  }
}

function debugString(val: unknown): string {
  const type = typeof val;
  if (type === "number" || type === "boolean" || val === null) {
    return `${val}`;
  }
  if (type === "string") {
    return `"${val}"`;
  }
  if (type === "symbol") {
    const description = (val as symbol).description;
    return description == null ? "Symbol" : `Symbol(${description})`;
  }
  if (type === "function") {
    const name = (val as Function).name;
    return typeof name === "string" && name.length > 0 ? `Function(${name})` : "Function";
  }
  if (Array.isArray(val)) {
    const length = val.length;
    let debug = "[";
    if (length > 0) {
      debug += debugString(val[0]);
    }
    for (let i = 1; i < length; i++) {
      debug += ", " + debugString(val[i]);
    }
    debug += "]";
    return debug;
  }
  const builtInMatches = /\[object ([^\]]+)\]/.exec(Object.prototype.toString.call(val));
  let className: string;
  if (builtInMatches && builtInMatches.length > 1) {
    className = builtInMatches[1] ?? "Unknown";
  } else {
    return Object.prototype.toString.call(val);
  }
  if (className === "Object") {
    try {
      return "Object(" + JSON.stringify(val) + ")";
    } catch {
      return "Object";
    }
  }
  if (val instanceof Error) {
    return `${val.name}: ${val.message}\n${val.stack}`;
  }
  return className;
}

function getArrayU8FromWasm0(ptr: number, len: number): Uint8Array {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

function passStringToWasm0(arg: string, malloc: Function, realloc?: Function): number {
  if (realloc === undefined) {
    const buf = cachedTextEncoder.encode(arg);
    const ptr = malloc(buf.length, 1) >>> 0;
    getUint8ArrayMemory0()
      .subarray(ptr, ptr + buf.length)
      .set(buf);
    WASM_VECTOR_LEN = buf.length;
    return ptr;
  }
  let len = arg.length;
  let ptr = malloc(len, 1) >>> 0;
  const mem = getUint8ArrayMemory0();
  let offset = 0;
  for (; offset < len; offset++) {
    const code = arg.charCodeAt(offset);
    if (code > 127) break;
    mem[ptr + offset] = code;
  }
  if (offset !== len) {
    if (offset !== 0) {
      arg = arg.slice(offset);
    }
    ptr = realloc(ptr, len, (len = offset + arg.length * 3), 1) >>> 0;
    const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
    const ret = cachedTextEncoder.encodeInto(arg, view);
    offset += ret.written!;
    ptr = realloc(ptr, len, offset, 1) >>> 0;
  }
  WASM_VECTOR_LEN = offset;
  return ptr;
}

function getStringFromWasm0(ptr: number, len: number): string {
  ptr = ptr >>> 0;
  const numBytesDecoded = len;
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

// ── WASM imports ────────────────────────────────────────────────────────────

function getImports() {
  const import0 = {
    __wbg_Error_8c4e43fe74559d73: function (arg0: number, arg1: number) {
      const ret = Error(getStringFromWasm0(arg0, arg1));
      return ret;
    },
    __wbg_Number_04624de7d0e8332d: function (arg0: unknown) {
      const ret = Number(arg0);
      return ret;
    },
    __wbg_String_8f0eb39a4a4c2f66: function (arg0: number, arg1: unknown) {
      const ret = String(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_boolean_get_bbbb1c18aa2f5e25: function (arg0: unknown) {
      const v = arg0;
      const ret = typeof v === "boolean" ? v : undefined;
      return isLikeNone(ret) ? 16777215 : ret ? 1 : 0;
    },
    __wbg___wbindgen_debug_string_0bc8482c6e3508ae: function (arg0: number, arg1: unknown) {
      const ret = debugString(arg1);
      const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_in_47fa6863be6f2f25: function (arg0: unknown, arg1: unknown) {
      const ret = (arg0 as any) in (arg1 as any);
      return ret;
    },
    __wbg___wbindgen_is_function_0095a73b8b156f76: function (arg0: unknown) {
      const ret = typeof arg0 === "function";
      return ret;
    },
    __wbg___wbindgen_is_object_5ae8e5880f2c1fbd: function (arg0: unknown) {
      const val = arg0;
      const ret = typeof val === "object" && val !== null;
      return ret;
    },
    __wbg___wbindgen_is_string_cd444516edc5b180: function (arg0: unknown) {
      const ret = typeof arg0 === "string";
      return ret;
    },
    __wbg___wbindgen_is_undefined_9e4d92534c42d778: function (arg0: unknown) {
      const ret = arg0 === undefined;
      return ret;
    },
    __wbg___wbindgen_jsval_loose_eq_9dd77d8cd6671811: function (arg0: unknown, arg1: unknown) {
      const ret = arg0 == arg1;
      return ret;
    },
    __wbg___wbindgen_number_get_8ff4255516ccad3e: function (arg0: number, arg1: unknown) {
      const obj = arg1;
      const ret = typeof obj === "number" ? obj : undefined;
      getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, Number(!isLikeNone(ret)), true);
    },
    __wbg___wbindgen_string_get_72fb696202c56729: function (arg0: number, arg1: unknown) {
      const obj = arg1;
      const ret = typeof obj === "string" ? obj : undefined;
      const ptr1 = isLikeNone(ret)
        ? 0
        : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
      const len1 = WASM_VECTOR_LEN;
      getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
      getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
    },
    __wbg___wbindgen_throw_be289d5034ed271b: function (arg0: number, arg1: number) {
      throw new Error(getStringFromWasm0(arg0, arg1));
    },
    __wbg_call_389efe28435a9388: function () {
      return handleError(function (arg0: Function, arg1: unknown) {
        const ret = arg0.call(arg1);
        return ret;
      }, arguments);
    },
    __wbg_call_4708e0c13bdc8e95: function () {
      return handleError(function (arg0: Function, arg1: unknown, arg2: unknown) {
        const ret = arg0.call(arg1, arg2);
        return ret;
      }, arguments);
    },
    __wbg_crypto_86f2631e91b51511: function (arg0: any) {
      const ret = arg0.crypto;
      return ret;
    },
    __wbg_entries_58c7934c745daac7: function (arg0: any) {
      const ret = Object.entries(arg0);
      return ret;
    },
    __wbg_getRandomValues_b3f15fcbfabb0f8b: function () {
      return handleError(function (arg0: any, arg1: any) {
        arg0.getRandomValues(arg1);
      }, arguments);
    },
    __wbg_get_9b94d73e6221f75c: function (arg0: any, arg1: number) {
      const ret = arg0[arg1 >>> 0];
      return ret;
    },
    __wbg_get_with_ref_key_1dc361bd10053bfe: function (arg0: any, arg1: any) {
      const ret = arg0[arg1];
      return ret;
    },
    __wbg_instanceof_ArrayBuffer_c367199e2fa2aa04: function (arg0: unknown) {
      let result;
      try {
        result = arg0 instanceof ArrayBuffer;
      } catch {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_instanceof_Uint8Array_9b9075935c74707c: function (arg0: unknown) {
      let result;
      try {
        result = arg0 instanceof Uint8Array;
      } catch {
        result = false;
      }
      const ret = result;
      return ret;
    },
    __wbg_isSafeInteger_bfbc7332a9768d2a: function (arg0: unknown) {
      const ret = Number.isSafeInteger(arg0);
      return ret;
    },
    __wbg_length_32ed9a279acd054c: function (arg0: any) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_length_35a7bace40f36eac: function (arg0: any) {
      const ret = arg0.length;
      return ret;
    },
    __wbg_msCrypto_d562bbe83e0d4b91: function (arg0: any) {
      const ret = arg0.msCrypto;
      return ret;
    },
    __wbg_new_361308b2356cecd0: function () {
      const ret = new Object();
      return ret;
    },
    __wbg_new_dd2b680c8bf6ae29: function (arg0: ArrayBuffer) {
      const ret = new Uint8Array(arg0);
      return ret;
    },
    __wbg_new_no_args_1c7c842f08d00ebb: function (arg0: number, arg1: number) {
      const ret = new Function(getStringFromWasm0(arg0, arg1));
      return ret;
    },
    __wbg_new_with_length_a2c39cbe88fd8ff1: function (arg0: number) {
      const ret = new Uint8Array(arg0 >>> 0);
      return ret;
    },
    __wbg_node_e1f24f89a7336c2e: function (arg0: any) {
      const ret = arg0.node;
      return ret;
    },
    __wbg_process_3975fd6c72f520aa: function (arg0: any) {
      const ret = arg0.process;
      return ret;
    },
    __wbg_prototypesetcall_bdcdcc5842e4d77d: function (arg0: number, arg1: number, arg2: Uint8Array) {
      Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
    },
    __wbg_randomFillSync_f8c153b79f285817: function () {
      return handleError(function (arg0: any, arg1: any) {
        arg0.randomFillSync(arg1);
      }, arguments);
    },
    __wbg_require_b74f47fc2d022fd6: function () {
      return handleError(function () {
        const ret = (module as any).require;
        return ret;
      }, arguments);
    },
    __wbg_set_3f1d0b984ed272ed: function (arg0: any, arg1: any, arg2: any) {
      arg0[arg1] = arg2;
    },
    __wbg_static_accessor_GLOBAL_12837167ad935116: function () {
      const ret = typeof global === "undefined" ? null : global;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_GLOBAL_THIS_e628e89ab3b1c95f: function () {
      const ret = typeof globalThis === "undefined" ? null : globalThis;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_SELF_a621d3dfbb60d0ce: function () {
      const ret = typeof self === "undefined" ? null : self;
      return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
    },
    __wbg_static_accessor_WINDOW_f8727f0cf888e0bd: function () {
      // window is not available in Workers runtime
      return 0;
    },
    __wbg_subarray_a96e1fef17ed23cb: function (arg0: Uint8Array, arg1: number, arg2: number) {
      const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
      return ret;
    },
    __wbg_versions_4e31226f5e8dc909: function (arg0: any) {
      const ret = arg0.versions;
      return ret;
    },
    __wbindgen_cast_0000000000000001: function (arg0: number, arg1: number) {
      const ret = getArrayU8FromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_cast_0000000000000002: function (arg0: number, arg1: number) {
      const ret = getStringFromWasm0(arg0, arg1);
      return ret;
    },
    __wbindgen_init_externref_table: function () {
      const table = wasm.__wbindgen_externrefs;
      const offset = table.grow(4);
      table.set(0, undefined);
      table.set(offset + 0, undefined);
      table.set(offset + 1, null);
      table.set(offset + 2, true);
      table.set(offset + 3, false);
    },
  };

  return {
    "./opaque_bg.js": import0,
  };
}

// ── Finalize init ───────────────────────────────────────────────────────────

function finalizeInit(instance: WebAssembly.Instance): any {
  wasm = instance.exports;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  wasm.__wbindgen_start();
  return wasm;
}

// ── Server API functions ────────────────────────────────────────────────────

function createServerSetup(): string {
  let deferred1_0 = 0;
  let deferred1_1 = 0;
  try {
    const ret = wasm.createServerSetup();
    deferred1_0 = ret[0];
    deferred1_1 = ret[1];
    return getStringFromWasm0(ret[0], ret[1]);
  } finally {
    wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
  }
}

function createServerRegistrationResponse(params: {
  serverSetup: string;
  userIdentifier: string;
  registrationRequest: string;
}): { registrationResponse: string } {
  const ret = wasm.createServerRegistrationResponse(params);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]) as { registrationResponse: string };
}

function startServerLogin(params: {
  serverSetup: string;
  registrationRecord: string;
  startLoginRequest: string;
  userIdentifier: string;
  identifiers: { client: string; server: string };
}): { serverLoginState: string; loginResponse: string } {
  const ret = wasm.startServerLogin(params);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]) as {
    serverLoginState: string;
    loginResponse: string;
  };
}

function finishServerLogin(params: {
  serverLoginState: string;
  finishLoginRequest: string;
  identifiers: { client: string; server: string };
}): void {
  const ret = wasm.finishServerLogin(params);
  if (ret[2]) {
    throw takeFromExternrefTable0(ret[1]);
  }
  return takeFromExternrefTable0(ret[0]) as void;
}

function getServerPublicKey(data: string): string {
  let deferred3_0 = 0;
  let deferred3_1 = 0;
  try {
    const ptr0 = passStringToWasm0(data, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.getServerPublicKey(ptr0, len0);
    let ptr2 = ret[0];
    let len2 = ret[1];
    if (ret[3]) {
      ptr2 = 0;
      len2 = 0;
      throw takeFromExternrefTable0(ret[2]);
    }
    deferred3_0 = ptr2;
    deferred3_1 = len2;
    return getStringFromWasm0(ptr2, len2);
  } finally {
    wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export interface OpaqueServer {
  createSetup(): string;
  createRegistrationResponse(params: {
    serverSetup: string;
    userIdentifier: string;
    registrationRequest: string;
  }): { registrationResponse: string };
  startLogin(params: {
    serverSetup: string;
    registrationRecord: string;
    startLoginRequest: string;
    userIdentifier: string;
    identifiers: { client: string; server: string };
  }): { serverLoginState: string; loginResponse: string };
  finishLogin(params: {
    serverLoginState: string;
    finishLoginRequest: string;
    identifiers: { client: string; server: string };
  }): void;
  getPublicKey(data: string): string;
}

let opaqueReady: Promise<void> | null = null;
let opaqueModule: OpaqueServer | null = null;

async function initOpaque(): Promise<OpaqueServer> {
  if (opaqueModule) return opaqueModule;

  const imports = getImports();

  // In Cloudflare Workers, static .wasm imports produce a WebAssembly.Module
  // that can be instantiated with WebAssembly.instantiate(module, imports)
  const result = await WebAssembly.instantiate(opaqueWasmModule, imports);
  const instanceObj =
    result instanceof WebAssembly.Instance ? result : (result as { instance: WebAssembly.Instance }).instance;

  finalizeInit(instanceObj);

  opaqueModule = {
    createSetup: createServerSetup,
    createRegistrationResponse: createServerRegistrationResponse,
    startLogin: startServerLogin,
    finishLogin: finishServerLogin,
    getPublicKey: getServerPublicKey,
  };

  return opaqueModule;
}

/** Promise that resolves when OPAQUE WASM is ready */
export const ready = initOpaque().then(() => {});

/** Get the OPAQUE server interface (throws if WASM failed to load) */
export async function getOpaqueServer(): Promise<OpaqueServer> {
  await ready;
  if (!opaqueModule) {
    throw new Error("OPAQUE WASM failed to initialize");
  }
  return opaqueModule;
}
