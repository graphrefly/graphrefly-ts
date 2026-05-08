import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve pure-ts to source so parity tests don't require a
			// pre-build. Mirrors the alias pattern in
			// packages/{cli,mcp-server}/vitest.config.ts.
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
