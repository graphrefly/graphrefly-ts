import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import type { DataIssue, DataResult } from "../data/index.js";
import { constructionOf } from "../graph/construction-scope.js";
import { Graph } from "../graph/graph.js";
import { stableJsonString } from "../json/codec.js";
import type { Node } from "../node/node.js";
import type { Message } from "../protocol/messages.js";
import {
	assertCausalOccurrenceTopology,
	CAUSAL_OCCURRENCE_SCHEMA_REVISION,
	type CausalBranchTerminal,
	type CausalCurrentness,
	type CausalEffectAdmission,
	type CausalEffectConservation,
	type CausalEffectOutcome,
	type CausalEffectProposal,
	type CausalEvidence,
	type CausalEvidenceCoverage,
	type CausalOccurrence,
	type CausalOccurrenceAdmission,
	type CausalOccurrenceRef,
	type CausalQuiescence,
	type CausalTerminalFanIn,
	type CausalWatermark,
	causalOccurrenceBundle,
	causalOccurrenceDigest,
	causalOccurrenceRequiredEdges,
} from "../solutions/causal-occurrence.js";

const digest = (char: string) => `sha256:${char.repeat(64)}`;
const problem = (code: string): DataIssue => ({
	kind: "issue",
	code,
	message: code,
});
const ok = <T>(value: T): DataResult<T> => ({ kind: "ok", value });
const error = (code: string): DataResult<never> => ({ kind: "error", error: problem(code) });

// Preserve real retain/subscription behavior while making test-owned teardown explicit.
class FixtureGraph extends Graph {
	readonly retainedStops: Array<() => void> = [];
	override retain<T>(node: Node<T>, opts: { reason?: string } = {}): () => void {
		const stop = super.retain(node, opts);
		this.retainedStops.push(stop);
		return stop;
	}
}
const cleanups = new Set<() => void>();
afterEach(() => {
	for (const cleanup of cleanups) cleanup();
	cleanups.clear();
});

function occurrence(revision: number, id = `occurrence-${revision}`): CausalOccurrence<string> {
	const value = Object.freeze({
		revisionDomain: "test-domain",
		occurrenceId: id,
		revision,
		sourceRefs: Object.freeze([{ kind: "command", id: `command-${revision}` }]),
		value: `value-${revision}`,
	});
	return Object.freeze({ ...value, digest: causalOccurrenceDigest(value) });
}

function refOf(value: CausalOccurrenceRef): CausalOccurrenceRef {
	return {
		revisionDomain: value.revisionDomain,
		occurrenceId: value.occurrenceId,
		revision: value.revision,
		digest: value.digest,
		sourceRefs: value.sourceRefs,
	};
}

function admission(
	value: CausalOccurrenceRef,
	state: "admitted" | "rejected" = "admitted",
): CausalOccurrenceAdmission {
	return {
		occurrence: refOf(value),
		decisionId: `decision-${value.revision}`,
		decisionDigest: digest("a"),
		state,
	};
}

function fixture(
	bounds: Partial<{
		maxOccurrences: number;
		maxPending: number;
		maxEffects: number;
		maxEvidence: number;
	}> = {},
	owner = new FixtureGraph(),
) {
	const stops: Array<() => void> = [];
	const stop = () => {
		for (const release of stops.splice(0)) release();
		for (const release of owner.retainedStops.splice(0)) release();
		// Test-owned teardown, never a production lifecycle settlement policy.
		for (const root of constructionOf(owner, "causal")?.roots ?? []) root.unsubscribe?.();
		const group = owner.topologyGroup({ name: "causal fixture cleanup" });
		for (const entry of owner.describe().nodes) group.add(owner.find(entry.id)!);
		group.release();
		cleanups.delete(stop);
	};
	cleanups.add(stop);
	const occurrences = owner.node<CausalOccurrence<string>>([], null, {
		name: "source/occurrences",
	});
	const admissions = owner.node<CausalOccurrenceAdmission>([], null, { name: "source/admissions" });
	const branchTerminals = owner.node<CausalBranchTerminal>([], null, {
		name: "source/branch-terminals",
	});
	const effectProposals = owner.node<CausalEffectProposal>([], null, {
		name: "source/effect-proposals",
	});
	const effectAdmissions = owner.node<CausalEffectAdmission>([], null, {
		name: "source/effect-admissions",
	});
	const effectOutcomes = owner.node<CausalEffectOutcome>([], null, {
		name: "source/effect-outcomes",
	});
	const evidence = owner.node<CausalEvidence>([], null, { name: "source/evidence" });
	const watermarks = owner.node<CausalWatermark>([], null, { name: "source/watermarks" });
	const bundle = causalOccurrenceBundle(owner, {
		name: "causal",
		occurrences,
		admissions,
		branchTerminals,
		effectProposals,
		effectAdmissions,
		effectOutcomes,
		evidence,
		watermarks,
		requiredBranches: ["materialize", "audit"],
		requiredEvidenceKinds: ["receipt", "trace"],
		maxOccurrences: bounds.maxOccurrences ?? 8,
		maxPending: bounds.maxPending ?? 8,
		maxEffects: bounds.maxEffects ?? 8,
		maxEvidence: bounds.maxEvidence ?? 8,
	});
	const messages = new Map<string, Message[]>();
	const unsubscribeOutputs = () => {
		for (const release of stops.splice(0)) release();
	};
	const subscribeOutputs = () => {
		unsubscribeOutputs();
		for (const [name, node] of Object.entries(bundle)) {
			const values: Message[] = [];
			messages.set(name, values);
			stops.push(node.subscribe((message) => values.push(message)));
		}
	};
	subscribeOutputs();
	return {
		owner,
		occurrences,
		admissions,
		branchTerminals,
		effectProposals,
		effectAdmissions,
		effectOutcomes,
		evidence,
		watermarks,
		messages,
		unsubscribeOutputs,
		subscribeOutputs,
		stop,
	};
}

const data = <T>(messages: Message[] | undefined) =>
	(messages ?? []).filter((message) => message[0] === "DATA").map((message) => message[1] as T);

