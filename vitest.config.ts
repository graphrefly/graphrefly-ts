import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	resolve: {
		alias: [
			{
				find: /^@graphrefly\/pure-ts\/(.+)$/,
				replacement: path.resolve(__dirname, "packages/pure-ts/src/$1"),
			},
			{
				find: "@graphrefly/pure-ts",
				replacement: path.resolve(__dirname, "packages/pure-ts/src/index.ts"),
			},
		],
	},
	test: {
		include: ["src/**/*.test.ts"],
		exclude: ["**/node_modules/**", "dist/**", "**/*.bench.ts"],
		environment: "node",
	},
});
