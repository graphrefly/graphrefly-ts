import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineConfig } from "tsup";

// Which built-in modules we import from source — esbuild strips the `node:`
// prefix at bundle time (evanw/esbuild#2535) even with `platform: "node"` and
// `external` listing, so we restore it post-build across every emitted chunk.
const NODE_BUILTINS = [
	"assert",
	"async_hooks",
	"buffer",
	"crypto",
	"events",
	"fs",
	"fs/promises",
	"os",
	"path",
	"perf_hooks",
	"process",
	"sqlite",
	"stream",
	"stream/web",
	"url",
	"util",
	"worker_threads",
];

async function restoreNodePrefix(dir: string): Promise<void> {
	const entries = await readdir(dir, { withFileTypes: true });
	for (const e of entries) {
		const p = join(dir, e.name);
		if (e.isDirectory()) {
			await restoreNodePrefix(p);
			continue;
		}
		if (!/\.(js|cjs|mjs)$/.test(e.name)) continue;
		let src = await readFile(p, "utf8");
		let changed = false;
		for (const name of NODE_BUILTINS) {
			const esc = name.replace(/\//g, "\\/");
			// Matches `from "fs"` / `from 'fs'` / `require("fs")` (not `node:fs`).
			const patterns = [
				new RegExp(`(from\\s+["'])(${esc})(["'])`, "g"),
				new RegExp(`(require\\(["'])(${esc})(["']\\))`, "g"),
			];
			for (const re of patterns) {
				const next = src.replace(re, (_m, a, b, c) => `${a}node:${b}${c}`);
				if (next !== src) {
					src = next;
					changed = true;
				}
			}
		}
		if (changed) await writeFile(p, src);
	}
}

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/core/index.ts",
		"src/extra/index.ts",
		"src/extra/sources.ts",
		"src/graph/index.ts",
		"src/compat/index.ts",
		"src/compat/jotai/index.ts",
		"src/compat/nanostores/index.ts",
		"src/compat/zustand/index.ts",
		"src/compat/react/index.ts",
		"src/compat/vue/index.ts",
		"src/compat/solid/index.ts",
		"src/compat/svelte/index.ts",
		"src/compat/nestjs/index.ts",
		"src/patterns/demo-shell.ts",
		"src/patterns/reactive-layout/index.ts",
		"src/patterns/memory.ts",
		"src/patterns/ai.ts",
		"src/patterns/ai/adapters/routing/browser-presets.ts",
		"src/patterns/audit.ts",
	],
	format: ["esm", "cjs"],
	dts: true,
	clean: true,
	sourcemap: process.env.NODE_ENV !== "production",
	minify: process.env.NODE_ENV === "production",
	platform: "node",
	target: "node22",
	external: [
		"@nestjs/common",
		"@nestjs/core",
		"@nestjs/microservices",
		"@nestjs/platform-express",
		"@nestjs/websockets",
		"rxjs",
		"reflect-metadata",
		"react",
		"react-dom",
		"vue",
		"solid-js",
		"svelte",
	],
	async onSuccess() {
		await restoreNodePrefix("dist");
	},
});