describe("D791 causal occurrence contract-v2", () => {
	it("releases test-owned output subscriptions, retained helpers, and graph registrations", () => {
		const f = fixture();
		f.stop();
		expect(f.owner.describe().nodes).toHaveLength(0);
		expect(f.owner.retainedStops).toHaveLength(0);
		f.stop();
	});
	it("computes the canonical digest over the schema and every identity/value coordinate", () => {
		const value = occurrence(1);
		const expectedMaterial = stableJsonString({
			schemaRevision: CAUSAL_OCCURRENCE_SCHEMA_REVISION,
			revisionDomain: value.revisionDomain,
			occurrenceId: value.occurrenceId,
			revision: value.revision,
			value: value.value,
			sourceRefs: value.sourceRefs,
		});
		expect(value.digest).toBe(
			`sha256:${createHash("sha256").update(expectedMaterial).digest("hex")}`,
		);
	});

	it("keeps candidate/decision mismatch quiet and releases each exact admitted occurrence once", () => {
		const f = fixture();
		const first = occurrence(1);
		f.occurrences.down([["DATA", first]]);
		expect(f.messages.get("released")?.filter((message) => message[0] !== "START")).toEqual([]);
		f.admissions.down([["DATA", admission({ ...refOf(first), digest: digest("f") })]]);
		expect(f.messages.get("released")?.filter((message) => message[0] !== "START")).toEqual([]);
		f.admissions.down([["DATA", admission(first)]]);
		expect(data(f.messages.get("released"))).toEqual([]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([first]);
		expect(f.messages.get("released")?.filter((message) => message[0] === "DIRTY")).toHaveLength(1);
		expect(f.messages.get("released")?.filter((message) => message[0] === "RESOLVED")).toEqual([]);
		f.admissions.down([["DATA", admission(first)]]);
		f.occurrences.down([["DATA", first]]);
		expect(data(f.messages.get("released"))).toHaveLength(1);
		expect(f.messages.get("released")?.filter((message) => message[0] === "ERROR")).toEqual([]);
		f.stop();
	});

	it("fails closed for decision-first exact-ref mismatch and for an unbound digest", () => {
		const f = fixture();
		const value = occurrence(1);
		f.admissions.down([["DATA", admission({ ...refOf(value), digest: digest("f") })]]);
		f.occurrences.down([["DATA", value]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		expect(f.messages.get("released")?.filter((message) => message[0] !== "START")).toEqual([]);
		f.admissions.down([["DATA", admission(value)]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([value]);
		const altered = { ...value, value: "altered-with-stale-digest" };
		f.occurrences.down([["DATA", altered]]);
		expect(data<DataIssue>(f.messages.get("issues")).map((entry) => entry.code)).toContain(
			"causal-occurrence/digest-mismatch",
		);
		f.stop();
	});

	it("blocks skipped revisions until the global gap is filled and reports conflicts as DATA issues", () => {
		const f = fixture();
		const second = occurrence(2);
		f.admissions.down([["DATA", admission(second)]]);
		f.occurrences.down([["DATA", second]]);
		expect(data(f.messages.get("released"))).toEqual([]);
		expect(data<DataIssue>(f.messages.get("issues")).map((value) => value.code)).toContain(
			"causal-occurrence/skipped-revision",
		);
		f.occurrences.down([["DATA", occurrence(1)]]);
		f.admissions.down([["DATA", admission(occurrence(1))]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 2 }]]);
		expect(
			data<CausalOccurrence<string>>(f.messages.get("released")).map((value) => value.revision),
		).toEqual([1, 2]);
		const { digest: _priorDigest, ...conflictMaterial } = {
			...second,
			value: "conflicting-value",
		};
		f.occurrences.down([
			["DATA", { ...conflictMaterial, digest: causalOccurrenceDigest(conflictMaterial) }],
		]);
		expect(data<DataIssue>(f.messages.get("issues")).map((value) => value.code)).toContain(
			"causal-occurrence/replay-conflict",
		);
		expect(f.messages.get("issues")?.some((message) => message[0] === "ERROR")).toBe(false);
		f.stop();
	});

	it("maps every admitted key to a distinct fresh lifecycle wave", () => {
		const f = fixture();
		const first = occurrence(1);
		const second = occurrence(2);
		f.occurrences.down([
			["DATA", first],
			["DATA", second],
		]);
		f.admissions.down([
			["DATA", admission(first)],
			["DATA", admission(second)],
		]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 2 }]]);
		const messages = f.messages.get("released") ?? [];
		expect(messages.filter((message) => message[0] === "DIRTY")).toHaveLength(2);
		expect(messages.filter((message) => message[0] === "DATA")).toHaveLength(2);
		f.stop();
	});

	it("attests currentness only through a watermark and supersedes by domain-scoped identity", () => {
		const f = fixture();
		const first = occurrence(1, "shared-id");
		const second = occurrence(2, "shared-id");
		f.occurrences.down([
			["DATA", first],
			["DATA", second],
		]);
		f.admissions.down([
			["DATA", admission(first)],
			["DATA", admission(second)],
		]);
		expect(data(f.messages.get("currentness"))).toEqual([]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 2 }]]);
		expect(
			data<CausalCurrentness>(f.messages.get("currentness")).map((entry) => [
				entry.occurrence.revision,
				entry.state,
			]),
		).toEqual([
			[1, "superseded"],
			[2, "current"],
		]);
		expect(
			data<CausalOccurrence<string>>(f.messages.get("released")).map((entry) => entry.revision),
		).toEqual([2]);
		f.stop();
	});

	it("treats a terminal rejection as quiescent without fabricating a release or branch terminal", () => {
		const f = fixture();
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value, "rejected")]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		expect(data(f.messages.get("released"))).toEqual([]);
		expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
			lifecycle: true,
			retainedEvidence: false,
		});
		f.stop();
	});

	it("requires exact terminal fan-in and conserves admitted effects through D184 DATA results", () => {
		const f = fixture();
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		const terminal = (branch: string, result: DataResult<unknown>): CausalBranchTerminal => ({
			occurrence: value,
			branch,
			state: result.kind === "ok" ? "completed" : "failed",
			result,
		});
		f.branchTerminals.down([["DATA", terminal("materialize", ok("done"))]]);
		expect(data(f.messages.get("terminals"))).toEqual([]);
		f.branchTerminals.down([["DATA", terminal("audit", error("audit-failed"))]]);
		expect(
			data<CausalTerminalFanIn>(f.messages.get("terminals"))[0]?.terminals.map(
				(entry) => entry.branch,
			),
		).toEqual(["materialize", "audit"]);

		const proposal: CausalEffectProposal = {
			occurrence: refOf(value),
			effectId: "effect-1",
			requestRef: { kind: "request", id: "request-1" },
			proposalDigest: digest("b"),
		};
		f.effectProposals.down([["DATA", proposal]]);
		const effectAdmission: CausalEffectAdmission = {
			...proposal,
			admissionRef: { kind: "effect-admission", id: "admission-1" },
			state: "admitted",
		};
		f.effectAdmissions.down([["DATA", effectAdmission]]);
		f.effectOutcomes.down([
			["DATA", { ...effectAdmission, state: "succeeded", result: error("wrong-result-kind") }],
		]);
		expect(data<DataIssue>(f.messages.get("issues")).map((entry) => entry.code)).toContain(
			"causal-occurrence/effect-outcome-mismatch",
		);
		f.effectOutcomes.down([
			[
				"DATA",
				{
					...effectAdmission,
					admissionRef: { kind: "effect-admission", id: "wrong-admission" },
					state: "failed",
					result: error("wrong-admission"),
				},
			],
		]);
		expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
			admitted: 1,
			active: 1,
			failed: 0,
		});
		const outcome: CausalEffectOutcome = {
			...effectAdmission,
			state: "failed",
			result: error("remote-failure"),
		};
		f.effectOutcomes.down([["DATA", outcome]]);
		const last = data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)!;
		expect(last).toBeDefined();
		expect(last.proposed).toBe(last.pendingAdmission + last.rejected + last.admitted);
		expect(last.admitted).toBe(
			last.active +
				last.succeeded +
				last.failed +
				last.cancelled +
				last.reconcileRequired +
				last.unknown,
		);
		expect(last).toMatchObject({ proposed: 1, admitted: 1, active: 0, failed: 1 });
		expect(f.messages.get("conservation")?.some((message) => message[0] === "ERROR")).toBe(false);
		f.stop();
	});

	it("conserves terminal, effect, and evidence joins under reverse lane arrival", () => {
		const f = fixture();
		const value = occurrence(1);
		const proposal: CausalEffectProposal = {
			occurrence: refOf(value),
			effectId: "effect-reordered",
			requestRef: { kind: "request", id: "request-reordered" },
			proposalDigest: digest("e"),
		};
		const effectAdmission: CausalEffectAdmission = {
			...proposal,
			admissionRef: { kind: "effect-admission", id: "admission-reordered" },
			state: "admitted",
		};
		f.effectOutcomes.down([
			["DATA", { ...effectAdmission, state: "failed", result: error("reordered-failure") }],
		]);
		f.effectAdmissions.down([["DATA", effectAdmission]]);
		f.effectProposals.down([["DATA", proposal]]);
		for (const branch of ["audit", "materialize"]) {
			f.branchTerminals.down([
				["DATA", { occurrence: refOf(value), branch, state: "completed", result: ok(branch) }],
			]);
		}
		for (const kind of ["trace", "receipt"]) {
			f.evidence.down([
				[
					"DATA",
					{
						occurrence: refOf(value),
						evidenceKind: kind,
						evidenceId: `${kind}-reordered`,
						evidenceDigest: digest(kind === "trace" ? "7" : "8"),
						coverage: "included",
					},
				],
			]);
		}
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		expect(data<CausalTerminalFanIn>(f.messages.get("terminals"))).toHaveLength(1);
		expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
			admitted: 1,
			active: 0,
			failed: 1,
		});
		expect(data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1)).toMatchObject({
			complete: true,
			missingKinds: [],
		});
		f.stop();
	});

	it("conserves every terminal effect bucket with the matching D184 result kind", () => {
		const f = fixture();
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		const states = ["succeeded", "failed", "cancelled", "reconcile-required", "unknown"] as const;
		states.forEach((state, index) => {
			const proposal: CausalEffectProposal = {
				occurrence: refOf(value),
				effectId: `effect-${state}`,
				requestRef: { kind: "request", id: `request-${state}` },
				proposalDigest: digest(String(index + 1)),
			};
			const admitted: CausalEffectAdmission = {
				...proposal,
				admissionRef: { kind: "effect-admission", id: `admission-${state}` },
				state: "admitted",
			};
			f.effectProposals.down([["DATA", proposal]]);
			f.effectAdmissions.down([["DATA", admitted]]);
			f.effectOutcomes.down([
				[
					"DATA",
					{
						...admitted,
						state,
						result: state === "succeeded" ? ok(state) : error(`terminal-${state}`),
					},
				],
			]);
		});
		const conserved = data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)!;
		expect(conserved).toMatchObject({
			proposed: 5,
			pendingAdmission: 0,
			rejected: 0,
			admitted: 5,
			active: 0,
			succeeded: 1,
			failed: 1,
			cancelled: 1,
			reconcileRequired: 1,
			unknown: 1,
		});
		f.stop();
	});

	it("rejects malformed closed states and non-canonical DATA without protocol ERROR", () => {
		const f = fixture();
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		f.branchTerminals.down([
			[
				"DATA",
				{
					occurrence: refOf(value),
					branch: "audit",
					state: "invented",
					result: ok("bad"),
				} as never,
			],
		]);
		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		f.branchTerminals.down([
			[
				"DATA",
				{
					occurrence: refOf(value),
					branch: "audit",
					state: "completed",
					result: ok(cyclic),
				},
			],
		]);
		f.evidence.down([
			[
				"DATA",
				{
					occurrence: refOf(value),
					evidenceKind: "receipt",
					evidenceId: "external-without-ref",
					evidenceDigest: digest("9"),
					coverage: "external-only",
				},
			],
		]);
		const issueMessages = f.messages.get("issues") ?? [];
		expect(data<DataIssue>(issueMessages).map((entry) => entry.code)).toEqual(
			expect.arrayContaining([
				"causal-occurrence/terminal-mismatch",
				"causal-occurrence/non-data-terminal",
				"causal-occurrence/evidence-mismatch",
			]),
		);
		expect(issueMessages.some((message) => message[0] === "ERROR")).toBe(false);
		f.stop();
	});

	it("fails closed at effect/evidence bounds and rejects a wrong-occurrence outcome", () => {
		const f = fixture({ maxEffects: 1, maxEvidence: 1 });
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		const proposal: CausalEffectProposal = {
			occurrence: refOf(value),
			effectId: "bounded-effect",
			requestRef: { kind: "request", id: "bounded-request" },
			proposalDigest: digest("5"),
		};
		const admitted: CausalEffectAdmission = {
			...proposal,
			admissionRef: { kind: "effect-admission", id: "bounded-admission" },
			state: "admitted",
		};
		f.effectProposals.down([["DATA", proposal]]);
		f.effectAdmissions.down([["DATA", admitted]]);
		f.effectProposals.down([
			[
				"DATA",
				{
					...proposal,
					effectId: "over-bound-effect",
					requestRef: { kind: "request", id: "over-bound-request" },
					proposalDigest: digest("6"),
				},
			],
		]);
		const wrongOccurrence = occurrence(1, "wrong-occurrence");
		f.effectOutcomes.down([
			[
				"DATA",
				{
					...admitted,
					occurrence: refOf(wrongOccurrence),
					state: "failed",
					result: error("wrong-occurrence"),
				},
			],
		]);
		expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
			proposed: 1,
			admitted: 1,
			active: 1,
			failed: 0,
		});
		const evidence = (kind: string): CausalEvidence => ({
			occurrence: refOf(value),
			evidenceKind: kind,
			evidenceId: `${kind}-bounded`,
			evidenceDigest: digest(kind === "receipt" ? "7" : "8"),
			coverage: "included",
		});
		f.evidence.down([["DATA", evidence("receipt")]]);
		f.evidence.down([["DATA", evidence("trace")]]);
		const coverage = data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1)!;
		expect(coverage).toBeDefined();
		expect(coverage.complete).toBe(false);
		expect(coverage.entries.some((entry) => entry.coverage === "retention-gap")).toBe(true);
		expect(data<DataIssue>(f.messages.get("issues")).map((entry) => entry.code)).toEqual(
			expect.arrayContaining([
				"causal-occurrence/effect-bound",
				"causal-occurrence/effect-outcome-occurrence-conflict",
				"causal-occurrence/evidence-bound",
			]),
		);
		f.stop();
	});

	it("never evicts unsettled obligations and exposes retention-gap after settled eviction", () => {
		const f = fixture({ maxOccurrences: 1 });
		const first = occurrence(1);
		f.occurrences.down([["DATA", first]]);
		f.admissions.down([["DATA", admission(first)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		f.occurrences.down([["DATA", occurrence(2)]]);
		expect(data<DataIssue>(f.messages.get("issues")).map((entry) => entry.code)).toContain(
			"causal-occurrence/retention-capacity",
		);
		for (const branch of ["materialize", "audit"]) {
			f.branchTerminals.down([
				["DATA", { occurrence: refOf(first), branch, state: "completed", result: ok(branch) }],
			]);
		}
		const gap = data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1)!;
		expect(gap).toMatchObject({ complete: false, missingKinds: ["receipt", "trace"] });
		f.occurrences.down([["DATA", first]]);
		expect(data<DataIssue>(f.messages.get("issues")).map((entry) => entry.code)).toContain(
			"causal-occurrence/retention-gap",
		);
		const second = occurrence(2);
		f.admissions.down([["DATA", admission(second)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 2 }]]);
		expect(
			data<CausalOccurrence<string>>(f.messages.get("released")).map((entry) => entry.revision),
		).toEqual([1]);
		expect(data<CausalCurrentness>(f.messages.get("currentness")).at(-1)).toMatchObject({
			state: "unverifiable",
			gapRef: { reason: "retention-gap" },
		});
		f.stop();
	});

	it("makes evidence gaps explicit and distinguishes lifecycle from retained-evidence quiescence", () => {
		const f = fixture();
		const value = occurrence(1);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: "test-domain", revision: 1 }]]);
		for (const branch of ["materialize", "audit"]) {
			f.branchTerminals.down([
				["DATA", { occurrence: value, branch, state: "completed", result: ok(branch) }],
			]);
		}
		expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
			lifecycle: true,
			retainedEvidence: false,
		});
		const evidence = (
			evidenceKind: string,
			coverage: CausalEvidence["coverage"],
		): CausalEvidence => ({
			occurrence: value,
			evidenceKind,
			evidenceId: `${evidenceKind}-1`,
			evidenceDigest: digest(evidenceKind === "receipt" ? "c" : "d"),
			coverage,
		});
		f.evidence.down([["DATA", evidence("receipt", "included")]]);
		f.evidence.down([["DATA", evidence("trace", "retention-gap")]]);
		const coverage = data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1)!;
		expect(coverage).toMatchObject({
			complete: false,
			missingKinds: [],
			terminalGapKinds: ["trace"],
		});
		expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
			lifecycle: true,
			retainedEvidence: true,
		});
		f.stop();
	});

	it("bounds domains across watermark-first, pending-first, and occurrence-first arrivals", () => {
		const f = fixture({ maxOccurrences: 2, maxPending: 8 });
		const inDomain = (domain: string) => {
			const { digest: _digest, ...material } = { ...occurrence(1), revisionDomain: domain };
			return { ...material, digest: causalOccurrenceDigest(material) };
		};
		f.watermarks.down([["DATA", { revisionDomain: "watermark-first", revision: 0 }]]);
		const pending = inDomain("pending-first");
		f.admissions.down([["DATA", admission(pending)]]);
		f.occurrences.down([["DATA", inDomain("over-bound")]]);
		for (let i = 0; i < 16; i++) {
			f.watermarks.down([["DATA", { revisionDomain: `unknown-${i}`, revision: 0 }]]);
		}
		expect(
			new Set(data<CausalQuiescence>(f.messages.get("quiescence")).map((v) => v.revisionDomain)),
		).toEqual(new Set(["watermark-first"]));
		expect(
			data<DataIssue>(f.messages.get("issues")).filter(
				(v) => v.code === "causal-occurrence/domain-bound",
			),
		).toHaveLength(17);
		f.occurrences.down([["DATA", pending]]);
		f.watermarks.down([["DATA", { revisionDomain: "pending-first", revision: 1 }]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([pending]);
		f.stop();
	});

	it("does not reserve domain capacity for invalid DATA and accepts repeated known-domain watermarks", () => {
		const f = fixture({ maxOccurrences: 1 });
		f.watermarks.down([["DATA", { revisionDomain: "invalid", revision: -1 }]]);
		const value = occurrence(1);
		f.occurrences.down([["DATA", { ...value, revisionDomain: "bad-digest" }]]);
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		for (let i = 0; i < 8; i++)
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
		f.watermarks.down([["DATA", { revisionDomain: "new-domain", revision: 0 }]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([value]);
		expect(
			data<DataIssue>(f.messages.get("issues")).filter(
				(v) => v.code === "causal-occurrence/domain-bound",
			),
		).toHaveLength(1);
		f.stop();
	});

	it("settles evidence capacity identically for direct and pending arrival, without forgetting gaps", () => {
		const run = (early: boolean) => {
			const f = fixture({ maxEvidence: 1, maxPending: 1 });
			const value = occurrence(1);
			const fact = (kind: string, id: string): CausalEvidence => ({
				occurrence: refOf(value),
				evidenceKind: kind,
				evidenceId: id,
				evidenceDigest: digest("c"),
				coverage: "included",
			});
			// Retain receipt first; the trace input is the same one-slot pending obligation in both arms.
			if (early) f.evidence.down([["DATA", fact("receipt", "receipt")]]);
			f.occurrences.down([["DATA", value]]);
			if (!early) f.evidence.down([["DATA", fact("receipt", "receipt")]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			for (const branch of ["materialize", "audit"])
				f.branchTerminals.down([
					["DATA", { occurrence: refOf(value), branch, state: "completed", result: ok(branch) }],
				]);
			for (let i = 0; i < 8; i++) f.evidence.down([["DATA", fact("trace", `trace-${i}`)]]);
			const coverage = data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1)!;
			expect(coverage).toMatchObject({
				complete: false,
				missingKinds: [],
				terminalGapKinds: ["trace"],
			});
			expect(coverage.entries).toHaveLength(2);
			expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
				lifecycle: true,
				retainedEvidence: true,
			});
			f.stop();
			return coverage;
		};
		expect(run(true)).toEqual(run(false));
	});

	it("turns pending evidence into the same terminal capacity gap as direct evidence", () => {
		const run = (early: boolean) => {
			const f = fixture({ maxEvidence: 1 });
			const value = occurrence(1);
			const send = () => {
				for (const kind of ["receipt", "trace"])
					f.evidence.down([
						[
							"DATA",
							{
								occurrence: refOf(value),
								evidenceKind: kind,
								evidenceId: kind,
								evidenceDigest: digest("c"),
								coverage: "included",
							},
						],
					]);
			};
			if (early) send();
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			for (const branch of ["materialize", "audit"])
				f.branchTerminals.down([
					["DATA", { occurrence: refOf(value), branch, state: "completed", result: ok(branch) }],
				]);
			if (!early) send();
			const result = {
				coverage: data<CausalEvidenceCoverage>(f.messages.get("coverage")).at(-1),
				quiescence: data<CausalQuiescence>(f.messages.get("quiescence")).at(-1),
				issues: data<DataIssue>(f.messages.get("issues")).map((v) => v.code),
			};
			expect(result.quiescence).toMatchObject({ lifecycle: true, retainedEvidence: true });
			expect(result.coverage).toMatchObject({
				complete: false,
				missingKinds: [],
				terminalGapKinds: ["trace"],
			});
			expect(result.issues).toContain("causal-occurrence/evidence-bound");
			f.stop();
			return result;
		};
		expect(run(true)).toEqual(run(false));
	});

	it("handles effect capacity consistently after direct or pending proposals", () => {
		const run = (early: boolean) => {
			const f = fixture({ maxEffects: 1 });
			const value = occurrence(1);
			const proposals = ["first", "overflow"].map(
				(id): CausalEffectProposal => ({
					occurrence: refOf(value),
					effectId: id,
					requestRef: { kind: "request", id },
					proposalDigest: digest("b"),
				}),
			);
			const send = () => f.effectProposals.down(proposals.map((v) => ["DATA", v]));
			if (early) send();
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			if (!early) send();
			f.effectAdmissions.down([
				[
					"DATA",
					{ ...proposals[0]!, admissionRef: { kind: "admission", id: "deny" }, state: "rejected" },
				],
			]);
			for (const branch of ["materialize", "audit"])
				f.branchTerminals.down([
					["DATA", { occurrence: refOf(value), branch, state: "completed", result: ok(branch) }],
				]);
			const result = {
				conservation: data<CausalEffectConservation>(f.messages.get("conservation")).at(-1),
				quiescence: data<CausalQuiescence>(f.messages.get("quiescence")).at(-1),
				issues: [...new Set(data<DataIssue>(f.messages.get("issues")).map((v) => v.code))],
			};
			expect(result.issues).toContain("causal-occurrence/effect-bound");
			expect(result.quiescence).toMatchObject({ lifecycle: false, pendingEffectIds: ["overflow"] });
			expect(result.conservation).toMatchObject({ proposed: 1, rejected: 1, admitted: 0 });
			f.stop();
			return result;
		};
		expect(run(true)).toEqual(run(false));
	});

	it("recovers capacity-blocked effect facts without replay after another occurrence is evicted", () => {
		for (const [early, queued] of [
			[true, false],
			[false, false],
			[true, true],
			[false, true],
		]) {
			const f = fixture({ maxOccurrences: 2, maxEffects: 1 });
			const first = occurrence(1);
			const second = occurrence(2);
			const release = (value: CausalOccurrence<string>) => {
				f.occurrences.down([["DATA", value]]);
				f.admissions.down([["DATA", admission(value)]]);
				f.watermarks.down([
					["DATA", { revisionDomain: value.revisionDomain, revision: value.revision }],
				]);
			};
			const propose = (value: CausalOccurrenceRef): CausalEffectProposal => ({
				occurrence: refOf(value),
				effectId: `effect-${value.revision}`,
				requestRef: { kind: "request", id: `request-${value.revision}` },
				proposalDigest: digest("b"),
			});
			release(first);
			const firstProposal = propose(first);
			f.effectProposals.down([["DATA", firstProposal]]);
			f.effectAdmissions.down([
				[
					"DATA",
					{ ...firstProposal, state: "rejected", admissionRef: { kind: "admission", id: "first" } },
				],
			]);
			for (const branch of queued ? ["materialize"] : ["materialize", "audit"])
				f.branchTerminals.down([
					["DATA", { occurrence: refOf(first), branch, state: "completed", result: ok(branch) }],
				]);
			const proposal = propose(second);
			const admitted: CausalEffectAdmission = {
				...proposal,
				state: "admitted",
				admissionRef: { kind: "admission", id: "second" },
			};
			const send = () => {
				f.effectOutcomes.down([["DATA", { ...admitted, state: "succeeded", result: ok("done") }]]);
				f.effectAdmissions.down([["DATA", admitted]]);
				f.effectProposals.down([["DATA", proposal]]);
			};
			if (early) send();
			release(second);
			if (!early) send();
			expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
				lifecycle: false,
				pendingEffectIds: [proposal.effectId],
			});
			f.effectProposals.down([
				[
					"DATA",
					{
						...proposal,
						proposalDigest: digest("c"),
						requestRef: { kind: "request", id: "conflict" },
					},
				],
			]);
			f.occurrences.down([["DATA", occurrence(3)]]);
			if (queued)
				f.branchTerminals.down([
					[
						"DATA",
						{ occurrence: refOf(first), branch: "audit", state: "completed", result: ok("audit") },
					],
				]);
			expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
				occurrence: refOf(second),
				proposed: 1,
				admitted: 1,
				active: 0,
				succeeded: 1,
			});
			expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
				pendingEffectIds: [],
			});
			f.stop();
		}
	});

	it("rejects malformed terminal result envelopes before they can settle direct or pending effects", () => {
		for (const early of [true, false]) {
			const f = fixture();
			const value = occurrence(1);
			const proposal: CausalEffectProposal = {
				occurrence: refOf(value),
				effectId: "result",
				requestRef: { kind: "request", id: "result" },
				proposalDigest: digest("b"),
			};
			const admitted: CausalEffectAdmission = {
				...proposal,
				state: "admitted",
				admissionRef: { kind: "admission", id: "result" },
			};
			const send = () => {
				for (const result of [
					{ kind: "error", error: { message: "missing DataIssue base" } },
					{ kind: "ok" },
					{ status: "failed" },
				])
					f.effectOutcomes.down([
						[
							"DATA",
							{
								...admitted,
								state: result.kind === "ok" ? "succeeded" : "failed",
								result,
							} as never,
						],
					]);
			};
			if (early) send();
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			f.effectProposals.down([["DATA", proposal]]);
			f.effectAdmissions.down([["DATA", admitted]]);
			if (!early) send();
			expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
				admitted: 1,
				active: 1,
				succeeded: 0,
				failed: 0,
			});
			expect(
				data<DataIssue>(f.messages.get("issues")).filter(
					(v) => v.code === "causal-occurrence/invalid-effect-outcome",
				),
			).toHaveLength(3);
			expect([...f.messages.values()].flat().some((message) => message[0] === "ERROR")).toBe(false);
			f.stop();
		}
	});

	it("promotes a new domain's first pending revision when another domain frees capacity", () => {
		const f = fixture({ maxOccurrences: 2 });
		for (const value of [occurrence(1), occurrence(2)]) {
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([
				["DATA", { revisionDomain: value.revisionDomain, revision: value.revision }],
			]);
		}
		const { digest: _digest, ...material } = occurrence(1, "new-domain-first");
		const changed = { ...material, revisionDomain: "new-domain" };
		const value = { ...changed, digest: causalOccurrenceDigest(changed) };
		f.occurrences.down([["DATA", value]]);
		f.admissions.down([["DATA", admission(value)]]);
		f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toHaveLength(2);
		for (const branch of ["materialize", "audit"])
			f.branchTerminals.down([
				[
					"DATA",
					{ occurrence: refOf(occurrence(1)), branch, state: "completed", result: ok(branch) },
				],
			]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([
			occurrence(1),
			occurrence(2),
			value,
		]);
		expect(data<CausalCurrentness>(f.messages.get("currentness")).at(-1)).toMatchObject({
			occurrence: refOf(value),
			state: "current",
		});
		f.occurrences.down([["DATA", value]]);
		expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toHaveLength(3);
		f.stop();
	});

	it("rejects independently invalid outcome state/result pairs before reserving a domain", () => {
		for (const [state, result] of [
			["succeeded", error("bad-success")],
			["failed", ok("bad-failure")],
		] as const) {
			const f = fixture({ maxOccurrences: 1 });
			f.effectOutcomes.down([
				[
					"DATA",
					{
						occurrence: refOf(occurrence(1)),
						effectId: "invalid",
						requestRef: { kind: "request", id: "invalid" },
						admissionRef: { kind: "admission", id: "invalid" },
						proposalDigest: digest("b"),
						state,
						result,
					},
				],
			]);
			expect(data<DataIssue>(f.messages.get("issues")).map((v) => v.code)).toContain(
				"causal-occurrence/effect-outcome-mismatch",
			);
			const { digest: _digest, ...material } = occurrence(1, "valid-domain-first");
			const changed = { ...material, revisionDomain: "valid-domain" };
			const value = { ...changed, digest: causalOccurrenceDigest(changed) };
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			expect(data<CausalOccurrence<string>>(f.messages.get("released"))).toEqual([value]);
			expect(data<DataIssue>(f.messages.get("issues")).map((v) => v.code)).not.toContain(
				"causal-occurrence/domain-bound",
			);
			f.stop();
		}
	});

	it("D160 keeps admitted obligations across UI unsubscription and rejects a wrong outcome before exact settlement", () => {
		const run = (detach: boolean, settle: boolean) => {
			const f = fixture();
			const value = occurrence(1);
			f.occurrences.down([["DATA", value]]);
			f.admissions.down([["DATA", admission(value)]]);
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 1 }]]);
			for (const branch of ["materialize", "audit"])
				f.branchTerminals.down([
					["DATA", { occurrence: value, branch, state: "completed", result: ok(branch) }],
				]);
			const proposal: CausalEffectProposal = {
				occurrence: refOf(value),
				effectId: "ui-effect",
				requestRef: { kind: "request", id: "ui-request" },
				proposalDigest: digest("b"),
			};
			const admitted: CausalEffectAdmission = {
				...proposal,
				state: "admitted",
				admissionRef: { kind: "admission", id: "ui-admission" },
			};
			f.effectProposals.down([["DATA", proposal]]);
			f.effectAdmissions.down([["DATA", admitted]]);
			expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject({
				admitted: 1,
				active: 1,
			});
			expect(
				constructionOf(f.owner, "causal")?.roots.filter(
					(root) =>
						root.node === f.owner.find("causal/release-controller") &&
						root.unsubscribe !== undefined,
				),
			).toHaveLength(1);
			if (detach) f.unsubscribeOutputs();
			f.effectOutcomes.down([
				[
					"DATA",
					{
						...admitted,
						admissionRef: { kind: "admission", id: "wrong" },
						state: "failed",
						result: error("failure"),
					},
				],
			]);
			// External inspection adds no subscription/keepalive and does not drive computation.
			expect(f.owner.find("causal/authority")?.cache).toMatchObject({
				kind: "issue",
				value: { code: "causal-occurrence/effect-outcome-mismatch" },
			});
			if (detach) f.subscribeOutputs();
			for (const values of f.messages.values()) values.length = 0;
			if (settle) {
				f.effectOutcomes.down([
					["DATA", { ...admitted, state: "failed", result: error("failure") }],
				]);
				expect(data<CausalEffectConservation>(f.messages.get("conservation")).at(-1)).toMatchObject(
					{ admitted: 1, active: 0, failed: 1 },
				);
			}
			for (const evidenceKind of ["receipt", "trace"])
				f.evidence.down([
					[
						"DATA",
						{
							occurrence: refOf(value),
							evidenceKind,
							evidenceId: evidenceKind,
							evidenceDigest: digest("c"),
							coverage: "included",
						},
					],
				]);
			// Force a fresh quiescence fact through DATA without inventing an outcome.
			f.watermarks.down([["DATA", { revisionDomain: value.revisionDomain, revision: 2 }]]);
			expect(data<CausalQuiescence>(f.messages.get("quiescence")).at(-1)).toMatchObject({
				pendingEffectIds: settle ? [] : ["ui-effect"],
			});
			if (!settle) expect(data(f.messages.get("conservation"))).toEqual([]);
			const result = Object.fromEntries(
				[...f.messages].map(([name, messages]) => [
					name,
					messages.filter(([kind]) => kind !== "START"),
				]),
			);
			f.stop();
			return result;
		};
		for (const settle of [false, true]) expect(run(true, settle)).toEqual(run(false, settle));
	});

	it("fails a topology mutation when any occurrence, join, release, or conservation edge is deleted", () => {
		const f = fixture();
		const description = f.owner.describe();
		assertCausalOccurrenceTopology(description, "causal");
		for (const deleted of causalOccurrenceRequiredEdges("causal", description)) {
			expect(
				() =>
					assertCausalOccurrenceTopology(
						{
							edges: description.edges.filter(
								(edge) => edge.from !== deleted.from || edge.to !== deleted.to,
							),
						},
						"causal",
					),
				`${deleted.from} -> ${deleted.to}`,
			).toThrow(/missing (?:required|source) edge/u);
		}
		f.stop();
	});

	it("contains no caller lifecycle patch escape hatches", () => {
		const source = [
			"../solutions/causal-occurrence.ts",
			...["contracts", "identity", "lifecycle", "evidence", "transition"].map(
				(name) => `../solutions/causal-occurrence/${name}.ts`,
			),
		]
			.map((path) => readFileSync(new URL(path, import.meta.url), "utf8"))
			.join("\n");
		expect(source).not.toMatch(/partial\s*:\s*true/u);
		expect(source).not.toMatch(/setTimeout|queueMicrotask/u);
		expect(source).not.toMatch(/\bPromise\b|callerQueue|caller_queue/u);
		expect(source).not.toMatch(/\[\s*["']RESOLVED["']/u);
		expect(source).not.toMatch(/\[\s*["']ERROR["']/u);
	});
});

// Representation equivalence: expected edges are an independent contract fixture.
describe("causal topology exact-string index", () => {
	const lanes = [
		"occurrences",
		"admissions",
		"branch-terminals",
		"effect-proposals",
		"effect-admissions",
		"effect-outcomes",
		"evidence",
		"watermarks",
	];
	const edgesFor = (name: string) => [
		...lanes.map((lane) => ({ from: `source/${lane}`, to: `${name}/input/${lane}` })),
		...lanes.map((lane) => ({ from: `${name}/input/${lane}`, to: `${name}/arrivals` })),
		...[
			["arrivals", "authority"],
			["authority", "release-candidates"],
			["release-candidates", "release-port"],
			["release-port", "released"],
			["release-candidates", "release-events"],
			["released", "release-events"],
			["release-events", "release-controller"],
			...["currentness", "terminals", "conservation", "coverage", "quiescence", "issues"].map(
				(port) => ["authority", port],
			),
		].map(([from, to]) => ({ from: `${name}/${from}`, to: `${name}/${to}` })),
	];
	it.each([
		"ordinary",
		"__proto__",
		"域/🌳",
		"a|b::c->d",
		"a\0b",
	])("preserves required edges and first error for %j", (name) => {
		const edges = edgesFor(name);
		expect(causalOccurrenceRequiredEdges(name, { edges })).toEqual(edges);
		expect(() => assertCausalOccurrenceTopology({ edges }, name)).not.toThrow();
		for (let index = 0; index < edges.length; index += 1) {
			const removed = edges[index]!;
			const message =
				index < lanes.length
					? `causal occurrence topology missing source edge into ${lanes[index]}`
					: `causal occurrence topology missing required edge ${removed.from} -> ${removed.to}`;
			// Also remove the next edge and reverse actual order: diagnostics follow contract order.
			const remaining = edges.filter((_, i) => i !== index && i !== index + 1).reverse();
			expect(() => assertCausalOccurrenceTopology({ edges: remaining }, name)).toThrow(
				new TypeError(message),
			);
		}
	});
	it("accepts duplicates, multiple sources, unrelated edges and self edges without redefining topology policy", () => {
		const edges = edgesFor("causal");
		const extras = [
			{ from: "__proto__", to: "__proto__" },
			{ from: "", to: "constructor" },
			{ from: "another/source", to: "causal/input/occurrences" },
			{ from: "causal/authority", to: "causal/authority" },
		];
		expect(() =>
			assertCausalOccurrenceTopology(
				{ edges: [...edges, ...edges, ...extras].reverse() },
				"causal",
			),
		).not.toThrow();
		expect(() =>
			assertCausalOccurrenceTopology(
				{ edges: [...edges.filter((e) => e.from !== "source/occurrences"), ...extras] },
				"causal",
			),
		).not.toThrow();
	});
	it.each([
		"|",
		"::",
		"->",
		"\0",
	])("does not replace a missing edge with a %j concatenation collision", (separator) => {
		const name = `a${separator}b`;
		const edges = edgesFor(name);
		const missing = { from: `${name}/arrivals`, to: `${name}/authority` };
		const joined = `${missing.from}${separator}${missing.to}`;
		const decoy = { from: "a", to: joined.slice(1 + separator.length) };
		expect(`${decoy.from}${separator}${decoy.to}`).toBe(joined);
		const remaining = edges.filter((edge) => edge.from !== missing.from || edge.to !== missing.to);
		expect(() => assertCausalOccurrenceTopology({ edges: [...remaining, decoy] }, name)).toThrow(
			new TypeError(
				`causal occurrence topology missing required edge ${missing.from} -> ${missing.to}`,
			),
		);
	});
	it("preserves helper source identity, lane order, duplicates and sparse holes (A2)", () => {
		const name = "域/\0__proto__";
		const first = { from: "first", to: `${name}/input/occurrences` };
		const last = { from: "last", to: `${name}/input/watermarks` };
		const edges = [last, first, first, { from: "other", to: "unrelated" }];
		delete edges[3];
		const result = causalOccurrenceRequiredEdges(name, { edges });
		expect(result.slice(0, 3)).toEqual([first, first, last]);
		expect(result[0]).toBe(first);
		expect(result[1]).toBe(first);
		expect(result[2]).toBe(last);
		expect(result.slice(3)).toEqual(causalOccurrenceRequiredEdges(name));
		expect(Object.isFrozen(result)).toBe(true);
		expect(Object.isFrozen(first)).toBe(false);
	});
	it("rereads helper edges per lane and preserves edge getter order (A2)", () => {
		const accesses: string[] = [];
		const sources: Array<{ from: string; to: string }> = [];
		let lane = 0;
		const result = causalOccurrenceRequiredEdges("causal", {
			get edges() {
				const index = lane++;
				accesses.push(`edges:${index}`);
				const edge = {
					from: `source/${index}`,
					get to() {
						accesses.push(`to:${index}`);
						return `causal/input/${lanes[index]}`;
					},
				};
				sources.push(edge);
				return [edge];
			},
		});
		expect(accesses).toEqual(lanes.flatMap((_, i) => [`edges:${i}`, `to:${i}`]));
		for (const [i, edge] of sources.entries()) expect(result[i]).toBe(edge);
		expect(result).toHaveLength(29);
	});
	it("preserves helper getter failure without inspecting later edges (A2)", () => {
		const accesses: string[] = [];
		const failure = new Error("edge read failed");
		const description = {
			get edges() {
				accesses.push("edges");
				return [
					{
						from: "a",
						get to(): string {
							accesses.push("first");
							throw failure;
						},
					},
					{
						from: "b",
						get to(): string {
							accesses.push("later");
							return "unused";
						},
					},
				];
			},
		};
		expect(() => causalOccurrenceRequiredEdges("causal", description)).toThrow(failure);
		expect(accesses).toEqual(["edges", "first"]);
	});
	it("keeps fresh frozen internal results without a description (A2)", () => {
		const a = causalOccurrenceRequiredEdges("causal");
		const b = causalOccurrenceRequiredEdges("causal", { edges: [] });
		expect(a).toHaveLength(21);
		expect(b).toEqual(a);
		expect(b).not.toBe(a);
		expect(b[0]).not.toBe(a[0]);
		expect(Object.isFrozen(a)).toBe(true);
		expect(Object.isFrozen(b)).toBe(true);
	});
	it("preserves sparse snapshot holes without accepting explicit undefined edges", () => {
		const edges = [...new Array<{ from: string; to: string }>(2), ...edgesFor("causal")];
		delete edges[0];
		delete edges[1];
		expect(() => assertCausalOccurrenceTopology({ edges }, "causal")).not.toThrow();
		delete edges[2];
		expect(() => assertCausalOccurrenceTopology({ edges }, "causal")).toThrow(
			new TypeError("causal occurrence topology missing source edge into occurrences"),
		);
		edges[2] = edgesFor("causal")[0]!;
		edges[0] = undefined as never;
		expect(() => assertCausalOccurrenceTopology({ edges }, "causal")).toThrow(TypeError);
	});
	it("inspects changed live dependencies during cold construction rather than trusting the manifest", () => {
		let changed = false;
		let calls = 0;
		class RewiredGraph extends FixtureGraph {
			override describe(...args: Parameters<Graph["describe"]>): ReturnType<Graph["describe"]> {
				const authority = this.find("causal/authority");
				if (authority && !changed) {
					changed = true;
					expect(authority.status).toBe("sentinel");
					authority.unsubscribeDep(this.find("causal/arrivals")!, () => {
						calls += 1;
					});
				}
				return super.describe(...args);
			}
		}
		const owner = new RewiredGraph();
		expect(() => fixture({}, owner)).toThrow(
			/missing required edge causal\/arrivals -> causal\/authority/,
		);
		expect(changed).toBe(true);
		expect(calls).toBe(0);
		expect(owner.find("causal/authority")).toBeUndefined();
		expect(owner.describe().nodes).toHaveLength(8);
	});
});
