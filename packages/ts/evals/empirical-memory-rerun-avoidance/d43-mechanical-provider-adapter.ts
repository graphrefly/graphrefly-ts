import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, strictSnapshot } from "./canonical.js";
import type { D43AdmittedEffectV1 } from "./d43-graph-harness-authority.js";

export const D43_MECHANICAL_ADAPTER_REVISION =
	"graphrefly-ts.d43.mechanical-provider-adapter.v1" as const;

export interface D43LoweredProviderWireV1 {
	readonly adapterRevision: typeof D43_MECHANICAL_ADAPTER_REVISION;
	readonly logicalRequestDigest: string;
	readonly bytes: Uint8Array;
	readonly wireDigest: string;
}

export function lowerD43ProviderEffect(effect: D43AdmittedEffectV1): D43LoweredProviderWireV1 {
	if (
		!effect.providerEffect ||
		(effect.kind !== "inspection" && effect.kind !== "mutation") ||
		effect.maxOutputTokens === null
	)
		throw new TypeError("D43 mechanical adapter requires one admitted provider effect");
	const body = strictSnapshot({
		schemaVersion: "graphrefly-ts.d43.mechanical-provider-wire.v1" as const,
		model: effect.modelRef,
		provider: effect.providerRef,
		protocol: effect.endpointProtocol,
		policyDigest: effect.policyDigest,
		planDigest: effect.planDigest,
		taskEnvelopeDigest: effect.taskEnvelopeDigest,
		retainsInspectionSpan: effect.retainsInspectionSpan,
		logicalRequestDigest: effect.logicalRequestDigest,
		phase: effect.kind,
		toolChoice:
			effect.namedToolRef === null
				? Object.freeze({ encoding: "auto" as const })
				: Object.freeze({
						encoding: effect.namedToolChoiceEncoding,
						name: effect.namedToolRef,
					}),
		maxOutputTokens: effect.maxOutputTokens,
		parallelToolCalls: false as const,
	});
	const bytes = strictJsonCodec.encode(body);
	return Object.freeze({
		adapterRevision: D43_MECHANICAL_ADAPTER_REVISION,
		logicalRequestDigest: effect.logicalRequestDigest,
		bytes,
		wireDigest: empiricalSha256(bytes),
	});
}
