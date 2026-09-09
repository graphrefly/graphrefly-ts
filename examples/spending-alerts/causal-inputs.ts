/** D164: private, bounded passive input formats. A fixture fact is never a host capability. */
import type { DataIssue } from "../../packages/ts/src/data/index.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type {
	CausalEffectOutcome,
	CausalOccurrenceRef,
	CausalSourceRef,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import { canonicalMaterial, type MaterialProfile, materialDigest } from "./causal-publication.js";
import type { Transaction, UserProfile } from "./pipeline.js";

export const VERIFIER_REVISION = "spending-oracle-v1";
export const NUMERIC_DOMAIN = "spending-finite-v1";
export interface SpendingBinding extends MaterialProfile {
	readonly runRef: string;
	readonly evidenceMode: "fixture-observations";
}
export interface SpendingPolicy {
	readonly zThreshold: number;
	readonly dailyRatioThreshold: number;
}
export interface Evaluation {
	readonly evaluationRef: string;
	readonly subjectRef: string;
	readonly occurrence: CausalOccurrenceRef;
	readonly inputDigest: string;
	readonly profileRef: CausalSourceRef;
	readonly profile: UserProfile;
	readonly policyRef: CausalSourceRef;
	readonly policyDigest: string;
	readonly policy: SpendingPolicy;
	readonly prefix: readonly Transaction[];
}
export interface EvaluationPack {
	readonly format: "spending-input-v1";
	readonly binding: SpendingBinding;
	readonly evaluations: readonly Evaluation[];
}
export interface ArrivalFrame {
	readonly packRef: CausalSourceRef;
	readonly evaluationRefs: readonly string[];
}
export interface CurrentFact {
	readonly revisionDomain: string;
	readonly occurrence: CausalOccurrenceRef;
	readonly policyRef: CausalSourceRef;
	readonly policyDigest: string;
	readonly watermark: number;
}
export interface CurrentFrame {
	readonly binding: SpendingBinding;
	readonly current: readonly CurrentFact[];
}
export interface VerificationReceipt {
	readonly receiptRef: CausalSourceRef;
	readonly issuerRef: CausalSourceRef;
	readonly verifierRevision: string;
	readonly occurrence: CausalOccurrenceRef;
	readonly inputDigest: string;
	readonly policyDigest: string;
	readonly sourceDigest: string;
	readonly runtimeDigest: string;
	readonly requestDigest: string;
	readonly numericDomainRef: string;
	readonly verdict: "pass" | "fail" | "unavailable";
	readonly artifactRef: CausalSourceRef;
	readonly artifactDigest: string;
}
export interface VerificationFrame {
	readonly binding: SpendingBinding;
	readonly receipts: readonly VerificationReceipt[];
}
export interface LocalGrant {
	readonly grantRef: CausalSourceRef;
	readonly ownerRef: CausalSourceRef;
	readonly operation: "append-alert";
	readonly occurrence: CausalOccurrenceRef;
	readonly requestDigest: string;
	readonly destinationRef: CausalSourceRef;
	readonly hostEpoch: number;
	readonly validFrom: number;
	readonly validThrough: number;
	readonly maxWrites: number;
	readonly replayScope: { readonly compositionEpoch: number; readonly hostEpoch: number };
	readonly revoked: boolean;
}
export interface LocalAuthorityFrame {
	readonly binding: SpendingBinding;
	readonly tick: number;
	readonly stop: boolean;
	readonly grants: readonly LocalGrant[];
}
export interface InboxObservationFrame {
	readonly binding: SpendingBinding;
	readonly issuerRef: CausalSourceRef;
	readonly artifactRef: CausalSourceRef;
	readonly artifactDigest: string;
	readonly readiness: {
		readonly ready: boolean;
		readonly observedAt: number;
		readonly validThrough: number;
		readonly availableSlots: number;
	};
	readonly outcomes: readonly CausalEffectOutcome[];
}
export interface SpendingInputs {
	readonly evaluations: {
		readonly pack: Node<EvaluationPack>;
		readonly arrivals: Node<ArrivalFrame>;
		readonly current: Node<CurrentFrame>;
	};
	readonly verification: { readonly receipts: Node<VerificationFrame> };
	readonly localAuthority: { readonly facts: Node<LocalAuthorityFrame> };
	readonly inbox: { readonly facts: Node<InboxObservationFrame> };
}
export type Checked<T> =
	| Readonly<{ valid: true; value: T }>
	| Readonly<{ valid: false; issue: DataIssue }>;
