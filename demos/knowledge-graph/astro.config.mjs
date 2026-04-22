import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.ASTRO_SITE_URL ?? "https://example.invalid",
	base: "/demos/knowledge-graph/",
	server: { port: 4324 },
	integrations: [react()],
	vite: {
		resolve: {
			conditions: ["browser"],
		},
		build: {
			rollupOptions: {
				// `@mlc-ai/web-llm` — peer dep of the library's browser
				// `webllmAdapter` (dynamic import with `.catch()`).
				// `node:*` builtins — the library's `fallbackAdapter` /
				// `withReplayCache` / `fileStorage` import them for Node-only
				// paths; this demo never calls them, but rollup tree-shakes
				// the library dist and can't resolve them for a browser build.
				// Marking them external means they remain as runtime imports
				// that only evaluate if the Node-only code ever runs (it won't
				// in the browser).
				external: ["@mlc-ai/web-llm", /^node:/],
			},
		},
		optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
	},
});
