import { defineConfig } from "tsup";

// Dual-build to .mjs (ESM) + .cjs (CJS) + .d.mts / .d.cts. The
// resolved file is chosen by the consumer's resolver via the
// package.json `exports` conditions:
//
//   "import"  → .mjs (ESM)
//   "require" → .cjs (CJS)
//
// This stops the v0.2.x foot-gun where a CJS caller (e.g. tsx loading
// a TS file whose nearest package.json had no "type" field) hit
// ERR_PACKAGE_PATH_NOT_EXPORTED because only the "import" condition
// was declared.

export default defineConfig({
  entry: {
    index: "src/index.ts",
    quality: "src/quality.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  // Node 18+ — drop no syntax.
  target: "node18",
  // Each entry → one chunk; no shared chunks so importing
  // /quality doesn't drag in the rest of the SDK.
  splitting: false,
});
