import { afterEach, describe, expect, it, vi } from "vitest";
import {
	constructionOf,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { checkpointStateOfNode } from "../node/runtime-accessors.js";
import type { CausalBinding } from "../solutions/causal-occurrence/capabilities.js";
import * as projection from "../solutions/causal-occurrence/committed-view.js";
import {
	buildCausalNodes,
	causalColdNodeNames,
	prepareCausalOptions,
} from "../solutions/causal-occurrence/construction.js";
import type {
	AuthorityEmission,
	CausalEffectOutcome,
	CausalOccurrenceBundleOptions,
	RuntimeState,
} from "../solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest } from "../solutions/causal-occurrence/identity.js";

const binding: CausalBinding = Object.freeze({
	contract: "contract-v2",
	implementationRevision: "construction-v1",
	scope: "full",
	epoch: 1,
});
const h = `sha256:${"b".repeat(64)}`;
const graphs: Graph[] = [];
const stops: (() => void)[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const stop of stops.splice(0)) stop();
	for (const graph of graphs.splice(0)) {
		for (const lease of constructionOf(graph, "run")?.roots ?? []) lease.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
		expect(graph.describe().nodes).toHaveLength(0);
	}
});
function facts(revision = 1, id = `e${revision}`) {
	const material = {
		revisionDomain: "d",
		occurrenceId: `o${revision}`,
		revision,
		sourceRefs: [{ kind: "input", id: `i${revision}` }],
		value: revision,
	};
	const occurrence = { ...material, digest: causalOccurrenceDigest(material) };
	const proposal = {
		occurrence,
		effectId: id,
		requestRef: { kind: "request", id },
		proposalDigest: h,
	};
	const admission = {
		...proposal,
		admissionRef: { kind: "admission", id },
		state: "admitted" as const,
	};
	const outcome: CausalEffectOutcome = {
		...admission,
		state: "succeeded",
		result: { kind: "ok", value: { receipt: id } },
	};
	return { occurrence, proposal, admission, outcome };
}
function fixture(maxOccurrences = 8, viewFirst = false) {
	const graph = new Graph();
	graphs.push(graph);
	const sources = {
		occurrences: graph.node([], null, { name: "in/occurrences" }),
		admissions: graph.node([], null, { name: "in/admissions" }),
		branchTerminals: graph.node([], null, { name: "in/branchTerminals" }),
		effectProposals: graph.node([], null, { name: "in/effectProposals" }),
		effectAdmissions: graph.node([], null, { name: "in/effectAdmissions" }),
		effectOutcomes: graph.node([], null, { name: "in/effectOutcomes" }),
		evidence: graph.node([], null, { name: "in/evidence" }),
		watermarks: graph.node([], null, { name: "in/watermarks" }),
	};
	const opts = {
		...sources,
		name: "causal",
		requiredBranches: ["one"],
		requiredEvidenceKinds: [],
		maxOccurrences,
		maxPending: 16,
		maxEffects: 16,
		maxEvidence: 16,
	} as CausalOccurrenceBundleOptions<number>;
	const scope = prepareConstruction(graph, {
		name: "run",
		epoch: 1,
		names: ["run/startup", ...causalColdNodeNames("causal")],
		inputs: Object.values(sources),
	});
	const startup = scope.startupSource();
	const built = buildCausalNodes(graph, scope, startup, prepareCausalOptions(opts), binding);
	const owner = scope.seal(
		startup,
		viewFirst ? [built.committedEffects, ...built.roots] : built.roots,
	);
	scope.transferToGraph(owner);
	startConstruction(graph, owner);
	function send(lane: keyof typeof sources, ...values: unknown[]) {
		sources[lane].down(values.map((v) => ["DATA", v]));
	}
	function release(f = facts()) {
		send("occurrences", f.occurrence);
		send("admissions", {
			occurrence: f.occurrence,
			decisionId: "decision",
			decisionDigest: h,
			state: "admitted",
		});
		send("watermarks", { revisionDomain: "d", revision: f.occurrence.revision });
	}
	function admit(f = facts()) {
		release(f);
		send("effectProposals", f.proposal);
		send("effectAdmissions", f.admission);
	}
	function state() {
		return checkpointStateOfNode(graph.find("causal/authority")!).ctxState
			?.value as RuntimeState<number>;
	}
	return { graph, sources, built, owner, send, release, admit, state };
}
function collect<T>(node: Node<T>) {
	const values: T[] = [];
	const stop = node.subscribe((m) => {
		if (m[0] === "DATA") values.push(m[1] as T);
	});
	stops.push(stop);
	return { values, stop };
}

