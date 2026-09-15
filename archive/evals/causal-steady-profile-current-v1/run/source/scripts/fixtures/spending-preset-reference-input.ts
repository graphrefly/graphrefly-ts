/** Independent finite input decoder for the plain and Graph reference arms. No candidate validation. */
import type { SpendingBinding } from "../../examples/spending-alerts/causal-inputs.js";
import {
	oracleCanonical as canonical,
	oracleFreeze,
	oracleHash,
} from "./spending-publication-oracle.js";
export type ReferenceLane = "pack" | "arrivals" | "current" | "verification" | "local" | "inbox";
type Check = (value: any) => void;
const reject = () => {
	throw new TypeError("reference input contract");
};
const fields = (value: any, shape: Record<string, Check>) => {
	if (
		!value ||
		Array.isArray(value) ||
		typeof value !== "object" ||
		Object.keys(value).sort().join() !== Object.keys(shape).sort().join()
	)
		reject();
	for (const key of Object.keys(shape)) shape[key](value[key]);
};
const text =
	(limit = 128): Check =>
	(v) => {
		if (typeof v !== "string" || !v.length || Buffer.byteLength(v) > limit) reject();
	};
const number =
	(max = Number.MAX_SAFE_INTEGER, min = 0, integer = true): Check =>
	(v) => {
		if (
			typeof v !== "number" ||
			!Number.isFinite(v) ||
			v < min ||
			v > max ||
			(integer && !Number.isSafeInteger(v))
		)
			reject();
	};
const bool: Check = (v) => {
	if (typeof v !== "boolean") reject();
};
const literal =
	(...values: unknown[]): Check =>
	(v) => {
		if (!values.includes(v)) reject();
	};
const digest: Check = (v) => {
	if (typeof v !== "string" || !/^sha256:[a-f0-9]{64}$/.test(v)) reject();
};
const ref: Check = (v) => fields(v, { kind: text(), id: text() });
const list =
	(check: Check, max = 64, min = 0): Check =>
	(v) => {
		if (!Array.isArray(v) || v.length < min || v.length > max) reject();
		for (let i = 0; i < v.length; i++) {
			if (!Object.hasOwn(v, i)) reject();
			check(v[i]);
		}
	};
const unique = (items: unknown[]) => {
	if (new Set(items.map((x) => canonical(x))).size !== items.length) reject();
};
const occurrence: Check = (v) => {
	fields(v, {
		revisionDomain: text(),
		occurrenceId: text(),
		revision: number(undefined, 1),
		digest,
		sourceRefs: list(ref, 64, 1),
	});
	unique(v.sourceRefs);
};
const profile: Check = (v) => {
	fields(v, { dailyAverage: number(1e9, 0, false), typicalCategories: list(text(256), 32) });
	unique(v.typicalCategories);
};
const policy: Check = (v) =>
	fields(v, { zThreshold: number(1e6, 0, false), dailyRatioThreshold: number(1e6, 0, false) });
const transaction: Check = (v) => {
	fields(v, {
		id: text(),
		vendor: text(256),
		category: text(256),
		amount: number(1e9, 0, false),
		timestampIso: text(),
	});
	if (
		!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v.timestampIso) ||
		!Number.isFinite(Date.parse(v.timestampIso)) ||
		new Date(v.timestampIso).toISOString() !== v.timestampIso
	)
		reject();
};
const evaluation: Check = (e) => {
	fields(e, {
		evaluationRef: text(),
		subjectRef: text(),
		occurrence,
		inputDigest: digest,
		profileRef: ref,
		profile,
		policyRef: ref,
		policyDigest: digest,
		policy,
		prefix: list(transaction, 64, 1),
	});
	unique(e.prefix.map((t: any) => t.id));
	if (
		new Set(e.prefix.map((t: any) => t.vendor)).size !== 1 ||
		Buffer.byteLength(canonical(e)) > 65536
	)
		reject();
	if (
		e.inputDigest !==
			oracleHash(canonical({ profileRef: e.profileRef, profile: e.profile, prefix: e.prefix })) ||
		e.policyDigest !== oracleHash(canonical(e.policy))
	)
		reject();
};
const binding: Check = (v) =>
	fields(v, {
		packRef: ref,
		sourceDigest: digest,
		runtimeDigest: digest,
		destinationRef: ref,
		compositionEpoch: number(undefined, 1),
		hostEpoch: number(undefined, 1),
		runRef: text(),
		evidenceMode: literal("fixture-observations"),
	});
