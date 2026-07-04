import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const websiteRoot = join(__dirname, "..");
const repoRoot = join(websiteRoot, "..");
const publicDir = join(websiteRoot, "public");

const checkMode = process.argv.includes("--check");
const legacyDocsRoot = join(websiteRoot, "src", "content", "docs");
const legacyMarker = "Legacy TypeScript website content";

/**
 * D563 boundary:
 *   - Shared public website/docs/blog/protocol pages are owned by ~/src/graphrefly.
 *   - This legacy website tree remains only as a migration reference and the current
 *     TypeScript API-doc generator host until that generator moves.
 *   - Do not mirror shared docs or package-local prose pages into this tree by hand.
 */

mkdirSync(publicDir, { recursive: true });

let stale = 0;

function legacyMarkdownFiles(dir) {
	const files = [];
	for (const name of readdirSync(dir)) {
		const filePath = join(dir, name);
		if (filePath.includes("/api/")) continue;
		const stat = statSync(filePath);
		if (stat.isDirectory()) {
			files.push(...legacyMarkdownFiles(filePath));
			continue;
		}
		if (name.endsWith(".md")) files.push(filePath);
	}
	return files;
}

const PUBLIC_FILES = ["robots.txt", "llms.txt"];

for (const name of PUBLIC_FILES) {
	const src = join(repoRoot, name);
	const dest = join(publicDir, name);
	if (!existsSync(src)) {
		console.log(`[sync-docs] skip public/${name} (not found at repo root)`);
		continue;
	}
	const content = readFileSync(src, "utf8");
	if (checkMode) {
		if (existsSync(dest)) {
			const existing = readFileSync(dest, "utf8");
			if (existing !== content) {
				console.log(`  ⚠ public/${name} is stale`);
				stale++;
			} else {
				console.log(`  ✓ public/${name} is up to date`);
			}
		} else {
			console.log(`  ⚠ public/${name} does not exist`);
			stale++;
		}
	} else {
		writeFileSync(dest, content, "utf8");
		console.log(`[sync-docs] public/${name}`);
	}
}

if (checkMode) {
	for (const filePath of legacyMarkdownFiles(legacyDocsRoot)) {
		const content = readFileSync(filePath, "utf8");
		if (content.includes(legacyMarker)) continue;
		console.log(
			`  ⚠ ${filePath.replace(`${websiteRoot}/`, "")} is missing the D563 legacy marker`,
		);
		stale++;
	}
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
