import { defineConfig } from "vitest/config";
import base from "./vitest.config.js";

/** The operator trace report (graphrefly-ts:D191 (6)); `pnpm test` does not run it. */
export default defineConfig({
	...base,
	test: {
		...base.test,
		include: ["src/__tests__/operator-traces/report.trace.ts"],
		fileParallelism: false,
	},
});
