/**
 * Fix two issues from the sugar conversion:
 * 1. Stray `;` lines from empty import removal
 * 2. Files that use `node()` but only have `import type { Node }` (no value import)
 */

import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Find all files with stray `;` lines
function findFilesWithSemicolon(dir) {
	try {
		const result = execSync(`grep -rln "^;" "${dir}"`, { encoding: "utf8" });
		return result.trim().split("\n").filter(Boolean);
	} catch {
		return [];
	}
}

// Fix stray `;` lines in a file
function fixSemicolons(src) {
	return src.replace(/^\s*;\s*$/gm, "").replace(/\n{3,}/g, "\n\n");
}

// Check if a file uses node() as a function but only has `import type { Node }`
function needsNodeValueImport(src) {
	// If uses `node(` as a function call
	const usesNodeFn = /\bnode\s*\(/.test(src);
	if (!usesNodeFn) return false;

	// Check if it has a value import of node already
	const hasValueImport =
		/import\s*\{[^}]*\bnode\b[^}]*\}\s*from\s*["'][^"']*core\/node\.js["']/.test(src);
	if (hasValueImport) return false;

	// Has only type import?
	const hasTypeOnlyImport =
		/import\s+type\s*\{[^}]*Node[^}]*\}\s*from\s*["'][^"']*core\/node\.js["']/.test(src);
	return true; // needs a value import
}

// Add `node` to an existing import or create a new import
function addNodeImport(src) {
	// Try to find and update existing node.js import (value or type)
	const valueImportRe = /import\s*\{([^}]*)\}\s*from\s*(["'][^"']*core\/node\.js["'])/;
	const typeImportRe = /import\s+type\s*\{([^}]*)\}\s*from\s*(["'][^"']*core\/node\.js["'])/;

	// Check if there's already a value import with `node`
	const existingValueMatch = src.match(valueImportRe);
	if (existingValueMatch) {
		const symbols = existingValueMatch[1]
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
		if (symbols.includes("node")) return src; // already there
		symbols.unshift("node");
		return src.replace(
			existingValueMatch[0],
			`import { ${symbols.join(", ")} } from ${existingValueMatch[2]}`,
		);
	}

	// Check if there's a type-only import - convert it or add alongside
	const typeMatch = src.match(typeImportRe);
	if (typeMatch) {
		// Insert a new value import before the type import
		const insertBefore = typeMatch[0];
		const importPath = typeMatch[2];
		const newImport = `import { node } from ${importPath};\n`;
		return src.replace(insertBefore, newImport + insertBefore);
	}

	// No node.js import at all - find the right path from sugar import
	const sugarImportMatch = src.match(/from\s*(["'][^"']*core\/sugar\.js["'])/);
	if (sugarImportMatch) {
		// Already converted - no sugar import remains, but we can guess the path
	}

	// Find any core import to determine relative path
	const coreImportMatch = src.match(/from\s*(["'][^"']*core\/[^"']+\.js["'])/);
	if (coreImportMatch) {
		const corePath = coreImportMatch[1].replace(/\/[^/]+\.js["']$/, '/node.js"');
		const firstImportIdx = src.indexOf("import ");
		if (firstImportIdx >= 0) {
			return (
				src.slice(0, firstImportIdx) +
				`import { node } from ${corePath};\n` +
				src.slice(firstImportIdx)
			);
		}
	}

	return src;
}

// Process all TS files in src/
const srcDir = resolve(REPO_ROOT, "src");
const files = findFilesWithSemicolon(srcDir);

let fixed = 0;
let addedNodeImport = 0;

for (const filePath of files) {
	if (!filePath.endsWith(".ts")) continue;

	let src = readFileSync(filePath, "utf8");
	const original = src;

	// Fix stray semicolons
	src = fixSemicolons(src);

	// Check if needs node value import
	if (needsNodeValueImport(src)) {
		src = addNodeImport(src);
		addedNodeImport++;
	}

	if (src !== original) {
		writeFileSync(filePath, src, "utf8");
		fixed++;
		console.log(`Fixed: ${filePath.replace(REPO_ROOT + "/", "")}`);
	}
}

// Also fix any remaining files that use node() without importing it
// (no stray semicolon, but still missing import)
try {
	const nodeUsersResult = execSync(`grep -rln "node(" "${srcDir}"`, { encoding: "utf8" });
	const nodeUsers = nodeUsersResult
		.trim()
		.split("\n")
		.filter((f) => f.endsWith(".ts"));

	for (const filePath of nodeUsers) {
		// Skip if already processed
		if (files.includes(filePath)) continue;

		const src = readFileSync(filePath, "utf8");

		if (needsNodeValueImport(src)) {
			const fixed2 = addNodeImport(src);
			if (fixed2 !== src) {
				writeFileSync(filePath, fixed2, "utf8");
				addedNodeImport++;
				console.log(`Added node import: ${filePath.replace(REPO_ROOT + "/", "")}`);
			}
		}
	}
} catch (e) {
	// ignore
}

// Also fix evals dir
const evalsDir = resolve(REPO_ROOT, "evals");
try {
	const evalsFiles = findFilesWithSemicolon(evalsDir);
	for (const filePath of evalsFiles) {
		if (!filePath.endsWith(".ts")) continue;
		let src = readFileSync(filePath, "utf8");
		const original = src;
		src = fixSemicolons(src);
		if (needsNodeValueImport(src)) src = addNodeImport(src);
		if (src !== original) {
			writeFileSync(filePath, src, "utf8");
			fixed++;
			console.log(`Fixed eval: ${filePath.replace(REPO_ROOT + "/", "")}`);
		}
	}
} catch {}

console.log(
	`\nFixed ${fixed} files (stray semicolons), added node import to ${addedNodeImport} files`,
);
