import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { instrumentShell } from "./diagnose-spending-preset-cold.mjs";

test("diagnostic adds only ten generated-shell marks, preserving original source bytes", () => {
	const original = readFileSync("scripts/fixtures/spending-preset-performance.ts", "utf8");
	const result = instrumentShell(original);
	assert.equal(result.labels.length, 10);
	assert.equal(
		result.source.replace(/globalThis\.__spendingColdMark\("[a-z-]+"\);\n/g, ""),
		original,
	);
});
test("missing or changed phase shape fails closed instead of silently measuring different boundaries", () => {
	assert.throws(() => instrumentShell("export function other() {}"), /graphArm/);
	assert.throws(() => instrumentShell("export function graphArm() { return 1; }"));
	const source = readFileSync("scripts/fixtures/spending-preset-performance.ts", "utf8");
	assert.throws(() =>
		instrumentShell(source.replace("startConstruction(graph, owner);", "void owner;")),
	);
});
