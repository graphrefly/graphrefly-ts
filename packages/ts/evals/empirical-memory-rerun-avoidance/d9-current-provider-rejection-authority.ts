import { depBatch } from "../../src/ctx/types.js";
import { graph } from "../../src/graph/graph.js";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	admitCurrentGraphProviderEffectResult,
	type CurrentGraphProviderAdmittedEffectV1,
	type CurrentGraphProviderAuthorityV1,
	type CurrentGraphProviderBudgetLimitsV1,
	type CurrentGraphProviderEffectResultInputV1,
	type CurrentGraphProviderEvidenceV1,
	type CurrentGraphProviderFactV1,
	type CurrentGraphProviderRouteProfileV1,
	type CurrentGraphProviderTaskProfileV1,
	createCurrentGraphProviderAuthority,
	snapshotCurrentGraphProviderEvidence,
	takeCurrentGraphProviderEffect,
	validateCurrentGraphProviderEvidence,
} from "./d6-current-provider-authority.js";

export const D9_PROVIDER_REJECTION_AUTHORITY_REVISION =
	"graphrefly-ts.d9.provider-result-rejection-authority.v1" as const;
export const D9_PROVIDER_REJECTION_FACT_SCHEMA =
	"graphrefly-ts.d9.provider-result-rejection-fact.v1" as const;
export const D9_PROVIDER_REJECTION_EVIDENCE_SCHEMA =
	"graphrefly-ts.d9.provider-result-rejection-evidence.v1" as const;

export const D9_PROVIDER_REJECTION_CAUSES = Object.freeze([
	"provider-result-schema-invalid",
	"provider-result-cardinality-invalid",
	"provider-tool-count-exceeded",
	"provider-tool-argument-invalid",
	"provider-usage-reservation-exceeded",
	"provider-retry-proposal-invalid",
] as const);

export type D9ProviderRejectionCause = (typeof D9_PROVIDER_REJECTION_CAUSES)[number];

export interface D9ProviderRejectionFactV1 {
	readonly schemaVersion: typeof D9_PROVIDER_REJECTION_FACT_SCHEMA;
	readonly sequence: number;
	readonly arm: CurrentGraphProviderAdmittedEffectV1["request"]["arm"];
	readonly runSequence: number;
	readonly causeCode: D9ProviderRejectionCause;
	readonly candidateDigest: string | null;
	readonly request: CurrentGraphProviderAdmittedEffectV1["request"];
	readonly admission: CurrentGraphProviderAdmittedEffectV1["admission"];
	readonly providerFactDigest: string;
	readonly reconciliation: CurrentGraphProviderFactV1["reconciliation"];
	readonly factDigest: string;
}

export interface D9ProviderRejectionEvidenceV1 {
	readonly schemaVersion: typeof D9_PROVIDER_REJECTION_EVIDENCE_SCHEMA;
	readonly decisionRef: "graphrefly-ts:D9";
	readonly topology: Readonly<{
		runtimeFactNode: "current/d9/provider-rejections/runtime-facts";
		canonicalProjectionNode: "current/d9/provider-rejections/canonical-projection";
		topologyDigest: string;
	}>;
	readonly d8FailureBaseline: typeof D9_D8_FAILURE_BASELINE;
	readonly providerEvidence: CurrentGraphProviderEvidenceV1;
	readonly rejectionFacts: readonly D9ProviderRejectionFactV1[];
	readonly rejectionCount: number;
	readonly causalAttribution: "undetermined";
	readonly efficacyClaim: "none";
	readonly evidenceDigest: string;
}

export interface D9ProviderRejectionAuthorityV1 {
	readonly revision: typeof D9_PROVIDER_REJECTION_AUTHORITY_REVISION;
}

export type D9ProviderAdmissionOutcomeV1 = Readonly<{
	providerFact: CurrentGraphProviderFactV1;
	rejectionFact: D9ProviderRejectionFactV1 | null;
}>;

