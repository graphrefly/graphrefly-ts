import { defineConfig } from "tsup";

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/composition/index.ts",
		"src/core/index.ts",
		"src/data-structures/index.ts",
		"src/graph/index.ts",
		"src/operators/index.ts",
		"src/render/index.ts",
		"src/sources/index.ts",
		"src/storage/index.ts",
		"src/testing/index.ts",
	],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
});
