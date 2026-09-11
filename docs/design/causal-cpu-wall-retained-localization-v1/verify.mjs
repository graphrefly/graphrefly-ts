/** Independent retained-gap relation comparison; never imports a consumer. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { relation } from "../../../scripts/causal-event-correlation.mjs";

const root = process.argv[2],
	doc = fileURLToPath(new URL(".", import.meta.url));
assert.ok(root);
const a = JSON.parse(readFileSync(`${doc}/analysis.json`, "utf8"));
let checked = 0;
for (const row of a.jobs.filter((x) => x.job.includes("-T-"))) {
	const t = JSON.parse(readFileSync(`${root}/${row.job}/report.json`, "utf8")).trace,
		e = JSON.parse(readFileSync(`${root}/${row.job}/evidence.json`, "utf8"));
	const raw = readFileSync(`${root}/${row.job}/samples.jsonl`, "utf8")
		.trim()
		.split("\n")
		.map(JSON.parse);
	const lo = Number(BigInt(e.anchors[0].h) / 1000n),
		hi = Number((BigInt(e.anchors[2].h) + 999n) / 1000n);
	for (const cell of row.phases) {
		const n = cell.phase === "warmup" ? 100 : 300,
			offset = cell.block * 400 + (cell.phase === "warmup" ? 0 : 100),
			expected = [];
		for (let i = offset; i < offset + n - 1; i++) {
			const g = {
				afterIndex: raw[i].index,
				ms: raw[i + 1].start - raw[i].end,
				gc: [],
				deopt: [],
				possible: [],
			};
			t.events.forEach((event, j) => {
				if (event.start < lo || event.end > hi) return;
				const status = relation(
					[event.start, event.end],
					{ start: raw[i].end, end: raw[i + 1].start },
					t.deltaUs,
				).status;
				if (status === "overlap") g[event.name === "V8.DeoptimizeCode" ? "deopt" : "gc"].push(j);
				else if (status === "possible") g.possible.push(j);
			});
			if (g.gc.length || g.deopt.length || g.possible.length) expected.push(g);
			checked++;
		}
		assert.deepEqual(expected, cell.gapRelations);
	}
}
writeFileSync(
	`${doc}/verification.json`,
	JSON.stringify(
		{
			passed: true,
			independentlyComparedGapRelations: checked,
			newConsumerSamples: 0,
			newCaptureProcesses: 0,
			method:
				"Python gap classifier agrees with previously qualified JS relation on every within-phase gap in all four retained T processes",
		},
		null,
		"\t",
	) + "\n",
);
console.log("RETAINED_GAP_VERIFICATION_DONE", checked);
