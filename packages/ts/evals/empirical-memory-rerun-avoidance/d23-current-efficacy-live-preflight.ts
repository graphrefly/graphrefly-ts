import { empiricalStrictJsonDigest, exactKeys, record, strictSnapshot } from "./canonical.js";
import {
	admitD20ZeroByok,
	composeD20Preclaim,
	consumeD20Preclaim,
	type D20CredentialV1,
	type D20PreclaimV1,
	type D20PricingObservationV1,
	type D20ZeroByokObservationV1,
	readD20OfficialPricing,
} from "./d20-current-live-preflight.js";
import { D23_COORDINATES_DIGEST } from "./d23-current-efficacy-live-coordinates.js";

export const D23_PRECLAIM_SCHEMA = "graphrefly-ts.d23.live-preclaim.v1" as const;

export type D23CredentialV1 = D20CredentialV1;
export type D23PricingObservationV1 = D20PricingObservationV1;
export type D23ZeroByokObservationV1 = D20ZeroByokObservationV1;

export interface D23PreclaimV1 {
	readonly schemaVersion: typeof D23_PRECLAIM_SCHEMA;
	readonly coordinatesDigest: string;
	readonly pricingObservationDigest: string;
	readonly zeroByokObservationDigest: string;
	readonly credentialBindingDigest: string;
	readonly expiresAtMs: number;
	readonly preclaimDigest: string;
}

const states = new WeakMap<object, D20PreclaimV1>();

export const readD23OfficialPricing = readD20OfficialPricing;
export const admitD23ZeroByok = admitD20ZeroByok;

export function composeD23Preclaim(inputValue: {
	readonly pricingObservation: D23PricingObservationV1;
	readonly zeroByokObservation: D23ZeroByokObservationV1;
	readonly credential: D23CredentialV1;
	readonly nowMs: number;
}): D23PreclaimV1 {
	const input = record(inputValue, "D23 preclaim input");
	exactKeys(
		input,
		["credential", "nowMs", "pricingObservation", "zeroByokObservation"],
		"D23 preclaim input",
	);
	const underlying = composeD20Preclaim(inputValue);
	const material = strictSnapshot({
		schemaVersion: D23_PRECLAIM_SCHEMA,
		coordinatesDigest: D23_COORDINATES_DIGEST,
		pricingObservationDigest: underlying.pricingObservation.observationDigest,
		zeroByokObservationDigest: underlying.zeroByokObservation.observationDigest,
		credentialBindingDigest: underlying.credentialBindingDigest,
		expiresAtMs: underlying.expiresAtMs,
	});
	const preclaim = Object.freeze({
		...material,
		preclaimDigest: empiricalStrictJsonDigest(material),
	}) as D23PreclaimV1;
	states.set(preclaim, underlying);
	return preclaim;
}

export function consumeD23Preclaim(value: unknown, nowMs: number): D23PreclaimV1 {
	if (value === null || typeof value !== "object") throw new TypeError("D23 preclaim is invalid");
	const underlying = states.get(value);
	if (underlying === undefined) throw new TypeError("D23 preclaim is forged, stale or replayed");
	states.delete(value);
	consumeD20Preclaim(underlying, nowMs);
	const preclaim = value as D23PreclaimV1;
	if (
		preclaim.coordinatesDigest !== D23_COORDINATES_DIGEST ||
		preclaim.preclaimDigest !==
			empiricalStrictJsonDigest({
				schemaVersion: preclaim.schemaVersion,
				coordinatesDigest: preclaim.coordinatesDigest,
				pricingObservationDigest: preclaim.pricingObservationDigest,
				zeroByokObservationDigest: preclaim.zeroByokObservationDigest,
				credentialBindingDigest: preclaim.credentialBindingDigest,
				expiresAtMs: preclaim.expiresAtMs,
			})
	)
		throw new TypeError("D23 preclaim coordinates drifted");
	return preclaim;
}
