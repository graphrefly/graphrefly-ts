import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DataIssue, DataResult } from "../data/index.js";
import { graph } from "../graph/graph.js";
import { stableJsonString } from "../json/codec.js";
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
) {
	const owner = graph();
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
	const stops = Object.entries(bundle).map(([name, node]) => {
		const values: Message[] = [];
		messages.set(name, values);
		return node.subscribe((message) => values.push(message));
	});
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
		stop: () =>
			stops.forEach((value) => {
				value();
			}),
	};
}

const data = <T>(messages: Message[] | undefined) =>
	(messages ?? []).filter((message) => message[0] === "DATA").map((message) => message[1] as T);

describe("D791 causal occurrence contract-v2", () => {
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
		const source = readFileSync(
			new URL("../solutions/causal-occurrence.ts", import.meta.url),
			"utf8",
		);
		expect(source).not.toMatch(/partial\s*:\s*true/u);
		expect(source).not.toMatch(/setTimeout|queueMicrotask/u);
		expect(source).not.toMatch(/\bPromise\b|callerQueue|caller_queue/u);
		expect(source).not.toMatch(/\[\s*["']RESOLVED["']/u);
		expect(source).not.toMatch(/\[\s*["']ERROR["']/u);
	});
});
