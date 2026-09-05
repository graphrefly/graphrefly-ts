import { depBatch } from "../ctx/types.js";
import type { DataIssue, DataResult } from "../data/index.js";
import type { Graph } from "../graph/graph.js";
import { canonicalTupleKey } from "../identity.js";
import { stableJsonString } from "../json/codec.js";
import type { Node } from "../node/node.js";
import { merge } from "../operators/index.js";

export interface CausalSourceRef {
	readonly kind: string;
	readonly id: string;
}

export interface CausalOccurrenceRef {
	readonly revisionDomain: string;
	readonly occurrenceId: string;
	readonly revision: number;
	readonly digest: string;
	readonly sourceRefs: readonly CausalSourceRef[];
}

export interface CausalOccurrence<T> extends CausalOccurrenceRef {
	readonly value: T;
}

export interface CausalOccurrenceAdmission {
	readonly occurrence: CausalOccurrenceRef;
	readonly decisionId: string;
	readonly decisionDigest: string;
	readonly state: "admitted" | "rejected";
}

export interface CausalBranchTerminal<T = unknown, E extends DataIssue = DataIssue> {
	readonly occurrence: CausalOccurrenceRef;
	readonly branch: string;
	readonly state: "completed" | "failed" | "skipped";
	readonly result: DataResult<T, E>;
}

export interface CausalEffectProposal {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly proposalDigest: string;
}

export interface CausalEffectAdmission {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly admissionRef: CausalSourceRef;
	readonly proposalDigest: string;
	readonly state: "admitted" | "rejected";
}

export type CausalEffectOutcomeState =
	| "succeeded"
	| "failed"
	| "cancelled"
	| "reconcile-required"
	| "unknown";

export interface CausalEffectOutcome<T = unknown, E extends DataIssue = DataIssue> {
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly requestRef: CausalSourceRef;
	readonly admissionRef: CausalSourceRef;
	readonly proposalDigest: string;
	readonly state: CausalEffectOutcomeState;
	/** D184 passive DATA result. Failure never travels as protocol ERROR. */
	readonly result: DataResult<T, E>;
}

export type CausalEvidenceCoverageState =
	| "included"
	| "excluded"
	| "redacted"
	| "sampled"
	| "external-only"
	| "stale"
	| "unavailable"
	| "retention-gap"
	| "skipped-revision";

export interface CausalEvidence {
	readonly occurrence: CausalOccurrenceRef;
	readonly evidenceKind: string;
	readonly evidenceId: string;
	readonly evidenceDigest: string;
	readonly coverage: CausalEvidenceCoverageState;
	readonly refs?: readonly string[];
}

export interface CausalWatermark {
	readonly revisionDomain: string;
	readonly revision: number;
}

export interface CausalCurrentness {
	readonly kind: "causal-currentness";
	readonly occurrence: CausalOccurrenceRef;
	readonly evaluatedThroughRevision: number;
	readonly state: "current" | "superseded" | "stale" | "unverifiable";
	readonly supersededBy?: CausalOccurrenceRef;
	readonly missingRevision?: number;
	readonly gapRef?: Readonly<{
		readonly revisionDomain: string;
		readonly afterRevision: number;
		readonly beforeRevision?: number;
		readonly reason: "skipped-revision" | "retention-gap";
		readonly evidenceRef?: CausalSourceRef;
	}>;
}

export interface CausalTerminalFanIn {
	readonly kind: "causal-terminal-fan-in";
	readonly occurrence: CausalOccurrenceRef;
	readonly terminals: readonly CausalBranchTerminal[];
}

export interface CausalEffectConservation {
	readonly kind: "causal-effect-conservation";
	readonly occurrence: CausalOccurrenceRef;
	readonly proposed: number;
	readonly pendingAdmission: number;
	readonly rejected: number;
	readonly admitted: number;
	readonly active: number;
	readonly succeeded: number;
	readonly failed: number;
	readonly cancelled: number;
	readonly reconcileRequired: number;
	readonly unknown: number;
}

export interface CausalEvidenceCoverage {
	readonly kind: "causal-evidence-coverage";
	readonly occurrence: CausalOccurrenceRef;
	readonly complete: boolean;
	readonly entries: readonly CausalEvidence[];
	readonly missingKinds: readonly string[];
	readonly terminalGapKinds: readonly string[];
}

export interface CausalQuiescence {
	readonly kind: "causal-quiescence";
	readonly revisionDomain: string;
	readonly evaluatedThroughRevision: number;
	readonly lifecycle: boolean;
	readonly retainedEvidence: boolean;
	readonly pendingOccurrenceRefs: readonly CausalOccurrenceRef[];
	readonly pendingEffectIds: readonly string[];
}

export interface CausalOccurrenceBundle<T> {
	readonly released: Node<CausalOccurrence<T>>;
	readonly currentness: Node<CausalCurrentness>;
	readonly terminals: Node<CausalTerminalFanIn>;
	readonly conservation: Node<CausalEffectConservation>;
	readonly coverage: Node<CausalEvidenceCoverage>;
	readonly quiescence: Node<CausalQuiescence>;
	readonly issues: Node<DataIssue>;
}

export interface CausalOccurrenceBundleOptions<T> {
	readonly name: string;
	readonly occurrences: Node<CausalOccurrence<T>>;
	readonly admissions: Node<CausalOccurrenceAdmission>;
	readonly branchTerminals: Node<CausalBranchTerminal>;
	readonly effectProposals: Node<CausalEffectProposal>;
	readonly effectAdmissions: Node<CausalEffectAdmission>;
	readonly effectOutcomes: Node<CausalEffectOutcome>;
	readonly evidence: Node<CausalEvidence>;
	readonly watermarks: Node<CausalWatermark>;
	readonly requiredBranches: readonly string[];
	readonly requiredEvidenceKinds: readonly string[];
	readonly maxOccurrences: number;
	readonly maxPending: number;
	readonly maxEffects: number;
	readonly maxEvidence: number;
}

type Arrival<T> =
	| Readonly<{ lane: "occurrences"; values: readonly CausalOccurrence<T>[] }>
	| Readonly<{ lane: "admissions"; values: readonly CausalOccurrenceAdmission[] }>
	| Readonly<{ lane: "branch-terminals"; values: readonly CausalBranchTerminal[] }>
	| Readonly<{ lane: "effect-proposals"; values: readonly CausalEffectProposal[] }>
	| Readonly<{ lane: "effect-admissions"; values: readonly CausalEffectAdmission[] }>
	| Readonly<{ lane: "effect-outcomes"; values: readonly CausalEffectOutcome[] }>
	| Readonly<{ lane: "evidence"; values: readonly CausalEvidence[] }>
	| Readonly<{ lane: "watermarks"; values: readonly CausalWatermark[] }>;

type AuthorityFact<T> =
	| Readonly<{ kind: "release"; value: CausalOccurrence<T> }>
	| Readonly<{ kind: "currentness"; value: CausalCurrentness }>
	| Readonly<{ kind: "terminal"; value: CausalTerminalFanIn }>
	| Readonly<{ kind: "conservation"; value: CausalEffectConservation }>
	| Readonly<{ kind: "coverage"; value: CausalEvidenceCoverage }>
	| Readonly<{ kind: "quiescence"; value: CausalQuiescence }>
	| Readonly<{ kind: "issue"; value: DataIssue }>;

interface RetainedOccurrence<T> {
	readonly value: CausalOccurrence<T>;
	readonly key: string;
}

interface EffectRecord {
	readonly proposal: CausalEffectProposal;
	readonly key: string;
	readonly admission?: CausalEffectAdmission;
	readonly outcome?: CausalEffectOutcome;
}

interface RuntimeState<T> {
	highWaterByDomain: Map<string, number>;
	retentionFloorByDomain: Map<string, number>;
	byRevision: Map<string, RetainedOccurrence<T>>;
	pending: Map<string, RetainedOccurrence<T>>;
	admissions: Map<string, CausalOccurrenceAdmission>;
	released: Set<string>;
	terminals: Map<string, Map<string, CausalBranchTerminal>>;
	emittedTerminals: Set<string>;
	effects: Map<string, EffectRecord>;
	evidence: Map<string, CausalEvidence>;
	pendingTerminals: Map<string, CausalBranchTerminal>;
	pendingEffectProposals: Map<string, CausalEffectProposal>;
	pendingEffectAdmissions: Map<string, CausalEffectAdmission>;
	pendingEffectOutcomes: Map<string, CausalEffectOutcome>;
	pendingEvidence: Map<string, CausalEvidence>;
	coverageGaps: Map<string, CausalEvidence>;
	watermarks: Map<string, number>;
	currentness: Map<string, CausalCurrentness>;
	quiescence: Map<string, CausalQuiescence>;
	retentionGapThroughByDomain: Map<string, number>;
	occurrenceRetentionGaps: Map<string, CausalEvidence>;
}

