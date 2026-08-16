import type { CurrentGraphProviderAdmittedEffectV1 } from "./d6-current-provider-authority.js";

export const D11_TRANSPORT_ENVELOPE_SCHEMA =
	"graphrefly-ts.d11.transport-result-envelope.v1" as const;
export const D11_TRANSPORT_PROPOSAL_SCHEMA =
	"graphrefly-ts.d11.transport-failure-proposal.v1" as const;
export const D11_TRANSPORT_FACT_SCHEMA = "graphrefly-ts.d11.transport-failure-fact.v1" as const;

export const D11_TRANSPORT_CAUSES = Object.freeze([
	"owned-deadline",
	"connect-timeout",
	"headers-timeout",
	"body-timeout",
	"connection-reset",
	"dns-failure",
] as const);

export type D11TransportCause = (typeof D11_TRANSPORT_CAUSES)[number];
export type D11TransportPhase = "request" | "response-body";

export interface D11TransportFailureProposalV1 {
	readonly schemaVersion: typeof D11_TRANSPORT_PROPOSAL_SCHEMA;
	readonly phase: D11TransportPhase;
	readonly causeCode: D11TransportCause;
	readonly requestDigest: string;
	readonly admissionDigest: string;
	readonly logicalRequestDigest: string;
	readonly workspaceStateDigest: string;
	readonly reservationDigest: string;
	readonly proposalDigest: string;
}

export interface D11TransportResultEnvelopeV1 {
	readonly schemaVersion: typeof D11_TRANSPORT_ENVELOPE_SCHEMA;
	readonly result: unknown;
	readonly transportProposal: D11TransportFailureProposalV1 | null;
}

export function validD11TransportPhaseCause(
	phase: D11TransportPhase,
	cause: D11TransportCause,
): boolean {
	if (cause === "body-timeout") return phase === "response-body";
	if (cause === "connection-reset") return phase === "response-body";
	if (cause === "connect-timeout" || cause === "headers-timeout" || cause === "dns-failure")
		return phase === "request";
	return true;
}

export function isD11ProviderEffect(effect: CurrentGraphProviderAdmittedEffectV1): boolean {
	return effect.request.effectKind === "provider-request";
}
