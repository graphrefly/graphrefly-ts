import react from "@astrojs/react";
import { defineConfig } from "astro/config";

export default defineConfig({
	site: process.env.ASTRO_SITE_URL ?? "https://example.invalid",
	base: "/demos/pagerduty-triage/",
	server: { port: 4325 },
	integrations: [react()],
	vite: {
		resolve: {
			conditions: ["browser"],
		},
		build: {
			rollupOptions: {
				external: ["@mlc-ai/web-llm", /^node:/],
			},
		},
		optimizeDeps: { exclude: ["@mlc-ai/web-llm"] },
	},
});
