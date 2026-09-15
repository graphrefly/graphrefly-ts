/** Private offline timing worker. Assertions/oracles and output serialization are outside clocks. */
import assert from "node:assert/strict";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { setImmediate } from "node:timers/promises";
import type { Evaluation } from "../../examples/spending-alerts/causal-inputs.js";
import { oracleBusiness, oracleCanonical, verifyBusiness } from "./spending-preset-oracle.js";
import {
	type Arm,
	graphArm,
	matrixRows,
	measurementArm,
	RECIPE,
	type Row,
	type Scenario,
	schedule,
} from "./spending-preset-performance.js";
export { matrixRows, RECIPE };
const sorted = (v: unknown[]) => v.map((x) => oracleCanonical(x)).sort();
function graphSnapshot(run: ReturnType<typeof graphArm>) {
	const state = run.state();
	return {
		effects: [...(state?.effects.values() ?? [])].map((x) => ({
			proposal: x.proposal,
			admission: x.admission ?? null,
			outcome: x.outcome ?? null,
		})),
		evidence: sorted([...(state?.evidence.values() ?? [])]),
		obligations: sorted(
			[...(state?.quiescence.values() ?? [])].map(
				({ revisionDomain, evaluatedThroughRevision, lifecycle, retainedEvidence }) => ({
					revisionDomain,
					evaluatedThroughRevision,
					lifecycle,
					retainedEvidence,
				}),
			),
		),
		view: Object.fromEntries(Object.entries(run.latest).filter(([k]) => k !== "summary")),
	};
}
function cleanupAll(runs: ({ cleanup(): void } | undefined)[], primary?: unknown) {
	const errors: unknown[] = [];
	for (const run of runs) {
		try {
			run?.cleanup();
		} catch (error) {
			errors.push(error);
		}
	}
	if (errors.length)
		throw new AggregateError(
			primary === undefined ? errors : [primary, ...errors],
			"cleanup failures; original failure retained first",
		);
}
function materialHints(scenario: Scenario, plan: ReturnType<typeof schedule>) {
	const seen = new Set<string>();
	const flagged = new Set(
		scenario.evaluations
			.filter((e) => oracleBusiness(e as Evaluation).flagged)
			.map((e) => e.evaluationRef),
	);
	const classify = (steps: typeof plan.before) =>
		steps.map((step) => {
			let newMaterials = 0;
			if (step.lane === "arrivals")
				for (const value of step.values)
					for (const ref of (value as { evaluationRefs: string[] }).evaluationRefs) {
						if (!seen.has(ref) && flagged.has(ref)) newMaterials++;
						seen.add(ref);
					}
			return {
				lane: step.lane,
				newMaterials,
				materialPhase:
					step.lane !== "arrivals"
						? "not-applicable"
						: newMaterials
							? "inclusive-material-generation-and-hash-wave"
							: "no-new-material",
			};
		});
	return { before: classify(plan.before), action: classify(plan.action) };
}
export function preflight(row: Row, scenario: Scenario) {
	const a = graphArm("candidate", row.mode),
		b = graphArm("reference", row.mode),
		c = measurementArm("plain", row.mode);
	assert.ok("plain" in c);
	const plan = schedule(row, scenario);
	const steps = row.group === "cold" ? scenario.steps : [...plan.before, ...plan.action];
	const topology: Record<string, unknown> = {};
	let primary: unknown;
	try {
		for (const [name, run] of [
			["candidate", a],
			["reference", b],
		] as const) {
			assert.equal(run.owner.nodes.length, row.mode === "off" ? 53 : 54);
			assert.equal(run.owner.roots.length, 2);
			topology[name] = run.graph
				.describe()
				.nodes.map(({ id, deps, factory }) => ({ id, deps, factory }));
		}
		let beforeOccurrences = 0;
		for (let i = 0; i < steps.length; i++) {
			if (row.group === "steady" && i === plan.before.length)
				beforeOccurrences = a.state()?.byRevision.size ?? 0;
			for (const r of [a, b, c]) r.send(steps[i]);
			const sa = graphSnapshot(a),
				sb = graphSnapshot(b);
			assert.deepEqual(sb, sa, `${row.id} stage ${i} Graph parity`);
			assert.deepEqual(c.plain.snapshot(), sa.effects, `${row.id} stage ${i} plain effects`);
			assert.deepEqual(
				sorted(c.plain.evidenceSnapshot()),
				sa.evidence,
				`${row.id} stage ${i} evidence`,
			);
			assert.deepEqual(
				sorted(c.plain.obligationSnapshot()),
				sa.obligations,
				`${row.id} stage ${i} obligations`,
			);
		}
		const assessments = (
			a.latest.assessment as {
				rows: { evaluation: Evaluation; value: Parameters<typeof verifyBusiness>[1] }[];
			}
		).rows;
		assert.equal(assessments.length, scenario.evaluations.length);
		for (const e of scenario.evaluations) {
			const observed = assessments.find((r) => r.evaluation.evaluationRef === e.evaluationRef)!;
			assert.ok(
				observed && verifyBusiness(e as Evaluation, observed.value),
				`${row.id} business oracle ${e.evaluationRef}`,
			);
		}
		const afterOccurrences = a.state()?.byRevision.size ?? 0;
		if (row.group === "steady")
			assert.equal(
				afterOccurrences - beforeOccurrences,
				plan.preWaveNew,
				`${row.id} actual new occurrence count`,
			);
		const saved = graphSnapshot(a);
		const recoveryPorts: Record<string, unknown> = {};
		for (const [arm, run] of [
			["candidate", a],
			["reference", b],
		] as const) {
			const counts = { ...run.counts },
				keys = Object.keys(run.latest);
			run.disconnect();
			assert.deepEqual(graphSnapshot(run), saved, `${row.id} detached state retained`);
			for (const key of keys) delete run.latest[key];
			run.connect();
			const reemitted = keys.filter((key) => run.counts[key] > counts[key]),
				missing = keys.filter((key) => !reemitted.includes(key));
			recoveryPorts[arm] = { reemitted, missing };
			// D163 guarantees publication recovery, not all event projections (design section 70).
			for (const key of ["assessment", "publication", "startup"])
				if (keys.includes(key))
					assert.ok(reemitted.includes(key), `${row.id} reconnect DATA ${key}`);
			const restored = graphSnapshot(run);
			assert.deepEqual(
				{ ...restored, view: undefined },
				{ ...saved, view: undefined },
				`${row.id} reconnected authority retained`,
			);
			for (const key of reemitted.filter((key) => key !== "summary"))
				assert.deepEqual(restored.view[key], saved.view[key]);
		}
		return {
			passed: true,
			materialHints: materialHints(scenario, plan),
			recoveryPorts,
			topology,
			beforeOccurrences,
			afterOccurrences,
			preWaveNew: plan.preWaveNew,
			frameItems: plan.frameItems,
			arrivalDataCount: row.dataCount ?? 0,
			newByEntry:
				row.group === "steady" ? [plan.preWaveNew, ...(row.dataCount === 2 ? [0] : [])] : [],
			extraVerificationData: plan.action
				.filter((s) => s.lane === "verification")
				.reduce((n, s) => n + s.values.length, 0),
			assessments: assessments.length,
			effects: saved.effects.length,
		};
	} catch (error) {
		primary = error;
		throw error;
	} finally {
		cleanupAll([a, b, c], primary);
	}
}
export async function runRow(configPath: string) {
	const config = JSON.parse(readFileSync(configPath, "utf8")) as {
		row: Row;
		scenarioPath: string;
		output: string;
	};
	const { row, output } = config,
		scenario = JSON.parse(readFileSync(config.scenarioPath, "utf8")) as Scenario;
	const put = (name: string, value: unknown) =>
		writeFileSync(`${output}/${name}`, `${JSON.stringify(value, null, 2)}\n`);
	const measure = (arm: Arm, mode: "off" | "summary") => measurementArm((config as typeof config & { identicalReference: boolean }).identicalReference && arm === "candidate" ? "reference" : arm, mode);
	const checked = preflight(row, scenario);
	put("preflight.json", checked);
	const plan = schedule(row, scenario),
		samplesPath = `${output}/samples.jsonl`;
	const metadata = {
		node: process.version,
		pid: process.pid,
		timeOrigin: performance.timeOrigin,
		uptimeOffsetMs: process.uptime() * 1000 - performance.now(),
		recipe: RECIPE,
		row,
	};
	put("worker.json", metadata);
	const samples: unknown[] = [];
	const record = (v: unknown) => {
		samples.push(v);
		appendFileSync(samplesPath, `${JSON.stringify(v)}\n`);
	};
	// Arm blocks follow the frozen three AB/BA/AB batches. Plain is absolute-only, after each pair.
	for (let batch = 0; batch < RECIPE.orders.length; batch++) {
		const arms = [...RECIPE.orders[batch], ...(row.group === "recovery" ? [] : ["plain"])] as Arm[];
		for (const arm of arms) {
			// Recovery is 20 actual cycles per arm, no p95 ratio gate or synthetic warmup cycles.
			if (row.group === "recovery" && batch > 0) continue;
			let shared: ReturnType<typeof measurementArm> | undefined;
			const total =
				row.group === "recovery" ? RECIPE.recoveryCycles : RECIPE.warmup + RECIPE.measured;
			let armFailure: unknown;
			let recoveryBaseline: unknown;
			try {
				for (let index = 0; index < total; index++) {
					await setImmediate();
					const phase = row.group === "recovery" || index >= RECIPE.warmup ? "measured" : "warmup";
					let run: ReturnType<typeof measurementArm> | undefined, sampleFailure: unknown;
					let constructionMs = 0,
						preparationMs = 0;
					const preparationSteps: { start: number; end: number }[] = [],
						actionSteps: { start: number; end: number }[] = [];
					const fresh =
						row.group === "cold" || row.change === "all-new" || row.change === "one-new";
					try {
						if (row.group !== "cold") {
							if (!shared || fresh) {
								const begin = performance.now();
								run = measure(arm, row.mode);
								constructionMs = performance.now() - begin;
								const setupBegin = performance.now();
								for (const step of plan.before) {
									const start = performance.now();
									run.send(step);
									preparationSteps.push({ start, end: performance.now() });
								}
								preparationMs = performance.now() - setupBegin;
								if (!fresh) shared = run;
							} else run = shared;
						}
						const recoveryCounts =
							row.group === "recovery" && run && "counts" in run ? { ...run.counts } : undefined;
						if (row.group === "recovery" && run && "graph" in run && recoveryBaseline === undefined)
							recoveryBaseline = graphSnapshot(run);
						const memoryBefore = process.memoryUsage();
						const start = performance.now();
						if (row.group === "cold") run = measure(arm, row.mode);
						else if (row.group === "recovery") {
							run!.disconnect();
							run!.connect();
						} else
							for (const step of plan.action) {
								const start = performance.now();
								run!.send(step);
								actionSteps.push({ start, end: performance.now() });
							}
						const end = performance.now();
						const memoryAfter = process.memoryUsage();
						if (recoveryCounts && run && "graph" in run) {
							for (const key of ["assessment", "publication", "startup"].filter(
								(key) => key in recoveryCounts,
							))
								assert.ok(
									run.counts[key] > recoveryCounts[key],
									`cycle ${index} reconnect DATA ${key}`,
								);
							assert.deepEqual(
								graphSnapshot(run),
								recoveryBaseline,
								`cycle ${index} obligations retained`,
							);
						}
						const restoredCounts = run && "counts" in run ? run.counts : undefined;
						record({
							arm,
							batch,
							index,
							phase,
							segment: shared
								? `${row.id}/${batch}/${arm}/shared`
								: `${row.id}/${batch}/${arm}/${index}`,
							start,
							end,
							ms: end - start,
							constructionMs,
							preparationMs,
							preparationSteps,
							actionSteps,
							memoryBefore,
							recoveryDataCounts:
								recoveryCounts && restoredCounts
									? Object.fromEntries(
											Object.keys(recoveryCounts).map((k) => [
												k,
												restoredCounts[k] - recoveryCounts[k],
											]),
										)
									: undefined,
							memoryAfter,
						});
					} catch (error) {
						sampleFailure = error;
						throw error;
					} finally {
						if (run !== shared) cleanupAll([run], sampleFailure);
					}
				}
			} catch (error) {
				armFailure = error;
				throw error;
			} finally {
				cleanupAll([shared], armFailure);
			}
		}
	}
	put("completion.json", { completed: true, samples: samples.length });
	console.log("PRESET_PERFORMANCE_ROW_DONE", row.id, samples.length);
}
