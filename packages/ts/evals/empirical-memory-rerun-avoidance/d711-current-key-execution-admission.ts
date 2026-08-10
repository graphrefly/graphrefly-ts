import { exactKeys, record } from "./canonical.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";
import type { OpenRouterResponsesCredentialCapabilityV1 } from "./openrouter-responses-model-turn.js";

export interface D711CurrentKeyExecutionAdmissionV1 {
	readonly capabilityRef: "d711-current-key-execution-admission";
	readonly capabilityRevision: "decision.D711.2026-08-10.v1";
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly admission: OpenRouterCurrentKeySpendAdmissionV1;
}

const constructedAdmissions = new WeakSet<object>();

export function createD711CurrentKeyExecutionAdmission(input: {
	readonly admission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
}): D711CurrentKeyExecutionAdmissionV1 {
	const candidate = record(input, "d711.currentKeyExecutionInput");
	exactKeys(candidate, ["admission", "credential"], "d711.currentKeyExecutionInput");
	const admission = consumeOpenRouterCurrentKeySpendAdmission(candidate.admission);
	const credential = record(candidate.credential, "d711.currentKeyExecutionCredential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"d711.currentKeyExecutionCredential",
	);
	for (const key of ["credentialBindingRef", "credentialBindingRevision"] as const) {
		const value = credential[key];
		if (typeof value !== "string" || value.length < 1 || value.length > 256) {
			throw new TypeError(`D711 current-key credential ${key} is invalid`);
		}
	}
	const capability = Object.freeze({
		capabilityRef: "d711-current-key-execution-admission" as const,
		capabilityRevision: "decision.D711.2026-08-10.v1" as const,
		credentialBindingRef: credential.credentialBindingRef as string,
		credentialBindingRevision: credential.credentialBindingRevision as string,
		admission,
	});
	constructedAdmissions.add(capability);
	return capability;
}

export function consumeD711CurrentKeyExecutionAdmission(
	value: unknown,
): D711CurrentKeyExecutionAdmissionV1 {
	if (value === null || typeof value !== "object" || !constructedAdmissions.delete(value)) {
		throw new TypeError("D711 execution requires one same-process current-key admission");
	}
	return value as D711CurrentKeyExecutionAdmissionV1;
}