const digestPattern = /^sha256:[0-9a-f]{64}$/u;
export const CAUSAL_OCCURRENCE_SCHEMA_REVISION =
	"graphrefly/causal-occurrence-contract/v1@contract-v2";
const terminalCoverage = new Set<CausalEvidenceCoverageState>([
	"included",
	"excluded",
	"redacted",
	"sampled",
	"external-only",
	"stale",
	"unavailable",
	"retention-gap",
	"skipped-revision",
]);

function issue(code: string, message: string, refs: readonly string[] = []): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", refs });
}

function dataKey(value: unknown): string {
	return stableJsonString(value);
}

const sha256Constants = Object.freeze([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
	return (value >>> count) | (value << (32 - count));
}

function sha256(value: string): string {
	const input = new TextEncoder().encode(value);
	const bitLength = input.length * 8;
	const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
	const bytes = new Uint8Array(paddedLength);
	bytes.set(input);
	bytes[input.length] = 0x80;
	const view = new DataView(bytes.buffer);
	view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000), false);
	view.setUint32(paddedLength - 4, bitLength >>> 0, false);
	const hash = new Uint32Array([
		0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
	]);
	const words = new Uint32Array(64);
	for (let offset = 0; offset < bytes.length; offset += 64) {
		for (let index = 0; index < 16; index += 1)
			words[index] = view.getUint32(offset + index * 4, false);
		for (let index = 16; index < 64; index += 1) {
			const s0 =
				rotateRight(words[index - 15]!, 7) ^
				rotateRight(words[index - 15]!, 18) ^
				(words[index - 15]! >>> 3);
			const s1 =
				rotateRight(words[index - 2]!, 17) ^
				rotateRight(words[index - 2]!, 19) ^
				(words[index - 2]! >>> 10);
			words[index] = (words[index - 16]! + s0 + words[index - 7]! + s1) >>> 0;
		}
		let [a, b, c, d, e, f, g, h] = hash;
		for (let index = 0; index < 64; index += 1) {
			const sum1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
			const choice = (e! & f!) ^ (~e! & g!);
			const temporary1 = (h! + sum1 + choice + sha256Constants[index]! + words[index]!) >>> 0;
			const sum0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
			const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
			const temporary2 = (sum0 + majority) >>> 0;
			h = g;
			g = f;
			f = e;
			e = (d! + temporary1) >>> 0;
			d = c;
			c = b;
			b = a;
			a = (temporary1 + temporary2) >>> 0;
		}
		hash[0] = (hash[0]! + a!) >>> 0;
		hash[1] = (hash[1]! + b!) >>> 0;
		hash[2] = (hash[2]! + c!) >>> 0;
		hash[3] = (hash[3]! + d!) >>> 0;
		hash[4] = (hash[4]! + e!) >>> 0;
		hash[5] = (hash[5]! + f!) >>> 0;
		hash[6] = (hash[6]! + g!) >>> 0;
		hash[7] = (hash[7]! + h!) >>> 0;
	}
	return `sha256:${[...hash].map((word) => word.toString(16).padStart(8, "0")).join("")}`;
}

export function causalOccurrenceDigest<T>(value: Omit<CausalOccurrence<T>, "digest">): string {
	return sha256(
		dataKey({
			schemaRevision: CAUSAL_OCCURRENCE_SCHEMA_REVISION,
			revisionDomain: value.revisionDomain,
			occurrenceId: value.occurrenceId,
			revision: value.revision,
			value: value.value,
			sourceRefs: value.sourceRefs,
		}),
	);
}

function canonicalSnapshot<T>(value: T): T {
	const freeze = (item: unknown): unknown => {
		if (item === null || typeof item !== "object") return item;
		if (Array.isArray(item)) return Object.freeze(item.map(freeze));
		return Object.freeze(
			Object.fromEntries(Object.entries(item).map(([key, child]) => [key, freeze(child)])),
		);
	};
	return freeze(JSON.parse(dataKey(value))) as T;
}

function canonicalEntry<T>(value: T): Readonly<{ key: string; snapshot: T }> | undefined {
	try {
		return Object.freeze({ key: dataKey(value), snapshot: canonicalSnapshot(value) });
	} catch {
		return undefined;
	}
}

function refKey(value: CausalOccurrenceRef): string {
	return canonicalTupleKey([
		value.revisionDomain,
		String(value.revision),
		value.occurrenceId,
		value.digest,
		dataKey(value.sourceRefs),
	]);
}

function occurrenceIdKey(value: CausalOccurrenceRef): string {
	return canonicalTupleKey([value.revisionDomain, value.occurrenceId]);
}

function revisionKey(domain: string, revision: number): string {
	return canonicalTupleKey([domain, String(revision)]);
}

function effectKey(value: { occurrence: CausalOccurrenceRef; effectId: string }): string {
	return canonicalTupleKey([refKey(value.occurrence), value.effectId]);
}

function validToken(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

function validSourceRef(value: unknown): value is CausalSourceRef {
	return (
		value !== null &&
		typeof value === "object" &&
		"kind" in value &&
		validToken(value.kind) &&
		"id" in value &&
		validToken(value.id)
	);
}

function validRef(value: unknown): value is CausalOccurrenceRef {
	return (
		value !== null &&
		typeof value === "object" &&
		"revisionDomain" in value &&
		validToken(value.revisionDomain) &&
		"occurrenceId" in value &&
		validToken(value.occurrenceId) &&
		"revision" in value &&
		Number.isSafeInteger(value.revision) &&
		(value.revision as number) > 0 &&
		"digest" in value &&
		typeof value.digest === "string" &&
		digestPattern.test(value.digest) &&
		"sourceRefs" in value &&
		Array.isArray(value.sourceRefs) &&
		value.sourceRefs.length > 0 &&
		value.sourceRefs.every(validSourceRef) &&
		new Set(value.sourceRefs.map((ref) => canonicalTupleKey([ref.kind, ref.id]))).size ===
			value.sourceRefs.length
	);
}

function validAdmissionState(value: unknown): value is CausalOccurrenceAdmission["state"] {
	return value === "admitted" || value === "rejected";
}

function validOutcomeState(value: unknown): value is CausalEffectOutcomeState {
	return (
		value === "succeeded" ||
		value === "failed" ||
		value === "cancelled" ||
		value === "reconcile-required" ||
		value === "unknown"
	);
}

function validTerminal(value: CausalBranchTerminal): boolean {
	return (
		(value.state === "completed" || value.state === "failed" || value.state === "skipped") &&
		validResult(value.result) &&
		(value.state === "completed") === (value.result.kind === "ok")
	);
}

function sameRef(left: CausalOccurrenceRef, right: CausalOccurrenceRef): boolean {
	return (
		refKey(left) === refKey(right) &&
		left.digest === right.digest &&
		dataKey(left.sourceRefs) === dataKey(right.sourceRefs)
	);
}

function validResult(value: DataResult<unknown>): boolean {
	if (value === null || typeof value !== "object") return false;
	if (value.kind === "ok") return Object.hasOwn(value, "value");
	return (
		value.kind === "error" &&
		value.error?.kind === "issue" &&
		validToken(value.error.code) &&
		validToken(value.error.message)
	);
}

function emptyState<T>(): RuntimeState<T> {
	return {
		highWaterByDomain: new Map(),
		retentionFloorByDomain: new Map(),
		byRevision: new Map(),
		pending: new Map(),
		admissions: new Map(),
		released: new Set(),
		terminals: new Map(),
		emittedTerminals: new Set(),
		effects: new Map(),
		evidence: new Map(),
		pendingTerminals: new Map(),
		pendingEffectProposals: new Map(),
		pendingEffectAdmissions: new Map(),
		pendingEffectOutcomes: new Map(),
		pendingEvidence: new Map(),
		coverageGaps: new Map(),
		watermarks: new Map(),
		currentness: new Map(),
		quiescence: new Map(),
		retentionGapThroughByDomain: new Map(),
		occurrenceRetentionGaps: new Map(),
	};
}

function cloneState<T>(prior: RuntimeState<T> | undefined): RuntimeState<T> {
	if (prior === undefined) return emptyState();
	return {
		...prior,
		highWaterByDomain: new Map(prior.highWaterByDomain),
		retentionFloorByDomain: new Map(prior.retentionFloorByDomain),
		byRevision: new Map(prior.byRevision),
		pending: new Map(prior.pending),
		admissions: new Map(prior.admissions),
		released: new Set(prior.released),
		terminals: new Map([...prior.terminals].map(([key, value]) => [key, new Map(value)])),
		emittedTerminals: new Set(prior.emittedTerminals),
		effects: new Map(prior.effects),
		evidence: new Map(prior.evidence),
		pendingTerminals: new Map(prior.pendingTerminals),
		pendingEffectProposals: new Map(prior.pendingEffectProposals),
		pendingEffectAdmissions: new Map(prior.pendingEffectAdmissions),
		pendingEffectOutcomes: new Map(prior.pendingEffectOutcomes),
		pendingEvidence: new Map(prior.pendingEvidence),
		coverageGaps: new Map(prior.coverageGaps),
		watermarks: new Map(prior.watermarks),
		currentness: new Map(prior.currentness),
		quiescence: new Map(prior.quiescence),
		retentionGapThroughByDomain: new Map(prior.retentionGapThroughByDomain),
		occurrenceRetentionGaps: new Map(prior.occurrenceRetentionGaps),
	};
}

function lane<T, K extends Arrival<T>["lane"]>(
	graph: Graph,
	input: Node<unknown>,
	name: string,
	laneName: K,
): Node<Arrival<T>> {
	return graph.node<Arrival<T>>(
		[input],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down([["DATA", { lane: laneName, values } as Arrival<T>]]);
		},
		{ name, factory: "causalOccurrenceInputLane" },
	);
}

