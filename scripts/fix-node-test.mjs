/**
 * Fix remaining derived() calls in node.test.ts which already had its
 * sugar import manually removed but still has derived() call sites.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

// Re-use the transform functions from the main script
function splitTopLevel(str) {
	const parts = [];
	let depth = 0;
	let current = "";
	let inString = false;
	let stringChar = "";

	for (let i = 0; i < str.length; i++) {
		const c = str[i];
		if (inString) {
			current += c;
			if (c === stringChar && str[i - 1] !== "\\") inString = false;
			continue;
		}
		if (c === '"' || c === "'" || c === "`") {
			inString = true;
			stringChar = c;
			current += c;
			continue;
		}
		if (c === "(" || c === "[" || c === "{") {
			depth++;
			current += c;
		} else if (c === ")" || c === "]" || c === "}") {
			depth--;
			current += c;
		} else if (c === "," && depth === 0) {
			parts.push(current);
			current = "";
		} else {
			current += c;
		}
	}
	if (current.trim()) parts.push(current);
	return parts;
}

function getIndent(linePrefix) {
	return linePrefix.match(/^(\s*)/)[1];
}

function transformDerived(src, funcName = "derived") {
	const pattern = new RegExp(`\\b${funcName}(<[^>]*>)?\\(`, "g");
	let result = "";
	let lastEnd = 0;

	for (;;) {
		const match = pattern.exec(src);
		if (match === null) break;
		const before = src.slice(0, match.index);
		if (before.endsWith(".")) continue;
		if (before.length > 0 && /\w/.test(before[before.length - 1])) continue;

		const typeArgs = match[1] || "";
		const parenStart = match.index + match[0].length;

		let depth = 1;
		let i = parenStart;
		while (i < src.length && depth > 0) {
			const c = src[i];
			if (c === "(" || c === "[" || c === "{") depth++;
			else if (c === ")" || c === "]" || c === "}") depth--;
			if (depth > 0) i++;
			else break;
		}
		const fullArgs = src.slice(parenStart, i);
		const topLevelArgs = splitTopLevel(fullArgs);

		if (topLevelArgs.length < 2) {
			result += src.slice(lastEnd, i + 1);
			lastEnd = i + 1;
			pattern.lastIndex = lastEnd;
			continue;
		}

		const depsArg = topLevelArgs[0].trim();
		const userFnArg = topLevelArgs[1].trim();
		const optsArg = topLevelArgs[2] ? topLevelArgs[2].trim() : null;

		const lineStart = src.lastIndexOf("\n", match.index) + 1;
		const linePrefix = src.slice(lineStart, match.index);
		const indent = getIndent(linePrefix);
		const inner = `${indent}\t`;

		let optsStr;
		if (optsArg) {
			optsStr = `{ describeKind: "derived", ...${optsArg} }`;
		} else {
			optsStr = `{ describeKind: "derived" }`;
		}

		const nodeFnBody = [
			`(batchData, actions, ctx) => {`,
			`${inner}const data = batchData.map((batch, i) => batch != null && batch.length > 0 ? batch.at(-1) : ctx.prevData[i]);`,
			`${inner}actions.emit((${userFnArg})(data, ctx));`,
			`${indent}}`,
		].join("\n");

		const replacement = `node${typeArgs}(${depsArg}, ${nodeFnBody}, ${optsStr})`;

		result += src.slice(lastEnd, match.index) + replacement;
		lastEnd = i + 1;
		pattern.lastIndex = lastEnd;
	}

	result += src.slice(lastEnd);
	return result;
}

const filePath = resolve(REPO_ROOT, "src/__tests__/core/node.test.ts");
let src = readFileSync(filePath, "utf8");

console.log("Before:", (src.match(/\bderived\(/g) || []).length, "derived() calls");
src = transformDerived(src, "derived");
console.log("After:", (src.match(/\bderived\(/g) || []).length, "derived() calls");

writeFileSync(filePath, src, "utf8");
console.log("Done");
