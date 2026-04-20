import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve workspace-local @graphrefly/graphrefly to source during
			// tests — avoids building the library just to test packages/*.
			{
				find: /^@graphrefly\/graphrefly$/,
				replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
