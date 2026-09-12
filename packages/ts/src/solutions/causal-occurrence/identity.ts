import type { DataIssue, DataResult } from "../../data/index.js";
import { canonicalTupleKey } from "../../identity.js";
import { stableJsonString } from "../../json/codec.js";
import type {
	Arrival,
	AuthorityFact,
	CausalBranchTerminal,
	CausalCurrentness,
	CausalEffectOutcomeState,
	CausalEvidenceCoverageState,
	CausalOccurrence,
	CausalOccurrenceAdmission,
	CausalOccurrenceRef,
	CausalSourceRef,
	IdentityDomain,
	TransitionOptions,
} from "./contracts.js";

export const digestPattern = /^sha256:[0-9a-f]{64}$/u;
export const CAUSAL_OCCURRENCE_SCHEMA_REVISION =
	"graphrefly/causal-occurrence-contract/v1@contract-v2";
export const terminalCoverage = new Set<CausalEvidenceCoverageState>([
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

export function issue(code: string, message: string, refs: readonly string[] = []): DataIssue {
	return Object.freeze({ kind: "issue", code, message, severity: "error", refs });
}

export function dataKey(value: unknown): string {
	return stableJsonString(value);
}

export const sha256Constants = Object.freeze([
	0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
	0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
	0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
	0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
	0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
	0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
	0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
	0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

export function rotateRight(value: number, count: number): number {
	return (value >>> count) | (value << (32 - count));
}

export function sha256(value: string): string {
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

export function canonicalSnapshot<T>(value: T): T {
	const freeze = (item: unknown): unknown => {
		if (item === null || typeof item !== "object") return item;
		if (Array.isArray(item)) return Object.freeze(item.map(freeze));
		return Object.freeze(
			Object.fromEntries(Object.entries(item).map(([key, child]) => [key, freeze(child)])),
		);
	};
	return freeze(JSON.parse(dataKey(value))) as T;
}

export function canonicalEntry<T>(value: T): Readonly<{ key: string; snapshot: T }> | undefined {
	try {
		return Object.freeze({ key: dataKey(value), snapshot: canonicalSnapshot(value) });
	} catch {
		return undefined;
	}
}

export function refKey(value: CausalOccurrenceRef): string {
	return canonicalTupleKey([
		value.revisionDomain,
		String(value.revision),
		value.occurrenceId,
		value.digest,
		dataKey(value.sourceRefs),
	]);
}

export function occurrenceIdKey(value: CausalOccurrenceRef): string {
	return canonicalTupleKey([value.revisionDomain, value.occurrenceId]);
}

export function revisionKey(domain: string, revision: number): string {
	return canonicalTupleKey([domain, String(revision)]);
}

export function effectKey(value: { occurrence: CausalOccurrenceRef; effectId: string }): string {
	return canonicalTupleKey([refKey(value.occurrence), value.effectId]);
}

export function validToken(value: unknown): value is string {
	return typeof value === "string" && value.length > 0;
}

export function validSourceRef(value: unknown): value is CausalSourceRef {
	return (
		value !== null &&
		typeof value === "object" &&
		"kind" in value &&
		validToken(value.kind) &&
		"id" in value &&
		validToken(value.id)
	);
}

export function validRef(value: unknown): value is CausalOccurrenceRef {
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

export function validAdmissionState(value: unknown): value is CausalOccurrenceAdmission["state"] {
	return value === "admitted" || value === "rejected";
}

export function validOutcomeState(value: unknown): value is CausalEffectOutcomeState {
	return (
		value === "succeeded" ||
		value === "failed" ||
		value === "cancelled" ||
		value === "reconcile-required" ||
		value === "unknown"
	);
}

export function validTerminal(value: CausalBranchTerminal): boolean {
	return (
		(value.state === "completed" || value.state === "failed" || value.state === "skipped") &&
		validResult(value.result) &&
		(value.state === "completed") === (value.result.kind === "ok")
	);
}

export function sameRef(left: CausalOccurrenceRef, right: CausalOccurrenceRef): boolean {
	return (
		refKey(left) === refKey(right) &&
		left.digest === right.digest &&
		dataKey(left.sourceRefs) === dataKey(right.sourceRefs)
	);
}

export function validResult(value: DataResult<unknown>): boolean {
	if (value === null || typeof value !== "object") return false;
	if (value.kind === "ok") return Object.hasOwn(value, "value");
	return (
		value.kind === "error" &&
		value.error?.kind === "issue" &&
		validToken(value.error.code) &&
		validToken(value.error.message)
	);
}

export function pushIssue<T>(outputs: AuthorityFact<T>[], value: DataIssue): void {
	outputs.push({ kind: "issue", value });
}
export const retainPending = <T, V>(
	opts: TransitionOptions,
	outputs: AuthorityFact<T>[],
	map: Map<string, V>,
	key: string,
	value: V,
	label: string,
) => {
	const prior = map.get(key);
	if (prior !== undefined) {
		if (dataKey(prior) !== dataKey(value))
			pushIssue(
				outputs,
				issue(
					`causal-occurrence/${label}-conflict`,
					`Pending ${label} replay conflicts with retained DATA.`,
					[key],
				),
			);
		return;
	}
	if (map.size >= opts.maxPending) {
		pushIssue(
			outputs,
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

import type { TransitionContext } from "./contracts.js";

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function retainDomain<T>(context: TransitionContext<T>, domain: string): boolean {
	const { state, opts, outputs } = context;

	if (state.domains.has(domain)) return true;
	if (state.domains.size >= opts.maxOccurrences) {
		pushIssue(
			outputs,
			issue("causal-occurrence/domain-bound", "Revision-domain retention bound was reached.", [
				domain,
			]),
		);
		return false;
	}
	state.domains.add(domain);
	return true;
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function findOccurrence<T>(context: TransitionContext<T>, ref: CausalOccurrenceRef) {
	const { state } = context;
	return state.byRevision.get(revisionKey(ref.revisionDomain, ref.revision))?.value;
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function exactOccurrence<T>(context: TransitionContext<T>, ref: CausalOccurrenceRef) {
	const retained = findOccurrence(context, ref);
	return retained !== undefined && sameRef(retained, ref) ? retained : undefined;
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function rejectDefinitiveMissingRef<T>(
	context: TransitionContext<T>,
	ref: CausalOccurrenceRef,
	label: string,
) {
	const { state, outputs } = context;

	const retained = findOccurrence(context, ref);
	const floor = state.retentionFloorByDomain.get(ref.revisionDomain) ?? 0;
	const highWater = state.highWaterByDomain.get(ref.revisionDomain) ?? 0;
	if (retained !== undefined && !sameRef(retained, ref)) {
		pushIssue(
			outputs,
			issue(
				`causal-occurrence/${label}-occurrence-conflict`,
				`${label} references a conflicting occurrence revision.`,
				[refKey(ref)],
			),
		);
		return true;
	}
	if (ref.revision <= floor || (ref.revision <= highWater && retained === undefined)) {
		pushIssue(
			outputs,
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
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function maybeRelease<T>(context: TransitionContext<T>, occurrence: CausalOccurrence<T>) {
	const { state, outputs } = context;

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
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function exactAdmission<T>(context: TransitionContext<T>, occurrence: CausalOccurrence<T>) {
	const { state } = context;

	const admission = state.admissions.get(refKey(occurrence));
	return admission !== undefined && sameRef(admission.occurrence, occurrence)
		? admission
		: undefined;
}

// This call site receives a canonicalSnapshot-owned occurrence, not arbitrary DATA.
// cloneState preserves retained entry identities; a future state importer must re-establish
// this provenance. A shallow Object.freeze check alone is not a canonical-data proof.
function currentnessMetadata(value: CausalCurrentness, occurrence: CausalOccurrenceRef) {
	if (
		value === null ||
		typeof value !== "object" ||
		Object.getPrototypeOf(value) !== Object.prototype
	)
		return;
	const keys = Reflect.ownKeys(value);
	if (
		keys.length !== 4 ||
		!keys.every(
			(key) =>
				key === "kind" ||
				key === "occurrence" ||
				key === "evaluatedThroughRevision" ||
				key === "state",
		)
	)
		return;
	const fields = Object.getOwnPropertyDescriptors(value);
	for (const key of keys) {
		const field = fields[key as keyof typeof fields];
		if (field === undefined || !("value" in field) || !field.enumerable) return;
	}
	if (
		fields.kind.value !== "causal-currentness" ||
		fields.occurrence.value !== occurrence ||
		typeof fields.evaluatedThroughRevision.value !== "number" ||
		!Number.isSafeInteger(fields.evaluatedThroughRevision.value) ||
		fields.evaluatedThroughRevision.value < 0 ||
		(fields.state.value !== "current" && fields.state.value !== "stale")
	)
		return;
	return {
		kind: fields.kind.value,
		occurrence: null,
		evaluatedThroughRevision: fields.evaluatedThroughRevision.value,
		state: fields.state.value,
	};
}

function currentnessChanged(
	prior: CausalCurrentness,
	value: CausalCurrentness,
	occurrence: CausalOccurrenceRef,
): boolean {
	if (Object.isFrozen(occurrence)) {
		const before = currentnessMetadata(prior, occurrence);
		const after = currentnessMetadata(value, occurrence);
		if (before !== undefined && after !== undefined) return dataKey(before) !== dataKey(after);
	}
	return dataKey(prior) !== dataKey(value);
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function recomputeCurrentness<T>(
	context: TransitionContext<T>,
	revisionDomain: string,
): IdentityDomain<T> | undefined {
	const { state, outputs } = context;

	const watermark = state.watermarks.get(revisionDomain);
	if (watermark === undefined) return;
	const floor = state.retentionFloorByDomain.get(revisionDomain) ?? 0;
	const occurrences = [...state.byRevision.values()]
		.map((entry) => entry.value)
		.filter((value) => value.revisionDomain === revisionDomain && value.revision <= watermark)
		.sort((left, right) => left.revision - right.revision);
	const sequenceComplete =
		(state.highWaterByDomain.get(revisionDomain) ?? 0) >= watermark &&
		(state.retentionGapThroughByDomain.get(revisionDomain) ?? 0) === 0 &&
		![...state.pending.values()].some(
			(entry) => entry.value.revisionDomain === revisionDomain && entry.value.revision <= watermark,
		) &&
		occurrences
			.filter((occurrence) => occurrence.revision > floor)
			.every((occurrence) => exactAdmission(context, occurrence) !== undefined);
	const latestAdmitted = new Map<string, CausalOccurrence<T>>();
	for (const occurrence of occurrences) {
		if (exactAdmission(context, occurrence)?.state === "admitted")
			latestAdmitted.set(occurrenceIdKey(occurrence), occurrence);
	}
	for (const occurrence of occurrences) {
		const admission = exactAdmission(context, occurrence);
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
		if (prior === undefined || currentnessChanged(prior, value, occurrence))
			outputs.push({ kind: "currentness", value });
		maybeRelease(context, occurrence);
	}
	return { watermark, occurrences, sequenceComplete, latestAdmitted };
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function flushAdmissions<T>(context: TransitionContext<T>) {
	const { state, outputs } = context;

	for (const [key, admission] of state.admissions) {
		const retained = findOccurrence(context, admission.occurrence);
		if (retained !== undefined && !sameRef(retained, admission.occurrence)) {
			pushIssue(
				outputs,
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
			rejectDefinitiveMissingRef(context, admission.occurrence, "admission")
		)
			state.admissions.delete(key);
	}
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function receiveAdmissions<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "admissions" }>,
) {
	const { state, opts, outputs } = context;

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
			pushIssue(
				outputs,
				issue("causal-occurrence/invalid-admission", "Occurrence admission identity is invalid."),
			);
			continue;
		}
		const canonical = canonicalEntry(admission);
		if (canonical === undefined) {
			pushIssue(
				outputs,
				issue("causal-occurrence/non-data-admission", "Admission must be canonical DATA."),
			);
			continue;
		}
		if (!retainDomain(context, admission.occurrence.revisionDomain)) continue;
		const key = refKey(admission.occurrence);
		const prior = state.admissions.get(key);
		if (prior !== undefined) {
			if (dataKey(prior) !== canonical.key)
				pushIssue(
					outputs,
					issue(
						"causal-occurrence/admission-conflict",
						"Admission replay conflicts with retained decision.",
						[key],
					),
				);
			continue;
		}
		const retained = findOccurrence(context, admission.occurrence);
		if (retained !== undefined && !sameRef(retained, admission.occurrence)) {
			pushIssue(
				outputs,
				issue(
					"causal-occurrence/admission-mismatch",
					"Admission does not match the retained occurrence.",
					[key],
				),
			);
			continue;
		}
		if (retained === undefined && state.admissions.size >= opts.maxPending) {
			pushIssue(
				outputs,
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
}

/** D160: fixed identity transition helper; no graph control or retained closure. */
export function receiveWatermarks<T>(
	context: TransitionContext<T>,
	arrival: Extract<Arrival<T>, { lane: "watermarks" }>,
) {
	const { state, outputs } = context;

	for (const watermark of arrival.values) {
		if (
			watermark === null ||
			typeof watermark !== "object" ||
			!validToken(watermark.revisionDomain) ||
			!Number.isSafeInteger(watermark.revision) ||
			watermark.revision < 0
		) {
			pushIssue(outputs, issue("causal-occurrence/invalid-watermark", "Watermark is invalid."));
			continue;
		}
		if (!retainDomain(context, watermark.revisionDomain)) continue;
		const prior = state.watermarks.get(watermark.revisionDomain) ?? 0;
		if (watermark.revision < prior) {
			pushIssue(
				outputs,
				issue("causal-occurrence/stale-watermark", "Watermark cannot move backwards."),
			);
			continue;
		}
		state.watermarks.set(watermark.revisionDomain, watermark.revision);
	}
}
