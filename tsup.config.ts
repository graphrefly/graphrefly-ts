import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts", "src/core/index.ts", "src/extra/index.ts", "src/graph/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: true,
});
