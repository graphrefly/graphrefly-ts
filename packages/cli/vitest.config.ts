import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@graphrefly\/graphrefly$/,
				replacement: fileURLToPath(new URL("../../src/index.ts", import.meta.url)),
			},
			{
				find: /^@graphrefly\/mcp-server$/,
				replacement: fileURLToPath(new URL("../mcp-server/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
