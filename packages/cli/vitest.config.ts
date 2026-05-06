import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve workspace-local @graphrefly/graphrefly straight to the
			// legacy-pure-ts source (the shim is just one-line re-exports;
			// nothing to test through it). Phase 13.9.A cleave.
			{
				find: /^@graphrefly\/graphrefly$/,
				replacement: fileURLToPath(new URL("../legacy-pure-ts/src/index.ts", import.meta.url)),
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
