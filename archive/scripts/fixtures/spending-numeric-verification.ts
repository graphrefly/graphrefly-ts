/** Reproducible offline D166 arithmetic differential; not a performance or full-domain qualification. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { exactVendorStats, exactZScore } from "../../examples/spending-alerts/causal-numeric.js";
import { referenceNumbers } from "./spending-numeric-oracle.js";
import { plainNumbers } from "./spending-numeric-plain.js";

const output = process.argv[2];
assert.ok(output && !existsSync(output), "fresh output required");
let seed = 0x166;
const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
const cases = [];
for (let k = 0; k < 200; k++) {
	const amounts = Array.from({ length: 1 + (random() % 64) }, () => {
		const m = random();
		switch (k % 5) {
			case 0:
				return m % 100000;
			case 1:
				return 1e9 - (m % 100) * 2 ** -23;
			case 2:
				return Number.MIN_VALUE * (m % 100);
			case 3:
				return (m / 2 ** 32) * 2 ** (-1074 + (random() % 1104));
			default:
				return (m % 1000) / 100;
		}
	});
	const stats = exactVendorStats(amounts),
		zScore = exactZScore(amounts.at(-1)!, stats);
	const expected = referenceNumbers(amounts, 100),
		plain = plainNumbers(amounts, 100);
	assert.equal(zScore, expected.zScore, `candidate ${k}`);
	assert.equal(stats.std, expected.std, `std ${k}`);
	assert.equal(stats.mean, expected.mean, `mean ${k}`);
	assert.equal(plain.zScore, expected.zScore, `plain ${k}`);
	cases.push({ amounts, stats, zScore, expected, plain });
}
const files = [
	"examples/spending-alerts/causal-numeric.ts",
	"scripts/fixtures/spending-numeric-oracle.ts",
	"scripts/fixtures/spending-numeric-plain.ts",
	"scripts/fixtures/spending-numeric-verification.ts",
	"docs/design/causal-preset-numeric-contract-v1.md",
];
const sourceDigests = Object.fromEntries(
	files.map((path) => [
		path,
		`sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`,
	]),
);
writeFileSync(
	output,
	JSON.stringify(
		{
			kind: "finite-numeric-differential",
			seed: 0x166,
			count: cases.length,
			fullDomainProof: false,
			performanceQualification: false,
			node: process.version,
			sourceDigests,
			cases,
		},
		null,
		2,
	),
);
console.log("NUMERIC_DIFFERENTIAL_DONE", cases.length);
