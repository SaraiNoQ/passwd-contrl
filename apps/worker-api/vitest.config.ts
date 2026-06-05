import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/__mocks__/**"],
      thresholds: {
        statements: 60,
        branches: 50,
        functions: 60,
        lines: 60,
      },
    },
  },
  resolve: {
    alias: {
      // Mock the opaque-loader to avoid loading WASM in tests
      "../opaque-loader": resolve(__dirname, "src/__mocks__/opaque-loader.ts"),
      "./opaque-loader": resolve(__dirname, "src/__mocks__/opaque-loader.ts"),
    },
  },
});
