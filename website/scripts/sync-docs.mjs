import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteRoot = join(__dirname, "..");
const repoDocs = join(websiteRoot, "..", "docs");
const outDir = join(websiteRoot, "src", "content", "docs");

/** Map source filename → Starlight slug (path under /) */
const FILES = [
	["GRAPHREFLY-SPEC.md", "spec.md", "Specification"],
	["roadmap.md", "roadmap.md", "Roadmap"],
	["optimizations.md", "optimizations.md", "Optimizations"],
	["benchmark.md", "benchmark.md", "Benchmark"],
	["test-guidance.md", "test-guidance.md", "Test guidance"],
	["docs-guidance.md", "docs-guidance.md", "Docs guidance"],
];

function titleFromBody(src) {
	const line = src.split(/\r?\n/).find((l) => l.startsWith("# "));
	if (!line) return "Untitled";
	return line.replace(/^#\s+/, "").trim();
}

function withFrontmatter(body, title, description) {
	return `---
title: ${JSON.stringify(title)}
description: ${JSON.stringify(description)}
---

${body.replace(/^\ufeff/, "")}
`;
}

mkdirSync(outDir, { recursive: true });

for (const [srcName, destName, defaultTitle] of FILES) {
	const srcPath = join(repoDocs, srcName);
	let body;
	try {
		body = readFileSync(srcPath, "utf8");
	} catch {
		console.warn(`[sync-docs] skip (missing): ${srcPath}`);
		continue;
	}
	const title = defaultTitle || titleFromBody(body);
	const desc =
		srcName === "GRAPHREFLY-SPEC.md"
			? "Behavior spec for graphrefly-ts and graphrefly-py."
			: `GraphReFly — ${title}.`;
	const destPath = join(outDir, destName);
	writeFileSync(destPath, withFrontmatter(body, title, desc), "utf8");
	console.log(`[sync-docs] ${srcName} → ${destName}`);
}

/** Optional: mirror `../graphrefly-py/docs` into `src/content/docs/py/` and add Starlight sidebar links. */

console.log("[sync-docs] done.");
