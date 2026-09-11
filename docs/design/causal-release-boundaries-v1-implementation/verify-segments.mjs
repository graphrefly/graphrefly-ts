/** Independent JS raw arithmetic, no collector/observer import. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
assert.ok(root);
const read = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const result = read("result.json");
const analysis = JSON.parse(readFileSync(new URL("./analysis.json", import.meta.url), "utf8"));
const names = [
	"entry-preparation",
	"external-dependency-checks",
	"quiescence-subscriber-checks",
	"event-registry-removal",
	"runtime-release",
	"owner-event-finalization",
];
let sidecars = 0,
	internalSidecars = 0;
for (const row of result.rows) {
	const dir = `${String(row.position).padStart(2, "0")}-${row.cell}`,
		g = read(`${dir}/gaps.json`),
		e = read(`${dir}/evidence.json`);
	const sums = Object.fromEntries([...names, "wrapper-remainder"].map((k) => [k, 0]));
	for (const [i, s] of g.samples.entries()) {
		sidecars++;
		const w = e.windows[2 * Math.floor(i / 400) + (i % 400 < 100 ? 0 : 1)];
		assert.ok(w.start <= s.y0 && s.c1 <= w.end);
		if (row.cell[0] !== "R") continue;
		internalSidecars++;
		const t = Array.from({ length: 7 }, (_, n) => s.deep.release[`r${n}`]);
		assert.ok(t.every(Number.isFinite));
		assert.deepEqual(
			t,
			[...t].sort((a, b) => a - b),
		);
		assert.ok(s.deep.d3 <= t[0] && t[6] <= s.deep.d4);
		const parts = t.slice(1).map((x, n) => x - t[n]),
			remaining = t[0] - s.deep.d3 + s.deep.d4 - t[6];
		assert.ok(Math.abs(parts.reduce((a, b) => a + b, remaining) - (s.deep.d4 - s.deep.d3)) < 1e-8);
		if (s.phase === "measured") {
			for (let n = 0; n < 6; n++) sums[names[n]] += parts[n];
			sums["wrapper-remainder"] += remaining;
		}
	}
	if (row.cell[0] === "R") {
		const expected = analysis.totals.find(
			(t) => t.position === row.position && t.phase === "measured",
		).releaseSegments;
		for (const [k, v] of Object.entries(sums)) assert.ok(Math.abs(v - expected[k]) < 1e-8, k);
	}
}
console.log(
	JSON.stringify({ passed: true, sidecars, internalSidecars, realConsumerSamples: 0 }, null, 2),
);
