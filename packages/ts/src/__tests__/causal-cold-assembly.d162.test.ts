import { afterEach, describe, expect, it, vi } from "vitest";
import { depLatest } from "../ctx/types.js";
import { Dispatcher, type Handle } from "../dispatcher/index.js";
import {
	ColdConstructionError,
	type ConstructionScope,
	constructionOf,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import { checkpointStateOfNode, subscriberCountOfNode } from "../node/runtime-accessors.js";
import {
	assertCausalCapabilities,
	type CausalBinding,
} from "../solutions/causal-occurrence/capabilities.js";
import {
	assertCausalOccurrenceTopology,
	buildCausalNodes,
	causalColdNodeNames,
	prepareCausalOptions,
} from "../solutions/causal-occurrence/construction.js";
import type {
	CausalEffectOutcome,
	CausalOccurrence,
	CausalOccurrenceBundleOptions,
	RuntimeState,
} from "../solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest } from "../solutions/causal-occurrence.js";

const graphs: Graph[] = [];
const dispatchers = new Map<Graph, CountingDispatcher>();
const stops: Array<() => void> = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const stop of stops.splice(0)) stop();
	for (const g of graphs.splice(0)) {
		for (const name of ["run", "context", "foreign", "sealed"])
			for (const lease of constructionOf(g, name)?.roots ?? []) lease.unsubscribe?.();
		const group = g.topologyGroup();
		for (const n of g.describe().nodes) group.add(g.find(n.id)!);
		group.release();
	}
});
function trackedGraph(dispatcher = new CountingDispatcher()) {
	const g = new Graph({ dispatcher });
	graphs.push(g);
	dispatchers.set(g, dispatcher);
	return g;
}
class CountingDispatcher extends Dispatcher {
	readonly live = new Set<Handle>();
	override register(...args: Parameters<Dispatcher["register"]>): Handle {
		const handle = super.register(...args);
		this.live.add(handle);
		return handle;
	}
	override unregister(handle: Handle): void {
		super.unregister(handle);
		this.live.delete(handle);
	}
}

function causal(graph = new Graph(), fault = false) {
	const material = {
		revisionDomain: "d",
		occurrenceId: "one",
		revision: 1,
		sourceRefs: [{ kind: "input", id: "one" }],
		value: "value-5",
	};
	const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
	const proposal = {
		occurrence,
		effectId: "effect",
		requestRef: { kind: "request", id: "request" },
		proposalDigest: `sha256:${"b".repeat(64)}`,
	};
	const admitted = {
		...proposal,
		admissionRef: { kind: "admission", id: "admission" },
		state: "admitted" as const,
	};
	const outcomes = graph.node<CausalEffectOutcome>([], null, { name: "input/outcome" });
	const options: CausalOccurrenceBundleOptions<string> = {
		name: "causal",
		occurrences: graph.state(occurrence, { name: "input/occurrence" }),
		admissions: graph.state(
			{
				occurrence,
				decisionId: "decision",
				decisionDigest: `sha256:${"a".repeat(64)}`,
				state: "admitted" as const,
			},
			{ name: "input/admission" },
		),
		branchTerminals: graph.state(
			{
				occurrence,
				branch: "one",
				state: "completed" as const,
				result: { kind: "ok" as const, value: "done" },
			},
			{ name: "input/terminal" },
		),
		effectProposals: graph.state(proposal, { name: "input/proposal" }),
		effectAdmissions: graph.state(admitted, { name: "input/effect-admission" }),
		effectOutcomes: outcomes,
		evidence: graph.node([], null, { name: "input/evidence" }),
		watermarks: graph.producer(
			(ctx) => {
				ctx.down([["DATA", { revisionDomain: "d", revision: 1 }]]);
				if (fault) throw new Error("after admission");
			},
			{ name: "input/watermark" },
		),
		requiredBranches: ["one"],
		requiredEvidenceKinds: ["receipt"],
		maxOccurrences: 8,
		maxPending: 8,
		maxEffects: 8,
		maxEvidence: 8,
	};
	return { graph, options, occurrence, admitted, outcomes };
}
const binding: CausalBinding = {
	contract: "contract-v2",
	implementationRevision: "construction-v1",
	scope: "full",
	epoch: 1,
};