export const D9_D8_FAILURE_BASELINE = Object.freeze({
	implementationCommit: "f826e4c5eb9c1c33b9440eb66c783fa623740202" as const,
	bundleArtifactDigest:
		"sha256:05343dcab5544ec30cbc5e09767bdbba9665c40685d5044de9883d03e7185582" as const,
	bundleDigest: "sha256:fcae8a43123bbda6463840e8f515dcc9ec10f613de2ef8a2a14f6a6e09ff272f" as const,
	partialGraphDigest:
		"sha256:da398f2628286f9099f113751adadf3ee1502d19c092b8b2c2572ca5b7592145" as const,
	terminalReceiptDigest:
		"sha256:a10fdf77215dba318315a3ab48e431a049e7d7862e6f5d7fbbc38e61bf03f3e9" as const,
});

const DIGEST = /^sha256:[0-9a-f]{64}$/u;
const RESULT_KEYS = Object.freeze([
	"effectKind",
	"evidenceDigest",
	"failureCode",
	"retryProposal",
	"status",
	"toolCalls",
	"usage",
] as const);
const USAGE_KEYS = Object.freeze([
	"actualCostMicrousd",
	"actualElapsedMs",
	"cacheReadTokens",
	"costBasis",
	"inputTokens",
	"outputTokens",
	"requests",
] as const);
const TOOL_REFS = Object.freeze([
	"read-file",
	"replace-exact",
	"workspace-diff",
	"focused-validation",
] as const);

interface D9State {
	readonly owner: ReturnType<typeof graph>;
	readonly rejectionNode: ReturnType<typeof createRejectionNode>;
	readonly provider: CurrentGraphProviderAuthorityV1;
	readonly rejectionFacts: D9ProviderRejectionFactV1[];
	active: CurrentGraphProviderAdmittedEffectV1 | null;
}

interface CloneBudget {
	nodes: number;
	bytes: number;
	readonly maxNodes: number;
	readonly maxBytes: number;
	readonly maxDepth: number;
	readonly maxArrayLength: number;
}

class RejectionClassification extends Error {
	readonly causeCode: D9ProviderRejectionCause;

	constructor(causeCode: D9ProviderRejectionCause) {
		super(causeCode);
		this.causeCode = causeCode;
	}
}

const states = new WeakMap<object, D9State>();

function createRejectionNode(owner: ReturnType<typeof graph>) {
	return owner.node<D9ProviderRejectionFactV1>([], null, {
		name: "current/d9/provider-rejections/runtime-facts",
	});
}

function fail(causeCode: D9ProviderRejectionCause): never {
	throw new RejectionClassification(causeCode);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function cloneBoundedData(
	value: unknown,
	budget: CloneBudget,
	seen: WeakSet<object>,
	depth = 0,
): unknown {
	if (depth > budget.maxDepth || budget.nodes >= budget.maxNodes || budget.bytes > budget.maxBytes)
		fail("provider-result-schema-invalid");
	budget.nodes += 1;
	if (value === null || typeof value === "boolean") return value;
	if (typeof value === "number") {
		if (!Number.isFinite(value)) fail("provider-result-schema-invalid");
		return value;
	}
	if (typeof value === "string") {
		budget.bytes += Buffer.byteLength(value, "utf8");
		if (budget.bytes > budget.maxBytes) fail("provider-result-schema-invalid");
		return value;
	}
	if (typeof value !== "object") fail("provider-result-schema-invalid");
	if (seen.has(value)) fail("provider-result-schema-invalid");
	seen.add(value);
	try {
		const descriptors = Object.getOwnPropertyDescriptors(value);
		const symbols = Object.getOwnPropertySymbols(value);
		if (symbols.length !== 0) fail("provider-result-schema-invalid");
		if (Array.isArray(value)) {
			const lengthDescriptor = descriptors.length;
			if (
				lengthDescriptor === undefined ||
				!("value" in lengthDescriptor) ||
				!Number.isSafeInteger(lengthDescriptor.value) ||
				lengthDescriptor.value < 0 ||
				lengthDescriptor.value > budget.maxArrayLength
			)
				fail("provider-result-schema-invalid");
			const output: unknown[] = [];
			for (let index = 0; index < lengthDescriptor.value; index += 1) {
				const descriptor = descriptors[String(index)];
				if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
					fail("provider-result-schema-invalid");
				output.push(cloneBoundedData(descriptor.value, budget, seen, depth + 1));
			}
			if (
				Object.keys(descriptors).some((key) => key !== "length" && !/^(0|[1-9][0-9]*)$/u.test(key))
			)
				fail("provider-result-schema-invalid");
			return output;
		}
		if (!isPlainObject(value)) fail("provider-result-schema-invalid");
		const keys = Object.keys(descriptors);
		if (keys.length > 32) fail("provider-result-schema-invalid");
		const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
		for (const key of keys) {
			budget.bytes += Buffer.byteLength(key, "utf8");
			const descriptor = descriptors[key];
			if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true)
				fail("provider-result-schema-invalid");
			output[key] = cloneBoundedData(descriptor.value, budget, seen, depth + 1);
		}
		return output;
	} finally {
		seen.delete(value);
	}
}

