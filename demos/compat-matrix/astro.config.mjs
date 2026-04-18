import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import solid from "@astrojs/solid-js";
import svelte from "@astrojs/svelte";
import vue from "@astrojs/vue";
import { defineConfig } from "astro/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const require = createRequire(import.meta.url);

// Resolve the installed `svelte` package.json and point bare `svelte` imports
// at its client entry. Resolved from the demo's own node_modules so we don't
// hardcode pnpm's versioned store path (which bakes `svelte@5.55.1` into the
// filesystem layout and breaks on upgrades).
const sveltePkgJson = require.resolve("svelte/package.json");
const sveltePkgDir = path.dirname(sveltePkgJson);
const svelteClientEntry = path.join(sveltePkgDir, "src/index-client.js");

export default defineConfig({
	base: '/demos/compat-matrix',
	// Both React and Solid use .tsx — scope each plugin to its own file so
	// Vite picks the right JSX transformer (otherwise the "More than one JSX
	// renderer is enabled" warning becomes an actual hydration bug).
	integrations: [
		react({ include: ["**/ReactDemo.tsx"] }),
		solid({ include: ["**/SolidDemo.tsx"] }),
		vue(),
		svelte(),
	],
	vite: {
		// Vite's default `node:` externalization fires before `resolve.alias`,
		// so a plain alias key of `"node:fs"` isn't respected. This inline
		// plugin rewrites `node:fs` and `node:path` to our browser stubs
		// during resolution, which is needed because the demo transitively
		// pulls `src/extra/sources.ts` (top-level `import { existsSync,
		// watch } from "node:fs"` etc.) via demo-shell → reactive-layout →
		// patterns/_internal → extra/sources. None of those paths are
		// actually exercised by the demo.
		plugins: [
			{
				name: "compat-matrix-node-builtins-stub",
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
				// node: builtins are dead code in the browser bundle (tree-shaken away
				// by sideEffects:false in package.json, but Vite alias resolution
				// bypasses the package manifest lookup). Marking them external
				// prevents Rollup from creating incomplete browser stubs.
				external: (id) => id.startsWith("node:") && id !== "node:fs" && id !== "node:path",
			},
		},
		// Svelte 5's package.json exports map falls through to the SERVER
		// entry (`src/index-server.js`) on the `default` condition; only
		// `browser` resolves to the DOM variant (`src/index-client.js`).
		// Adding `browser` to conditions is not enough — Vite pre-bundles
		// `@astrojs/svelte/client.svelte.js` once and bakes in whichever
		// entry it resolved at bundle time. A direct alias from bare
		// `svelte` (exact match) to `svelte/src/index-client.js` is the
		// only reliable pin we've found for dev mode.
		resolve: {
			conditions: ["browser"],
			alias: [
				{ find: /^svelte$/, replacement: svelteClientEntry },
				{ find: "@graphrefly/graphrefly/compat/react", replacement: `${root}/src/compat/react/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/vue", replacement: `${root}/src/compat/vue/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/solid", replacement: `${root}/src/compat/solid/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/svelte", replacement: `${root}/src/compat/svelte/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/jotai", replacement: `${root}/src/compat/jotai/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/nanostores", replacement: `${root}/src/compat/nanostores/index.ts` },
				{ find: "@graphrefly/graphrefly/compat/zustand", replacement: `${root}/src/compat/zustand/index.ts` },
				{ find: "@graphrefly/graphrefly/patterns/demo-shell", replacement: `${root}/src/patterns/demo-shell.ts` },
				{ find: "@graphrefly/graphrefly/patterns/reactive-layout", replacement: `${root}/src/patterns/reactive-layout/index.ts` },
				{ find: "@graphrefly/graphrefly/graph", replacement: `${root}/src/graph/index.ts` },
				{ find: "@graphrefly/graphrefly/core", replacement: `${root}/src/core/index.ts` },
				// NOTE: the top-level `@graphrefly/graphrefly` barrel re-exports
				// NestJS (decorators → `process`) and patterns (node:fs). Demo
				// code should import from the narrower subpath entries above
				// (`/core`, `/graph`, `/compat/*`) to keep the browser bundle
				// server-free.
				{ find: /^@graphrefly\/graphrefly$/, replacement: `${root}/src/core/index.ts` },
			],
		},
		optimizeDeps: {
			esbuildOptions: {
				conditions: ["browser"],
			},
		},
	},
});
