import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	buildSpendingPublication,
	canonicalMaterial,
	type MaterialBody,
	type MaterialProfile,
	makeMaterialSnapshot,
	makeRequestMaterial,
	materialDigest,
	type RequestMaterial,
	validateMaterialSnapshot,
} from "../../../../examples/spending-alerts/causal-publication.js";
import { spendingAlertsGraph } from "../../../../examples/spending-alerts/pipeline.js";
import {
	oracleCanonical,
	oracleFreeze,
	oracleHash,
	oracleMaterial,
	oraclePublication,
	oracleRows,
	oracleSnapshot,
	verifyPublicationMaterial,
} from "../../../../scripts/fixtures/spending-publication-oracle.js";
import {
	constructionOf,
	prepareConstruction,
	startConstruction,
} from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import type { Node } from "../node/node.js";
import { checkpointStateOfNode } from "../node/runtime-accessors.js";
import type { CausalBinding } from "../solutions/causal-occurrence/capabilities.js";
import {
	causalColdNodeNames,
	prepareCausalOptions,
} from "../solutions/causal-occurrence/construction.js";
import type {
	CausalEffectOutcome,
	CausalOccurrenceBundleOptions,
	RuntimeState,
} from "../solutions/causal-occurrence/contracts.js";
import { causalOccurrenceDigest } from "../solutions/causal-occurrence/identity.js";

