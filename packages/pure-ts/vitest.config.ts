import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@graphrefly\/graphrefly-ts\/(.+)$/,
				replacement: path.resolve(__dirname, "src/$1"),
			},
			{ find: "@graphrefly/graphrefly-ts", replacement: path.resolve(__dirname, "src/index.ts") },
		],
	},
	test: {
		// Colocated *.test.ts or src/__tests__/**/*.test.ts (see docs/test-guidance.md)
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "dist/**", "**/*.bench.ts"],
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
