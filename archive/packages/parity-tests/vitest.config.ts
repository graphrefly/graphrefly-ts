import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve pure-ts to source so parity tests don't require a
			// pre-build.
			//
			// The subpath regex MUST precede the bare alias and is required:
			// without it, `@graphrefly/pure-ts/extra` falls through to the
			// built `dist/` via package `exports`, so parity would silently
			// test STALE substrate for any `extra/*` symbol until pure-ts is
			// rebuilt. Capture-group `$1` covers `/extra`, `/core/...`, etc.
			{
				find: /^@graphrefly\/pure-ts\/(.+)$/,
				replacement: fileURLToPath(new URL("../pure-ts/src/$1", import.meta.url)),
			},
			{
				find: /^@graphrefly\/pure-ts$/,
				replacement: fileURLToPath(new URL("../pure-ts/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		include: ["scenarios/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
		// `@graphrefly/native` ships a `.node` napi binary via a CJS
		// loader (`index.js` → `loadBinding(...)`). Vite/vitest's
		// transform pipeline tries to source-map the loader and stalls
		// on the binary; standalone `require("@graphrefly/native")`
		// loads in ~4 ms (verified 2026-05-25 / D291 verify session),
		// but the same `require` from inside a vitest worker hangs at
		// boot indefinitely. Externalizing keeps it on node's native
		// require path and lets vitest boot in <1 s. Discovered while
		// closing Bucket A; see graphrefly-ts/docs/cross-track-ledger.md
		// (the parity gate would silently regress on every napi rebuild
		// without this).
		//
		// D291 /qa A4 (2026-05-25): regex anchored to match the bare
		// package `@graphrefly/native` AND its per-platform sub-packages
		// (`@graphrefly/native-darwin-arm64`, `@graphrefly/native-linux-x64-gnu`,
		// etc. — the napi-rs loader resolves to whichever one matches
		// the host triple) but NOT a hypothetical future `@graphrefly/
		// native-helpers` TS-only sibling that would benefit from vite's
		// transform pipeline.
		server: {
			deps: {
				external: [/^@graphrefly\/native($|\/|-(darwin|linux|win32)-)/],
			},
		},
	},
});
