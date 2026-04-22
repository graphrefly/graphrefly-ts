import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.ASTRO_SITE_URL ?? "https://example.invalid",
	base: "/demos/reactive-layout/",
	server: { port: 4322 },
	integrations: [react()],
	vite: {
		resolve: {
			conditions: ["browser"],
		},
		build: {
			rollupOptions: {
				// See knowledge-graph/astro.config for the rationale. The
				// library's Node-only code paths (`fallbackAdapter`,
				// `withReplayCache`, `fileStorage`, `sqliteStorage`) import
				// `node:*` builtins; the demos never call them, but rollup
				// tree-shakes the library dist and needs them externalized.
				external: ["@mlc-ai/web-llm", /^node:/],
			},
		},
		optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
	},
});