export function snapshotD9BoundedCanonicalEvidence(value: unknown): unknown {
	return strictSnapshot(
		cloneBoundedData(
			value,
			{
				nodes: 0,
				bytes: 0,
				maxNodes: 100_000,
				maxBytes: 4_194_304,
				maxDepth: 32,
				maxArrayLength: 2_048,
			},
			new WeakSet<object>(),
		),
	);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function safeInteger(value: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): value is number {
	return Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max;
}

function boundedString(value: unknown, maxBytes: number, allowEmpty = false): value is string {
	return (
		typeof value === "string" &&
		(allowEmpty || value.length > 0) &&
		Buffer.byteLength(value, "utf8") <= maxBytes
	);
}

function validToolArgument(value: unknown): boolean {
	if (!isPlainObject(value) || typeof value.toolRef !== "string") return false;
	if (!TOOL_REFS.includes(value.toolRef as (typeof TOOL_REFS)[number])) return false;
	if (value.toolRef === "read-file")
		return exactKeys(value, ["path", "toolRef"]) && boundedString(value.path, 512);
	if (value.toolRef === "replace-exact")
		return (
			exactKeys(value, ["newText", "oldText", "path", "toolRef"]) &&
			boundedString(value.path, 512) &&
			boundedString(value.oldText, 32_768) &&
			boundedString(value.newText, 32_768, true) &&
			Buffer.byteLength(JSON.stringify(value), "utf8") <= 65_536
		);
	return exactKeys(value, ["toolRef"]);
}

function classifyProviderResult(
	value: unknown,
	request: CurrentGraphProviderAdmittedEffectV1["request"],
):
	| Readonly<{
			accepted: true;
			value: CurrentGraphProviderEffectResultInputV1;
			candidateDigest: string;
	  }>
	| Readonly<{
			accepted: false;
			causeCode: D9ProviderRejectionCause;
			candidateDigest: string | null;
	  }> {
	let cloned: unknown;
	try {
		cloned = cloneBoundedData(
			value,
			{
				nodes: 0,
				bytes: 0,
				maxNodes: 1_024,
				maxBytes: 524_288,
				maxDepth: 8,
				maxArrayLength: 32,
			},
			new WeakSet<object>(),
		);
	} catch (error) {
		if (error instanceof RejectionClassification)
			return Object.freeze({ accepted: false, causeCode: error.causeCode, candidateDigest: null });
		throw error;
	}
	const candidateDigest = empiricalStrictJsonDigest(cloned);
	if (!isPlainObject(cloned) || !exactKeys(cloned, RESULT_KEYS))
		return Object.freeze({
			accepted: false,
			causeCode: "provider-result-schema-invalid",
			candidateDigest,
		});
	if (
		cloned.effectKind !== "provider-request" ||
		(cloned.status !== "completed" && cloned.status !== "failed") ||
		!Array.isArray(cloned.toolCalls) ||
		typeof cloned.evidenceDigest !== "string" ||
		!DIGEST.test(cloned.evidenceDigest) ||
		!isPlainObject(cloned.usage) ||
		!exactKeys(cloned.usage, USAGE_KEYS) ||
		cloned.usage.requests !== 1 ||
		!safeInteger(cloned.usage.inputTokens) ||
		!safeInteger(cloned.usage.outputTokens) ||
		!safeInteger(cloned.usage.cacheReadTokens) ||
		!safeInteger(cloned.usage.actualCostMicrousd) ||
		!safeInteger(cloned.usage.actualElapsedMs) ||
		(cloned.usage.costBasis !== "reported" && cloned.usage.costBasis !== "conservative-reservation")
	)
		return Object.freeze({
			accepted: false,
			causeCode: "provider-result-schema-invalid",
			candidateDigest,
		});
	if (cloned.toolCalls.length > 4)
		return Object.freeze({
			accepted: false,
			causeCode: "provider-tool-count-exceeded",
			candidateDigest,
		});
	if (!cloned.toolCalls.every(validToolArgument))
		return Object.freeze({
			accepted: false,
			causeCode: "provider-tool-argument-invalid",
			candidateDigest,
		});
	if (
		cloned.usage.actualCostMicrousd > request.reservation.maxCostMicrousd ||
		cloned.usage.actualElapsedMs > request.reservation.maxElapsedMs
	)
		return Object.freeze({
			accepted: false,
			causeCode: "provider-usage-reservation-exceeded",
			candidateDigest,
		});
	if (cloned.status === "completed") {
		if (
			cloned.toolCalls.length === 0 ||
			cloned.failureCode !== null ||
			cloned.retryProposal !== null
		)
			return Object.freeze({
				accepted: false,
				causeCode: "provider-result-cardinality-invalid",
				candidateDigest,
			});
	} else {
		if (
			cloned.toolCalls.length !== 0 ||
			(cloned.failureCode !== "retryable-transient" &&
				cloned.failureCode !== "provider-failed" &&
				cloned.failureCode !== "mutation-proposal-cardinality" &&
				cloned.failureCode !== "mutation-proposal-content")
		)
			return Object.freeze({
				accepted: false,
				causeCode: "provider-result-cardinality-invalid",
				candidateDigest,
			});
		if (cloned.failureCode === "retryable-transient") {
			const proposal = cloned.retryProposal;
			if (
				!isPlainObject(proposal) ||
				!exactKeys(proposal, ["proposalDigest", "retryAfterMs", "retryClass"]) ||
				proposal.retryClass !== "retryable-transient" ||
				!safeInteger(proposal.retryAfterMs, 0, 60_000) ||
				typeof proposal.proposalDigest !== "string" ||
				proposal.proposalDigest !==
					empiricalStrictJsonDigest({
						retryClass: "retryable-transient",
						retryAfterMs: proposal.retryAfterMs,
						requestDigest: request.requestDigest,
						logicalRequestDigest: request.logicalRequestDigest,
					})
			)
				return Object.freeze({
					accepted: false,
					causeCode: "provider-retry-proposal-invalid",
					candidateDigest,
				});
		} else if (cloned.retryProposal !== null)
			return Object.freeze({
				accepted: false,
				causeCode: "provider-retry-proposal-invalid",
				candidateDigest,
			});
	}
	return Object.freeze({
		accepted: true,
		value: strictSnapshot(cloned) as unknown as CurrentGraphProviderEffectResultInputV1,
		candidateDigest,
	});
}

function conservativeFailure(
	effect: CurrentGraphProviderAdmittedEffectV1,
	causeCode: D9ProviderRejectionCause,
): CurrentGraphProviderEffectResultInputV1 {
	return Object.freeze({
		effectKind: "provider-request" as const,
		status: "failed" as const,
		toolCalls: Object.freeze([]),
		failureCode: "provider-failed" as const,
		retryProposal: null,
		usage: Object.freeze({
			requests: 1 as const,
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			actualCostMicrousd: effect.request.reservation.maxCostMicrousd,
			actualElapsedMs: effect.request.reservation.maxElapsedMs,
			costBasis: "conservative-reservation" as const,
		}),
		evidenceDigest: empiricalStrictJsonDigest({
			schemaVersion: D9_PROVIDER_REJECTION_FACT_SCHEMA,
			requestDigest: effect.request.requestDigest,
			causeCode,
		}),
	});
}

function topology() {
	const material = strictSnapshot({
		runtimeFactNode: "current/d9/provider-rejections/runtime-facts" as const,
		canonicalProjectionNode: "current/d9/provider-rejections/canonical-projection" as const,
	});
	return Object.freeze({ ...material, topologyDigest: empiricalStrictJsonDigest(material) });
}

function stateFor(value: unknown): D9State {
	if (value === null || typeof value !== "object")
		throw new TypeError("D9 provider rejection authority must be an object");
	const state = states.get(value);
	if (state === undefined) throw new TypeError("D9 provider rejection authority is forged");
	return state;
}

export function createD9ProviderRejectionAuthority(input: {
	readonly limits: CurrentGraphProviderBudgetLimitsV1;
	readonly routeProfile: CurrentGraphProviderRouteProfileV1;
	readonly taskProfile: CurrentGraphProviderTaskProfileV1;
}): D9ProviderRejectionAuthorityV1 {
	const owner = graph({ name: "current/d9/provider-rejections/graph-native-eval" });
	const rejectionNode = createRejectionNode(owner);
	const projectionNode = owner.node<D9ProviderRejectionFactV1>(
		[rejectionNode],
		(ctx) => {
			for (const fact of depBatch(ctx, 0) ?? []) ctx.down([["DATA", fact]]);
		},
		{
			name: "current/d9/provider-rejections/canonical-projection",
			factory: "d9ProviderRejectionCanonicalProjection",
		},
	);
	const capability = Object.freeze({ revision: D9_PROVIDER_REJECTION_AUTHORITY_REVISION });
	const state: D9State = {
		owner,
		rejectionNode,
		provider: createCurrentGraphProviderAuthority(input),
		rejectionFacts: [],
		active: null,
	};
	projectionNode.subscribe((message) => {
		if (message[0] === "DATA") state.rejectionFacts.push(message[1] as D9ProviderRejectionFactV1);
	});
	states.set(capability, state);
	return capability;
}

export function takeD9ProviderEffect(
	authority: D9ProviderRejectionAuthorityV1,
): CurrentGraphProviderAdmittedEffectV1 | null {
	const state = stateFor(authority);
	const effect = takeCurrentGraphProviderEffect(state.provider);
	state.active = effect;
	return effect;
}

export function admitD9ProviderEffectResult(
	authority: D9ProviderRejectionAuthorityV1,
	requestDigest: string,
	resultValue: unknown,
): D9ProviderAdmissionOutcomeV1 {
	const state = stateFor(authority);
	const active = state.active;
	if (active === null) throw new TypeError("D9 provider Graph has no taken active effect");
	if (requestDigest !== active.request.requestDigest)
		throw new TypeError("D9 provider result does not match the active request");
	state.active = null;
	if (active.request.effectKind !== "provider-request") {
		const providerFact = admitCurrentGraphProviderEffectResult(
			state.provider,
			requestDigest,
			resultValue,
		);
		return Object.freeze({ providerFact, rejectionFact: null });
	}
	const classified = classifyProviderResult(resultValue, active.request);
	if (classified.accepted) {
		const providerFact = admitCurrentGraphProviderEffectResult(
			state.provider,
			requestDigest,
			classified.value,
		);
		return Object.freeze({ providerFact, rejectionFact: null });
	}
	const providerFact = admitCurrentGraphProviderEffectResult(
		state.provider,
		requestDigest,
		conservativeFailure(active, classified.causeCode),
	);
	const material = strictSnapshot({
		schemaVersion: D9_PROVIDER_REJECTION_FACT_SCHEMA,
		sequence: state.rejectionFacts.length,
		arm: active.request.arm,
		runSequence: active.request.runSequence,
		causeCode: classified.causeCode,
		candidateDigest: classified.candidateDigest,
		request: providerFact.request,
		admission: providerFact.admission,
		providerFactDigest: providerFact.factDigest,
		reconciliation: providerFact.reconciliation,
	});
	const rejectionFact = Object.freeze({
		...material,
		factDigest: empiricalStrictJsonDigest(material),
	}) as D9ProviderRejectionFactV1;
	state.rejectionNode.down([["DATA", rejectionFact]]);
	return Object.freeze({ providerFact, rejectionFact });
}

export function snapshotD9ProviderRejectionEvidence(
	authority: D9ProviderRejectionAuthorityV1,
): D9ProviderRejectionEvidenceV1 {
	const state = stateFor(authority);
	if (state.active !== null)
		throw new TypeError("D9 provider evidence has an unadmitted active effect");
	const providerEvidence = validateCurrentGraphProviderEvidence(
		snapshotCurrentGraphProviderEvidence(state.provider),
	);
	const material = strictSnapshot({
		schemaVersion: D9_PROVIDER_REJECTION_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D9" as const,
		topology: topology(),
		d8FailureBaseline: D9_D8_FAILURE_BASELINE,
		providerEvidence,
		rejectionFacts: state.rejectionFacts,
		rejectionCount: state.rejectionFacts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	return Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D9ProviderRejectionEvidenceV1;
}

function validateRejectionFact(
	value: D9ProviderRejectionFactV1,
	index: number,
	providerEvidence: CurrentGraphProviderEvidenceV1,
): D9ProviderRejectionFactV1 {
	if (
		!isPlainObject(value) ||
		!exactKeys(value, [
			"admission",
			"arm",
			"candidateDigest",
			"causeCode",
			"factDigest",
			"providerFactDigest",
			"reconciliation",
			"request",
			"runSequence",
			"schemaVersion",
			"sequence",
		])
	)
		throw new TypeError("D9 provider rejection fact shape drifted");
	if (
		value.schemaVersion !== D9_PROVIDER_REJECTION_FACT_SCHEMA ||
		value.sequence !== index ||
		!D9_PROVIDER_REJECTION_CAUSES.includes(value.causeCode) ||
		(value.candidateDigest !== null && !DIGEST.test(value.candidateDigest)) ||
		!DIGEST.test(value.providerFactDigest) ||
		!DIGEST.test(value.factDigest)
	)
		throw new TypeError("D9 provider rejection fact coordinates drifted");
	const providerFact = providerEvidence.facts.find(
		(fact) => fact.factDigest === value.providerFactDigest,
	);
	if (
		providerFact === undefined ||
		empiricalStrictJsonDigest(providerFact.request) !== empiricalStrictJsonDigest(value.request) ||
		empiricalStrictJsonDigest(providerFact.admission) !==
			empiricalStrictJsonDigest(value.admission) ||
		empiricalStrictJsonDigest(providerFact.reconciliation) !==
			empiricalStrictJsonDigest(value.reconciliation) ||
		providerFact.result.effectKind !== "provider-request" ||
		providerFact.result.status !== "failed" ||
		providerFact.result.failureCode !== "provider-failed" ||
		providerFact.result.retryProposal !== null ||
		providerFact.result.toolCalls.length !== 0 ||
		providerFact.result.usage.costBasis !== "conservative-reservation" ||
		providerFact.result.usage.actualCostMicrousd !==
			providerFact.request.reservation.maxCostMicrousd ||
		providerFact.result.usage.actualElapsedMs !== providerFact.request.reservation.maxElapsedMs ||
		providerFact.result.evidenceDigest !==
			empiricalStrictJsonDigest({
				schemaVersion: D9_PROVIDER_REJECTION_FACT_SCHEMA,
				requestDigest: providerFact.request.requestDigest,
				causeCode: value.causeCode,
			})
	)
		throw new TypeError("D9 provider rejection fact lost its conservative provider binding");
	const material = strictSnapshot({
		schemaVersion: D9_PROVIDER_REJECTION_FACT_SCHEMA,
		sequence: index,
		arm: providerFact.arm,
		runSequence: providerFact.runSequence,
		causeCode: value.causeCode,
		candidateDigest: value.candidateDigest,
		request: providerFact.request,
		admission: providerFact.admission,
		providerFactDigest: providerFact.factDigest,
		reconciliation: providerFact.reconciliation,
	});
	if (empiricalStrictJsonDigest(material) !== value.factDigest)
		throw new TypeError("D9 provider rejection fact digest drifted");
	return Object.freeze({
		...material,
		factDigest: value.factDigest,
	}) as D9ProviderRejectionFactV1;
}

export function validateD9ProviderRejectionEvidence(value: unknown): D9ProviderRejectionEvidenceV1 {
	const candidate = snapshotD9BoundedCanonicalEvidence(value);
	if (!isPlainObject(candidate)) throw new TypeError("D9 provider rejection evidence is invalid");
	if (
		!exactKeys(candidate, [
			"causalAttribution",
			"d8FailureBaseline",
			"decisionRef",
			"efficacyClaim",
			"evidenceDigest",
			"providerEvidence",
			"rejectionCount",
			"rejectionFacts",
			"schemaVersion",
			"topology",
		]) ||
		candidate.schemaVersion !== D9_PROVIDER_REJECTION_EVIDENCE_SCHEMA ||
		candidate.decisionRef !== "graphrefly-ts:D9" ||
		candidate.causalAttribution !== "undetermined" ||
		candidate.efficacyClaim !== "none" ||
		!DIGEST.test(String(candidate.evidenceDigest)) ||
		empiricalStrictJsonDigest(candidate.d8FailureBaseline) !==
			empiricalStrictJsonDigest(D9_D8_FAILURE_BASELINE) ||
		empiricalStrictJsonDigest(candidate.topology) !== empiricalStrictJsonDigest(topology()) ||
		!Array.isArray(candidate.rejectionFacts) ||
		candidate.rejectionFacts.length > 6 ||
		candidate.rejectionCount !== candidate.rejectionFacts.length
	)
		throw new TypeError("D9 provider rejection evidence coordinates drifted");
	const providerEvidence = validateCurrentGraphProviderEvidence(candidate.providerEvidence);
	const rejectionFacts = candidate.rejectionFacts.map((fact, index) =>
		validateRejectionFact(fact as unknown as D9ProviderRejectionFactV1, index, providerEvidence),
	);
	const providerKeys = new Set(rejectionFacts.map((fact) => fact.providerFactDigest));
	if (providerKeys.size !== rejectionFacts.length)
		throw new TypeError("D9 provider rejection evidence reused a provider fact");
	const material = strictSnapshot({
		schemaVersion: D9_PROVIDER_REJECTION_EVIDENCE_SCHEMA,
		decisionRef: "graphrefly-ts:D9" as const,
		topology: topology(),
		d8FailureBaseline: D9_D8_FAILURE_BASELINE,
		providerEvidence,
		rejectionFacts,
		rejectionCount: rejectionFacts.length,
		causalAttribution: "undetermined" as const,
		efficacyClaim: "none" as const,
	});
	const validated = Object.freeze({
		...material,
		evidenceDigest: empiricalStrictJsonDigest(material),
	}) as D9ProviderRejectionEvidenceV1;
	if (candidate.evidenceDigest !== validated.evidenceDigest)
		throw new TypeError("D9 provider rejection evidence digest drifted");
	return validated;
}
