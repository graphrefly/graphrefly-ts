import { exactKeys, record } from "./canonical.js";
import {
	consumeOpenRouterCurrentKeySpendAdmission,
	type OpenRouterCurrentKeySpendAdmissionV1,
} from "./openrouter-current-key-spend-admission.js";
import type { OpenRouterResponsesCredentialCapabilityV1 } from "./openrouter-responses-model-turn.js";

export interface D713CurrentKeyExecutionAdmissionV1 {
	readonly capabilityRef: "d713-current-key-execution-admission";
	readonly capabilityRevision: "decision.D713.2026-08-10.v1";
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
	readonly admission: OpenRouterCurrentKeySpendAdmissionV1;
}

const constructedAdmissions = new WeakSet<object>();

export function createD713CurrentKeyExecutionAdmission(input: {
	readonly admission: OpenRouterCurrentKeySpendAdmissionV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
}): D713CurrentKeyExecutionAdmissionV1 {
	const candidate = record(input, "d713.currentKeyExecutionInput");
	exactKeys(candidate, ["admission", "credential"], "d713.currentKeyExecutionInput");
	const admission = consumeOpenRouterCurrentKeySpendAdmission(candidate.admission);
	const credential = record(candidate.credential, "d713.currentKeyExecutionCredential");
	exactKeys(
		credential,
		["bearerToken", "credentialBindingRef", "credentialBindingRevision"],
		"d713.currentKeyExecutionCredential",
	);
	for (const key of ["credentialBindingRef", "credentialBindingRevision"] as const) {
		const value = credential[key];
		if (typeof value !== "string" || value.length < 1 || value.length > 256) {
			throw new TypeError(`D713 current-key credential ${key} is invalid`);
		}
	}
	const capability = Object.freeze({
		capabilityRef: "d713-current-key-execution-admission" as const,
		capabilityRevision: "decision.D713.2026-08-10.v1" as const,
		credentialBindingRef: credential.credentialBindingRef as string,
		credentialBindingRevision: credential.credentialBindingRevision as string,
		admission,
	});
	constructedAdmissions.add(capability);
	return capability;
}

export function consumeD713CurrentKeyExecutionAdmission(
	value: unknown,
): D713CurrentKeyExecutionAdmissionV1 {
	if (value === null || typeof value !== "object" || !constructedAdmissions.delete(value)) {
		throw new TypeError("D713 execution requires one same-process current-key admission");
	}
	return value as D713CurrentKeyExecutionAdmissionV1;
}
