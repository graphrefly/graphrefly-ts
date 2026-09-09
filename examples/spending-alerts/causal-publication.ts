/** Consumer-private, passive publication. D160-D163; never an execution permission. */
import { createHash } from "node:crypto";
import { depBatch, depLatest } from "../../packages/ts/src/ctx/types.js";
import type {
	ConstructionScope,
	StartupFact,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type { CausalBinding } from "../../packages/ts/src/solutions/causal-occurrence/capabilities.js";
import { buildCausalNodes } from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type {
	CausalEffectProposal,
	CausalOccurrenceRef,
	CausalSourceRef,
	CommittedEffectsView,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";

const REQUEST = "spending-alerts/request-material/v1";
const SNAPSHOT = "spending-alerts/material-snapshot/v1";
const PROPOSAL = "spending-alerts/effect-proposal/v1";
const MAX_FRAME = 1048576;
const MAX_PAYLOAD = 8192;
const MAX_MATERIALS = 64;
export interface MaterialProfile {
	readonly packRef: CausalSourceRef;
	readonly sourceDigest: string;
	readonly runtimeDigest: string;
	readonly destinationRef: CausalSourceRef;
	readonly compositionEpoch: number;
	readonly hostEpoch: number;
}
export interface AlertPayload {
	readonly transactionId: string;
	readonly vendor: string;
	readonly severity: "low" | "medium" | "high";
	readonly message: string;
}
export interface MaterialBody extends Omit<MaterialProfile, "packRef"> {
	readonly schema: typeof REQUEST;
	readonly occurrence: CausalOccurrenceRef;
	readonly effectId: string;
	readonly inputDigest: string;
	readonly policyDigest: string;
	readonly payloadText: string;
	readonly payloadDigest: string;
}
export interface RequestMaterial {
	readonly body: MaterialBody;
	readonly requestRef: CausalSourceRef;
	readonly proposalDigest: string;
}
export interface MaterialSnapshot {
	readonly body: MaterialProfile & {
		readonly schema: typeof SNAPSHOT;
		readonly materials: readonly RequestMaterial[];
	};
	readonly digest: string;
}
export type MaterialState = "matched" | "missing" | "invalid/conflicting" | "binding-mismatch";
export interface PublicationRow {
	readonly proposal: CausalEffectProposal;
	readonly recorded:
		| "pending-admission"
		| "rejected"
		| "admitted-no-outcome"
		| NonNullable<CommittedEffectsView["effects"][number]["outcome"]>["state"];
	readonly material: MaterialState;
	readonly payload?: AlertPayload;
}
export interface Publication {
	readonly kind: "spending-alerts/publication";
	readonly authorityId: string;
	readonly binding: CausalBinding;
	readonly asOf: MaterialProfile;
	readonly retention: CommittedEffectsView["retention"];
	readonly materialFrame: "valid" | "invalid/conflicting" | "binding-mismatch";
	readonly unmatchedMaterials: number;
	readonly rows: readonly PublicationRow[];
}

/** Descriptor-safe, bounded canonical encoding. Canonical-text equality also rejects duplicate keys. */
function encodeMaterial(value: unknown, limit = MAX_FRAME): { text: string; immutable: boolean } {
	let immutable = true;
	let bytes = 0;
	const ancestors = new Set<object>();
	function token(s: string): string {
		bytes += Buffer.byteLength(s, "utf8");
		if (bytes > limit) throw new TypeError("material byte limit");
		return s;
	}
	function string(s: string): string {
		if (
			s.length > limit ||
			/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(s)
		)
			throw new TypeError("invalid material string");
		return token(JSON.stringify(s));
	}
	function visit(v: unknown): string {
		if (v === null) return token("null");
		if (typeof v === "string") return string(v);
		if (typeof v === "boolean") return token(String(v));
		if (typeof v === "number" && Number.isFinite(v)) return token(JSON.stringify(v));
		if (typeof v !== "object" || v === null || ancestors.has(v))
			throw new TypeError("not passive JSON");
		const array = Array.isArray(v);
		const proto = Object.getPrototypeOf(v);
		if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
			throw new TypeError("non-data prototype");
		if (array && v.length > limit / 2) throw new TypeError("material byte limit");
		immutable &&= Object.isFrozen(v);
		ancestors.add(v);
		const keys = Reflect.ownKeys(v);
		if (keys.length > limit / 2 || keys.some((k) => typeof k !== "string"))
			throw new TypeError("invalid material keys");
		const names = (keys as string[]).filter((k) => !array || k !== "length");
		if (array && (names.length !== v.length || names.some((k, i) => k !== String(i))))
			throw new TypeError("non-data array");
		const pieces = [token(array ? "[" : "{")];
		for (const [i, key] of (array ? names : names.sort()).entries()) {
			const descriptor = Object.getOwnPropertyDescriptor(v, key)!;
			if (!("value" in descriptor) || !descriptor.enumerable)
				throw new TypeError("non-data property");
			if (i) pieces.push(token(","));
			if (!array) pieces.push(string(key), token(":"));
			pieces.push(visit(descriptor.value));
		}
		pieces.push(token(array ? "]" : "}"));
		ancestors.delete(v);
		return pieces.join("");
	}
	const result = visit(value);
	return { text: result, immutable };
}
export function canonicalMaterial(value: unknown, limit = MAX_FRAME): string {
	return encodeMaterial(value, limit).text;
}
export function materialDigest(text: string): string {
	return `sha256:${createHash("sha256").update(text, "utf8").digest("hex")}`;
}
function freeze<T>(v: T): T {
	if (v !== null && typeof v === "object") {
		for (const child of Object.values(v)) freeze(child);
		Object.freeze(v);
	}
	return v;
}
function keys(value: unknown, expected: string): void {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== expected.split(",").sort().join(",")
	)
		throw new TypeError("material shape");
}
function text(v: unknown): asserts v is string {
	if (typeof v !== "string") throw new TypeError("material text");
}
function digest(v: unknown) {
	if (typeof v !== "string" || !/^sha256:[0-9a-f]{64}$/.test(v))
		throw new TypeError("material digest");
}
function epoch(v: unknown) {
	if (!Number.isSafeInteger(v) || (v as number) < 1) throw new TypeError("material epoch");
}
function ref(v: unknown) {
	keys(v, "kind,id");
	const r = v as CausalSourceRef;
	text(r.kind);
	text(r.id);
}
function occurrence(raw: unknown) {
	const v = raw as CausalOccurrenceRef;
	keys(v, "revisionDomain,occurrenceId,revision,digest,sourceRefs");
	text(v.revisionDomain);
	text(v.occurrenceId);
	epoch(v.revision);
	digest(v.digest);
	if (!Array.isArray(v.sourceRefs)) throw new TypeError("material sources");
	for (const source of v.sourceRefs) ref(source);
}
function profile(v: MaterialProfile) {
	ref(v.packRef);
	ref(v.destinationRef);
	digest(v.sourceDigest);
	digest(v.runtimeDigest);
	epoch(v.compositionEpoch);
	epoch(v.hostEpoch);
}
function sameBinding(a: Omit<MaterialProfile, "packRef">, b: Omit<MaterialProfile, "packRef">) {
	return (
		a.sourceDigest === b.sourceDigest &&
		a.runtimeDigest === b.runtimeDigest &&
		a.compositionEpoch === b.compositionEpoch &&
		a.hostEpoch === b.hostEpoch &&
		a.destinationRef.kind === b.destinationRef.kind &&
		a.destinationRef.id === b.destinationRef.id
	);
}
export function proposalForMaterial(m: RequestMaterial): CausalEffectProposal {
	return freeze({
		occurrence: m.body.occurrence,
		effectId: m.body.effectId,
		requestRef: m.requestRef,
		proposalDigest: m.proposalDigest,
	});
}
export function makeRequestMaterial(body: MaterialBody): RequestMaterial {
	const safe = freeze(JSON.parse(canonicalMaterial(body))) as MaterialBody;
	const requestRef = { kind: REQUEST, id: materialDigest(canonicalMaterial(safe)) };
	return freeze({
		body: safe,
		requestRef,
		proposalDigest: materialDigest(
			canonicalMaterial({
				schema: PROPOSAL,
				occurrence: safe.occurrence,
				effectId: safe.effectId,
				requestRef,
			}),
		),
	});
}
export function makeMaterialSnapshot(
	p: MaterialProfile,
	materials: readonly RequestMaterial[],
): MaterialSnapshot {
	const body = JSON.parse(canonicalMaterial({ ...p, schema: SNAPSHOT, materials }));
	return freeze({ body, digest: materialDigest(canonicalMaterial(body)) });
}
function associationKey(p: CausalEffectProposal): string {
	// Full passive tuple; deliberately does not hash or clone the authority table.
	const o = p.occurrence;
	return JSON.stringify([
		o.revisionDomain,
		o.occurrenceId,
		o.revision,
		o.digest,
		o.sourceRefs.map((r) => [r.kind, r.id]),
		p.effectId,
		p.requestRef.kind,
		p.requestRef.id,
		p.proposalDigest,
	]);
}
interface MaterialIndex {
	readonly cacheable?: boolean;
	readonly state: Publication["materialFrame"];
	readonly rows: ReadonlyMap<string, AlertPayload>;
}
/** New frames are always independently validated; no self-reported digest shortcut. */
export function validateMaterialSnapshot(raw: unknown, expected: MaterialProfile): MaterialIndex {
	const rows = new Map<string, AlertPayload>();
	try {
		// The raw shape check is descriptor-safe: all reads below are from the canonical copy.
		const encoded = encodeMaterial(raw);
		const frame = JSON.parse(encoded.text) as MaterialSnapshot;
		keys(frame, "body,digest");
		keys(
			frame.body,
			"schema,packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch,materials",
		);
		if (
			frame.body.schema !== SNAPSHOT ||
			!Array.isArray(frame.body.materials) ||
			frame.body.materials.length > MAX_MATERIALS
		)
			throw new TypeError("material frame");
		profile(frame.body);
		digest(frame.digest);
		if (materialDigest(canonicalMaterial(frame.body)) !== frame.digest)
			throw new TypeError("frame digest mismatch");
		if (
			!sameBinding(frame.body, expected) ||
			frame.body.packRef.kind !== expected.packRef.kind ||
			frame.body.packRef.id !== expected.packRef.id
		)
			return { state: "binding-mismatch", rows };
		const contents = new Map<string, string>();
		for (const m of frame.body.materials) {
			keys(m, "body,requestRef,proposalDigest");
			keys(
				m.body,
				"schema,occurrence,effectId,destinationRef,compositionEpoch,hostEpoch,inputDigest,policyDigest,sourceDigest,runtimeDigest,payloadText,payloadDigest",
			);
			const b = m.body;
			if (b.schema !== REQUEST) throw new TypeError("material schema");
			occurrence(b.occurrence);
			text(b.effectId);
			ref(b.destinationRef);
			epoch(b.hostEpoch);
			epoch(b.compositionEpoch);
			for (const d of [
				b.inputDigest,
				b.policyDigest,
				b.sourceDigest,
				b.runtimeDigest,
				b.payloadDigest,
				m.proposalDigest,
			])
				digest(d);
			ref(m.requestRef);
			text(b.payloadText);
			if (!sameBinding(b, frame.body)) return { state: "binding-mismatch", rows: new Map() };
			if (Buffer.byteLength(b.payloadText, "utf8") > MAX_PAYLOAD)
				throw new TypeError("payload byte limit");
			const payload = JSON.parse(b.payloadText) as AlertPayload;
			keys(payload, "transactionId,vendor,severity,message");
			text(payload.transactionId);
			text(payload.vendor);
			text(payload.message);
			if (
				!["low", "medium", "high"].includes(payload.severity) ||
				canonicalMaterial(payload, MAX_PAYLOAD) !== b.payloadText ||
				materialDigest(b.payloadText) !== b.payloadDigest
			)
				throw new TypeError("payload mismatch");
			if (
				m.requestRef.kind !== REQUEST ||
				m.requestRef.id !== materialDigest(canonicalMaterial(b)) ||
				m.proposalDigest !==
					materialDigest(
						canonicalMaterial({
							schema: PROPOSAL,
							occurrence: b.occurrence,
							effectId: b.effectId,
							requestRef: m.requestRef,
						}),
					)
			)
				throw new TypeError("request mismatch");
			const key = associationKey(proposalForMaterial(m));
			const identity = JSON.stringify([
				b.occurrence.revisionDomain,
				b.occurrence.occurrenceId,
				b.occurrence.revision,
				b.occurrence.digest,
				b.occurrence.sourceRefs,
				b.effectId,
			]);
			const content = canonicalMaterial(m);
			if (contents.has(identity) && contents.get(identity) !== content)
				throw new TypeError("conflicting material");
			contents.set(identity, content);
			rows.set(key, freeze(payload));
		}
		return { state: "valid", rows, cacheable: encoded.immutable };
	} catch {
		return { state: "invalid/conflicting", rows: new Map() };
	}
}
interface JoinResult {
	readonly view: CommittedEffectsView;
	readonly index: MaterialIndex;
}
function publicationFor(join: JoinResult, asOf: MaterialProfile): Publication {
	const used = new Set<string>();
	const rows = join.view.effects.map((record) => {
		const key = associationKey(record.proposal);
		const payload = join.index.rows.get(key);
		if (payload !== undefined) used.add(key);
		return Object.freeze({
			proposal: record.proposal,
			recorded:
				record.outcome?.state ??
				(record.admission?.state === "admitted"
					? "admitted-no-outcome"
					: (record.admission?.state ?? "pending-admission")),
			material:
				join.index.state !== "valid"
					? join.index.state
					: payload === undefined
						? "missing"
						: "matched",
			...(payload === undefined ? {} : { payload }),
		}) as PublicationRow;
	});
	return Object.freeze({
		kind: "spending-alerts/publication",
		authorityId: join.view.authorityId,
		binding: join.view.binding,
		asOf,
		retention: join.view.retention,
		materialFrame: join.index.state,
		unmatchedMaterials: join.index.rows.size - used.size,
		rows: Object.freeze(rows),
	});
}
/** This private assembly calls the real builder itself: callers cannot substitute a named view. */
export function buildSpendingPublication<T>(
	ownerGraph: Graph,
	scope: ConstructionScope,
	startup: Node<StartupFact>,
	prepared: Parameters<typeof buildCausalNodes<T>>[3],
	binding: CausalBinding,
	materialSource: Node<unknown>,
	expected: MaterialProfile,
) {
	const asOf = freeze(JSON.parse(canonicalMaterial(expected))) as MaterialProfile;
	keys(asOf, "packRef,sourceDigest,runtimeDigest,destinationRef,compositionEpoch,hostEpoch");
	profile(asOf);
	scope.assertContext(ownerGraph, startup, asOf.compositionEpoch);
	if (asOf.compositionEpoch !== binding.epoch) throw new TypeError("publication context mismatch");
	const causal = buildCausalNodes(ownerGraph, scope, startup, prepared, binding);
	const authorityId = `${prepared.options.name}/authority`;
	const expectedBinding = canonicalMaterial(binding);
	const requestMaterialJoin = scope.node<JoinResult>(
		[causal.committedEffects, materialSource],
		(ctx) => {
			// Missing dependencies invalidate positional meaning; never use an old cached join.
			if (
				ctx.waveData.length !== 2 ||
				requestMaterialJoin.deps[0] !== causal.committedEffects ||
				requestMaterialJoin.deps[1] !== materialSource
			) {
				ctx.down([["ERROR", new TypeError("publication dependency mismatch")]]);
				return;
			}
			let state = ctx.state.get<{
				raw?: unknown;
				index?: MaterialIndex;
				validatedBinding?: CausalBinding;
			}>();
			if (state === undefined) {
				state = {};
				ctx.state.set(state);
			}
			// These context helpers read only DATA delivered to this invocation's declared edges.
			// Their per-dependency INVALIDATE bookkeeping remains valid even while this node is SENTINEL.
			const view = depLatest(ctx, 0) as CommittedEffectsView | undefined;
			const raw = depLatest(ctx, 1);
			const materialArrived = Boolean(depBatch(ctx, 1)?.length);
			if (raw === undefined && !materialArrived) {
				state.raw = undefined;
				state.index = undefined;
				return;
			}
			if (
				raw !== state.raw ||
				state.index === undefined ||
				(materialArrived && !state.index.cacheable)
			)
				state.index = validateMaterialSnapshot(raw, asOf);
			// Keep the validated copy for unchanged DATA, even if its sender later mutates their object.
			// Native dep validity gates output; only a new material DATA can replace this finite index.
			state.raw = raw;
			if (view === undefined) return;
			if (
				view.kind !== "causal-committed-effects" ||
				view.authorityId !== authorityId ||
				((state.validatedBinding === undefined || state.validatedBinding !== view.binding) &&
					canonicalMaterial(view.binding) !== expectedBinding)
			) {
				ctx.down([["ERROR", new TypeError("publication authority binding")]]);
				return;
			}
			// Canonical success proves this frozen binding contains only the exact flat primitive fields.
			// Mutable or new references always pass through the full validator; this is derived RAM only.
			if (Object.isFrozen(view.binding)) state.validatedBinding = view.binding;
			ctx.down([["DATA", Object.freeze({ view, index: state.index })]]);
		},
		{
			name: "requestMaterialJoin",
			factory: "spendingRequestMaterialJoin",
			errorWhenDepsError: true,
		},
	);
	const publication = scope.node<Publication>(
		[requestMaterialJoin],
		(ctx) => {
			for (const j of (depBatch(ctx, 0) ?? []) as JoinResult[])
				ctx.down([["DATA", publicationFor(j, asOf)]]);
		},
		{ name: "publication", factory: "spendingPublication", errorWhenDepsError: true },
	);
	return Object.freeze({ causal, requestMaterialJoin, publication });
}
