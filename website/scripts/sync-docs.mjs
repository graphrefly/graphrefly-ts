import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteRoot = join(__dirname, "..");
const repoDocs = join(websiteRoot, "..", "docs");
const specRepo = join(websiteRoot, "..", "..", "graphrefly");
const outDir = join(websiteRoot, "src", "content", "docs");

const checkMode = process.argv.includes("--check");

/**
 * Sources:
 *   - SHARED: `GRAPHREFLY-SPEC.md` from ~/src/graphrefly only (sibling `graphrefly` repo)
 *   - LOCAL: other markdown from this repo's docs/
 *
 * Format: [sourceDir, srcName, destName, title]
 */
const SHARED_FILES = [
	["GRAPHREFLY-SPEC.md", "spec.md", "Specification"],
];

const LOCAL_FILES = [
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

function syncFile(srcPath, destName, defaultTitle) {
	let body;
	try {
		body = readFileSync(srcPath, "utf8");
	} catch {
		console.warn(`[sync-docs] skip (missing): ${srcPath}`);
		return false;
	}
	const title = defaultTitle || titleFromBody(body);
	const desc =
		destName === "spec.md"
			? "Behavior spec for graphrefly-ts and graphrefly-py."
			: `GraphReFly — ${title}.`;
	const destPath = join(outDir, destName);
	const content = withFrontmatter(body, title, desc);

	if (checkMode) {
		if (existsSync(destPath)) {
			const existing = readFileSync(destPath, "utf8");
			if (existing !== content) {
				console.log(`  ⚠ ${destName} is stale`);
				return true; // stale
			}
			console.log(`  ✓ ${destName} is up to date`);
		} else {
			console.log(`  ⚠ ${destName} does not exist`);
			return true; // stale
		}
		return false;
	}

	writeFileSync(destPath, content, "utf8");
	console.log(`[sync-docs] ${destName}`);
	return false;
}

mkdirSync(outDir, { recursive: true });

let stale = 0;

// Shared spec from canonical repo (no in-repo docs/ copy)
for (const [srcName, destName, defaultTitle] of SHARED_FILES) {
	const srcPath = join(specRepo, srcName);
	if (syncFile(srcPath, destName, defaultTitle)) stale++;
}

// Local docs from this repo
for (const [srcName, destName, defaultTitle] of LOCAL_FILES) {
	const srcPath = join(repoDocs, srcName);
	if (syncFile(srcPath, destName, defaultTitle)) stale++;
}

if (checkMode) {
	if (stale > 0) {
		console.log(`\n${stale} file(s) stale. Run 'pnpm sync-docs' to regenerate.`);
		process.exit(1);
	}
	console.log("\n[sync-docs] all files up to date.");
} else {
	console.log("[sync-docs] done.");
}
