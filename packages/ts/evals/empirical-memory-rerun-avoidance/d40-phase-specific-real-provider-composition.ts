import { empiricalSha256, empiricalStrictJsonDigest, record, strictSnapshot } from "./canonical.js";
import type { D38PrematureFinalRealProviderOptionsV1 } from "./d38-premature-final-real-provider-composition.js";
import { createD38PrematureFinalRealProviderExecutor } from "./d38-premature-final-real-provider-composition.js";
import type {
	D40AdmittedEffectV1,
	D40InferenceWireReceiptV1,
} from "./d40-phase-specific-inference-authority.js";

export const D40_ADAPTER_REVISION =
	"graphrefly-ts.d40.phase-specific-real-provider-composition.v1" as const;
const D40_WIRE_RECEIPT_SCHEMA =
	"graphrefly-ts.d40.phase-specific-inference-wire-receipt.v1" as const;
const MAX_REQUEST_BYTES = 2 * 1_048_576;

export interface D40PhaseSpecificRealProviderOptionsV1
	extends Omit<D38PrematureFinalRealProviderOptionsV1, "authority"> {}

export interface D40PhaseSpecificRealProviderExecutorV1 {
	readonly execute: (admitted: D40AdmittedEffectV1) => Promise<
		Readonly<{
			admitted: D40AdmittedEffectV1;
			result: unknown;
			wireReceipt: D40InferenceWireReceiptV1 | null;
		}>
	>;
	readonly dispose: () => Promise<void>;
}

function bodyBytes(value: unknown): Uint8Array {
	if (typeof value === "string") return Buffer.from(value, "utf8");
	if (value instanceof Uint8Array) return new Uint8Array(value);
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	throw new TypeError("D40 provider request body is not bounded bytes");
}

function lowerBody(
	body: Uint8Array,
	admitted: D40AdmittedEffectV1,
): Readonly<{ bytes: Uint8Array; receipt: D40InferenceWireReceiptV1 }> {
	if (body.byteLength < 1 || body.byteLength > MAX_REQUEST_BYTES)
		throw new TypeError("D40 provider request body exceeded its bound");
	const directive = admitted.inferenceDirective;
	if (directive === null) throw new TypeError("D40 provider request has no inference directive");
	const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
	const candidate = record(JSON.parse(decoded), "D40 provider request body");
	if (candidate.max_tokens !== 65_536)
		throw new TypeError("D40 provider request did not retain the frozen pre-lowering ceiling");
	const reasoning = record(candidate.reasoning, "D40 provider request reasoning");
	if (reasoning.effort !== "high")
		throw new TypeError("D40 provider request reasoning effort drifted");
	const lowered = Buffer.from(
		JSON.stringify({ ...candidate, max_tokens: directive.maxOutputTokens }),
		"utf8",
	);
	if (lowered.byteLength < 1 || lowered.byteLength > MAX_REQUEST_BYTES)
		throw new TypeError("D40 lowered provider request exceeded its bound");
	const material = strictSnapshot({
		schemaVersion: D40_WIRE_RECEIPT_SCHEMA,
		requestDigest: directive.requestDigest,
		admissionDigest: directive.admissionDigest,
		logicalRequestDigest: directive.logicalRequestDigest,
		inferenceDirectiveDigest: directive.directiveDigest,
		maxOutputTokens: directive.maxOutputTokens,
		originalBodyDigest: empiricalSha256(body),
		loweredBodyDigest: empiricalSha256(lowered),
	});
	return Object.freeze({
		bytes: lowered,
		receipt: Object.freeze({
			...material,
			receiptDigest: empiricalStrictJsonDigest(material),
		}),
	});
}

export function createD40PhaseSpecificRealProviderExecutor(
	options: D40PhaseSpecificRealProviderOptionsV1,
): D40PhaseSpecificRealProviderExecutorV1 {
	const { fetchImpl, ...baseOptions } = options;
	let active: D40AdmittedEffectV1 | null = null;
	let activeReceipt: D40InferenceWireReceiptV1 | null = null;
	let executing = false;
	const retryBodies = new Map<string, Uint8Array>();
	const base = createD38PrematureFinalRealProviderExecutor({
		...baseOptions,
		authority: undefined as never,
		fetchImpl: async (url, init) => {
			const current = active;
			if (current === null || current.inferenceDirective === null)
				throw new TypeError("D40 transport lacks a Graph inference directive");
			const lowered = lowerBody(bodyBytes(init?.body), current);
			const logical = current.inferenceDirective.logicalRequestDigest;
			const prior = retryBodies.get(logical);
			if (prior !== undefined && !Buffer.from(prior).equals(Buffer.from(lowered.bytes)))
				throw new TypeError("D40 same-logical-request retry wire bytes drifted");
			retryBodies.set(logical, lowered.bytes);
			activeReceipt = lowered.receipt;
			return fetchImpl(url, { ...init, body: lowered.bytes });
		},
	});
	return Object.freeze({
		async execute(admitted: D40AdmittedEffectV1) {
			if (executing) throw new TypeError("D40 observed parallel admitted effects");
			executing = true;
			active = admitted.inferenceDirective === null ? null : admitted;
			activeReceipt = null;
			try {
				const execution = await base.execute(admitted.effect);
				if (admitted.inferenceDirective !== null && activeReceipt === null)
					throw new TypeError("D40 provider effect completed without a wire receipt");
				return Object.freeze({
					admitted,
					result: execution.result,
					wireReceipt: activeReceipt,
				});
			} finally {
				active = null;
				activeReceipt = null;
				executing = false;
			}
		},
		async dispose() {
			if (executing) throw new TypeError("D40 cannot dispose an active effect");
			active = null;
			activeReceipt = null;
			retryBodies.clear();
			await base.dispose();
		},
	});
}
