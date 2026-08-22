import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

const packageMetadata = JSON.parse(
	readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
const packageRevision = `graphrefly-ts:${packageMetadata.version}`;

export default defineConfig({
	define: {
		__GRAPHREFLY_TS_PACKAGE_REVISION__: JSON.stringify(packageRevision),
	},
	test: {
		include: ["src/**/*.test.ts"],
	},
});
