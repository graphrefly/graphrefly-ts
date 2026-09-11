/** Independent JS arithmetic replay of raw sidecars. No observer/collector imports. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.argv[2];
assert.ok(root);
const read = (p) => JSON.parse(readFileSync(path.join(root, p), "utf8"));
const result = read("result.json");
let checked = 0;
const totals = [];
for (const row of result.rows) {
	if (row.cell[0] === "B") continue;
	const name = `${String(row.position).padStart(2, "0")}-${row.cell}`;
	const g = read(`${name}/gaps.json`),
		e = read(`${name}/evidence.json`);
	let release = 0,
		cleanup = 0;
	for (const [i, r] of g.samples.entries()) {
		const w = e.windows[2 * Math.floor(i / 400) + (i % 400 < 100 ? 0 : 1)];
		assert.ok(w.start <= r.y0 && r.c1 <= w.end);
		const outer = r.y1 - r.y0 + (r.start - r.m0) + (r.m1 - r.end) + (r.r1 - r.r0) + (r.c1 - r.c0);
		const residual = r.m0 - r.y1 + (r.r0 - r.m1) + (r.c0 - r.r1);
		assert.ok(Math.abs(outer + residual + (r.end - r.start) - (r.c1 - r.y0)) < 1e-8);
		if (r.deep) {
			assert.ok(r.c0 <= r.deep.d0 && r.deep.d4 <= r.c1);
			assert.ok(r.deep.d3 <= r.deep.d4);
		}
		if (r.phase === "measured") {
			cleanup += r.c1 - r.c0;
			if (r.deep) release += r.deep.d4 - r.deep.d3;
		}
		checked++;
	}
	totals.push({
		position: row.position,
		cleanupMs: cleanup,
		releaseMs: row.cell[0] === "D" ? release : null,
	});
}
const expected = JSON.parse(readFileSync(new URL("./analysis.json", import.meta.url), "utf8"));
for (const t of totals) {
	const a = expected.totals.find((x) => x.position === t.position && x.phase === "measured");
	assert.ok(Math.abs(a.segments.cleanup - t.cleanupMs) < 1e-8);
	if (t.releaseMs !== null) assert.ok(Math.abs(a.segments["group-release"] - t.releaseMs) < 1e-8);
}
console.log(
	JSON.stringify({ passed: true, sidecars: checked, totals, realConsumerSamples: 0 }, null, 2),
);
