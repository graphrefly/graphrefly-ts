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
		include: ["src/__bench__/**/*.bench.ts"],
		environment: "node",
	},
});