function projectFact<T, K extends AuthorityFact<T>["kind"]>(
	graph: Graph,
	authority: Node<AuthorityFact<T>>,
	name: string,
	kind: K,
	replayBuffer: number,
): Node<Extract<AuthorityFact<T>, { kind: K }>["value"]> {
	return graph.node(
		[authority],
		(ctx) => {
			const values = (depBatch(ctx, 0) ?? [])
				.filter((raw) => (raw as AuthorityFact<T>).kind === kind)
				.map((raw) => ["DATA", (raw as Extract<AuthorityFact<T>, { kind: K }>).value] as const);
			if (values.length > 0) ctx.down(values);
		},
		{ name, factory: "causalOccurrenceFactProjection", replayBuffer },
	);
}

export function causalOccurrenceBundle<T>(
	graph: Graph,
	opts: CausalOccurrenceBundleOptions<T>,
): CausalOccurrenceBundle<T> {
	for (const [label, bound] of [
		["maxOccurrences", opts.maxOccurrences],
		["maxPending", opts.maxPending],
		["maxEffects", opts.maxEffects],
		["maxEvidence", opts.maxEvidence],
	] as const) {
		if (!Number.isSafeInteger(bound) || bound < 1)
			throw new TypeError(`${label} must be a positive safe integer`);
	}
	if (new Set(opts.requiredBranches).size !== opts.requiredBranches.length)
		throw new TypeError("required branches must be unique");
	if (opts.requiredBranches.length === 0)
		throw new TypeError("at least one required branch must be declared");
	if (new Set(opts.requiredEvidenceKinds).size !== opts.requiredEvidenceKinds.length)
		throw new TypeError("required evidence kinds must be unique");

	const arrivals = graph.initNode(
		merge<Arrival<T>>(),
		[
			lane(graph, opts.occurrences, `${opts.name}/input/occurrences`, "occurrences"),
			lane(graph, opts.admissions, `${opts.name}/input/admissions`, "admissions"),
			lane(graph, opts.branchTerminals, `${opts.name}/input/branch-terminals`, "branch-terminals"),
			lane(graph, opts.effectProposals, `${opts.name}/input/effect-proposals`, "effect-proposals"),
			lane(
				graph,
				opts.effectAdmissions,
				`${opts.name}/input/effect-admissions`,
				"effect-admissions",
			),
			lane(graph, opts.effectOutcomes, `${opts.name}/input/effect-outcomes`, "effect-outcomes"),
			lane(graph, opts.evidence, `${opts.name}/input/evidence`, "evidence"),
			lane(graph, opts.watermarks, `${opts.name}/input/watermarks`, "watermarks"),
		],
		{ name: `${opts.name}/arrivals` },
	);

	const authority = graph.node<AuthorityFact<T>>(
		[arrivals],
		(ctx) => {
			const state = cloneState(ctx.state.get<RuntimeState<T>>());
			const outputs: AuthorityFact<T>[] = [];
			const emitIssue = (value: DataIssue) => outputs.push({ kind: "issue", value });
			const retainPending = <V>(map: Map<string, V>, key: string, value: V, label: string) => {
				const prior = map.get(key);
				if (prior !== undefined) {
					if (dataKey(prior) !== dataKey(value))
						emitIssue(
							issue(
								`causal-occurrence/${label}-conflict`,
								`Pending ${label} replay conflicts with retained DATA.`,
								[key],
							),
						);
					return;
				}
				if (map.size >= opts.maxPending) {
					emitIssue(
						issue(
							`causal-occurrence/${label}-pending-bound`,
							`Pending ${label} exceeded bounded retention.`,
							[key],
						),
					);
					return;
				}
				map.set(key, value);
			};
			const findOccurrence = (ref: CausalOccurrenceRef) =>
				state.byRevision.get(revisionKey(ref.revisionDomain, ref.revision))?.value;
			const exactOccurrence = (ref: CausalOccurrenceRef) => {
				const retained = findOccurrence(ref);
				return retained !== undefined && sameRef(retained, ref) ? retained : undefined;
			};
			const rejectDefinitiveMissingRef = (ref: CausalOccurrenceRef, label: string) => {
				const retained = findOccurrence(ref);
				const floor = state.retentionFloorByDomain.get(ref.revisionDomain) ?? 0;
				const highWater = state.highWaterByDomain.get(ref.revisionDomain) ?? 0;
				if (retained !== undefined && !sameRef(retained, ref)) {
					emitIssue(
						issue(
							`causal-occurrence/${label}-occurrence-conflict`,
							`${label} references a conflicting occurrence revision.`,
							[refKey(ref)],
						),
					);
					return true;
				}
				if (ref.revision <= floor || (ref.revision <= highWater && retained === undefined)) {
					emitIssue(
						issue(
							ref.revision <= floor
								? `causal-occurrence/${label}-retention-gap`
								: `causal-occurrence/${label}-stale`,
							`${label} references a revision that cannot regain authority.`,
							[refKey(ref)],
						),
					);
					return true;
				}
				return false;
			};
			const maybeRelease = (occurrence: CausalOccurrence<T>) => {
				const key = refKey(occurrence);
				const admission = state.admissions.get(key);
				const currentness = state.currentness.get(key);
				if (
					admission?.state !== "admitted" ||
					!sameRef(admission.occurrence, occurrence) ||
					currentness?.state !== "current" ||
					state.released.has(key) ||
					currentness.evaluatedThroughRevision < occurrence.revision
				)
					return;
				state.released.add(key);
				outputs.push({ kind: "release", value: occurrence });
			};
			const settledForEviction = (occurrence: CausalOccurrence<T>) => {
				const key = refKey(occurrence);
				const admission = state.admissions.get(key);
				if (admission?.state === "rejected") return true;
				if (
					admission?.state !== "admitted" ||
					!state.released.has(key) ||
					!state.emittedTerminals.has(key)
				)
					return false;
				return [...state.effects.values()]
					.filter((record) => sameRef(record.proposal.occurrence, occurrence))
					.every(
						(record) =>
							record.admission?.state === "rejected" ||
							(record.admission?.state === "admitted" && record.outcome !== undefined),
					);
			};
			const acceptOccurrence = (entry: RetainedOccurrence<T>): boolean => {
				const occurrence = entry.value;
				if (state.byRevision.size >= opts.maxOccurrences) {
					const oldest = [...state.byRevision.entries()]
						.sort(([, left], [, right]) => left.value.revision - right.value.revision)
						.find(([, retained]) => settledForEviction(retained.value));
					if (oldest === undefined) {
						emitIssue(
							issue(
								"causal-occurrence/retention-capacity",
								"Occurrence retention is full of unsettled causal obligations.",
								[refKey(occurrence)],
							),
						);
						return false;
					}
					state.byRevision.delete(oldest[0]);
					const evicted = oldest[1].value;
					const evictedRefKey = refKey(evicted);
					state.admissions.delete(evictedRefKey);
					state.released.delete(evictedRefKey);
					state.terminals.delete(evictedRefKey);
					state.emittedTerminals.delete(evictedRefKey);
					state.currentness.delete(evictedRefKey);
					for (const [key, record] of state.effects) {
						if (sameRef(record.proposal.occurrence, evicted)) state.effects.delete(key);
					}
					for (const [key, evidence] of state.evidence) {
						if (sameRef(evidence.occurrence, evicted)) state.evidence.delete(key);
					}
					for (const map of [
						state.pendingTerminals,
						state.pendingEffectProposals,
						state.pendingEffectAdmissions,
						state.pendingEffectOutcomes,
						state.pendingEvidence,
						state.coverageGaps,
					]) {
						for (const [key, value] of map) {
							if (sameRef(value.occurrence, evicted)) map.delete(key);
						}
					}
					state.retentionFloorByDomain.set(
						evicted.revisionDomain,
						Math.max(
							state.retentionFloorByDomain.get(evicted.revisionDomain) ?? 0,
							evicted.revision,
						),
					);
					state.retentionGapThroughByDomain.set(
						evicted.revisionDomain,
						Math.max(
							state.retentionGapThroughByDomain.get(evicted.revisionDomain) ?? 0,
							evicted.revision,
						),
					);
					const retentionGap = canonicalSnapshot<CausalEvidence>({
						occurrence: evicted,
						evidenceKind: "occurrence-retention",
						evidenceId: `retention-gap/${evicted.revisionDomain}/${evicted.revision}`,
						evidenceDigest: evicted.digest,
						coverage: "retention-gap",
						refs: Object.freeze([`causal-occurrence:${refKey(evicted)}`]),
					});
					state.occurrenceRetentionGaps.set(evicted.revisionDomain, retentionGap);
					outputs.push({
						kind: "coverage",
						value: {
							kind: "causal-evidence-coverage",
							occurrence: evicted,
							complete: false,
							entries: Object.freeze([retentionGap]),
							missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
							terminalGapKinds: Object.freeze([...opts.requiredEvidenceKinds]),
						},
					});
				}
				state.byRevision.set(revisionKey(occurrence.revisionDomain, occurrence.revision), entry);
				state.highWaterByDomain.set(occurrence.revisionDomain, occurrence.revision);
				return true;
			};
			const emitConservation = (occurrence: CausalOccurrenceRef) => {
				const records = [...state.effects.values()].filter((record) =>
					sameRef(record.proposal.occurrence, occurrence),
				);
				const admitted = records.filter((record) => record.admission?.state === "admitted");
				const count = (value: CausalEffectOutcomeState) =>
					admitted.filter((record) => record.outcome?.state === value).length;
				outputs.push({
					kind: "conservation",
					value: {
						kind: "causal-effect-conservation",
						occurrence,
						proposed: records.length,
						pendingAdmission: records.filter((record) => record.admission === undefined).length,
						rejected: records.filter((record) => record.admission?.state === "rejected").length,
						admitted: admitted.length,
						active: admitted.filter((record) => record.outcome === undefined).length,
						succeeded: count("succeeded"),
						failed: count("failed"),
						cancelled: count("cancelled"),
						reconcileRequired: count("reconcile-required"),
						unknown: count("unknown"),
					},
				});
			};
			const emitCoverage = (occurrence: CausalOccurrenceRef) => {
				const entries = [...state.evidence.values(), ...state.coverageGaps.values()].filter(
					(value) => sameRef(value.occurrence, occurrence),
				);
				const byKind = new Map(entries.map((value) => [value.evidenceKind, value]));
				const missingKinds = opts.requiredEvidenceKinds.filter((kind) => !byKind.has(kind));
				const terminalGapKinds = opts.requiredEvidenceKinds.filter((kind) => {
					const value = byKind.get(kind);
					return (
						value !== undefined &&
						value.coverage !== "included" &&
						value.coverage !== "external-only"
					);
				});
				outputs.push({
					kind: "coverage",
					value: {
						kind: "causal-evidence-coverage",
						occurrence,
						complete:
							missingKinds.length === 0 &&
							entries.every(
								(value) =>
									value.coverage !== "retention-gap" && value.coverage !== "skipped-revision",
							),
						entries: Object.freeze(entries),
						missingKinds: Object.freeze(missingKinds),
						terminalGapKinds: Object.freeze(terminalGapKinds),
					},
				});
			};
			const recomputeDomain = (revisionDomain: string) => {
				const watermark = state.watermarks.get(revisionDomain);
				if (watermark === undefined) return;
				const floor = state.retentionFloorByDomain.get(revisionDomain) ?? 0;
				const occurrences = [...state.byRevision.values()]
					.map((entry) => entry.value)
					.filter((value) => value.revisionDomain === revisionDomain && value.revision <= watermark)
					.sort((left, right) => left.revision - right.revision);
				const exactAdmission = (occurrence: CausalOccurrence<T>) => {
					const admission = state.admissions.get(refKey(occurrence));
					return admission !== undefined && sameRef(admission.occurrence, occurrence)
						? admission
						: undefined;
				};
				const sequenceComplete =
					(state.highWaterByDomain.get(revisionDomain) ?? 0) >= watermark &&
					(state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0 &&
					![...state.pending.values()].some(
						(entry) =>
							entry.value.revisionDomain === revisionDomain && entry.value.revision <= watermark,
					) &&
					occurrences
						.filter((occurrence) => occurrence.revision > floor)
						.every((occurrence) => exactAdmission(occurrence) !== undefined);
				const latestAdmitted = new Map<string, CausalOccurrence<T>>();
				for (const occurrence of occurrences) {
					if (exactAdmission(occurrence)?.state === "admitted")
						latestAdmitted.set(occurrenceIdKey(occurrence), occurrence);
				}
				for (const occurrence of occurrences) {
					const admission = exactAdmission(occurrence);
					const newer = latestAdmitted.get(occurrenceIdKey(occurrence));
					const value: CausalCurrentness =
						admission === undefined || !sequenceComplete
							? {
									kind: "causal-currentness",
									occurrence,
									evaluatedThroughRevision: watermark,
									state: "unverifiable",
									...((state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) > 0
										? {
												gapRef: {
													revisionDomain,
													afterRevision: state.retentionGapThroughByDomain.get(revisionDomain)!,
													reason: "retention-gap" as const,
													evidenceRef: {
														kind: "causal-evidence",
														id: state.occurrenceRetentionGaps.get(revisionDomain)!.evidenceId,
													},
												},
											}
										: {}),
								}
							: admission.state === "rejected"
								? {
										kind: "causal-currentness",
										occurrence,
										evaluatedThroughRevision: watermark,
										state: "stale",
									}
								: newer !== undefined && newer !== occurrence
									? {
											kind: "causal-currentness",
											occurrence,
											evaluatedThroughRevision: watermark,
											state: "superseded",
											supersededBy: newer,
										}
									: {
											kind: "causal-currentness",
											occurrence,
											evaluatedThroughRevision: watermark,
											state: "current",
										};
					const key = refKey(occurrence);
					const prior = state.currentness.get(key);
					state.currentness.set(key, value);
					if (prior === undefined || dataKey(prior) !== dataKey(value))
						outputs.push({ kind: "currentness", value });
					maybeRelease(occurrence);
				}
				const pending = new Map<string, CausalOccurrenceRef>();
				for (const occurrence of occurrences) {
					const key = refKey(occurrence);
					const admission = exactAdmission(occurrence);
					const isLatest = latestAdmitted.get(occurrenceIdKey(occurrence)) === occurrence;
					if (
						admission === undefined ||
						(admission.state === "admitted" && isLatest && !state.released.has(key)) ||
						(state.released.has(key) && !state.emittedTerminals.has(key))
					)
						pending.set(key, occurrence);
				}
				for (const admission of state.admissions.values()) {
					if (
						admission.occurrence.revisionDomain === revisionDomain &&
						admission.occurrence.revision <= watermark &&
						exactOccurrence(admission.occurrence) === undefined
					)
						pending.set(refKey(admission.occurrence), admission.occurrence);
				}
				for (const terminal of state.pendingTerminals.values()) {
					if (
						terminal.occurrence.revisionDomain === revisionDomain &&
						terminal.occurrence.revision <= watermark
					)
						pending.set(refKey(terminal.occurrence), terminal.occurrence);
				}
				const pendingEffects = [...state.effects.values()].filter(
					(record) =>
						record.proposal.occurrence.revisionDomain === revisionDomain &&
						record.proposal.occurrence.revision <= watermark &&
						(record.admission === undefined ||
							(record.admission.state === "admitted" && record.outcome === undefined)),
				);
				const pendingEffectIds = new Set(pendingEffects.map((record) => record.proposal.effectId));
				for (const effect of [
					...state.pendingEffectProposals.values(),
					...state.pendingEffectAdmissions.values(),
					...state.pendingEffectOutcomes.values(),
				]) {
					if (
						effect.occurrence.revisionDomain === revisionDomain &&
						effect.occurrence.revision <= watermark
					)
						pendingEffectIds.add(effect.effectId);
				}
				const evidenceTerminal =
					![...state.pendingEvidence.values()].some(
						(evidence) =>
							evidence.occurrence.revisionDomain === revisionDomain &&
							evidence.occurrence.revision <= watermark,
					) &&
					occurrences.every((occurrence) =>
						opts.requiredEvidenceKinds.every((kind) =>
							[...state.evidence.values(), ...state.coverageGaps.values()].some(
								(entry) =>
									sameRef(entry.occurrence, occurrence) &&
									entry.evidenceKind === kind &&
									terminalCoverage.has(entry.coverage),
							),
						),
					);
				const pendingOccurrenceRefs = Object.freeze([...pending.values()]);
				const lifecycle =
					sequenceComplete && pendingOccurrenceRefs.length === 0 && pendingEffectIds.size === 0;
				const value: CausalQuiescence = {
					kind: "causal-quiescence",
					revisionDomain,
					evaluatedThroughRevision: watermark,
					lifecycle,
					retainedEvidence:
						lifecycle &&
						evidenceTerminal &&
						(state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0,
					pendingOccurrenceRefs,
					pendingEffectIds: Object.freeze([...pendingEffectIds]),
				};
				const prior = state.quiescence.get(revisionDomain);
				state.quiescence.set(revisionDomain, value);
				if (prior === undefined || dataKey(prior) !== dataKey(value))
					outputs.push({ kind: "quiescence", value });
			};
			const flushPending = () => {
				for (const [key, admission] of state.admissions) {
					const retained = findOccurrence(admission.occurrence);
					if (retained !== undefined && !sameRef(retained, admission.occurrence)) {
						emitIssue(
							issue(
								"causal-occurrence/admission-mismatch",
								"Deferred admission conflicts with the retained occurrence revision.",
								[key],
							),
						);
						state.admissions.delete(key);
					}
					if (
						retained === undefined &&
						rejectDefinitiveMissingRef(admission.occurrence, "admission")
					)
						state.admissions.delete(key);
				}
				for (const [key, proposal] of state.pendingEffectProposals) {
					if (
						exactOccurrence(proposal.occurrence) === undefined &&
						rejectDefinitiveMissingRef(proposal.occurrence, "effect-proposal")
					) {
						state.pendingEffectProposals.delete(key);
						continue;
					}
					if (
						exactOccurrence(proposal.occurrence) === undefined ||
						!state.released.has(refKey(proposal.occurrence))
					)
						continue;
					if (state.effects.size >= opts.maxEffects) continue;
					const existing = state.effects.get(key);
					if (existing === undefined) state.effects.set(key, { proposal, key: dataKey(proposal) });
					else if (existing.key !== dataKey(proposal))
						emitIssue(
							issue(
								"causal-occurrence/effect-proposal-conflict",
								"Deferred effect proposal conflicts with retained proposal.",
								[key],
							),
						);
					state.pendingEffectProposals.delete(key);
					emitConservation(proposal.occurrence);
				}
				for (const [key, admission] of state.pendingEffectAdmissions) {
					const record = state.effects.get(key);
					if (record === undefined) {
						if (rejectDefinitiveMissingRef(admission.occurrence, "effect-admission"))
							state.pendingEffectAdmissions.delete(key);
						continue;
					}
					if (
						record.proposal.proposalDigest !== admission.proposalDigest ||
						dataKey(record.proposal.requestRef) !== dataKey(admission.requestRef) ||
						!sameRef(record.proposal.occurrence, admission.occurrence)
					) {
						emitIssue(
							issue(
								"causal-occurrence/effect-admission-mismatch",
								"Deferred effect admission does not match its proposal.",
								[key],
							),
						);
						state.pendingEffectAdmissions.delete(key);
						continue;
					}
					if (record.admission === undefined) state.effects.set(key, { ...record, admission });
					else if (dataKey(record.admission) !== dataKey(admission))
						emitIssue(
							issue(
								"causal-occurrence/effect-admission-conflict",
								"Deferred effect admission conflicts with retained admission.",
								[key],
							),
						);
					state.pendingEffectAdmissions.delete(key);
					emitConservation(admission.occurrence);
				}
				for (const [key, outcome] of state.pendingEffectOutcomes) {
					const record = state.effects.get(key);
					if (record?.admission === undefined) {
						if (rejectDefinitiveMissingRef(outcome.occurrence, "effect-outcome"))
							state.pendingEffectOutcomes.delete(key);
						continue;
					}
					const matches =
						record.admission.state === "admitted" &&
						record.proposal.proposalDigest === outcome.proposalDigest &&
						dataKey(record.proposal.requestRef) === dataKey(outcome.requestRef) &&
						dataKey(record.admission.admissionRef) === dataKey(outcome.admissionRef) &&
						sameRef(record.proposal.occurrence, outcome.occurrence) &&
						(outcome.state === "succeeded") === (outcome.result.kind === "ok");
					if (!matches) {
						emitIssue(
							issue(
								"causal-occurrence/effect-outcome-mismatch",
								"Deferred effect outcome lacks exact admitted authority.",
								[key],
							),
						);
						state.pendingEffectOutcomes.delete(key);
						continue;
					}
					if (record.outcome === undefined) state.effects.set(key, { ...record, outcome });
					else if (dataKey(record.outcome) !== dataKey(outcome))
						emitIssue(
							issue(
								"causal-occurrence/effect-outcome-conflict",
								"Deferred effect outcome conflicts with retained outcome.",
								[key],
							),
						);
					state.pendingEffectOutcomes.delete(key);
					emitConservation(outcome.occurrence);
				}
				for (const [pendingKey, terminal] of state.pendingTerminals) {
					const key = refKey(terminal.occurrence);
					if (
						exactOccurrence(terminal.occurrence) === undefined &&
						rejectDefinitiveMissingRef(terminal.occurrence, "terminal")
					) {
						state.pendingTerminals.delete(pendingKey);
						continue;
					}
					if (exactOccurrence(terminal.occurrence) === undefined || !state.released.has(key))
						continue;
					const branches = state.terminals.get(key) ?? new Map<string, CausalBranchTerminal>();
					const prior = branches.get(terminal.branch);
					if (prior === undefined) branches.set(terminal.branch, terminal);
					else if (dataKey(prior) !== dataKey(terminal))
						emitIssue(
							issue(
								"causal-occurrence/terminal-conflict",
								"Deferred branch terminal conflicts with retained terminal.",
								[key, terminal.branch],
							),
						);
					state.terminals.set(key, branches);
					state.pendingTerminals.delete(pendingKey);
					if (
						!state.emittedTerminals.has(key) &&
						opts.requiredBranches.every((branch) => branches.has(branch))
					) {
						state.emittedTerminals.add(key);
						outputs.push({
							kind: "terminal",
							value: {
								kind: "causal-terminal-fan-in",
								occurrence: terminal.occurrence,
								terminals: Object.freeze(
									opts.requiredBranches.map((branch) => branches.get(branch)!),
								),
							},
						});
					}
				}
				for (const [key, evidence] of state.pendingEvidence) {
					if (exactOccurrence(evidence.occurrence) === undefined) {
						if (rejectDefinitiveMissingRef(evidence.occurrence, "evidence"))
							state.pendingEvidence.delete(key);
						continue;
					}
					if (state.evidence.size >= opts.maxEvidence) continue;
					const prior = state.evidence.get(key);
					if (prior === undefined) state.evidence.set(key, evidence);
					else if (dataKey(prior) !== dataKey(evidence))
						emitIssue(
							issue(
								"causal-occurrence/evidence-conflict",
								"Deferred evidence conflicts with retained evidence.",
								[key],
							),
						);
					state.pendingEvidence.delete(key);
					emitCoverage(evidence.occurrence);
				}
				for (const revisionDomain of state.highWaterByDomain.keys()) {
					for (;;) {
						const revision = (state.highWaterByDomain.get(revisionDomain) ?? 0) + 1;
						const key = revisionKey(revisionDomain, revision);
						const pending = state.pending.get(key);
						if (pending === undefined || !acceptOccurrence(pending)) break;
						state.pending.delete(key);
					}
				}
			};

			for (const raw of depBatch(ctx, 0) ?? []) {
				const arrival = raw as Arrival<T>;
				if (arrival.lane === "occurrences") {
					for (const occurrence of arrival.values) {
						if (!validRef(occurrence)) {
							emitIssue(
								issue("causal-occurrence/invalid-identity", "Occurrence identity is invalid."),
							);
							continue;
						}
						let key: string;
						try {
							key = dataKey(occurrence);
						} catch {
							emitIssue(issue("causal-occurrence/non-data", "Occurrence must be canonical DATA."));
							continue;
						}
						const { digest, ...digestMaterial } = occurrence;
						if (causalOccurrenceDigest(digestMaterial) !== digest) {
							emitIssue(
								issue(
									"causal-occurrence/digest-mismatch",
									"Occurrence digest does not bind contract-v2 identity and value material.",
									[refKey(occurrence)],
								),
							);
							continue;
						}
						if (
							!state.highWaterByDomain.has(occurrence.revisionDomain) &&
							state.highWaterByDomain.size >= opts.maxOccurrences
						) {
							emitIssue(
								issue(
									"causal-occurrence/domain-bound",
									"Revision-domain retention bound was reached.",
									[occurrence.revisionDomain],
								),
							);
							continue;
						}
						const domainKey = revisionKey(occurrence.revisionDomain, occurrence.revision);
						const existing = state.byRevision.get(domainKey) ?? state.pending.get(domainKey);
						if (existing !== undefined) {
							if (existing.key !== key)
								emitIssue(
									issue(
										"causal-occurrence/replay-conflict",
										"Revision replay conflicts with retained identity.",
										[refKey(occurrence)],
									),
								);
							continue;
						}
						const highWater = state.highWaterByDomain.get(occurrence.revisionDomain) ?? 0;
						const floor = state.retentionFloorByDomain.get(occurrence.revisionDomain) ?? 0;
						if (occurrence.revision <= highWater) {
							emitIssue(
								issue(
									occurrence.revision <= floor
										? "causal-occurrence/retention-gap"
										: "causal-occurrence/stale-revision",
									"Revision cannot regain causal authority.",
									[refKey(occurrence)],
								),
							);
							outputs.push({
								kind: "currentness",
								value: {
									kind: "causal-currentness",
									occurrence,
									evaluatedThroughRevision: highWater,
									state: occurrence.revision <= floor ? "unverifiable" : "stale",
								},
							});
							continue;
						}
						const entry = { value: canonicalSnapshot(occurrence), key };
						if (occurrence.revision > highWater + 1) {
							if (state.pending.size >= opts.maxPending) {
								emitIssue(
									issue(
										"causal-occurrence/pending-bound",
										"Skipped revision exceeded bounded pending retention.",
										[refKey(occurrence)],
									),
								);
								continue;
							}
							state.pending.set(domainKey, entry);
							emitIssue(
								issue(
									"causal-occurrence/skipped-revision",
									`Revision ${highWater + 1} is missing.`,
									[refKey(occurrence)],
								),
							);
							outputs.push({
								kind: "currentness",
								value: {
									kind: "causal-currentness",
									occurrence,
									evaluatedThroughRevision: highWater,
									state: "unverifiable",
									missingRevision: highWater + 1,
									gapRef: {
										revisionDomain: occurrence.revisionDomain,
										afterRevision: highWater,
										beforeRevision: occurrence.revision,
										reason: "skipped-revision",
									},
								},
							});
							outputs.push({
								kind: "coverage",
								value: {
									kind: "causal-evidence-coverage",
									occurrence,
									complete: false,
									entries: Object.freeze([
										{
											occurrence,
											evidenceKind: "revision-sequence",
											evidenceId: `${occurrence.revisionDomain}/${occurrence.revision}`,
											evidenceDigest: occurrence.digest,
											coverage: "skipped-revision",
										},
									]),
									missingKinds: Object.freeze([...opts.requiredEvidenceKinds]),
									terminalGapKinds: Object.freeze(["revision-sequence"]),
								},
							});
							continue;
						}
						if (!acceptOccurrence(entry)) {
							if (state.pending.size < opts.maxPending) state.pending.set(domainKey, entry);
							continue;
						}
						for (;;) {
							const nextRevision =
								(state.highWaterByDomain.get(occurrence.revisionDomain) ?? 0) + 1;
							const pending = state.pending.get(
								revisionKey(occurrence.revisionDomain, nextRevision),
							);
							if (pending === undefined) break;
							if (!acceptOccurrence(pending)) break;
							state.pending.delete(revisionKey(occurrence.revisionDomain, nextRevision));
						}
					}
				} else if (arrival.lane === "admissions") {
					for (const admission of arrival.values) {
						if (
							admission === null ||
							typeof admission !== "object" ||
							!validRef(admission.occurrence) ||
							!validToken(admission.decisionId) ||
							typeof admission.decisionDigest !== "string" ||
							!digestPattern.test(admission.decisionDigest) ||
							!validAdmissionState(admission.state)
						) {
							emitIssue(
								issue(
									"causal-occurrence/invalid-admission",
									"Occurrence admission identity is invalid.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(admission);
						if (canonical === undefined) {
							emitIssue(
								issue("causal-occurrence/non-data-admission", "Admission must be canonical DATA."),
							);
							continue;
						}
						const key = refKey(admission.occurrence);
						const prior = state.admissions.get(key);
						if (prior !== undefined) {
							if (dataKey(prior) !== canonical.key)
								emitIssue(
									issue(
										"causal-occurrence/admission-conflict",
										"Admission replay conflicts with retained decision.",
										[key],
									),
								);
							continue;
						}
						const retained = findOccurrence(admission.occurrence);
						if (retained !== undefined && !sameRef(retained, admission.occurrence)) {
							emitIssue(
								issue(
									"causal-occurrence/admission-mismatch",
									"Admission does not match the retained occurrence.",
									[key],
								),
							);
							continue;
						}
						if (retained === undefined && state.admissions.size >= opts.maxPending) {
							emitIssue(
								issue(
									"causal-occurrence/admission-bound",
									"Unmatched admission exceeded bounded pending retention.",
									[key],
								),
							);
							continue;
						}
						state.admissions.set(key, canonical.snapshot);
					}
				} else if (arrival.lane === "branch-terminals") {
					for (const terminal of arrival.values) {
						if (
							terminal === null ||
							typeof terminal !== "object" ||
							!validRef(terminal.occurrence) ||
							!validToken(terminal.branch) ||
							!opts.requiredBranches.includes(terminal.branch) ||
							!validTerminal(terminal)
						) {
							emitIssue(
								issue(
									"causal-occurrence/terminal-mismatch",
									"Terminal does not match an admitted branch occurrence.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(terminal);
						if (canonical === undefined) {
							emitIssue(
								issue("causal-occurrence/non-data-terminal", "Terminal must be canonical DATA."),
							);
							continue;
						}
						const key = refKey(terminal.occurrence);
						const pendingKey = canonicalTupleKey([key, terminal.branch]);
						if (
							exactOccurrence(terminal.occurrence) === undefined &&
							rejectDefinitiveMissingRef(terminal.occurrence, "terminal")
						)
							continue;
						if (exactOccurrence(terminal.occurrence) === undefined || !state.released.has(key)) {
							retainPending(state.pendingTerminals, pendingKey, canonical.snapshot, "terminal");
							continue;
						}
						const branches = state.terminals.get(key) ?? new Map<string, CausalBranchTerminal>();
						const prior = branches.get(terminal.branch);
						if (prior !== undefined && dataKey(prior) !== canonical.key)
							emitIssue(
								issue(
									"causal-occurrence/terminal-conflict",
									"Branch terminal replay conflicts with retained terminal.",
									[key, terminal.branch],
								),
							);
						else if (prior === undefined) branches.set(terminal.branch, canonical.snapshot);
						state.terminals.set(key, branches);
						if (
							!state.emittedTerminals.has(key) &&
							opts.requiredBranches.every((branch) => branches.has(branch))
						) {
							state.emittedTerminals.add(key);
							outputs.push({
								kind: "terminal",
								value: {
									kind: "causal-terminal-fan-in",
									occurrence: terminal.occurrence,
									terminals: Object.freeze(
										opts.requiredBranches.map((branch) => branches.get(branch)!),
									),
								},
							});
						}
					}
				} else if (arrival.lane === "effect-proposals") {
					for (const proposal of arrival.values) {
						if (
							proposal === null ||
							typeof proposal !== "object" ||
							!validRef(proposal.occurrence) ||
							!validToken(proposal.effectId) ||
							!validSourceRef(proposal.requestRef) ||
							typeof proposal.proposalDigest !== "string" ||
							!digestPattern.test(proposal.proposalDigest)
						) {
							emitIssue(
								issue(
									"causal-occurrence/effect-proposal-mismatch",
									"Effect proposal lacks exact occurrence authority.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(proposal);
						if (canonical === undefined) {
							emitIssue(
								issue(
									"causal-occurrence/non-data-effect-proposal",
									"Effect proposal must be canonical DATA.",
								),
							);
							continue;
						}
						const key = effectKey(proposal);
						if (
							exactOccurrence(proposal.occurrence) === undefined &&
							rejectDefinitiveMissingRef(proposal.occurrence, "effect-proposal")
						)
							continue;
						if (
							exactOccurrence(proposal.occurrence) === undefined ||
							!state.released.has(refKey(proposal.occurrence))
						) {
							retainPending(
								state.pendingEffectProposals,
								key,
								canonical.snapshot,
								"effect-proposal",
							);
							continue;
						}
						const prior = state.effects.get(key);
						if (prior !== undefined) {
							if (prior.key !== canonical.key)
								emitIssue(
									issue(
										"causal-occurrence/effect-proposal-conflict",
										"Effect proposal replay conflicts.",
										[key],
									),
								);
							continue;
						}
						if (state.effects.size >= opts.maxEffects) {
							emitIssue(
								issue("causal-occurrence/effect-bound", "Effect retention bound was reached.", [
									key,
								]),
							);
							continue;
						}
						state.effects.set(key, {
							proposal: canonical.snapshot,
							key: canonical.key,
						});
						emitConservation(proposal.occurrence);
					}
				} else if (arrival.lane === "effect-admissions") {
					for (const admission of arrival.values) {
						if (
							admission === null ||
							typeof admission !== "object" ||
							!validRef(admission.occurrence) ||
							!validToken(admission.effectId) ||
							!validSourceRef(admission.requestRef) ||
							!validSourceRef(admission.admissionRef) ||
							typeof admission.proposalDigest !== "string" ||
							!digestPattern.test(admission.proposalDigest) ||
							!validAdmissionState(admission.state)
						) {
							emitIssue(
								issue(
									"causal-occurrence/invalid-effect-admission",
									"Effect admission identity or state is invalid.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(admission);
						if (canonical === undefined) {
							emitIssue(
								issue(
									"causal-occurrence/non-data-effect-admission",
									"Effect admission must be canonical DATA.",
								),
							);
							continue;
						}
						const key = effectKey(admission);
						const record = state.effects.get(key);
						if (record === undefined) {
							if (rejectDefinitiveMissingRef(admission.occurrence, "effect-admission")) continue;
							retainPending(
								state.pendingEffectAdmissions,
								key,
								canonical.snapshot,
								"effect-admission",
							);
							continue;
						}
						if (
							record.proposal.proposalDigest !== admission.proposalDigest ||
							dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) ||
							!sameRef(record.proposal.occurrence, admission.occurrence)
						) {
							emitIssue(
								issue(
									"causal-occurrence/effect-admission-mismatch",
									"Effect admission has no exact proposal.",
									[key],
								),
							);
							continue;
						}
						if (record.admission !== undefined) {
							if (dataKey(record.admission) !== canonical.key)
								emitIssue(
									issue(
										"causal-occurrence/effect-admission-conflict",
										"Effect admission replay conflicts.",
										[key],
									),
								);
							continue;
						}
						state.effects.set(key, { ...record, admission: canonical.snapshot });
						emitConservation(admission.occurrence);
					}
				} else if (arrival.lane === "effect-outcomes") {
					for (const outcome of arrival.values) {
						if (
							outcome === null ||
							typeof outcome !== "object" ||
							!validRef(outcome.occurrence) ||
							!validToken(outcome.effectId) ||
							!validSourceRef(outcome.requestRef) ||
							!validSourceRef(outcome.admissionRef) ||
							typeof outcome.proposalDigest !== "string" ||
							!digestPattern.test(outcome.proposalDigest) ||
							!validOutcomeState(outcome.state) ||
							!validResult(outcome.result)
						) {
							emitIssue(
								issue(
									"causal-occurrence/invalid-effect-outcome",
									"Effect outcome identity, state, or D184 result is invalid.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(outcome);
						if (canonical === undefined) {
							emitIssue(
								issue(
									"causal-occurrence/non-data-effect-outcome",
									"Effect outcome must be canonical DATA.",
								),
							);
							continue;
						}
						const key = effectKey(outcome);
						const record = state.effects.get(key);
						if (record === undefined || record.admission === undefined) {
							if (rejectDefinitiveMissingRef(outcome.occurrence, "effect-outcome")) continue;
							retainPending(state.pendingEffectOutcomes, key, canonical.snapshot, "effect-outcome");
							continue;
						}
						const resultMatchesState =
							validResult(outcome.result) &&
							(outcome.state === "succeeded") === (outcome.result.kind === "ok");
						if (
							record.admission.state !== "admitted" ||
							record.proposal.proposalDigest !== outcome.proposalDigest ||
							dataKey(record.proposal.requestRef) !== dataKey(canonical.snapshot.requestRef) ||
							dataKey(record.admission.admissionRef) !== dataKey(canonical.snapshot.admissionRef) ||
							!sameRef(record.proposal.occurrence, outcome.occurrence) ||
							!resultMatchesState
						) {
							emitIssue(
								issue(
									"causal-occurrence/effect-outcome-mismatch",
									"Effect outcome requires exact admitted authority and a D184 result matching its state.",
									[key],
								),
							);
							continue;
						}
						if (record.outcome !== undefined) {
							if (dataKey(record.outcome) !== canonical.key)
								emitIssue(
									issue(
										"causal-occurrence/effect-outcome-conflict",
										"Effect outcome replay conflicts.",
										[key],
									),
								);
							continue;
						}
						state.effects.set(key, { ...record, outcome: canonical.snapshot });
						emitConservation(outcome.occurrence);
					}
				} else if (arrival.lane === "evidence") {
					for (const evidence of arrival.values) {
						if (
							evidence === null ||
							typeof evidence !== "object" ||
							!validRef(evidence.occurrence) ||
							!validToken(evidence.evidenceKind) ||
							!validToken(evidence.evidenceId) ||
							typeof evidence.evidenceDigest !== "string" ||
							!digestPattern.test(evidence.evidenceDigest) ||
							!terminalCoverage.has(evidence.coverage) ||
							(evidence.coverage === "external-only" &&
								(!Array.isArray(evidence.refs) ||
									evidence.refs.length === 0 ||
									!evidence.refs.every(validToken)))
						) {
							emitIssue(
								issue(
									"causal-occurrence/evidence-mismatch",
									"Evidence does not match retained occurrence authority.",
								),
							);
							continue;
						}
						const canonical = canonicalEntry(evidence);
						if (canonical === undefined) {
							emitIssue(
								issue("causal-occurrence/non-data-evidence", "Evidence must be canonical DATA."),
							);
							continue;
						}
						const key = canonicalTupleKey([
							refKey(evidence.occurrence),
							evidence.evidenceKind,
							evidence.evidenceId,
						]);
						if (exactOccurrence(evidence.occurrence) === undefined) {
							if (rejectDefinitiveMissingRef(evidence.occurrence, "evidence")) continue;
							retainPending(state.pendingEvidence, key, canonical.snapshot, "evidence");
							continue;
						}
						const prior = state.evidence.get(key);
						if (prior !== undefined) {
							if (dataKey(prior) !== canonical.key)
								emitIssue(
									issue("causal-occurrence/evidence-conflict", "Evidence replay conflicts.", [key]),
								);
							continue;
						}
						if (state.evidence.size >= opts.maxEvidence) {
							emitIssue(
								issue("causal-occurrence/evidence-bound", "Evidence retention bound was reached.", [
									key,
								]),
							);
							const entries = [...state.evidence.values()].filter((entry) =>
								sameRef(entry.occurrence, evidence.occurrence),
							);
							const gap = canonicalSnapshot({ ...evidence, coverage: "retention-gap" as const });
							if (state.coverageGaps.size < opts.maxPending) state.coverageGaps.set(key, gap);
							outputs.push({
								kind: "coverage",
								value: {
									kind: "causal-evidence-coverage",
									occurrence: evidence.occurrence,
									complete: false,
									entries: Object.freeze([...entries, gap]),
									missingKinds: Object.freeze(
										opts.requiredEvidenceKinds.filter(
											(kind) =>
												kind !== evidence.evidenceKind &&
												!entries.some((entry) => entry.evidenceKind === kind),
										),
									),
									terminalGapKinds: Object.freeze([evidence.evidenceKind]),
								},
							});
							continue;
						}
						state.evidence.set(key, canonical.snapshot);
						emitCoverage(evidence.occurrence);
					}
				} else {
					for (const watermark of arrival.values) {
						if (
							watermark === null ||
							typeof watermark !== "object" ||
							!validToken(watermark.revisionDomain) ||
							!Number.isSafeInteger(watermark.revision) ||
							watermark.revision < 0
						) {
							emitIssue(issue("causal-occurrence/invalid-watermark", "Watermark is invalid."));
							continue;
						}
						const prior = state.watermarks.get(watermark.revisionDomain) ?? 0;
						if (watermark.revision < prior) {
							emitIssue(
								issue("causal-occurrence/stale-watermark", "Watermark cannot move backwards."),
							);
							continue;
						}
						state.watermarks.set(watermark.revisionDomain, watermark.revision);
					}
				}
			}
			for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
			flushPending();
			for (const revisionDomain of state.watermarks.keys()) recomputeDomain(revisionDomain);
			ctx.state.set(state);
			// Each fact is an independent wave. In particular, each admitted occurrence
			// becomes one fresh lifecycle after the pull-quiet boundary below.
			for (const output of outputs) ctx.down([["DATA", Object.freeze(output)]]);
		},
		{
			name: `${opts.name}/authority`,
			factory: "causalOccurrenceAuthority",
			completeWhenDepsComplete: false,
			errorWhenDepsError: true,
		},
	);

	const rawRelease = projectFact(
		graph,
		authority,
		`${opts.name}/release-candidates`,
		"release",
		opts.maxOccurrences,
	);
	const pullId = Symbol(`${opts.name}/release`);
	const quietPort = graph.node<CausalOccurrence<T>>(
		[rawRelease],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/release-port`,
			factory: "causalOccurrenceQuietReleasePort",
			pullId,
			pausable: "resumeAll",
		},
	);
	const released = graph.node<CausalOccurrence<T>>(
		[quietPort],
		(ctx) => {
			const values = depBatch(ctx, 0) ?? [];
			if (values.length > 0) ctx.down(values.map((value) => ["DATA", value]));
		},
		{
			name: `${opts.name}/released`,
			factory: "causalOccurrenceReleased",
			replayBuffer: opts.maxOccurrences,
		},
	);
	const releaseEvents = graph.initNode(merge<CausalOccurrence<T>>(), [released, rawRelease], {
		name: `${opts.name}/release-events`,
	});
	const releaseController = graph.node(
		[releaseEvents],
		(ctx) => {
			if ((depBatch(ctx, 0) ?? []).length > 0) ctx.upNext([["PULL", { pullId }]]);
		},
		{ name: `${opts.name}/release-controller`, factory: "causalOccurrenceReleaseController" },
	);
	graph.retain(releaseController, { reason: `${opts.name} owns admitted occurrence release` });

	const result = {
		released,
		currentness: projectFact(
			graph,
			authority,
			`${opts.name}/currentness`,
			"currentness",
			opts.maxOccurrences,
		),
		terminals: projectFact(
			graph,
			authority,
			`${opts.name}/terminals`,
			"terminal",
			opts.maxOccurrences,
		),
		conservation: projectFact(
			graph,
			authority,
			`${opts.name}/conservation`,
			"conservation",
			opts.maxEffects,
		),
		coverage: projectFact(graph, authority, `${opts.name}/coverage`, "coverage", opts.maxEvidence),
		quiescence: projectFact(
			graph,
			authority,
			`${opts.name}/quiescence`,
			"quiescence",
			opts.maxOccurrences,
		),
		issues: projectFact(graph, authority, `${opts.name}/issues`, "issue", opts.maxPending),
	};
	assertCausalOccurrenceTopology(graph.describe(), opts.name);
	return Object.freeze(result);
}

export function causalOccurrenceRequiredEdges(
	name: string,
	description?: Readonly<{
		readonly edges: readonly Readonly<{ from: string; to: string }>[];
	}>,
): readonly Readonly<{ from: string; to: string }>[] {
	const internal = [
		{ from: `${name}/input/occurrences`, to: `${name}/arrivals` },
		{ from: `${name}/input/admissions`, to: `${name}/arrivals` },
		{ from: `${name}/input/branch-terminals`, to: `${name}/arrivals` },
		{ from: `${name}/input/effect-proposals`, to: `${name}/arrivals` },
		{ from: `${name}/input/effect-admissions`, to: `${name}/arrivals` },
		{ from: `${name}/input/effect-outcomes`, to: `${name}/arrivals` },
		{ from: `${name}/input/evidence`, to: `${name}/arrivals` },
		{ from: `${name}/input/watermarks`, to: `${name}/arrivals` },
		{ from: `${name}/arrivals`, to: `${name}/authority` },
		{ from: `${name}/authority`, to: `${name}/release-candidates` },
		{ from: `${name}/release-candidates`, to: `${name}/release-port` },
		{ from: `${name}/release-port`, to: `${name}/released` },
		{ from: `${name}/release-candidates`, to: `${name}/release-events` },
		{ from: `${name}/released`, to: `${name}/release-events` },
		{ from: `${name}/release-events`, to: `${name}/release-controller` },
		{ from: `${name}/authority`, to: `${name}/currentness` },
		{ from: `${name}/authority`, to: `${name}/terminals` },
		{ from: `${name}/authority`, to: `${name}/conservation` },
		{ from: `${name}/authority`, to: `${name}/coverage` },
		{ from: `${name}/authority`, to: `${name}/quiescence` },
		{ from: `${name}/authority`, to: `${name}/issues` },
	];
	const inputLanes = [
		"occurrences",
		"admissions",
		"branch-terminals",
		"effect-proposals",
		"effect-admissions",
		"effect-outcomes",
		"evidence",
		"watermarks",
	];
	const sources =
		description === undefined
			? []
			: inputLanes.flatMap((laneName) =>
					description.edges.filter((edge) => edge.to === `${name}/input/${laneName}`),
				);
	return Object.freeze([...sources, ...internal]);
}

export function assertCausalOccurrenceTopology(
	description: Readonly<{ readonly edges: readonly Readonly<{ from: string; to: string }>[] }>,
	name: string,
): void {
	const actual = new Set(description.edges.map((edge) => canonicalTupleKey([edge.from, edge.to])));
	for (const laneName of [
		"occurrences",
		"admissions",
		"branch-terminals",
		"effect-proposals",
		"effect-admissions",
		"effect-outcomes",
		"evidence",
		"watermarks",
	]) {
		if (!description.edges.some((edge) => edge.to === `${name}/input/${laneName}`))
			throw new TypeError(`causal occurrence topology missing source edge into ${laneName}`);
	}
	for (const edge of causalOccurrenceRequiredEdges(name, description)) {
		if (!actual.has(canonicalTupleKey([edge.from, edge.to])))
			throw new TypeError(
				`causal occurrence topology missing required edge ${edge.from} -> ${edge.to}`,
			);
	}
}
