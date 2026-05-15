import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Root of the monorepo (parent of packages/pure-ts)
const ROOT = path.resolve(__dirname, "../..");
const ROOT_SRC = path.resolve(ROOT, "src");

export default defineConfig({
	resolve: {
		alias: [
			// ── Package aliases ────────────────────────────────────────────
			{
				find: /^@graphrefly\/pure-ts\/(.+)$/,
				replacement: path.resolve(__dirname, "src/$1"),
			},
			{ find: "@graphrefly/pure-ts", replacement: path.resolve(__dirname, "src/index.ts") },
			// Legacy alias (pre-cleave package name used by some tests)
			{
				find: /^@graphrefly\/graphrefly-ts\/(.+)$/,
				replacement: path.resolve(__dirname, "src/$1"),
			},
			{ find: "@graphrefly/graphrefly-ts", replacement: path.resolve(__dirname, "src/index.ts") },

			// ── Presentation layer paths (tests that weren't yet moved) ────
			// These tests in __tests__/ still reference presentation modules
			// that live in the root src/. Alias them so substrate tests work
			// until the test files are migrated to root src/__tests__/.
			{
				// Resolve extra/render/index.js references from pure-ts tests
				find: /^(\.\.\/)*extra\/render\/index\.js$/,
				replacement: path.resolve(ROOT_SRC, "base/render/index.ts"),
			},
			{
				// Resolve ../../../../src/base/* references from pure-ts tests
				// (the extra ../../ levels path is wrong but vitest resolves file-relative)
				find: /^(\.\.\/)*src\/base\/(.+)$/,
				replacement: path.resolve(ROOT_SRC, "base/$2"),
			},
			{
				// Resolve ../../../../src/utils/* references from pure-ts tests
				find: /^(\.\.\/)*src\/utils\/(.+)$/,
				replacement: path.resolve(ROOT_SRC, "utils/$2"),
			},
		],
	},
	test: {
		// Colocated *.test.ts or src/__tests__/**/*.test.ts (see docs/test-guidance.md)
		include: ["src/**/*.test.ts"],
		exclude: [
			"**/node_modules/**",
			"dist/**",
			"**/*.bench.ts",
			// Presentation-layer tests: import adapters, SSE, webhooks, git-hook, cron,
			// content-addressed-storage, etc. — moved to root src/__tests__/ by A2 cleave.
			"src/__tests__/extra/session1-foundation.test.ts",
			"src/__tests__/extra/sources.test.ts",
		],
		environment: "node",
	},
	benchmark: {
		// CI-eligible benches use the `*.bench.ts` suffix.
		// Maintainer-local profiling tools that hardcode
		// `/Users/davidchenallio/src/graphrefly-rs/target/release/...` paths
		// or run as standalone scripts (without `bench()` blocks) use the
		// `*.bench.local.ts` suffix and are excluded from this glob. Run them
		// directly via `vitest bench src/__bench__/<file>` after
		// `pnpm --filter @graphrefly/native build`.
		include: ["src/__bench__/**/*.bench.ts"],
		environment: "node",
	},
});
