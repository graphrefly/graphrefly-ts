/** Independent passive oracle. No consumer codec, join or authority-transition imports. */
import { createHash } from "node:crypto";
import type { CommittedEffectsView } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";

export function oracleCanonical(input: unknown): string {
	if (input === null || typeof input === "boolean") return JSON.stringify(input);
	if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
	if (typeof input === "string") {
		for (let i = 0; i < input.length; i++) {
			const c = input.charCodeAt(i);
			if (c >= 0xd800 && c <= 0xdbff) {
				const next = input.charCodeAt(++i);
				if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error("surrogate");
			} else if (c >= 0xdc00 && c <= 0xdfff) throw Error("surrogate");
		}
		return JSON.stringify(input);
	}
	if (Array.isArray(input)) {
		if (
			Object.getPrototypeOf(input) !== Array.prototype ||
			Reflect.ownKeys(input).length !== input.length + 1
		)
			throw Error("array");
		for (let i = 0; i < input.length; i++) {
			const d = Object.getOwnPropertyDescriptor(input, String(i));
			if (!d || !("value" in d) || !d.enumerable) throw Error("array descriptor");
		}
		return `[${input.map(oracleCanonical).join(",")}]`;
	}
	if (typeof input !== "object" || input === null) throw Error("passive");
	const proto = Object.getPrototypeOf(input);
	if (proto !== Object.prototype && proto !== null) throw Error("prototype");
	const entries = Reflect.ownKeys(input).sort();
	return `{${entries
		.map((k) => {
			if (typeof k !== "string") throw Error("key");
			const d = Object.getOwnPropertyDescriptor(input, k)!;
			if (!("value" in d) || !d.enumerable) throw Error("descriptor");
			return `${oracleCanonical(k)}:${oracleCanonical(d.value)}`;
		})
		.join(",")}}`;
}
export const oracleHash = (s: string) => `sha256:${createHash("sha256").update(s).digest("hex")}`;
export function oracleFreeze<T>(v: T): T {
	if (v !== null && typeof v === "object") {
		Object.values(v).forEach(oracleFreeze);
		Object.freeze(v);
	}
	return v;
}
/** Independently reconstruct a valid material from passive body fields. */
export function oracleMaterial<B extends { occurrence: unknown; effectId: string }>(body: B) {
	const requestRef = {
		kind: "spending-alerts/request-material/v1",
		id: oracleHash(oracleCanonical(body)),
	};
	return oracleFreeze({
		body,
		requestRef,
		proposalDigest: oracleHash(
			oracleCanonical({
				schema: "spending-alerts/effect-proposal/v1",
				occurrence: body.occurrence,
				effectId: body.effectId,
				requestRef,
			}),
		),
	});
}
export function oracleSnapshot<P>(p: P, materials: readonly unknown[]) {
	const body = { ...p, schema: "spending-alerts/material-snapshot/v1" as const, materials };
	return oracleFreeze({ body, digest: oracleHash(oracleCanonical(body)) });
}
/** Independent full-coordinate association for already externally validated finite fixtures. */
export function oracleRows(
	view: CommittedEffectsView,
	materials: readonly {
		body: { occurrence: unknown; effectId: string; payloadText: string };
		requestRef: unknown;
		proposalDigest: string;
	}[],
) {
	const index = new Map(
		materials.map((m) => [
			oracleCanonical({
				occurrence: m.body.occurrence,
				effectId: m.body.effectId,
				requestRef: m.requestRef,
				proposalDigest: m.proposalDigest,
			}),
			JSON.parse(m.body.payloadText),
		]),
	);
	return view.effects.map((r) => {
		const payload = index.get(oracleCanonical(r.proposal));
		return {
			proposal: r.proposal,
			recorded:
				r.outcome?.state ??
				(r.admission?.state === "admitted"
					? "admitted-no-outcome"
					: (r.admission?.state ?? "pending-admission")),
			material: payload === undefined ? "missing" : "matched",
			...(payload === undefined ? {} : { payload }),
		};
	});
}