function combined(inject?: (scope: ConstructionScope) => void, empty = false) {
	const dispatcher = new CountingDispatcher();
	const f = causal(trackedGraph(dispatcher));
	const a = empty
		? f.graph.node<number>([], null, { name: "external/a" })
		: f.graph.state(2, { name: "external/a" });
	const b = f.graph.state(3, { name: "external/b" });
	const before = f.graph.describe();
	const handlesBefore = dispatcher.live.size;
	const scope = prepareConstruction(f.graph, {
		name: "run",
		epoch: 1,
		inputs: [
			a,
			b,
			f.options.admissions,
			f.options.branchTerminals,
			f.options.effectProposals,
			f.options.effectAdmissions,
			f.outcomes,
			f.options.evidence,
			f.options.watermarks,
		],
		names: [
			"run/startup",
			"run/left",
			"run/right",
			"run/occurrence",
			...causalColdNodeNames("run/causal"),
			"run/value",
			"run/count",
			"run/final",
		],
	});
	let calls = 0;
	inject?.(scope);
	try {
		const startup = scope.startupSource();
		const left = scope.node<number>(
			[a],
			(ctx) => {
				calls++;
				ctx.down([["DATA", Number(depLatest(ctx, 0)) * 2]]);
			},
			{ name: "run/left" },
		);
		const right = scope.node<number>(
			[a, b],
			(ctx) => {
				calls++;
				ctx.down([["DATA", Number(depLatest(ctx, 0)) + Number(depLatest(ctx, 1))]]);
			},
			{ name: "run/right" },
		);
		const occurrence = scope.node<CausalOccurrence<string>>(
			[left, right],
			(ctx) => {
				calls++;
				const value = `value-${Number(depLatest(ctx, 1))}`;
				const material = { ...f.occurrence, value };
				// Both branches are real deps; value agrees with the frozen fixture at a=2,b=3.
				if (Number(depLatest(ctx, 0)) !== 4) return;
				ctx.down([["DATA", { ...material, digest: causalOccurrenceDigest(material) }]]);
			},
			{ name: "run/occurrence" },
		);
		const built = buildCausalNodes(
			f.graph,
			scope,
			startup,
			prepareCausalOptions({ ...f.options, name: "run/causal", occurrences: occurrence }),
			binding,
		);
		const value = scope.node([built.ports.released], null, { name: "run/value", replayBuffer: 8 });
		const count = scope.node<number>(
			[built.ports.released],
			(ctx) => ctx.down([["DATA", (depLatest(ctx, 0) as CausalOccurrence<string>).value.length]]),
			{
				name: "run/count",
				replayBuffer: 8,
			},
		);
		const final = scope.node(
			[value, count],
			(ctx) => ctx.down([["DATA", [depLatest(ctx, 0), depLatest(ctx, 1)]]]),
			{ name: "run/final" },
		);
		return {
			...f,
			a,
			b,
			scope,
			startup,
			built,
			value,
			count,
			final,
			dispatcher,
			before,
			handlesBefore,
			calls: () => calls,
		};
	} catch (error) {
		scope.abort(error);
	}
}
function own(f: ReturnType<typeof combined>, extra = true) {
	const owner = f.scope.seal(f.startup, [...f.built.roots, ...(extra ? [f.final] : [])]);
	f.scope.transferToGraph(owner);
	return owner;
}
function effects(f: ReturnType<typeof combined>) {
	return [
		...(
			checkpointStateOfNode(f.graph.find("run/causal/authority")!).ctxState
				.value as RuntimeState<string>
		).effects.values(),
	];
}

