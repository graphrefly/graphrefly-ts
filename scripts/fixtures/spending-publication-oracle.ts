/** Independent passive oracle. No consumer codec, join or authority-transition imports. */
import { createHash } from "node:crypto";
import type {
	CausalEffectProposal,
	CommittedEffectsView,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";

/** Independent bounded encoder; descriptors are read once and no getters are invoked. */
function oracleEncoding(input: unknown) {
	let remaining = 1048576,
		immutable = true;
	const active = new Set<object>();
	function charge(text: string) {
		remaining -= Buffer.byteLength(text);
		if (remaining < 0) throw Error("frame bound");
		return text;
	}
	function string(value: string) {
		if (value.length > remaining) throw Error("frame bound");
		for (let i = 0; i < value.length; i++) {
			const c = value.charCodeAt(i);
			if (c >= 0xd800 && c <= 0xdbff) {
				const next = value.charCodeAt(++i);
				if (!(next >= 0xdc00 && next <= 0xdfff)) throw Error("surrogate");
			} else if (c >= 0xdc00 && c <= 0xdfff) throw Error("surrogate");
		}
		return charge(JSON.stringify(value));
	}
	function encode(value: unknown): string {
		if (value === null || typeof value === "boolean") return charge(JSON.stringify(value));
		if (typeof value === "number" && Number.isFinite(value)) return charge(JSON.stringify(value));
		if (typeof value === "string") return string(value);
		if (typeof value !== "object" || value === null || active.has(value)) throw Error("passive");
		const array = Array.isArray(value),
			proto = Object.getPrototypeOf(value);
		if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
			throw Error("prototype");
		if (array && value.length > remaining / 2) throw Error("array bound");
		const keys = Reflect.ownKeys(value);
		if (keys.length > remaining / 2 || keys.some((k) => typeof k !== "string")) throw Error("keys");
		const names = (keys as string[]).filter((k) => !array || k !== "length");
		if (array && (names.length !== value.length || names.some((k, i) => k !== String(i))))
			throw Error("array");
		active.add(value);
		immutable &&= Object.isFrozen(value);
		const encoded: string[] = [charge(array ? "[" : "{")];
		let first = true;
		for (const key of array ? names : names.sort()) {
			const d = Object.getOwnPropertyDescriptor(value, key)!;
			if (!("value" in d) || !d.enumerable) throw Error("descriptor");
			if (!first) encoded.push(charge(","));
			first = false;
			if (!array) encoded.push(string(key), charge(":"));
			encoded.push(encode(d.value));
		}
		encoded.push(charge(array ? "]" : "}"));
		active.delete(value);
		return encoded.join("");
	}
	return {
		text: encode(input),
		get immutable() {
			return immutable;
		},
	};
}
export function oracleCanonical(input: unknown): string {
	return oracleEncoding(input).text;
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
	readonly cacheable?: boolean;
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
function coordinatesEqual(left: RecordValue | OracleProfile, right: RecordValue | OracleProfile) {
	for (const key of ["sourceDigest", "runtimeDigest", "compositionEpoch", "hostEpoch"] as const)
		if (left[key] !== right[key]) return false;
	const a = left.destinationRef as { kind: string; id: string },
		b = right.destinationRef as { kind: string; id: string };
	return a.kind === b.kind && a.id === b.id;
}
function proposalKey(p: CausalEffectProposal) {
	const o = p.occurrence;
	return JSON.stringify([
		p.effectId,
		p.proposalDigest,
		p.requestRef.kind,
		p.requestRef.id,
		o.occurrenceId,
		o.revisionDomain,
		o.revision,
		o.digest,
		o.sourceRefs.map((r) => [r.kind, r.id]),
	]);
}
export function verifyPublicationMaterial(raw: unknown, expected: OracleProfile): OracleIndex {
	try {
		const encoding = oracleEncoding(raw);
		const encoded = encoding.text;
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
			!coordinatesEqual(body, expected) ||
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
			if (!coordinatesEqual(b, body)) return { state: "binding-mismatch", rows: new Map() };
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
			const key = proposalKey(proposal as unknown as CausalEffectProposal),
				identity = oracleCanonical([b.occurrence, b.effectId]),
				bytes = oracleCanonical(m);
			if (identities.has(identity) && identities.get(identity) !== bytes) throw Error("conflict");
			identities.set(identity, bytes);
			rows.set(key, oracleFreeze(payload));
		}
		return { state: "valid", rows, cacheable: encoding.immutable };
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
		const key = proposalKey(r.proposal),
			payload = index.rows.get(key);
		if (payload !== undefined) used.add(key);
		return Object.freeze({
			proposal: r.proposal,
			recorded:
				r.outcome?.state ??
				(r.admission?.state === "admitted"
					? "admitted-no-outcome"
					: (r.admission?.state ?? "pending-admission")),
			material:
				index.state !== "valid" ? index.state : payload === undefined ? "missing" : "matched",
			...(payload === undefined ? {} : { payload }),
		});
	});
	return Object.freeze({
		kind: "spending-alerts/publication",
		authorityId: view.authorityId,
		binding: view.binding,
		asOf: profile,
		retention: view.retention,
		materialFrame: index.state,
		unmatchedMaterials: index.rows.size - used.size,
		rows: Object.freeze(rows),
	});
}

