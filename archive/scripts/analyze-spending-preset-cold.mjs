/** Attribute sampled JavaScript stacks structurally; never align profiler/hrtime clocks by guess. */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
export function analyzeCpu(profile) {
	const nodes = new Map(profile.nodes.map((n) => [n.id, n])),
		parents = new Map();
	for (const node of profile.nodes)
		for (const child of node.children ?? []) {
			assert.ok(!parents.has(child), "profile must be a call tree");
			parents.set(child, node.id);
		}
	const own = new Map(),
		inclusive = new Map(),
		excluded = new Map();
	let construction = 0;
	const add = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
	for (const id of profile.samples) {
		const stack = [],
			seen = new Set();
		let current = id;
		while (current !== undefined) {
			assert.ok(!seen.has(current), "cyclic profile");
			seen.add(current);
			const n = nodes.get(current);
			assert.ok(n, "missing frame");
			stack.push(n.callFrame);
			current = parents.get(current);
		}
		const boundary = stack.findIndex((f) => f.functionName === "graphArm");
		if (boundary < 0) {
			add(excluded, stack[0].functionName || "(anonymous)");
			continue;
		}
		construction++;
		const key = (f) => `${f.functionName || "(anonymous)"}@${f.lineNumber + 1}`;
		add(own, key(stack[0]));
		for (const name of new Set(
			stack.slice(0, boundary + 1).map((f) => f.functionName || "(anonymous)"),
		))
			add(inclusive, name);
	}
	const ranked = (map) =>
		[...map]
			.sort((a, b) => b[1] - a[1])
			.map(([frame, count]) => ({
				frame,
				count,
				constructionFraction: construction ? count / construction : null,
			}));
	return {
		totalSamples: profile.samples.length,
		constructionSamples: construction,
		otherSamples: profile.samples.length - construction,
		own: ranked(own),
		inclusive: ranked(inclusive),
		excluded: [...excluded].sort((a, b) => b[1] - a[1]),
		meaning:
			"Sample counts, not time or exclusive cost. Only JS stacks containing graphArm; native/GC without that frame unassigned. Inclusive rows overlap.",
	};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const base = resolve(process.argv[2]),
		output = resolve(base, process.argv[3] ?? "analysis.json");
	assert.ok(!existsSync(output), "fresh analysis output required");
	assert.equal(
		JSON.parse(readFileSync(resolve(base, "completion.json"), "utf8")).completed,
		true,
		"diagnostic run incomplete",
	);
	const cpu = {},
		stages = {};
	for (const name of readdirSync(base).filter((n) => n.startsWith("job-"))) {
		const dir = resolve(base, name),
			config = JSON.parse(readFileSync(resolve(dir, "config.json"), "utf8"));
		assert.equal(
			JSON.parse(readFileSync(resolve(dir, "completion.json"), "utf8")).completed,
			true,
			"diagnostic job incomplete",
		);
		assert.equal(
			JSON.parse(readFileSync(resolve(dir, "process.json"), "utf8")).exitCode,
			0,
			"diagnostic job failed",
		);
		if (config.kind === "profile") {
			assert.equal(
				JSON.parse(readFileSync(resolve(dir, "profile-scope.json"), "utf8")).partial,
				false,
				"partial CPU profile",
			);
			cpu[name] = {
				status: "complete",
				...analyzeCpu(JSON.parse(readFileSync(resolve(dir, "cpu.cpuprofile"), "utf8"))),
			};
		} else {
			const x = JSON.parse(readFileSync(resolve(dir, "summary.json"), "utf8"));
			stages[config.mode] = Object.fromEntries(
				Object.entries(x.candidate.stages).map(([label, a]) => {
					const b = x.reference.stages[label];
					return [
						label,
						{
							candidate: a,
							reference: b,
							meanDeltaMs: a.meanMs - b.meanMs,
							p50DeltaMs: a.p50Ms - b.p50Ms,
						},
					];
				}),
			);
		}
	}
	writeFileSync(
		output,
		`${JSON.stringify({ qualification: false, stages, cpu, limits: ["Instrumentation is included in stage times", "p50/p95 components are not additive", "No historical p95 causal proof", "Native and cleanup samples without graphArm are excluded from construction attribution"] }, null, 2)}\n`,
	);
	console.log("COLD_ANALYSIS_DONE");
}
