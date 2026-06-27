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
			dedupe: ["@graphrefly/ts"],
		},
		build: {
			rollupOptions: {
				// The solution subpaths include optional Node-only adapters.
				// This browser demo never calls them, but rollup still sees
				// those imports while tree-shaking and needs them externalized.
				external: ["@mlc-ai/web-llm", /^node:/],
			},
		},
		optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
	},
});
