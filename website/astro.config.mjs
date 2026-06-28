import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import starlightBlog from "starlight-blog";
import { apiSidebar } from "./src/generated/api-sidebar.mjs";

/** GitHub Project Pages: set to `/repo-name/` (trailing slash). Root site: `'/'`. */
const base = process.env.ASTRO_BASE_PATH ?? "/";

export default defineConfig({
	site: process.env.ASTRO_SITE_URL ?? "https://example.invalid",
	base,
	// Fixed dev-server port so the preview tool + other demos don't collide.
	server: { port: 4323 },
	vite: {
		build: {
			rollupOptions: {
				// `@mlc-ai/web-llm` — peer dep of the library's browser
				// `webllmAdapter` (dynamic import with `.catch()`). The
				// website never calls it, but rollup tree-shakes the library
				// dist and needs it externalized. Matches the library's
				// peer-dep contract — users who actually need webllm install
				// it in their own app.
				// `node:*` builtins — the library's Node-only paths
				// (`fallbackAdapter`, `withReplayCache`, `fileStorage`,
				// `sqliteStorage`) import them; the website doesn't execute
				// those paths, but rollup needs them externalized to tree-shake.
				external: ["@mlc-ai/web-llm", /^node:/],
			},
		},
		optimizeDeps: {
			exclude: ["@mlc-ai/web-llm"],
		},
	},
	integrations: [
		starlight({
			plugins: [
				starlightBlog({
					title: "Blog",
					authors: {
						david: {
							name: "David Chen",
							title: "GraphReFly creator",
						},
					},
				}),
			],
			title: "GraphReFly",
			description: "Reactive harness layer for agent workflows. Describe automations in plain language, trace every decision, enforce policies, persist checkpoints. Zero dependencies.",
			components: {
				Header: "./src/components/Header.astro",
				Footer: "./src/components/Footer.astro",
				MobileMenuFooter: "./src/components/MobileMenuFooter.astro",
				Sidebar: "./src/components/Sidebar.astro",
				ThemeSelect: "./src/components/ThemeSelect.astro",
			},
			customCss: ["./src/styles/custom.css"],
			head: [
				{
					tag: "script",
					content:
						"(function(){try{var k='starlight-theme';if(localStorage.getItem(k)===null){localStorage.setItem(k,'light');document.documentElement.dataset.theme='light'}}catch(e){}})()",
				},
				{ tag: "link", attrs: { rel: "preconnect", href: "https://fonts.googleapis.com" } },
				{
					tag: "link",
					attrs: { rel: "preconnect", href: "https://fonts.gstatic.com", crossorigin: "" },
				},
				{
					tag: "script",
					content: `(function(){var p=location.pathname,l=p.toLowerCase();if(p!==l)location.replace(l+location.search+location.hash)})()`,
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
					label: "Protocol",
					items: [{ label: "Specification", link: "/spec" }],
				},
				{
					label: "Solutions",
					items: [
						{ label: "Overview", link: "/solutions" },
						{ label: "Reactive Layout", link: "/solutions/reactive-layout" },
					],
				},
				{
					label: "API Reference",
					collapsed: true,
					items: apiSidebar,
				},
				{
					label: "Comparisons",
					items: [
						{ label: "Reactive Layout vs Pretext", link: "/comparisons/pretext" },
					],
				},
				{
					label: "Recipes",
					items: [
						{ label: "NestJS Integration", link: "/recipes/nestjs-integration" },
					],
				},
				{
					label: "Integrations",
					items: [
						{ label: "Overview", link: "/integrations" },
						{ label: "Integration Matrix", link: "/integrations/matrix" },
						{ label: "Adapters", link: "/integrations/adapters" },
					],
				},
				{
					label: "Demos",
					items: [
						{ label: "Overview", link: "/demos" },
						{ label: "Reactive layout", link: "/demos/reactive-layout/" },
						{ label: "Spending alerts", link: "/demos/spending-alerts/" },
					],
				},
			],
		}),
	],
});
