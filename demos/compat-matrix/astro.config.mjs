import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@astrojs/react";
import solid from "@astrojs/solid-js";
import svelte from "@astrojs/svelte";
import vue from "@astrojs/vue";
import { defineConfig } from "astro/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// Svelte 5's package.json exports map falls through to the SERVER entry
// (`src/index-server.js`) on the `default` condition; only `browser` resolves
// to the DOM variant (`src/index-client.js`). Adding `browser` to conditions
// is not enough — Vite pre-bundles `@astrojs/svelte/client.svelte.js` once and
// bakes in whichever entry it resolved at bundle time. A direct alias from
// bare `svelte` (exact match) to `svelte/src/index-client.js` is the only
// reliable pin we've found for dev mode. Unrelated to `@graphrefly/*`.
const sveltePkgJson = require.resolve("svelte/package.json");
const sveltePkgDir = path.dirname(sveltePkgJson);
const svelteClientEntry = path.join(sveltePkgDir, "src/index-client.js");

export default defineConfig({
	base: "/demos/compat-matrix",
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
		resolve: {
			conditions: ["browser"],
			alias: [{ find: /^svelte$/, replacement: svelteClientEntry }],
		},
		optimizeDeps: {
			esbuildOptions: {
				conditions: ["browser"],
			},
		},
	},
});
