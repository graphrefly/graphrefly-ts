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
	},
});