export function oracleProfile(raw: OracleProfile): OracleProfile {
	const p = JSON.parse(oracleCanonical(raw));
	shape(p, "packRef|destinationRef|sourceDigest|runtimeDigest|compositionEpoch|hostEpoch");
	reference(p.packRef);
	coordinates(p);
	return oracleFreeze(p);
}
/** Plain code has the same bounded two-input retention/replay/invalidity responsibilities. */
export class PlainPublication {
	private material: unknown;
	private materialSeen = false;
	private view?: CommittedEffectsView;
	private viewSeen = false;
	private index?: OracleIndex;
	private indexed: unknown;
	private subscribers = 0;
	private terminal = false;
	readonly profile: OracleProfile;
	constructor(
		profile: OracleProfile,
		private authorityId = "causal/authority",
		private binding: unknown = {
			contract: "contract-v2",
			implementationRevision: "construction-v1",
			scope: "full",
			epoch: 1,
		},
	) {
		this.profile = oracleProfile(profile);
	}
	acceptMaterial(value: unknown) {
		if (value === undefined) throw TypeError("DATA payload must not be undefined");
		this.material = value;
		this.materialSeen = true;
		return this.project(true);
	}
	acceptView(value: CommittedEffectsView) {
		this.view = value;
		this.viewSeen = true;
		return this.project(false);
	}
	invalidate(lane: "material" | "view") {
		if (lane === "material") {
			this.materialSeen = false;
			this.material = undefined;
			this.index = undefined;
			this.indexed = undefined;
		} else {
			this.viewSeen = false;
			this.view = undefined;
		}
	}
	connect() {
		const cold = this.subscribers === 0;
		this.subscribers++;
		return this.project(cold);
	}
	acceptError() {
		this.terminal = true;
		this.index = undefined;
		this.indexed = undefined;
	}
	disconnect() {
		this.subscribers = Math.max(0, this.subscribers - 1);
		if (!this.subscribers) {
			this.index = undefined;
			this.indexed = undefined;
		}
	}
	project(materialArrived = false) {
		if (this.terminal || !this.subscribers || !this.materialSeen) return undefined;
		if (
			!this.index ||
			this.indexed !== this.material ||
			(materialArrived && !this.index.cacheable)
		) {
			this.index = verifyPublicationMaterial(this.material, this.profile);
			this.indexed = this.material;
		}
		if (!this.viewSeen || !this.view) return undefined;
		if (
			this.view.kind !== "causal-committed-effects" ||
			this.view.authorityId !== this.authorityId ||
			oracleCanonical(this.view.binding) !== oracleCanonical(this.binding)
		)
			throw Error("authority binding");
		return oraclePublication(this.view, this.index, this.profile);
	}
}