vi.mock("node:crypto", async (importOriginal) => {
	const original = await importOriginal<typeof import("node:crypto")>();
	return { ...original, createHash: vi.fn(original.createHash) };
});
const h = `sha256:${"b".repeat(64)}`;
const binding: CausalBinding = Object.freeze({
	contract: "contract-v2",
	implementationRevision: "construction-v1",
	scope: "full",
	epoch: 1,
});
const profile: MaterialProfile = oracleFreeze({
	packRef: { kind: "pack", id: "finite" },
	sourceDigest: h,
	runtimeDigest: h,
	destinationRef: { kind: "inbox", id: "offline-only" },
	compositionEpoch: 1,
	hostEpoch: 1,
});
const stops: (() => void)[] = [];
const graphs: Graph[] = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const stop of stops.splice(0)) stop();
	for (const graph of graphs.splice(0)) {
		for (const r of constructionOf(graph, "run")?.roots ?? []) r.unsubscribe?.();
		const group = graph.topologyGroup();
		for (const n of graph.describe().nodes) group.add(graph.find(n.id)!);
		group.release();
		expect(graph.describe().nodes).toHaveLength(0);
	}
});
function facts(id = "A", message = `Message ${id}`) {
	const raw = {
		revisionDomain: `d/${id}`,
		occurrenceId: `o/${id}`,
		revision: 1,
		sourceRefs: [{ kind: "input", id }],
		value: 1,
	};
	const occurrence = { ...raw, digest: causalOccurrenceDigest(raw) };
	const { value: _, ...ref } = occurrence;
	const { packRef: __, ...coordinates } = profile;
	const payloadText = oracleCanonical({ transactionId: id, vendor: id, severity: "low", message });
	const body: MaterialBody = {
		...coordinates,
		schema: "spending-alerts/request-material/v1",
		occurrence: ref,
		effectId: `e/${id}`,
		inputDigest: h,
		policyDigest: h,
		payloadText,
		payloadDigest: oracleHash(payloadText),
	};
	const material = oracleMaterial(body);
	const proposal = {
		occurrence: ref,
		effectId: body.effectId,
		requestRef: material.requestRef,
		proposalDigest: material.proposalDigest,
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
	return { occurrence, material, proposal, admission, outcome };
}
function collect<T>(n: Node<T>) {
	const values: T[] = [];
	const messages: unknown[] = [];
	const stop = n.subscribe((m) => {
		messages.push(m);
		if (m[0] === "DATA") values.push(m[1] as T);
	});
	stops.push(stop);
	return { values, messages, stop, last: () => values.at(-1)! };
}
function fixture(p: MaterialProfile = profile) {
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
	const material = graph.node([], null, { name: "material" });
	const scope = prepareConstruction(graph, {
		name: "run",
		epoch: 1,
		names: ["run/startup", ...causalColdNodeNames("causal"), "requestMaterialJoin", "publication"],
		inputs: [...Object.values(sources), material],
	});
	const startup = scope.startupSource();
	const nodeCalls = vi.spyOn(scope, "node");
	const opts = {
		...sources,
		name: "causal",
		requiredBranches: ["one"],
		requiredEvidenceKinds: [],
		maxOccurrences: 8,
		maxPending: 16,
		maxEffects: 16,
		maxEvidence: 16,
	} as CausalOccurrenceBundleOptions<number>;
	const built = buildSpendingPublication(
		graph,
		scope,
		startup,
		prepareCausalOptions(opts),
		binding,
		material,
		p,
	);
	const owner = scope.seal(startup, built.causal.roots);
	scope.transferToGraph(owner);
	startConstruction(graph, owner);
	const send = (lane: keyof typeof sources, ...values: unknown[]) =>
		sources[lane].down(values.map((v) => ["DATA", v]));
	const release = (a: ReturnType<typeof facts>) => {
		send("occurrences", a.occurrence);
		send("admissions", {
			occurrence: a.proposal.occurrence,
			decisionId: "decision",
			decisionDigest: h,
			state: "admitted",
		});
		send("watermarks", { revisionDomain: a.occurrence.revisionDomain, revision: 1 });
	};
	const admit = (a: ReturnType<typeof facts>) => {
		release(a);
		send("effectProposals", a.proposal);
		send("effectAdmissions", a.admission);
	};
	const state = () =>
		checkpointStateOfNode(graph.find("causal/authority")!).ctxState?.value as RuntimeState<number>;
	return {
		graph,
		sources,
		material,
		scope,
		startup,
		built,
		owner,
		send,
		release,
		admit,
		state,
		joinFn: nodeCalls.mock.calls.find((c) => c[2]?.name === "requestMaterialJoin")![1]!,
		frame: (rows: readonly RequestMaterial[]) => material.down([["DATA", oracleSnapshot(p, rows)]]),
	};
}
describe("private publication material-v1", () => {
	it("matches externally frozen encoding bytes and all digests", () => {
		const v = JSON.parse(
			readFileSync(
				new URL(
					"../../../../docs/design/causal-publication-material-v1-vectors.json",
					import.meta.url,
				),
				"utf8",
			),
		);
		expect(canonicalMaterial(v.materialBody)).toBe(v.materialCanonical);
		expect(materialDigest(v.payloadText)).toBe(v.payloadDigest);
		expect(makeRequestMaterial(v.materialBody)).toEqual(v.snapshot.body.materials[0]);
		const { materials, schema: _, ...p } = v.snapshot.body;
		expect(makeMaterialSnapshot(p, materials)).toEqual(v.snapshot);
		expect(validateMaterialSnapshot(v.snapshot, p).state).toBe("valid");
	});
	it.each([
		null,
		true,
		false,
		0,
		-0,
		1.5,
		"你好😀",
		{ "10": 1, "2": 2, a: "\n" },
	])("independent canonical vector %j", (v) =>
		expect(canonicalMaterial(v)).toBe(oracleCanonical(v)));
	it.each([
		undefined,
		NaN,
		Infinity,
		1n,
		Symbol("x"),
		() => 0,
		"\ud800",
		"\udc00",
		new Date(),
		Array(2),
	])("rejects non-passive %s", (v) => expect(() => canonicalMaterial(v)).toThrow());
	it("rejects accessors without invoking and bounded cycles/bytes", () => {
		let calls = 0;
		expect(() =>
			canonicalMaterial({
				get x() {
					calls++;
					return 1;
				},
			}),
		).toThrow();
		expect(calls).toBe(0);
		const cycle: unknown[] = [];
		cycle.push(cycle);
		expect(() => canonicalMaterial(cycle)).toThrow();
		expect(() => canonicalMaterial("x".repeat(1048577))).toThrow();
	});
	it.each([
		false,
		true,
	])("uses two nodes and original roots, joins both DATA orders %s", (first) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication),
			view = collect(f.built.causal.committedEffects);
		expect(out.values).toEqual([]);
		expect(f.owner.nodes).toHaveLength(26);
		expect(f.owner.roots).toHaveLength(2);
		if (first) f.frame([a.material]);
		f.admit(a);
		if (!first) f.frame([a.material]);
		expect(out.last().rows).toEqual(oracleRows(view.last(), [a.material]));
		expect(out.last().rows[0].material).toBe("matched");
		expect(f.built.requestMaterialJoin.deps).toEqual([f.built.causal.committedEffects, f.material]);
	});
	it("A/B fan-in, explicit empty material and replay never invent no-publish", () => {
		const f = fixture(),
			a = facts(),
			b = facts("B"),
			out = collect(f.built.publication),
			view = collect(f.built.causal.committedEffects);
		f.frame([b.material]);
		f.admit(a);
		f.admit(b);
		expect(out.last().rows).toEqual(oracleRows(view.last(), [b.material]));
		expect(out.last().rows.map((r) => r.material)).toEqual(["missing", "matched"]);
		f.send("effectAdmissions", a.admission, b.admission);
		expect(out.last().rows).toHaveLength(2);
		f.frame([]);
		expect(out.last().rows.every((r) => r.material === "missing")).toBe(true);
	});
	it("invalid new frame clears old match and leaves authority bytes untouched", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.admit(a);
		const before = JSON.stringify(f.state());
		const bad = JSON.parse(JSON.stringify(oracleSnapshot(profile, [a.material])));
		bad.body.materials[0].body.payloadText = "{}";
		f.material.down([["DATA", bad]]);
		expect(out.last().rows[0]).toMatchObject({
			recorded: "admitted-no-outcome",
			material: "invalid/conflicting",
		});
		expect(JSON.stringify(f.state())).toBe(before);
	});
	it("same topology/source change rejects old material without claiming actor/correctness", () => {
		const f = fixture({ ...profile, sourceDigest: `sha256:${"c".repeat(64)}` }),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		f.material.down([["DATA", oracleSnapshot(profile, [a.material])]]);
		expect(out.last().materialFrame).toBe("binding-mismatch");
	});
	it.each([
		"succeeded",
		"failed",
		"cancelled",
		"unknown",
		"reconcile-required",
	] as const)("retains exact %s independently of missing body", (state) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		f.frame([]);
		f.send("effectOutcomes", {
			...a.outcome,
			state,
			result:
				state === "succeeded"
					? a.outcome.result
					: { kind: "error", error: { kind: "issue", code: state, message: state } },
		});
		expect(out.last().rows[0]).toMatchObject({ recorded: state, material: "missing" });
	});
	it("UI detach cannot settle, wrong outcome cannot settle, reconnect uses graph-owned evidence", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.admit(a);
		out.stop();
		expect(checkpointStateOfNode(f.built.requestMaterialJoin).ctxState?.value).toBeUndefined();
		f.send("effectOutcomes", { ...a.outcome, admissionRef: { kind: "admission", id: "wrong" } });
		const mid = collect(f.built.causal.committedEffects);
		expect(mid.last().effects[0].outcome).toBeUndefined();
		mid.stop();
		f.send("effectOutcomes", a.outcome);
		const again = collect(f.built.publication);
		f.frame([a.material]);
		expect(again.last().rows[0]).toMatchObject({ recorded: "succeeded", material: "matched" });
	});
	it("proposal material alone is not an admitted fact", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.release(a);
		expect(out.last().rows).toEqual([]);
		expect(out.last().unmatchedMaterials).toBe(1);
	});
	it.each([65, 100])("counts raw duplicates before normalization %s", (count) => {
		const a = facts();
		expect(
			validateMaterialSnapshot(oracleSnapshot(profile, Array(count).fill(a.material)), profile)
				.state,
		).toBe("invalid/conflicting");
	});
	it("normalizes identical duplicates but rejects conflicting identity", () => {
		const a = facts(),
			b = facts("A", "changed");
		expect(
			validateMaterialSnapshot(oracleSnapshot(profile, [a.material, a.material]), profile).rows
				.size,
		).toBe(1);
		expect(
			validateMaterialSnapshot(oracleSnapshot(profile, [a.material, b.material]), profile).state,
		).toBe("invalid/conflicting");
	});
	it.each([
		'{"message":"a","message":"b","severity":"low","transactionId":"A","vendor":"A"}',
		'{"message":"b", "severity":"low","transactionId":"A","vendor":"A"}',
	])("rejects noncanonical/duplicate JSON text", (payloadText) => {
		const a = facts();
		const m = oracleMaterial({
			...a.material.body,
			payloadText,
			payloadDigest: oracleHash(payloadText),
		});
		expect(validateMaterialSnapshot(oracleSnapshot(profile, [m]), profile).state).toBe(
			"invalid/conflicting",
		);
	});
	it("changed mutable input cannot bypass validation through reference identity", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		const raw = JSON.parse(JSON.stringify(oracleSnapshot(profile, [a.material])));
		f.material.down([["DATA", raw]]);
		raw.body.materials[0].body.payloadText = "{}";
		f.material.down([["DATA", raw]]);
		expect(out.last().materialFrame).toBe("invalid/conflicting");
	});
	it.each([200, 1000])("actual consumer payload for sample 100/%s", (amount) => {
		const legacy = spendingAlertsGraph({
			profile: { dailyAverage: 100, typicalCategories: ["groceries"] },
			dailyRatioThreshold: 5,
		});
		const messages: string[] = [];
		const stop = legacy.graph.find("alertMessage")!.subscribe((m) => {
			if (m[0] === "DATA") messages.push(m[1] as string);
		});
		try {
			for (const [i, n] of [100, amount].entries())
				legacy.feed({
					id: `txn-${i}`,
					vendor: "A",
					amount: n,
					category: "groceries",
					timestampIso: `2026-01-01T00:00:0${i}Z`,
				});
			const message = messages.at(-1)!;
			expect(message).toContain(amount === 200 ? "normal." : "flagged — severity: low.");
			const f = fixture(),
				a = facts("A", message),
				out = collect(f.built.publication);
			f.frame([a.material]);
			if (amount === 1000) f.admit(a);
			else f.release(a);
			if (amount === 1000) expect(out.last().rows[0].payload?.message).toBe(message);
			else expect(out.last().rows).toEqual([]);
		} finally {
			stop();
			const group = legacy.graph.topologyGroup();
			for (const n of legacy.graph.describe().nodes) group.add(legacy.graph.find(n.id)!);
			group.release();
		}
	});
	it.each([
		"material",
		"view",
	] as const)("INVALIDATE restores only the affected DATA input: %s", (lane) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.admit(a);
		const latest = collect(f.built.causal.committedEffects).last();
		const source = lane === "material" ? f.material : f.built.causal.committedEffects;
		source.down([["INVALIDATE"]]);
		const n = out.values.length;
		if (lane === "material") f.frame([a.material]);
		else source.down([["DATA", latest]]);
		expect(out.values.length).toBeGreaterThan(n);
		expect(out.last().rows[0].material).toBe("matched");
	});
	it("repeated invalidation while SENTINEL cannot revive old material", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.admit(a);
		const view = collect(f.built.causal.committedEffects).last();
		f.material.down([["INVALIDATE"]]);
		f.built.causal.committedEffects.down([["INVALIDATE"]]);
		f.frame([a.material]);
		f.material.down([["INVALIDATE"]]);
		const n = out.values.length;
		f.built.causal.committedEffects.down([["DATA", view]]);
		expect(out.values.slice(n).some((v) => v.rows.some((r) => r.material === "matched"))).toBe(
			false,
		);
		f.frame([a.material]);
		expect(out.last().rows[0].material).toBe("matched");
	});
	it.each([0, 1])("real dependency removal %s cannot use old cache", (index) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.admit(a);
		const n = out.values.length;
		const join = f.built.requestMaterialJoin;
		join.unsubscribeDep(join.deps[index], f.joinFn);
		if (index === 0) f.frame([a.material]);
		else f.send("effectOutcomes", a.outcome);
		expect(out.values.slice(n).some((v) => v.rows.some((r) => r.material === "matched"))).toBe(
			false,
		);
		expect(out.messages.some((m) => (m as unknown[])[0] === "ERROR")).toBe(true);
	});
	it.each([
		"valid",
		"payload",
		"request",
		"proposal",
		"frame",
		"binding",
		"conflict",
		"empty",
	])("independent verifier rejects each negative input: %s", (kind) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication),
			view = collect(f.built.causal.committedEffects);
		f.admit(a);
		const raw = JSON.parse(JSON.stringify(oracleSnapshot(profile, [a.material])));
		if (kind === "payload")
			raw.body.materials[0].body.payloadText = oracleCanonical({
				transactionId: "A",
				vendor: "A",
				severity: "low",
				message: "forged",
			});
		if (kind === "request") raw.body.materials[0].requestRef.id = h;
		if (kind === "proposal") raw.body.materials[0].proposalDigest = h;
		if (kind === "binding") raw.body.sourceDigest = `sha256:${"c".repeat(64)}`;
		if (kind === "conflict") raw.body.materials.push(facts("A", "conflict").material);
		if (kind === "empty") raw.body.materials = [];
		raw.digest = kind === "frame" ? h : oracleHash(oracleCanonical(raw.body));
		f.material.down([["DATA", raw]]);
		const index = verifyPublicationMaterial(raw, profile);
		expect(out.last()).toEqual(oraclePublication(view.last(), index, profile));
		expect(index.state).toBe(
			kind === "valid" || kind === "empty"
				? "valid"
				: kind === "binding"
					? "binding-mismatch"
					: "invalid/conflicting",
		);
	});
	it.each([
		"revisionDomain",
		"occurrenceId",
		"revision",
		"digest",
		"sourceRefs",
		"effectId",
	])("full association coordinate rejects changed %s", (field) => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		const body = JSON.parse(JSON.stringify(a.material.body));
		if (field === "effectId") body.effectId = "another";
		else if (field === "revision") body.occurrence.revision = 2;
		else if (field === "digest") body.occurrence.digest = `sha256:${"c".repeat(64)}`;
		else if (field === "sourceRefs")
			body.occurrence.sourceRefs = [{ kind: "input", id: "different" }];
		else body.occurrence[field] = "different";
		const m = oracleMaterial(body);
		f.frame([m]);
		expect(out.last().rows[0].material).toBe("missing");
	});
	it("same-commit outcome projects the final recorded result directly", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.frame([a.material]);
		f.release(a);
		f.send("effectOutcomes", a.outcome);
		f.send("effectAdmissions", a.admission);
		const n = out.values.length;
		f.send("effectProposals", a.proposal);
		const rows = out.values.slice(n).flatMap((v) => v.rows);
		expect(rows.length).toBeGreaterThan(0);
		expect(rows.every((r) => r.recorded === "succeeded")).toBe(true);
	});
	it("payload byte boundary counts UTF-8 canonical bytes", () => {
		const a = facts();
		const empty = { transactionId: "A", vendor: "A", severity: "low", message: "" };
		const overhead = Buffer.byteLength(oracleCanonical(empty));
		for (const extra of [0, 1]) {
			const payloadText = oracleCanonical({
				...empty,
				message: "x".repeat(8192 - overhead + extra),
			});
			const m = oracleMaterial({
				...a.material.body,
				payloadText,
				payloadDigest: oracleHash(payloadText),
			});
			expect(validateMaterialSnapshot(oracleSnapshot(profile, [m]), profile).state).toBe(
				extra ? "invalid/conflicting" : "valid",
			);
		}
	});
	it("wrong cold epoch rejects before authority construction", () => {
		expect(() => fixture({ ...profile, compositionEpoch: 2 })).toThrow("context mismatch");
		expect(graphs.at(-1)!.find("causal/authority")).toBeUndefined();
	});
	it("protocol material ERROR cannot create fresh matched output", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		f.frame([a.material]);
		const n = out.values.length;
		f.material.down([["ERROR", new Error("source unavailable")]]);
		f.send("effectOutcomes", a.outcome);
		expect(out.values.length).toBe(n);
		expect(out.messages.some((m) => (m as unknown[])[0] === "ERROR")).toBe(true);
	});
	it("immutable repeated DATA and view-only change do not revalidate payload", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		const frame = oracleSnapshot(profile, [a.material]);
		vi.mocked(createHash).mockClear();
		f.material.down([["DATA", frame]]);
		expect(createHash).toHaveBeenCalledTimes(4);
		vi.mocked(createHash).mockClear();
		f.material.down([["DATA", frame]]);
		f.send("effectOutcomes", a.outcome);
		expect(createHash).not.toHaveBeenCalled();
		expect(out.last().rows[0].recorded).toBe("succeeded");
	});
	it("mutation outside material DATA cannot alter accepted payload on a view change", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		const raw = JSON.parse(JSON.stringify(oracleSnapshot(profile, [a.material])));
		f.material.down([["DATA", raw]]);
		raw.body.materials[0].body.payloadText = "{}";
		vi.mocked(createHash).mockClear();
		f.send("effectOutcomes", a.outcome);
		expect(createHash).not.toHaveBeenCalled();
		expect(out.last().rows[0]).toMatchObject({
			recorded: "succeeded",
			material: "matched",
			payload: { message: "Message A" },
		});
		f.material.down([["DATA", raw]]);
		expect(out.last().materialFrame).toBe("invalid/conflicting");
	});
	it("material DATA while authority is invalid must replace its previous index", () => {
		const f = fixture(),
			a = facts(),
			out = collect(f.built.publication);
		f.admit(a);
		const view = collect(f.built.causal.committedEffects).last();
		const raw = JSON.parse(JSON.stringify(oracleSnapshot(profile, [a.material])));
		f.material.down([["DATA", raw]]);
		f.built.causal.committedEffects.down([["INVALIDATE"]]);
		raw.body.materials[0].body.payloadText = "{}";
		f.material.down([["DATA", raw]]);
		f.built.causal.committedEffects.down([["DATA", view]]);
		expect(out.last().rows[0].material).toBe("invalid/conflicting");
	});
});
