import { empiricalStrictJsonDigest } from "./canonical.js";
import type {
	D720EffectResultV1,
	D720GraphEffectRequestV1,
	D720ToolIntentV1,
} from "./d722-graph-native-effect-runtime.js";

export const D722_INJECTED_MODEL_FIXTURE_REVISION =
	"graphrefly.b112.d722.injected-model-fixture.v1" as const;

export interface D722InjectedModelFixtureV1 {
	readonly revision: typeof D722_INJECTED_MODEL_FIXTURE_REVISION;
}

const fixtureStates = new WeakMap<object, Set<string>>();

function evidence(value: unknown): string {
	return empiricalStrictJsonDigest(value);
}

function intents(runSequence: number): readonly D720ToolIntentV1[] {
	return Object.freeze(
		(["read-file", "replace-exact", "workspace-diff", "focused-validation"] as const).map(
			(toolRef, index) =>
				Object.freeze({ toolRef, intentDigest: evidence({ runSequence, toolRef, index }) }),
		),
	);
}

export function createD722InjectedModelFixture(): D722InjectedModelFixtureV1 {
	const fixture = Object.freeze({ revision: D722_INJECTED_MODEL_FIXTURE_REVISION });
	fixtureStates.set(fixture, new Set());
	return fixture;
}

export async function invokeD722InjectedModelFixture(
	fixture: D722InjectedModelFixtureV1,
	request: D720GraphEffectRequestV1,
): Promise<D720EffectResultV1> {
	const retries = fixtureStates.get(fixture);
	if (retries === undefined) throw new TypeError("D722 model fixture is not constructed");
	if (request.effectKind !== "provider-request" || request.workspaceStateDigest === null)
		throw new TypeError("D722 model fixture requires a provider request with workspace state");
	const initialRetryReason =
		request.runSequence === 0
			? "d671-rate-limit-exceeded"
			: request.runSequence === 1
				? "d675-und-err-socket"
				: request.runSequence === 2
					? "d710-untyped-http-429"
					: null;
	const completionRetryReason =
		request.completionContext === undefined
			? null
			: request.runSequence === 3
				? "d671-provider-overloaded"
				: request.runSequence === 4
					? "d675-und-err-socket"
					: request.runSequence === 5
						? "d710-untyped-http-429"
						: null;
	const retryReason = request.phaseBefore === "none" ? initialRetryReason : completionRetryReason;
	if (
		retryReason !== null &&
		request.phaseBefore === "none" &&
		request.attemptOrdinal === 1 &&
		!retries.has(request.logicalRequestDigest)
	) {
		retries.add(request.logicalRequestDigest);
		return Object.freeze({
			effectKind: "provider-request",
			status: "retryable-failure",
			toolIntents: Object.freeze([]),
			failureDiscriminator: retryReason,
			retryAfterMs: null,
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest: evidence({ request, retryReason }),
		});
	}
	if (
		retryReason !== null &&
		request.completionContext !== undefined &&
		request.attemptOrdinal === 1 &&
		!retries.has(request.logicalRequestDigest)
	) {
		retries.add(request.logicalRequestDigest);
		return Object.freeze({
			effectKind: "provider-request",
			status: "retryable-failure",
			toolIntents: Object.freeze([]),
			failureDiscriminator: retryReason,
			retryAfterMs: null,
			workspaceStateDigest: request.workspaceStateDigest,
			evidenceDigest: evidence({ request, retryReason }),
		});
	}
	const firstTurn = request.phaseBefore === "none";
	const toolIntents = firstTurn
		? Object.freeze([intents(request.runSequence)[0]!])
		: request.completionContext === undefined
			? Object.freeze([])
			: Object.freeze(intents(request.runSequence).slice(1));
	return Object.freeze({
		effectKind: "provider-request",
		status: toolIntents.length > 0 ? "tool-intents" : "structured-final",
		toolIntents,
		failureDiscriminator: "none",
		retryAfterMs: null,
		workspaceStateDigest: request.workspaceStateDigest,
		evidenceDigest: evidence({ request, toolIntents }),
	});
}
