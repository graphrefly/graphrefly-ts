/** Private measurement shell: identical Graph/source/observer ownership for both consumer builders. */
import type { SpendingInputs } from "../../examples/spending-alerts/causal-inputs.js";
import {
	buildSpendingPresetNodes,
	spendingNodeNames,
} from "../../examples/spending-alerts/causal-preset.js";
import {
	prepareConstruction,
	startConstruction,
} from "../../packages/ts/src/graph/construction-scope.js";
import { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import { checkpointStateOfNode } from "../../packages/ts/src/node/runtime-accessors.js";
import { causalColdNodeNames } from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type { RuntimeState } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { presetBinding } from "./spending-preset-harness.js";
import { PlainSpending } from "./spending-preset-plain.js";
import { buildReferencePreset, REFERENCE_BUSINESS_NAMES } from "./spending-preset-reference.js";
import type { ReferenceLane } from "./spending-preset-reference-input.js";
import type { InputStep } from "./spending-preset-scenarios.js";
export type Arm = "candidate" | "reference" | "plain";
export type Mode = "off" | "summary";
export interface Scenario {
	id: string;
	evaluations: { evaluationRef: string }[];
	arrivals: { packRef: unknown; evaluationRefs: string[] };
	setup: InputStep[];
	steps: InputStep[];
	combined: { verification: unknown };
}
export const RECIPE = Object.freeze({
	revision: "spending-preset-performance-v1",
	coldRows: 12,
	steadyRows: 60,
	recoveryRows: 12,
	warmup: 100,
	measured: 300,
	orders: [
		["candidate", "reference"],
		["reference", "candidate"],
		["candidate", "reference"],
	],
	coldLimit: 1.2,
	steadyLimit: 1.1,
	recoveryCycles: 20,
	// A failed row rejects qualification. Other rows stay explicitly not-run; no automatic retry.
	stopAfterFailedRow: true,
	childTimeoutMs: 900000,
	totalTimeoutMs: 7200000,
	freshBasis: "distinct evaluation identities absent before the whole wave",
	doubleData:
		"two exact copies of the same arrival frame in one source.down; second copy is intra-wave replay",
	memory:
		"raw process heap/RSS before and after action; GC may make deltas negative, not retained-size proof",
});
export function matrixRows() {
	const rows: Row[] = [];
	for (const profile of ["P1", "P2", "P3", "P4", "P5", "P6"])
		for (const mode of ["off", "summary"] as const)
			rows.push({ id: `cold-${profile}-${mode}`, group: "cold", profile, mode });
	for (const profile of ["P1", "P2", "P3", "P4", "P5", "P6"])
		for (const mode of ["off", "summary"] as const)
			for (const change of [
				"duplicate",
				"all-new",
				...(["P3", "P5", "P6"].includes(profile) ? ["one-new" as const] : []),
			] as const)
				for (const dataCount of [1, 2] as const)
					rows.push({
						id: `steady-${profile}-${mode}-${change}-${dataCount}`,
						group: "steady",
						profile,
						mode,
						change,
						dataCount,
					});
	for (const profile of ["P1", "P2", "P3", "P4", "P5", "P6"])
		for (const mode of ["off", "summary"] as const)
			rows.push({ id: `recovery-${profile}-${mode}`, group: "recovery", profile, mode });
	return rows;
}
export interface Row {
	id: string;
	group: "cold" | "steady" | "recovery";
	profile: string;
	mode: Mode;
	change?: "duplicate" | "all-new" | "one-new";
	dataCount?: 1 | 2;
}
export function graphArm(arm: Exclude<Arm, "plain">, mode: Mode) {
	const graph = new Graph({ name: "spending-performance" });
	const sources = Object.fromEntries(
		(["pack", "arrivals", "current", "verification", "local", "inbox"] as const).map((name) => [
			name,
			graph.node<any>([], null, { name }),
		]),
	) as Record<ReferenceLane, Node<any>>;
	const inputs: SpendingInputs = {
		evaluations: { pack: sources.pack, arrivals: sources.arrivals, current: sources.current },
		verification: { receipts: sources.verification },
		localAuthority: { facts: sources.local },
		inbox: { facts: sources.inbox },
	};
	const names =
		arm === "candidate"
			? spendingNodeNames("spending", mode)
			: [
					"spending/startup",
					...REFERENCE_BUSINESS_NAMES.map((n) => `spending/reference/${n}`),
					...causalColdNodeNames("spending/causal"),
					"requestMaterialJoin",
					"publication",
					...(mode === "summary" ? ["spending/reference/summary"] : []),
				];
	const scope = prepareConstruction(graph, {
			name: "spending",
			epoch: presetBinding.compositionEpoch,
			names,
			inputs: Object.values(sources),
		}),
		startup = scope.startupSource();
	let view: Record<string, Node<any>>,
		conservation: Node<any>,
		summary: Node<any> | undefined,
		roots: readonly Node<any>[];
	try {
		if (arm === "candidate") {
			const built = buildSpendingPresetNodes(
				graph,
				scope,
				startup,
				inputs,
				presetBinding,
				"spending",
				mode,
			);
			view = built.consume.view;
			conservation = built.consume.capabilities.execution.conservation;
			summary = built.diagnosticSummary;
			roots = built.roots;
		} else {
			const built = buildReferencePreset(graph, scope, startup, inputs, presetBinding, mode);
			view = built.view;
			conservation = built.capabilities.execution.conservation;
			summary = built.summary;
			roots = built.roots;
		}
	} catch (e) {
		return scope.abort(e);
	}
	const owner = scope.seal(startup, roots);
	scope.transferToGraph(owner);
	startConstruction(graph, owner);
	const latest: Record<string, unknown> = {},
		counts: Record<string, number> = {};
	const observed = [
		...Object.entries(view),
		["conservation", conservation] as const,
		...(summary ? [["summary", summary] as const] : []),
	];
	let stops: (() => void)[] = [];
	function connect() {
		if (stops.length) return;
		for (const [name, node] of observed)
			stops.push(
				node.subscribe((m) => {
					if (m[0] === "DATA") {
						latest[name] = m[1];
						counts[name] = (counts[name] ?? 0) + 1;
					}
				}),
			);
	}
	function disconnect() {
		for (const stop of stops) stop();
		stops = [];
	}
	connect();
	return {
		graph,
		owner,
		sources,
		latest,
		counts,
		connect,
		disconnect,
		send: (step: InputStep) => sources[step.lane].down(step.values.map((v) => ["DATA", v])),
		state: () =>
			checkpointStateOfNode(graph.find("spending/causal/authority")!).ctxState?.value as
				| RuntimeState<unknown>
				| undefined,
		cleanup: () => {
			disconnect();
			for (const root of owner.roots) root.unsubscribe?.();
			const group = graph.topologyGroup();
			for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
			group.release();
		},
	};
}
export function measurementArm(arm: Arm, mode: Mode) {
	if (arm !== "plain") return graphArm(arm, mode);
	const plain = new PlainSpending(presetBinding);
	return {
		plain,
		send: (step: InputStep) => {
			for (const value of step.values) plain.push(step.lane, value);
		},
		connect: () => {},
		disconnect: () => {},
		cleanup: () => {},
	};
}
export function schedule(row: Row, scenario: Scenario) {
	const before: InputStep[] = [],
		action: InputStep[] = [];
	const arrival = (refs: string[], count = 1): InputStep => ({
		lane: "arrivals",
		values: Array.from({ length: count }, () => ({ ...scenario.arrivals, evaluationRefs: refs })),
	});
	if (row.group === "cold") return { before, action, preWaveNew: 0, frameItems: 0 };
	if (row.group === "recovery")
		return { before: scenario.steps, action, preWaveNew: 0, frameItems: 0 };
	const refs = scenario.arrivals.evaluationRefs;
	if (row.change === "duplicate") before.push(...scenario.steps);
	else {
		before.push(...scenario.setup);
		// P6 keeps verification absent until the timed new arrival; others are ready before it.
		if (scenario.id !== "P6")
			before.push({ lane: "verification", values: [scenario.combined.verification] });
		if (row.change === "one-new") before.push(arrival(refs.slice(0, -1)));
	}
	action.push(arrival(refs, row.dataCount));
	if (scenario.id === "P6" && row.change !== "duplicate")
		action.push(...scenario.steps.filter((s) => s.lane === "verification"));
	return {
		before,
		action,
		preWaveNew: row.change === "all-new" ? refs.length : row.change === "one-new" ? 1 : 0,
		frameItems: refs.length,
	};
}