export function frozen<T>(v: T): T {
	if (v && typeof v === "object" && !Object.isFrozen(v)) {
		for (const child of Object.values(v)) frozen(child);
		Object.freeze(v);
	}
	return v;
}
export function issue(code: string, subjectId?: string): DataIssue {
	return Object.freeze({
		kind: "issue",
		code: `spending/${code}`,
		message: code,
		...(subjectId === undefined ? {} : { subjectId }),
	});
}
export function hash(value: unknown): string {
	return materialDigest(canonicalMaterial(value, 4 * 1048576));
}
export function same(a: unknown, b: unknown): boolean {
	return canonicalMaterial(a) === canonicalMaterial(b);
}
export function occurrenceKey(o: CausalOccurrenceRef): string {
	return canonicalMaterial(o);
}
export function inputDigest(e: Pick<Evaluation, "profileRef" | "profile" | "prefix">): string {
	return hash({ profileRef: e.profileRef, profile: e.profile, prefix: e.prefix });
}
export function materialProfile(b: SpendingBinding): MaterialProfile {
	const { packRef, sourceDigest, runtimeDigest, destinationRef, compositionEpoch, hostEpoch } = b;
	return frozen({
		packRef,
		sourceDigest,
		runtimeDigest,
		destinationRef,
		compositionEpoch,
		hostEpoch,
	});
}
function keys(v: unknown, names: string): asserts v is Record<string, unknown> {
	if (
		!v ||
		typeof v !== "object" ||
		Array.isArray(v) ||
		Object.keys(v).sort().join(",") !== names.split(",").sort().join(",")
	)
		throw new TypeError("fields");
}
function str(v: unknown, max = 128): asserts v is string {
	if (typeof v !== "string" || !v.length || Buffer.byteLength(v) > max)
		throw new TypeError("string");
}
function number(v: unknown, max: number, integral = false, min = 0): asserts v is number {
	if (
		typeof v !== "number" ||
		!Number.isFinite(v) ||
		v < min ||
		v > max ||
		(integral && !Number.isSafeInteger(v))
	)
		throw new TypeError("number");
}
function tick(v: unknown) {
	number(v, Number.MAX_SAFE_INTEGER, true);
}
function epoch(v: unknown) {
	number(v, Number.MAX_SAFE_INTEGER, true, 1);
}
function boolean(v: unknown): asserts v is boolean {
	if (typeof v !== "boolean") throw new TypeError("boolean");
}
function digest(v: unknown) {
	if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v)) throw new TypeError("digest");
}
function array(v: unknown, limit = 64): asserts v is unknown[] {
	if (!Array.isArray(v) || v.length > limit) throw new TypeError("array");
}
function ref(v: unknown) {
	keys(v, "kind,id");
	str(v.kind);
	str(v.id);
}
function occurrence(v: unknown) {
	keys(v, "revisionDomain,occurrenceId,revision,digest,sourceRefs");
	str(v.revisionDomain);
	str(v.occurrenceId);
	epoch(v.revision);
	digest(v.digest);
	array(v.sourceRefs);
	if (!v.sourceRefs.length) throw new TypeError("source-refs");
	v.sourceRefs.forEach(ref);
	if (new Set(v.sourceRefs.map((x) => canonicalMaterial(x))).size !== v.sourceRefs.length)
		throw new TypeError("source-refs");
}
function binding(v: unknown) {
	keys(
		v,
		"packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,runRef,evidenceMode",
	);
	ref(v.packRef);
	ref(v.destinationRef);
	digest(v.sourceDigest);
	digest(v.runtimeDigest);
	epoch(v.compositionEpoch);
	epoch(v.hostEpoch);
	str(v.runRef);
	if (v.evidenceMode !== "fixture-observations") throw new TypeError("observation-mode");
}
function profile(v: unknown) {
	keys(v, "dailyAverage,typicalCategories");
	number(v.dailyAverage, 1e9);
	array(v.typicalCategories, 32);
	v.typicalCategories.forEach((x) => {
		str(x, 256);
	});
	if (new Set(v.typicalCategories).size !== v.typicalCategories.length)
		throw new TypeError("categories");
}
function policy(v: unknown) {
	keys(v, "zThreshold,dailyRatioThreshold");
	number(v.zThreshold, 1e6);
	number(v.dailyRatioThreshold, 1e6);
}
function transaction(v: unknown) {
	keys(v, "id,vendor,category,amount,timestampIso");
	str(v.id);
	str(v.vendor, 256);
	str(v.category, 256);
	number(v.amount, 1e9);
	str(v.timestampIso);
	if (
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.timestampIso) ||
		!Number.isFinite(Date.parse(v.timestampIso)) ||
		new Date(v.timestampIso).toISOString() !== v.timestampIso
	)
		throw new TypeError("timestamp");
}
function evaluation(raw: unknown) {
	keys(
		raw,
		"evaluationRef,subjectRef,occurrence,inputDigest,profileRef,profile,policyRef,policyDigest,policy,prefix",
	);
	str(raw.evaluationRef);
	str(raw.subjectRef);
	occurrence(raw.occurrence);
	digest(raw.inputDigest);
	ref(raw.profileRef);
	profile(raw.profile);
	ref(raw.policyRef);
	digest(raw.policyDigest);
	policy(raw.policy);
	array(raw.prefix);
	if (!raw.prefix.length) throw new TypeError("empty-prefix");
	raw.prefix.forEach(transaction);
	const e = raw as unknown as Evaluation;
	if (
		new Set(e.prefix.map((t) => t.id)).size !== e.prefix.length ||
		new Set(e.prefix.map((t) => t.vendor)).size !== 1 ||
		e.inputDigest !== inputDigest(e) ||
		e.policyDigest !== hash(e.policy)
	)
		throw new TypeError("evaluation-binding");
	canonicalMaterial(e, 65536);
}
function receipt(v: unknown) {
	keys(
		v,
		"receiptRef,issuerRef,verifierRevision,occurrence,inputDigest,policyDigest,sourceDigest,runtimeDigest,requestDigest,numericDomainRef,verdict,artifactRef,artifactDigest",
	);
	ref(v.receiptRef);
	ref(v.issuerRef);
	str(v.verifierRevision);
	occurrence(v.occurrence);
	for (const k of [
		"inputDigest",
		"policyDigest",
		"sourceDigest",
		"runtimeDigest",
		"requestDigest",
		"artifactDigest",
	])
		digest(v[k]);
	str(v.numericDomainRef);
	ref(v.artifactRef);
	if (!["pass", "fail", "unavailable"].includes(v.verdict as string))
		throw new TypeError("verdict");
}
function grant(v: unknown) {
	keys(
		v,
		"grantRef,ownerRef,operation,occurrence,requestDigest,destinationRef,hostEpoch,validFrom,validThrough,maxWrites,replayScope,revoked",
	);
	ref(v.grantRef);
	ref(v.ownerRef);
	ref(v.destinationRef);
	occurrence(v.occurrence);
	digest(v.requestDigest);
	epoch(v.hostEpoch);
	tick(v.validFrom);
	tick(v.validThrough);
	number(v.maxWrites, 64, true, 1);
	boolean(v.revoked);
	keys(v.replayScope, "compositionEpoch,hostEpoch");
	epoch(v.replayScope.compositionEpoch);
	epoch(v.replayScope.hostEpoch);
	if (v.operation !== "append-alert" || (v.validFrom as number) > (v.validThrough as number))
		throw new TypeError("grant");
}
function outcome(v: unknown) {
	keys(v, "occurrence,effectId,requestRef,admissionRef,proposalDigest,state,result");
	occurrence(v.occurrence);
	str(v.effectId);
	ref(v.requestRef);
	ref(v.admissionRef);
	digest(v.proposalDigest);
	if (
		!["succeeded", "failed", "cancelled", "reconcile-required", "unknown"].includes(
			v.state as string,
		)
	)
		throw new TypeError("outcome");
	// DataResult semantic validity is independently enforced by the sole causal authority.
	if (
		!v.result ||
		typeof v.result !== "object" ||
		!["ok", "error"].includes((v.result as { kind: string }).kind)
	)
		throw new TypeError("result");
}
export function validateBinding(raw: SpendingBinding): SpendingBinding {
	const v = JSON.parse(canonicalMaterial(raw));
	binding(v);
	return frozen(v);
}
export function checkInput<T>(
	kind: "pack" | "arrivals" | "current" | "verification" | "local" | "inbox",
	raw: unknown,
	expected: SpendingBinding,
): Checked<T> {
	try {
		const v = JSON.parse(canonicalMaterial(raw, kind === "pack" ? 4 * 1048576 : 1048576));
		if (kind === "arrivals") {
			keys(v, "packRef,evaluationRefs");
			ref(v.packRef);
			array(v.evaluationRefs);
			v.evaluationRefs.forEach((x) => {
				str(x);
			});
			if (!same(v.packRef, expected.packRef)) throw new TypeError("pack-ref");
		} else {
			const names = {
				pack: "format,binding,evaluations",
				current: "binding,current",
				verification: "binding,receipts",
				local: "binding,tick,stop,grants",
				inbox: "binding,issuerRef,artifactRef,artifactDigest,readiness,outcomes",
			};
			keys(v, names[kind]);
			binding(v.binding);
			if (!same(v.binding, expected)) throw new TypeError("binding");
			if (kind === "pack") {
				if (v.format !== "spending-input-v1") throw new TypeError("format");
				array(v.evaluations);
				v.evaluations.forEach(evaluation);
				const es = v.evaluations as Evaluation[];
				if (
					new Set(es.map((e) => e.evaluationRef)).size !== es.length ||
					new Set(es.map((e) => occurrenceKey(e.occurrence))).size !== es.length ||
					new Set(es.map((e) => e.prefix[0].vendor)).size > 2
				)
					throw new TypeError("pack-uniqueness");
				const domains = new Map<string, string>();
				for (const e of es) {
					const vendor = e.prefix[0].vendor,
						prior = domains.get(e.occurrence.revisionDomain);
					if (prior !== undefined && prior !== vendor) throw new TypeError("domain-vendor");
					domains.set(e.occurrence.revisionDomain, vendor);
				}
			} else if (kind === "current") {
				array(v.current);
				const domains = new Set<string>();
				for (const f of v.current) {
					keys(f, "revisionDomain,occurrence,policyRef,policyDigest,watermark");
					str(f.revisionDomain);
					occurrence(f.occurrence);
					ref(f.policyRef);
					digest(f.policyDigest);
					tick(f.watermark);
					if (
						f.revisionDomain !== (f.occurrence as CausalOccurrenceRef).revisionDomain ||
						domains.has(f.revisionDomain)
					)
						throw new TypeError("current-domain");
					domains.add(f.revisionDomain);
				}
			} else if (kind === "verification") {
				array(v.receipts);
				v.receipts.forEach(receipt);
			} else if (kind === "local") {
				tick(v.tick);
				boolean(v.stop);
				array(v.grants);
				v.grants.forEach(grant);
			} else {
				ref(v.issuerRef);
				ref(v.artifactRef);
				digest(v.artifactDigest);
				keys(v.readiness, "ready,observedAt,validThrough,availableSlots");
				boolean(v.readiness.ready);
				tick(v.readiness.observedAt);
				tick(v.readiness.validThrough);
				number(v.readiness.availableSlots, 1, true);
				array(v.outcomes);
				v.outcomes.forEach(outcome);
			}
		}
		return frozen({ valid: true, value: v as T });
	} catch {
		return { valid: false, issue: issue(`invalid-${kind}`) };
	}
}
