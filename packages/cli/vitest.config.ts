import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			// Resolve workspace-local @graphrefly/graphrefly to the
			// presentation layer root src/index.ts (A3 cleave: substrate lives
			// in @graphrefly/pure-ts, presentation re-exported from root src/).
			{
				find: /^@graphrefly\/graphrefly$/,
				replacement: path.resolve(__dirname, "../../src/index.ts"),
			},
			// Alias @graphrefly/pure-ts subpath imports (e.g. /core/messages.js)
			// so vitest resolves substrate source when transitively imported.
			{
				find: /^@graphrefly\/pure-ts\/(.+)$/,
				replacement: path.resolve(__dirname, "../pure-ts/src/$1"),
			},
			// Alias bare @graphrefly/pure-ts import.
			{
				find: "@graphrefly/pure-ts",
				replacement: path.resolve(__dirname, "../pure-ts/src/index.ts"),
			},
		],
	},
	test: {
		include: ["tests/**/*.test.ts"],
	},
});
