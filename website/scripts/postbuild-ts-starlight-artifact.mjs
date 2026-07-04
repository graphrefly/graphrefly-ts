#!/usr/bin/env node

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const websiteRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(websiteRoot, "..");
const distRoot = path.join(websiteRoot, "dist");
const customDomain = process.env.TS_DOCS_CUSTOM_DOMAIN ?? "ts.graphrefly.dev";

for (const demo of ["reactive-layout", "compat-matrix"]) {
	const source = path.join(repoRoot, "demos", demo, "dist");
	if (!existsSync(source)) continue;
	const target = path.join(distRoot, "demos", demo);
	mkdirSync(path.dirname(target), { recursive: true });
	cpSync(source, target, { recursive: true });
}

if (customDomain.trim().length > 0) {
	writeFileSync(path.join(distRoot, "CNAME"), `${customDomain.trim()}\n`);
}

writeFileSync(
	path.join(distRoot, "artifact-manifest.json"),
	`${JSON.stringify(
		{
			package: "@graphrefly/ts",
			framework: "astro-starlight",
			route: process.env.ASTRO_BASE_PATH ?? "/",
			source: "website/src/content/docs",
		},
		null,
		2,
	)}\n`,
);

console.log("prepared Starlight @graphrefly/ts docs artifact");
