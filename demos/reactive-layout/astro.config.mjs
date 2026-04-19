import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import { defineConfig } from "astro/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

export default defineConfig({
	base: "/demos/reactive-layout",
	server: { port: 4322 },
	integrations: [react()],
	vite: {
		// Rewrite `node:fs` / `node:path` imports to local browser stubs so the
		// transitive `src/extra/sources.ts` top-level `node:*` imports (pulled
		// in via `patterns/_internal` → `patterns/demo-shell` →
		// `patterns/reactive-layout`) don't fail at bundle time. None of those
		// code paths are actually exercised by this demo — same pattern as
		// compat-matrix.
		plugins: [
			{
				name: "reactive-layout-node-builtins-stub",
				enforce: "pre",
				resolveId(source) {
					if (source === "node:fs") return `${__dirname}/src/lib/node-fs-stub.ts`;
					if (source === "node:path") return `${__dirname}/src/lib/node-path-stub.ts`;
					return null;
				},
			},
		],
		build: {
			rollupOptions: {
				external: (id) => id.startsWith("node:") && id !== "node:fs" && id !== "node:path",
			},
		},
		resolve: {
			conditions: ["browser"],
			alias: [
				{
					find: "@graphrefly/graphrefly/reactive-layout",
					replacement: `${root}/src/patterns/reactive-layout/index.ts`,
				},
				{
					find: "@graphrefly/graphrefly/extra/sources",
					replacement: `${root}/src/extra/sources.ts`,
				},
				{
					find: "@graphrefly/graphrefly/patterns/demo-shell",
					replacement: `${root}/src/patterns/demo-shell.ts`,
				},
				{
					find: "@graphrefly/graphrefly/graph",
					replacement: `${root}/src/graph/index.ts`,
				},
				{
					find: "@graphrefly/graphrefly/core",
					replacement: `${root}/src/core/index.ts`,
				},
				// The top-level barrel pulls in NestJS + `node:fs`, so keep demo
				// imports on the narrow subpath aliases above.
				{
					find: /^@graphrefly\/graphrefly$/,
					replacement: `${root}/src/core/index.ts`,
				},
			],
		},
		optimizeDeps: {
			esbuildOptions: {
				conditions: ["browser"],
			},
		},
	},
});
