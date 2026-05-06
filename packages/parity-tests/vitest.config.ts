import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve legacy-pure-ts to source so parity tests don't require a
			// pre-build. Mirrors the alias pattern in
			// packages/{cli,mcp-server}/vitest.config.ts.
			{
				find: /^@graphrefly\/legacy-pure-ts$/,
				replacement: fileURLToPath(new URL("../legacy-pure-ts/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		include: ["scenarios/**/*.test.ts"],
		exclude: ["**/node_modules/**", "**/dist/**"],
		environment: "node",
	},
});
