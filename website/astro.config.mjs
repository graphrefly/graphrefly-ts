import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

/** GitHub Project Pages: set to `/repo-name/` (trailing slash). Root site: `'/'`. */
const base = process.env.ASTRO_BASE_PATH ?? "/";

export default defineConfig({
	site: process.env.ASTRO_SITE_URL ?? "https://example.invalid",
	base,
	integrations: [
		starlight({
			title: "GraphReFly",
			description: "Reactive graph protocol for human + LLM co-operation — TypeScript and Python.",
			customCss: ["./src/styles/custom.css"],
			head: [
				{ tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
				{
					tag: "link",
					attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
				},
			],
			social: [
				{
					icon: "github",
					label: "graphrefly-ts",
					href: "https://github.com/graphrefly/graphrefly-ts",
				},
			],
			sidebar: [
				{
					label: "Overview",
					items: [{ label: "Home", link: "/" }],
				},
				{
					label: "Protocol",
					items: [
						{ label: "Specification", link: "/spec" },
						{ label: "Roadmap", link: "/roadmap" },
					],
				},
				{
					label: "Project",
					collapsed: true,
					items: [
						{ label: "Optimizations", link: "/optimizations" },
						{ label: "Benchmark", link: "/benchmark" },
						{ label: "Test guidance", link: "/test-guidance" },
						{ label: "Docs guidance", link: "/docs-guidance" },
					],
				},
			],
		}),
	],
});
