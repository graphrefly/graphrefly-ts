import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

const packageRoot = dirname(fileURLToPath(import.meta.url));
const packageMetadata = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const packageRevision = `graphrefly-ts:${packageMetadata.version}`;
const src = resolve(packageRoot, "src");

export default defineConfig({
	define: {
		__GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify(packageRevision),
	},
	// Examples import public subpaths. Unit tests run before dist exists, so
	// resolve those entries to source the same way keyed-rate-limit typecheck does.
	resolve: {
		alias: {
			"@graphrefly/ts/core": resolve(src, "core/index.ts"),
			"@graphrefly/ts/graph": resolve(src, "graph/index.ts"),
			"@graphrefly/ts/render": resolve(src, "render/index.ts"),
		},
	},
	test: {
		include: ["src/**/*.test.ts"],
		exclude: [
			...configDefaults.exclude,
			"src/__tests__/solutions-agentic-memory-work-item-root-eval-live.test.ts",
		],
	},
});