// The verifier consumes unknown material independently; valid-fixture generation above is not a grant.
type RecordValue = Record<string, unknown>;
export interface OracleProfile {
	readonly packRef: { readonly kind: string; readonly id: string };
	readonly destinationRef: { readonly kind: string; readonly id: string };
	readonly sourceDigest: string;
	readonly runtimeDigest: string;
	readonly compositionEpoch: number;
	readonly hostEpoch: number;
}
export interface OracleIndex {
	readonly state: "valid" | "binding-mismatch" | "invalid/conflicting";
	readonly rows: ReadonlyMap<string, RecordValue>;
}
function shape(v: unknown, names: string): RecordValue {
	if (
		!v ||
		typeof v !== "object" ||
		Array.isArray(v) ||
		Object.keys(v).sort().join("|") !== names.split("|").sort().join("|")
	)
		throw Error("shape");
	return v as RecordValue;
}
function stringFields(v: RecordValue, names: string) {
	for (const n of names.split("|")) if (typeof v[n] !== "string") throw Error("string");
}
function reference(v: unknown) {
	const o = shape(v, "kind|id");
	stringFields(o, "kind|id");
}
function isDigest(v: unknown) {
	if (typeof v !== "string" || !/^sha256:[0-9a-f]{64}$/.test(v)) throw Error("digest");
}
function coordinates(v: RecordValue) {
	reference(v.destinationRef);
	isDigest(v.sourceDigest);
	isDigest(v.runtimeDigest);
	for (const n of ["hostEpoch", "compositionEpoch"])
		if (!Number.isSafeInteger(v[n]) || (v[n] as number) < 1) throw Error("epoch");
}
function coordinateKey(v: RecordValue | OracleProfile) {
	return oracleCanonical([
		v.destinationRef,
		v.sourceDigest,
		v.runtimeDigest,
		v.compositionEpoch,
		v.hostEpoch,
	]);
}
export function verifyPublicationMaterial(raw: unknown, expected: OracleProfile): OracleIndex {
	try {
		const encoded = oracleCanonical(raw);
		if (Buffer.byteLength(encoded) > 1048576) throw Error("frame bound");
		const frame = shape(JSON.parse(encoded), "body|digest");
		const body = shape(
			frame.body,
			"schema|packRef|destinationRef|sourceDigest|runtimeDigest|compositionEpoch|hostEpoch|materials",
		);
		if (
			body.schema !== "spending-alerts/material-snapshot/v1" ||
			!Array.isArray(body.materials) ||
			body.materials.length > 64
		)
			throw Error("snapshot");
		reference(body.packRef);
		coordinates(body);
		isDigest(frame.digest);
		if (oracleHash(oracleCanonical(body)) !== frame.digest) throw Error("frame hash");
		if (
			coordinateKey(body) !== coordinateKey(expected) ||
			oracleCanonical(body.packRef) !== oracleCanonical(expected.packRef)
		)
			return { state: "binding-mismatch", rows: new Map() };
		const rows = new Map<string, RecordValue>(),
			identities = new Map<string, string>();
		for (const value of body.materials) {
			const m = shape(value, "body|requestRef|proposalDigest");
			const b = shape(
				m.body,
				"schema|occurrence|effectId|destinationRef|compositionEpoch|hostEpoch|inputDigest|policyDigest|sourceDigest|runtimeDigest|payloadText|payloadDigest",
			);
			if (b.schema !== "spending-alerts/request-material/v1") throw Error("schema");
			coordinates(b);
			stringFields(b, "effectId|payloadText");
			for (const n of ["inputDigest", "policyDigest", "payloadDigest"]) isDigest(b[n]);
			isDigest(m.proposalDigest);
			reference(m.requestRef);
			const o = shape(b.occurrence, "revisionDomain|occurrenceId|revision|digest|sourceRefs");
			stringFields(o, "revisionDomain|occurrenceId");
			isDigest(o.digest);
			if (
				!Number.isSafeInteger(o.revision) ||
				(o.revision as number) < 1 ||
				!Array.isArray(o.sourceRefs)
			)
				throw Error("occurrence");
			o.sourceRefs.forEach(reference);
			if (coordinateKey(b) !== coordinateKey(body))
				return { state: "binding-mismatch", rows: new Map() };
			const payloadText = b.payloadText as string;
			if (Buffer.byteLength(payloadText) > 8192) throw Error("payload bound");
			const payload = shape(JSON.parse(payloadText), "transactionId|vendor|severity|message");
			stringFields(payload, "transactionId|vendor|severity|message");
			if (
				!["low", "medium", "high"].includes(payload.severity as string) ||
				oracleCanonical(payload) !== payloadText ||
				oracleHash(payloadText) !== b.payloadDigest
			)
				throw Error("payload hash");
			const request = m.requestRef as RecordValue;
			if (
				request.kind !== "spending-alerts/request-material/v1" ||
				request.id !== oracleHash(oracleCanonical(b))
			)
				throw Error("request hash");
			const proposal = {
				occurrence: b.occurrence,
				effectId: b.effectId,
				requestRef: request,
				proposalDigest: m.proposalDigest,
			};
			if (
				m.proposalDigest !==
				oracleHash(
					oracleCanonical({
						schema: "spending-alerts/effect-proposal/v1",
						occurrence: b.occurrence,
						effectId: b.effectId,
						requestRef: request,
					}),
				)
			)
				throw Error("proposal hash");
			const key = oracleCanonical(proposal),
				identity = oracleCanonical([b.occurrence, b.effectId]),
				bytes = oracleCanonical(m);
			if (identities.has(identity) && identities.get(identity) !== bytes) throw Error("conflict");
			identities.set(identity, bytes);
			rows.set(key, oracleFreeze(payload));
		}
		return { state: "valid", rows };
	} catch {
		return { state: "invalid/conflicting", rows: new Map() };
	}
}
export function oraclePublication(
	view: CommittedEffectsView,
	index: OracleIndex,
	profile: OracleProfile,
) {
	const used = new Set<string>();
	const rows = view.effects.map((r) => {
		const key = oracleCanonical(r.proposal),
			payload = index.rows.get(key);
		if (payload !== undefined) used.add(key);
		return {
			proposal: r.proposal,
			recorded:
				r.outcome?.state ??
				(r.admission?.state === "admitted"
					? "admitted-no-outcome"
					: (r.admission?.state ?? "pending-admission")),
			material:
				index.state !== "valid" ? index.state : payload === undefined ? "missing" : "matched",
			...(payload === undefined ? {} : { payload }),
		};
	});
	return {
		kind: "spending-alerts/publication",
		authorityId: view.authorityId,
		binding: view.binding,
		asOf: profile,
		retention: view.retention,
		materialFrame: index.state,
		unmatchedMaterials: index.rows.size - used.size,
		rows,
	};
}