describe("D163 committed effects through ordinary DATA", () => {
	it("keeps empty sources silent and adds only one owned node, no root", () => {
		const f = fixture();
		const out = collect(f.built.committedEffects);
		expect(out.values).toEqual([]);
		expect(f.owner.nodes).toHaveLength(24);
		expect(f.owner.roots).toHaveLength(2);
		expect(f.built.roots).toHaveLength(1);
		expect(f.built.roots).not.toContain(f.built.committedEffects);
		expect(Object.keys(f.built.full)).toEqual(["identity", "execution", "retained", "startup"]);
		expect(f.graph.describe().edges).toContainEqual(
			expect.objectContaining({ from: "causal/authority", to: "causal/committed-effects" }),
		);
	});
	it.each([false, true])("recovers exact records with view-first root=%s", (viewFirst) => {
		const f = fixture(8, viewFirst);
		const a = facts();
		const b = facts(1, "other");
		f.admit(a);
		f.send("effectProposals", b.proposal);
		const out = collect(f.built.committedEffects);
		expect(out.values.at(-1)?.effects).toEqual([
			{ proposal: a.proposal, admission: a.admission },
			{ proposal: b.proposal },
		]);
		expect(out.values.at(-1)?.binding).toEqual(binding);
	});
	it("rebuilds on every direct write but reuses the view on repeated and wrong facts", () => {
		const f = fixture();
		const a = facts();
		const out = collect(f.built.committedEffects);
		f.release(a);
		const empty = out.values.at(-1);
		f.send("effectProposals", a.proposal);
		const proposed = out.values.at(-1);
		expect(proposed).not.toBe(empty);
		f.send("effectAdmissions", a.admission);
		const admitted = out.values.at(-1);
		expect(admitted).not.toBe(proposed);
		const count = out.values.length;
		f.send("effectProposals", a.proposal);
		f.send("effectAdmissions", a.admission);
		f.send("effectOutcomes", { ...a.outcome, admissionRef: { kind: "admission", id: "wrong" } });
		expect(out.values).toHaveLength(count);
		expect(f.state().committedEffects).toBe(admitted);
		f.send("effectOutcomes", a.outcome);
		expect(out.values.at(-1)).not.toBe(admitted);
		expect(out.values.at(-1)?.effects[0]?.outcome).toEqual(a.outcome);
	});
	it("commits deferred proposal/admission/outcome together without an admitted-only view", () => {
		const f = fixture();
		const a = facts();
		const out = collect(f.built.committedEffects);
		f.send("effectOutcomes", a.outcome);
		f.send("effectAdmissions", a.admission);
		f.send("effectProposals", a.proposal);
		f.release(a);
		const populated = out.values.filter((v) => v.effects.length > 0);
		expect(populated).toHaveLength(1);
		expect(populated[0]?.effects).toEqual([
			{ proposal: a.proposal, admission: a.admission, outcome: a.outcome },
		]);
	});
	it("retains obligations through UI disconnect and rejects wrong terminal before reconnect", () => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		const ui = collect(f.built.committedEffects);
		ui.stop();
		f.send("effectOutcomes", { ...a.outcome, requestRef: { kind: "request", id: "wrong" } });
		expect(f.state().effects.values().next().value?.outcome).toBeUndefined();
		const reconnect = collect(f.built.committedEffects);
		expect(reconnect.values.at(-1)?.effects[0]?.admission).toEqual(a.admission);
		reconnect.stop();
		f.send("effectOutcomes", a.outcome);
		const again = collect(f.built.committedEffects);
		expect(again.values.at(-1)?.effects[0]?.outcome).toEqual(a.outcome);
		const n = again.values.length;
		f.send("effectOutcomes", a.outcome);
		expect(again.values).toHaveLength(n);
	});
	it.each([
		"issue",
		"coverage",
		"quiescence",
	])("late subscriber recovers when last fact is %s", (kind) => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		const events = collect(f.graph.find("causal/authority")! as Node<AuthorityEmission<number>>);
		if (kind === "issue")
			f.send("effectOutcomes", { ...a.outcome, admissionRef: { kind: "admission", id: "bad" } });
		if (kind === "coverage")
			f.send("evidence", {
				occurrence: a.occurrence,
				evidenceKind: "extra",
				evidenceId: "extra",
				evidenceDigest: h,
				coverage: "included",
			});
		if (kind === "quiescence") {
			f.send("effectOutcomes", a.outcome);
			f.send("branchTerminals", {
				occurrence: a.occurrence,
				branch: "one",
				state: "completed",
				result: { kind: "ok", value: 1 },
			});
		}
		const last = events.values.at(-1)!;
		expect(last.kind === "fact" && last.fact.kind).toBe(kind);
		const expected = [
			{
				proposal: a.proposal,
				admission: a.admission,
				...(kind === "quiescence" ? { outcome: a.outcome } : {}),
			},
		];
		expect(last.committedEffects?.effects).toEqual(expected);
		const restored = collect(f.built.committedEffects).values.at(-1);
		expect(restored?.effects).toEqual(expected);
		expect(restored).toBe(last.committedEffects);
	});
	it("publishes after the authority commit, sharing the final view across all facts", () => {
		const f = fixture();
		const a = facts();
		let calls = 0;
		stops.push(
			f.graph.find("causal/authority")!.subscribe((m) => {
				if (m[0] !== "DATA") return;
				calls++;
				expect((m[1] as AuthorityEmission<number>).committedEffects).toBe(
					f.state().committedEffects,
				);
			}),
		);
		f.send("effectOutcomes", a.outcome);
		f.send("effectAdmissions", a.admission);
		f.send("effectProposals", a.proposal);
		f.release(a);
		expect(calls).toBeGreaterThan(0);
	});
	it("does not mutate old views or publish internal mutable records", () => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		const old = collect(f.built.committedEffects).values.at(-1)!;
		const bytes = JSON.stringify(old);
		const record = f.state().effects.values().next().value!;
		expect(old.effects[0]).not.toBe(record);
		expect(old.effects[0]?.proposal).toBe(record.proposal);
		expect(() => {
			(old.effects as unknown[]).push({});
		}).toThrow();
		expect(() => {
			(old.effects[0]!.proposal.requestRef as { id: string }).id = "tamper";
		}).toThrow();
		f.send("effectOutcomes", a.outcome);
		expect(JSON.stringify(old)).toBe(bytes);
	});
	it.each([false, true])("updates legal eviction boundaries, populated=%s", (populated) => {
		const f = fixture(1);
		const a = facts();
		const out = collect(f.built.committedEffects);
		if (populated) {
			f.admit(a);
			f.send("effectOutcomes", a.outcome);
		} else f.release(a);
		f.send("branchTerminals", {
			occurrence: a.occurrence,
			branch: "one",
			state: "completed",
			result: { kind: "ok", value: 1 },
		});
		const before = out.values.at(-1);
		f.send("occurrences", facts(2).occurrence);
		expect(out.values.at(-1)).not.toBe(before);
		expect(out.values.at(-1)?.effects).toEqual([]);
		expect(out.values.at(-1)?.retention).toEqual([
			{ revisionDomain: "d", floor: 1, gapThrough: 1 },
		]);
	});
	it("does not evict active obligations under capacity pressure", () => {
		const f = fixture(1);
		const a = facts();
		f.admit(a);
		const out = collect(f.built.committedEffects);
		const before = out.values.at(-1);
		f.send("occurrences", facts(2).occurrence);
		expect(out.values.at(-1)).toBe(before);
		expect(f.state().effects.size).toBe(1);
		expect(out.values.at(-1)?.effects[0]?.outcome).toBeUndefined();
	});
	it.each(["unknown", "reconcile-required"] as const)("preserves uncertain outcome %s", (state) => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		f.send("effectOutcomes", {
			...a.outcome,
			state,
			result: { kind: "error", error: { kind: "issue", code: state, message: state } },
		});
		expect(collect(f.built.committedEffects).values.at(-1)?.effects[0]?.outcome?.state).toBe(state);
	});
	it("recovers the same retained view after INVALIDATE", () => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		const out = collect(f.built.committedEffects);
		const before = out.values.at(-1);
		f.send("effectAdmissions", a.admission);
		f.built.committedEffects.down([["INVALIDATE"]]);
		f.send("effectOutcomes", { ...a.outcome, admissionRef: { kind: "admission", id: "wrong" } });
		expect(out.values).toHaveLength(2);
		expect(out.values.at(-1)).toBe(before);
	});
	it("leaves the prior commit intact if preparing a changed view fails", () => {
		const f = fixture();
		const a = facts();
		f.admit(a);
		const before = f.state();
		const prepare = projection.prepareCommittedEffectsView;
		const failure = vi
			.spyOn(projection, "prepareCommittedEffectsView")
			.mockImplementation((...args) => {
				if (args[1]) throw new Error("projection failure");
				return prepare(...args);
			});
		expect(() => f.send("effectOutcomes", a.outcome)).toThrow("projection failure");
		expect(failure).toHaveBeenCalled();
		expect(f.state()).toBe(before);
		expect(before.effects.values().next().value?.outcome).toBeUndefined();
	});
});
