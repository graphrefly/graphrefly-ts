import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		alias: [
			// Resolve workspace-local @graphrefly/graphrefly straight to the
			// pure-ts source (the shim is just one-line re-exports;
			// avoids building the library just to test packages/*).
			// Phase 13.9.A cleave.
			{
				find: /^@graphrefly\/graphrefly$/,
				replacement: fileURLToPath(new URL("../pure-ts/src/index.ts", import.meta.url)),
			},
		],
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