const receipt: Check = (v) =>
	fields(v, {
		receiptRef: ref,
		issuerRef: ref,
		verifierRevision: text(),
		occurrence,
		inputDigest: digest,
		policyDigest: digest,
		sourceDigest: digest,
		runtimeDigest: digest,
		requestDigest: digest,
		numericDomainRef: text(),
		verdict: literal("pass", "fail", "unavailable"),
		artifactRef: ref,
		artifactDigest: digest,
	});
const grant: Check = (v) => {
	fields(v, {
		grantRef: ref,
		ownerRef: ref,
		operation: literal("append-alert"),
		occurrence,
		requestDigest: digest,
		destinationRef: ref,
		hostEpoch: number(undefined, 1),
		validFrom: number(),
		validThrough: number(),
		maxWrites: number(64, 1),
		replayScope: (x) =>
			fields(x, { compositionEpoch: number(undefined, 1), hostEpoch: number(undefined, 1) }),
		revoked: bool,
	});
	if (v.validFrom > v.validThrough) reject();
};
const current: Check = (v) => {
	fields(v, {
		revisionDomain: text(),
		occurrence,
		policyRef: ref,
		policyDigest: digest,
		watermark: number(),
	});
	if (v.revisionDomain !== v.occurrence.revisionDomain) reject();
};
const outcome: Check = (v) =>
	fields(v, {
		occurrence,
		effectId: text(),
		requestRef: ref,
		admissionRef: ref,
		proposalDigest: digest,
		state: literal("succeeded", "failed", "cancelled", "unknown", "reconcile-required"),
		result: (x) => {
			if (!x || typeof x !== "object" || !["ok", "error"].includes(x.kind)) reject();
		},
	});
export function referenceInput<T>(lane: ReferenceLane, raw: unknown, expected: SpendingBinding): T {
	const encoded = canonical(raw, lane === "pack" ? 4 * 1048576 : 1048576);
	if (Buffer.byteLength(encoded) > (lane === "pack" ? 4 * 1048576 : 1048576)) reject();
	const v = JSON.parse(encoded);
	if (lane === "arrivals") {
		fields(v, { packRef: ref, evaluationRefs: list(text()) });
		if (canonical(v.packRef) !== canonical(expected.packRef)) reject();
	} else {
		const shape: Record<Exclude<ReferenceLane, "arrivals">, Record<string, Check>> = {
			pack: { format: literal("spending-input-v1"), evaluations: list(evaluation) },
			current: { current: list(current) },
			verification: { receipts: list(receipt) },
			local: { tick: number(), stop: bool, grants: list(grant) },
			inbox: {
				issuerRef: ref,
				artifactRef: ref,
				artifactDigest: digest,
				readiness: (x) =>
					fields(x, {
						ready: bool,
						observedAt: number(),
						validThrough: number(),
						availableSlots: number(1),
					}),
				outcomes: list(outcome),
			},
		};
		fields(v, { binding, ...shape[lane] });
		if (canonical(v.binding) !== canonical(expected)) reject();
		if (lane === "pack") {
			unique(v.evaluations.map((e: any) => e.evaluationRef));
			unique(v.evaluations.map((e: any) => e.occurrence));
			if (new Set(v.evaluations.map((e: any) => e.prefix[0].vendor)).size > 2) reject();
			const domains = new Map<string, string>();
			for (const e of v.evaluations) {
				const vendor = e.prefix[0].vendor,
					prior = domains.get(e.occurrence.revisionDomain);
				if (prior !== undefined && prior !== vendor) reject();
				domains.set(e.occurrence.revisionDomain, vendor);
			}
		} else if (lane === "current") unique(v.current.map((c: any) => c.revisionDomain));
	}
	return oracleFreeze(v);
}

/** Independent cold binding validation; same passive schema as input frames. */
export function referenceBinding(raw: unknown): SpendingBinding {
	const value = JSON.parse(canonical(raw));
	binding(value);
	return oracleFreeze(value);
}
