/** Fixed diagnostic attribution map. One action per case is NOT a p95 qualification sample. */
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { matrixRows, measurementArm, schedule } from "./spending-preset-performance.js";
import { preflight } from "./spending-preset-performance-worker.js";

const results = [];
for (const row of matrixRows()) {
	const scenario = JSON.parse(
		readFileSync(new URL(`./${row.profile}-inputs.json`, import.meta.url), "utf8"),
	);
	const semantic = preflight(row, scenario);
	assert.equal(semantic.passed, true);
	const plan = schedule(row, scenario);
	const arms = [];
	for (const arm of row.group === "recovery"
		? (["candidate", "reference"] as const)
		: (["candidate", "reference", "plain"] as const)) {
		let shared: ReturnType<typeof measurementArm> | undefined;
		const observations = [];
		try {
			const fresh = row.group === "cold" || row.change === "all-new" || row.change === "one-new";
			for (let index = 0; index < (row.group === "recovery" ? 20 : 1); index++) {
				let run: ReturnType<typeof measurementArm> | undefined;
				try {
					const constructStart = performance.now();
					run = shared ?? measurementArm(arm, row.mode);
					const constructMs = shared ? 0 : performance.now() - constructStart;
					const prepareStart = performance.now();
					if (!shared) for (const step of plan.before) run.send(step);
					const preparationMs = shared ? 0 : performance.now() - prepareStart;
					if (!fresh) shared = run;
					const before = "graph" in run ? run.graph.profile() : undefined;
					const counts = "counts" in run ? { ...run.counts } : undefined;
					const stateBefore = "state" in run ? structuredClone(run.state()) : undefined;
					const memoryBefore = process.memoryUsage();
					const start = performance.now();
					if (row.group === "recovery") {
						run.disconnect();
						run.connect();
					} else if (row.group === "steady") for (const step of plan.action) run.send(step);
					const ms = performance.now() - start;
					const memoryAfter = process.memoryUsage();
					const after = "graph" in run ? run.graph.profile() : undefined;
					if (row.group === "recovery" && "state" in run) {
						assert.deepEqual(run.state(), stateBefore);
						for (const key of ["assessment", "publication", "startup"])
							if (counts && key in counts) assert.ok(run.counts[key] > counts[key]);
					}
					const nodes =
						before && after
							? Object.fromEntries(
									Object.entries(after.nodes).map(([id, n]) => [
										id,
										{
											invokes: n.invokes - before.nodes[id].invokes,
											totalDurationNs: n.totalDurationNs - before.nodes[id].totalDurationNs,
										},
									]),
								)
							: null;
					observations.push({
						index,
						constructMs,
						preparationMs,
						ms,
						memoryBefore,
						memoryAfter,
						totalInvokes: before && after ? after.totalInvokes - before.totalInvokes : null,
						nodes,
					});
				} finally {
					if (run !== shared) run?.cleanup();
				}
			}
		} finally {
			shared?.cleanup();
		}
		arms.push({ arm, observations });
	}
	results.push({ row, semantic, arms });
	appendFileSync(
		new URL("./rows.jsonl", import.meta.url),
		JSON.stringify({ row, semantic, arms }) + "\n",
	);
	writeFileSync(
		new URL("./progress.json", import.meta.url),
		JSON.stringify({ completedRows: results.length, row: row.id }) + "\n",
	);
	console.log("PROFILE_MAP_ROW", results.length, row.id);
}
writeFileSync(
	new URL("./result.json", import.meta.url),
	JSON.stringify(
		{
			kind: "fixed-single-action-profile-map",
			formalQualification: false,
			limitations:
				"Opt-in profiling changes timing; durations may nest. Absolute observations and invocation counts only, no p95 or relative performance qualification.",
			results,
		},
		null,
		2,
	) + "\n",
);
console.log("PROFILE_MAP_DONE", results.length);
