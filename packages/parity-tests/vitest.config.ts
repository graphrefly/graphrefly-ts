import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve pure-ts to source so parity tests don't require a
			// pre-build. Mirrors the alias pattern in
			// packages/cli/vitest.config.ts.
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
	},
});