describe("D162 private shared cold assembly", () => {
	it("waits for a late required input and handles a finite repeated DATA batch", () => {
		const f = combined(undefined, true);
		const owner = own(f);
		startConstruction(f.graph, owner);
		expect(f.value.cache).toBeUndefined();
		expect(effects(f)).toHaveLength(0);
		f.a.down([
			["DATA", 2],
			["DATA", 2],
		]);
		expect(f.value.cache).toEqual(f.occurrence);
		expect(effects(f)).toHaveLength(1);
		expect(effects(f)[0]?.admission?.state).toBe("admitted");
	});
	it("checks the final binding epoch snapshot, not an earlier getter result", () => {
		const f = causal(trackedGraph());
		const scope = prepareConstruction(f.graph, {
			name: "epoch",
			epoch: 1,
			inputs: [],
			names: ["epoch/startup", ...causalColdNodeNames("epoch/causal")],
		});
		const startup = scope.startupSource();
		let reads = 0;
		const changing = {
			...binding,
			get epoch() {
				return ++reads === 1 ? 1 : 2;
			},
		};
		expect(() =>
			buildCausalNodes(
				f.graph,
				scope,
				startup,
				prepareCausalOptions({ ...f.options, name: "epoch/causal" }),
				changing,
			),
		).toThrow(/context/);
		expect(f.graph.describe().nodes.filter((n) => n.name?.startsWith("epoch/"))).toHaveLength(1);
	});
	it("validates options once before resource acquisition and never revalidates the captured snapshot", () => {
		const f = causal(trackedGraph());
		let reads = 0;
		const prepared = prepareCausalOptions({
			...f.options,
			get maxOccurrences() {
				return ++reads === 1 ? 1 : 0;
			},
		});
		expect(reads).toBe(2);
		expect(prepared.options.maxOccurrences).toBe(0);
		const scope = prepareConstruction(f.graph, {
			name: "causal",
			epoch: 1,
			inputs: [],
			names: ["causal/startup", ...causalColdNodeNames("causal")],
		});
		const startup = scope.startupSource();
		buildCausalNodes(f.graph, scope, startup, prepared, binding);
		expect(reads).toBe(2);
	});
	it("requires every union name before seal", () => {
		const g = trackedGraph();
		const scope = prepareConstruction(g, {
			name: "missing",
			epoch: 1,
			inputs: [],
			names: ["missing/startup", "missing/last"],
		});
		const st = scope.startupSource();
		expect(() => scope.seal(st, [])).toThrow(/incomplete/);
		expect(constructionOf(g, "missing")).toBeUndefined();
	});

	it("builds real upstream and downstream nodes cold, then transfers exactly once before any execution", () => {
		const f = combined();
		expect(f.calls()).toBe(0);
		expect(subscriberCountOfNode(f.a)).toBe(0);
		expect(constructionOf(f.graph, "run")).toBeUndefined();
		expect(constructionOf(f.graph, "run/causal")).toBeUndefined();
		expect(f.built.full.startup).toBe(f.startup);
		assertCausalCapabilities(f.graph, f.built.full, binding);
		const owner = own(f);
		expect(f.calls()).toBe(0);
		expect(owner.nodes).toHaveLength(30);
		startConstruction(f.graph, owner);
		expect(f.calls()).toBeGreaterThan(0);
		expect(f.startup.cache?.state).toBe("started");
		expect(f.value.cache).toEqual(f.occurrence);
		expect(f.count.cache).toBe("value-5".length);
		expect(f.final.cache).toEqual([f.occurrence, "value-5".length]);
		expect(owner.nodes).toContain(f.final);
		expect(owner.nodes).toContain(f.graph.find("run/causal/authority"));
		expect(() => f.scope.transferToGraph(owner)).toThrow();
		expect(() => startConstruction(f.graph, owner)).toThrow();
		expect(f.built.full.execution.identity).toBe(f.built.full.identity);
		expect(f.built.full.retained.execution).toBe(f.built.full.execution);
	});
	it.each([
		1, 4, 12, 26, 30,
	])("cleans all acquired members when acquisition %i throws after registration", (at) => {
		let graph: Graph | undefined;
		let baseline = 0;
		let handles: Set<Handle>;
		let n = 0;
		const shared: number[] = [];
		// The exception happens after the real node acquisition, so cleanup must use its journal.
		expect(() =>
			combined((scope) => {
				const original = scope.node.bind(scope);
				vi.spyOn(scope, "node").mockImplementation((...args) => {
					const node = original(...args);
					n++;
					if (n === 1) {
						graph = graphs.at(-1)!;
						baseline = graph.describe().nodes.length - 1;
						handles = new Set(dispatchers.get(graph)!.live);
						// Native startup has no fn handle; this is the exact external handle set.
						const a = graph.find("external/a")!;
						stops.push(
							a.subscribe((m) => {
								if (m[0] === "DATA") shared.push(m[1] as number);
							}),
						);
					}
					if (n === at) throw new Error("post-acquisition fault");
					return node;
				});
			}),
		).toThrow(ColdConstructionError);
		expect(graph!.describe().nodes).toHaveLength(baseline);
		expect(graph!.describe().nodes.some((n) => n.name?.startsWith("run/"))).toBe(false);
		expect(constructionOf(graph!, "run")).toBeUndefined();
		expect(shared).toEqual([2]);
		expect(dispatchers.get(graph!)!.live).toEqual(handles!);
		graph!.find("external/a")!.down([["DATA", 7]]);
		expect(shared).toEqual([2, 7]);
	});
	it.each([
		"graph",
		"startup",
		"epoch",
		"sealed",
	])("rejects %s context before adding any causal member", (kind) => {
		const f = causal(trackedGraph());
		const g = f.graph;
		const scope = prepareConstruction(g, {
			name: "context",
			epoch: 1,
			inputs: [],
			names: ["context/startup", ...causalColdNodeNames("context/causal")],
		});
		const startup = scope.startupSource();
		let targetGraph = g,
			targetStartup = startup,
			epoch = 1;
		if (kind === "graph") targetGraph = trackedGraph();
		if (kind === "startup") {
			const foreign = prepareConstruction(g, {
				name: "foreign",
				epoch: 1,
				inputs: [],
				names: ["foreign/startup"],
			});
			targetStartup = foreign.startupSource();
		}
		if (kind === "epoch") epoch = 2;
		if (kind === "sealed") {
			const s = prepareConstruction(g, {
				name: "sealed",
				epoch: 1,
				inputs: [],
				names: ["sealed/startup"],
			});
			const st = s.startupSource();
			s.seal(st, []);
			expect(() => buildCausalNodes(g, s, st, prepareCausalOptions(f.options), binding)).toThrow(
				/context/,
			);
			return;
		}
		const before = g.describe().nodes.length;
		expect(() =>
			buildCausalNodes(
				targetGraph,
				scope,
				targetStartup,
				prepareCausalOptions({ ...f.options, name: "context/causal" }),
				{ ...binding, epoch },
			),
		).toThrow(/context/);
		expect(g.describe().nodes).toHaveLength(before);
		expect(constructionOf(g, "context")).toBeUndefined();
	});
	it("retains obligations across late root failure, UI unsubscribe, wrong outcome and exact replay", () => {
		const f = combined();
		const owner = own(f);
		// Fail only after the original release root has activated the actual authority.
		vi.spyOn(f.final, "_subscribeOwned").mockImplementation(() => {
			throw new Error("late root failure");
		});
		startConstruction(f.graph, owner);
		expect(owner.phase).toBe("faulted");
		expect(effects(f)[0]?.admission?.state).toBe("admitted");
		const seen: unknown[] = [];
		const stop = f.built.ports.conservation.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		stop();
		expect(effects(f)[0]?.outcome).toBeUndefined();
		const outcome: CausalEffectOutcome = {
			...f.admitted,
			state: "failed",
			result: {
				kind: "error",
				error: { kind: "issue", code: "known-failure", message: "fixture boundary did not write" },
			},
		};
		f.outcomes.down([["DATA", { ...outcome, admissionRef: { kind: "admission", id: "wrong" } }]]);
		expect(effects(f)[0]?.outcome).toBeUndefined();
		const collect = f.built.ports.conservation.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		f.outcomes.down([["DATA", outcome]]);
		f.outcomes.down([["DATA", outcome]]);
		collect();
		const again = f.built.ports.conservation.subscribe((m) => {
			if (m[0] === "DATA") seen.push(m[1]);
		});
		again();
		expect(effects(f)[0]?.outcome?.state).toBe("failed");
		expect(seen).toContainEqual(expect.objectContaining({ active: 0, failed: 1, admitted: 1 }));
		expect(constructionOf(f.graph, "run")).toBe(owner);
		expect(owner.phase).toBe("faulted");
		expect(seen.length).toBeGreaterThan(0);
	});
	it("does not lose the early cached occurrence when view roots activate after the authority root", () => {
		const f = combined();
		const owner = own(f);
		startConstruction(f.graph, owner);
		const values: unknown[] = [];
		const stop = f.value.subscribe((m) => {
			if (m[0] === "DATA") values.push(m[1]);
		});
		stop();
		expect(values).toEqual([f.occurrence]);
		expect(f.count.cache).toBe("value-5".length);
	});
	it("preserves shared dependency protection before ownership or activation", () => {
		const f = combined();
		// Actual removal invalidates real dependency membership at the normal construction boundary.
		const group = f.graph.topologyGroup();
		group.add(f.a);
		expect(() => group.release()).toThrow();
		expect(f.calls()).toBe(0);
	});
	it("checks the actual upstream and authority edges without manifest-synthesized edges", () => {
		const f = combined();
		const snap = f.scope.readIncoming();
		expect(snap.edges).toContainEqual(
			expect.objectContaining({ from: "run/occurrence", to: "run/causal/input/occurrences" }),
		);
		expect(() =>
			assertCausalOccurrenceTopology(
				{ edges: snap.edges.filter((e) => e.to !== "run/causal/input/occurrences") },
				"run/causal",
			),
		).toThrow();
		expect(f.calls()).toBe(0);
	});
});
