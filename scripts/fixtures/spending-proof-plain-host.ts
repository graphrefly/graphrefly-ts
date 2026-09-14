/** D171 finite independent host for PlainSpending; no Graph runtime or candidate host imports. */
import type {
	CurrentFrame,
	EvaluationPack,
	InboxObservationFrame,
	LocalAuthorityFrame,
	SpendingBinding,
	VerificationFrame,
} from "../../examples/spending-alerts/causal-inputs.js";
import type {
	CausalEffectAdmission,
	CausalEffectOutcome,
	CausalEffectProposal,
} from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	type PlainBusiness,
	type PlainLane,
	PlainSpending,
	type plainMaterial,
} from "./spending-preset-plain.js";
import { referenceBinding, referenceInput } from "./spending-preset-reference-input.js";
import {
	oracleCanonical as canonical,
	oracleFreeze as freeze,
	oracleHash,
} from "./spending-publication-oracle.js";

export type PlainHostLane = Exclude<PlainLane, "inbox">;
export interface PlainHostStep {
	readonly lane: PlainHostLane;
	readonly value: unknown;
}
export interface PlainHostRecord {
	readonly request: ReturnType<typeof plainMaterial>;
	readonly admission: CausalEffectAdmission;
	readonly outcome?: CausalEffectOutcome;
}
export interface PlainHostObservation {
	readonly effects: ReturnType<PlainSpending["snapshot"]>;
	readonly assessments: readonly (readonly [string, PlainBusiness])[];
	readonly materials: readonly (readonly [string, PlainHostRecord["request"]])[];
	readonly evidence: ReturnType<PlainSpending["evidenceSnapshot"]>;
	readonly obligations: ReturnType<PlainSpending["obligationSnapshot"]>;
	readonly issues: readonly string[];
}
type MutableRecord = {
	request: PlainHostRecord["request"];
	admission: CausalEffectAdmission;
	outcome?: CausalEffectOutcome;
};
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const digest = (value: unknown) => oracleHash(canonical(value));
const proposal = (request: PlainHostRecord["request"]): CausalEffectProposal => ({
	occurrence: request.body.occurrence,
	effectId: request.body.effectId,
	requestRef: request.requestRef,
	proposalDigest: request.proposalDigest,
});

export class PlainSpendingProofHost {
	readonly binding: SpendingBinding;
	readonly #plain: PlainSpending;
	readonly #records = new Map<string, MutableRecord>();
	readonly #listeners = new Set<
		(observation: ReturnType<PlainSpendingProofHost["observations"]>) => void
	>();
	#pack?: EvaluationPack;
	#packText?: string;
	#current?: CurrentFrame;
	#verification?: VerificationFrame;
	#local?: LocalAuthorityFrame;
	#inbox?: InboxObservationFrame;
	#writes = 0;
	#inFlight = 0;
	#scheduled = false;
	#delivering = false;
	#revision = 0;
	#notifications = 0;
	#maxFrameBytes = 0;
	#fault?: string;
	#unknown = false;
	constructor(
		binding: SpendingBinding,
		private readonly write: (payload: string) => Promise<{ readonly bytesWritten: number }>,
	) {
		this.binding = referenceBinding(binding);
		this.#plain = new PlainSpending(this.binding);
		this.#revision++;
		this.#schedule();
		Object.freeze(this);
	}
	/** Passive input only; callers cannot replace the host-owned inbox source. */
	feed(lane: PlainHostLane, value: unknown): void {
		this.feedMany([{ lane, value }]);
	}
	feedMany(steps: readonly PlainHostStep[]): void {
		for (const { lane, value } of steps) {
			if (!["pack", "current", "verification", "local", "arrivals"].includes(lane))
				throw new TypeError("plain host input lane");
			let safe: unknown;
			try {
				safe = referenceInput(lane, value, this.binding);
				if (lane === "pack") {
					const text = canonical(safe, 4 * 1048576);
					if (this.#packText !== undefined && this.#packText !== text)
						throw new TypeError("plain host pack conflict");
					this.#packText = text;
					this.#pack = safe as EvaluationPack;
				} else if (lane === "current") this.#current = safe as CurrentFrame;
				else if (lane === "verification") this.#verification = safe as VerificationFrame;
				else if (lane === "local") this.#local = safe as LocalAuthorityFrame;
			} catch {
				this.#clear(lane);
			}
			// The plain coordinator performs its own input validation and retains its own issue facts.
			this.#plain.push(lane, safe ?? null);
			if (
				lane === "verification" &&
				this.#verification?.receipts.some((receipt) => {
					const key = canonical(receipt.receiptRef);
					return (
						this.#plain.receiptConflicts.has(key) ||
						this.#plain.receiptHistory.get(key) !== canonical(receipt)
					);
				})
			)
				this.#verification = undefined;
		}
		this.#dispatch();
		this.#publish();
	}
	#clear(lane: PlainHostLane) {
		if (lane === "pack") this.#pack = undefined;
		else if (lane === "current") this.#current = undefined;
		else if (lane === "verification") this.#verification = undefined;
		else if (lane === "local") this.#local = undefined;
	}
	invalidate(lane: PlainHostLane): void {
		if (!["pack", "current", "verification", "local", "arrivals"].includes(lane))
			throw new TypeError("plain host input lane");
		this.#clear(lane);
		this.#plain.invalidate(lane);
		this.#dispatch();
		this.#publish();
	}
	#frame(): InboxObservationFrame {
		const ready = !this.#fault && !this.#unknown && this.#inFlight === 0 && this.#records.size < 64;
		return freeze({
			binding: this.binding,
			issuerRef: { kind: "fixture", id: "owned-offline-host" },
			artifactRef: { kind: "fixture-artifact", id: "simulated-writes" },
			artifactDigest: digest("offline-host-not-real-io"),
			readiness: {
				ready,
				observedAt: 0,
				validThrough: Number.MAX_SAFE_INTEGER,
				availableSlots: ready ? 1 : 0,
			},
			outcomes: [...this.#records.values()].flatMap((r) => (r.outcome ? [r.outcome] : [])),
		});
	}
	#schedule(): void {
		if (this.#scheduled || this.#delivering || this.#fault) return;
		this.#scheduled = true;
		try {
			queueMicrotask(() => {
				this.#scheduled = false;
				this.#delivering = true;
				const captured = this.#revision;
				try {
					const frame = this.#frame();
					this.#maxFrameBytes = Math.max(this.#maxFrameBytes, Buffer.byteLength(canonical(frame)));
					this.#notifications++;
					this.#inbox = frame;
					this.#plain.push("inbox", frame);
					this.#dispatch();
					this.#publish();
				} catch {
					this.#fault = "delivery-failed";
				} finally {
					this.#delivering = false;
				}
				if (!this.#fault && captured !== this.#revision) this.#schedule();
			});
		} catch {
			this.#scheduled = false;
			this.#fault = "schedule-failed";
		}
	}
	#complete(record: MutableRecord, state: CausalEffectOutcome["state"], code: string): void {
		if (record.outcome) return;
		const result =
			state === "succeeded"
				? { kind: "ok" as const, value: { source: "plain-host-result" } }
				: {
						kind: "error" as const,
						error: { kind: "issue" as const, code: `spending-host/${code}`, message: code },
					};
		canonical(result, 4096);
		record.outcome = freeze({
			...proposal(record.request),
			admissionRef: record.admission.admissionRef,
			state,
			result,
		});
		if (state === "unknown" || state === "reconcile-required") this.#unknown = true;
		this.#revision++;
		this.#schedule();
	}
	#dispatch(): void {
		for (const effect of this.#plain.snapshot()) {
			const admission = effect.admission;
			if (!admission || admission.state !== "admitted" || effect.outcome) continue;
			const request = [...this.#plain.materials.values()].find((m) =>
				equal(proposal(m), effect.proposal),
			);
			if (
				!request ||
				!equal(
					{ ...proposal(request), admissionRef: admission.admissionRef, state: "admitted" },
					admission,
				)
			)
				continue;
			const body = request.body;
			if (
				body.hostEpoch !== this.binding.hostEpoch ||
				body.compositionEpoch !== this.binding.compositionEpoch ||
				body.sourceDigest !== this.binding.sourceDigest ||
				body.runtimeDigest !== this.binding.runtimeDigest ||
				!equal(body.destinationRef, this.binding.destinationRef)
			)
				continue;
			const key = canonical(effect.proposal),
				prior = this.#records.get(key);
			if (prior) {
				if (!equal(prior.admission, admission)) this.#fault = "admission-conflict";
				continue;
			}
			if (this.#fault) continue;
			if (this.#records.size >= 64) {
				this.#fault = "record-capacity-proof-failed";
				continue;
			}
			const record: MutableRecord = {
				request: freeze(JSON.parse(canonical(request))),
				admission: freeze(JSON.parse(canonical(admission))),
			};
			this.#records.set(key, record);
			const current =
				this.#current?.current.filter((c) => equal(c.occurrence, body.occurrence)) ?? [];
			const receipts =
				this.#verification?.receipts.filter(
					(r) =>
						equal(r.occurrence, body.occurrence) &&
						r.inputDigest === body.inputDigest &&
						r.policyDigest === body.policyDigest &&
						r.sourceDigest === body.sourceDigest &&
						r.runtimeDigest === body.runtimeDigest &&
						r.requestDigest === body.payloadDigest &&
						r.verifierRevision === "spending-oracle-v2" &&
						r.numericDomainRef === "spending-finite-v1",
				) ?? [];
			const grants =
				this.#local?.grants.filter(
					(g) =>
						equal(g.occurrence, body.occurrence) &&
						g.requestDigest === body.payloadDigest &&
						equal(g.destinationRef, body.destinationRef) &&
						g.hostEpoch === body.hostEpoch &&
						g.replayScope.compositionEpoch === body.compositionEpoch &&
						g.replayScope.hostEpoch === body.hostEpoch,
				) ?? [];
			const evaluation = this.#pack?.evaluations.find((e) => equal(e.occurrence, body.occurrence));
			const local = this.#local,
				receipt = receipts[0],
				grant = grants[0],
				inbox = this.#inbox;
			const denied =
				!local ||
				local.stop ||
				current.length !== 1 ||
				current[0].policyDigest !== body.policyDigest ||
				current[0].watermark < body.occurrence.revision ||
				!evaluation ||
				!equal(current[0].policyRef, evaluation.policyRef) ||
				receipts.length !== 1 ||
				receipt.verdict !== "pass" ||
				this.#plain.receiptConflicts.has(canonical(receipt.receiptRef)) ||
				grants.length !== 1 ||
				grant.revoked ||
				admission.admissionRef.kind !== "spending-admission" ||
				admission.admissionRef.id !==
					digest({
						proposal: effect.proposal,
						receiptRef: receipt.receiptRef,
						grantRef: grant.grantRef,
						binding: this.binding,
					}) ||
				local.tick < grant.validFrom ||
				local.tick > grant.validThrough ||
				!inbox ||
				!inbox.readiness.ready ||
				inbox.readiness.availableSlots !== 1 ||
				local.tick < inbox.readiness.observedAt ||
				local.tick > inbox.readiness.validThrough;
			if (denied) {
				this.#complete(record, "cancelled", "final-guard");
				continue;
			}
			if (this.#unknown || this.#inFlight !== 0 || this.#writes >= Math.min(64, grant.maxWrites)) {
				this.#complete(record, "cancelled", "busy-or-write-budget");
				continue;
			}
			const payload = body.payloadText + "\n";
			if (Buffer.byteLength(payload) > 4096) {
				this.#complete(record, "cancelled", "payload-capacity");
				continue;
			}
			this.#inFlight++;
			this.#revision++;
			this.#schedule();
			if (this.#fault) {
				this.#inFlight--;
				this.#complete(record, "cancelled", "notification-unavailable");
				continue;
			}
			this.#writes++;
			try {
				Promise.resolve(this.write(payload)).then(
					(result) => {
						this.#inFlight--;
						let state: CausalEffectOutcome["state"] = "unknown";
						try {
							const descriptor = Object.getOwnPropertyDescriptor(result, "bytesWritten");
							if (
								descriptor &&
								"value" in descriptor &&
								descriptor.value === Buffer.byteLength(payload)
							)
								state = "succeeded";
						} catch {
							/* Malformed result cannot establish success. */
						}
						this.#complete(record, state, "short-or-unknown-write");
					},
					() => {
						this.#inFlight--;
						this.#complete(record, "unknown", "write-rejected");
					},
				);
			} catch {
				this.#inFlight--;
				this.#complete(record, "unknown", "write-threw");
			}
		}
	}
	observations(): PlainHostObservation {
		return freeze(
			JSON.parse(
				canonical({
					effects: this.#plain.snapshot(),
					assessments: [...this.#plain.assessments],
					materials: [...this.#plain.materials],
					evidence: this.#plain.evidenceSnapshot(),
					obligations: this.#plain.obligationSnapshot(),
					issues: this.#plain.issues,
				}),
			),
		);
	}
	observe(
		listener: (observation: ReturnType<PlainSpendingProofHost["observations"]>) => void,
	): () => void {
		this.#listeners.add(listener);
		try {
			listener(this.observations());
		} catch (error) {
			this.#listeners.delete(listener);
			throw error;
		}
		return () => {
			this.#listeners.delete(listener);
		};
	}
	#publish(): void {
		if (!this.#listeners.size) return;
		try {
			const value = this.observations();
			for (const listener of [...this.#listeners]) listener(value);
		} catch {
			this.#fault = "delivery-failed";
		}
	}
	inspect() {
		const obligations = this.#plain.obligationSnapshot();
		const frontier =
			!!this.#pack &&
			this.#pack.evaluations.every((e) =>
				obligations.some(
					(o) =>
						o.revisionDomain === e.occurrence.revisionDomain &&
						o.evaluatedThroughRevision >= e.occurrence.revision,
				),
			);
		const settled = this.#plain
			.snapshot()
			.every(
				(e) =>
					e.admission?.state === "rejected" ||
					(e.outcome !== null && !["unknown", "reconcile-required"].includes(e.outcome.state)),
			);
		const normalEndReady =
			!this.#fault &&
			!this.#unknown &&
			this.#inFlight === 0 &&
			!this.#scheduled &&
			!this.#delivering &&
			!!this.#local?.stop &&
			frontier &&
			obligations.length > 0 &&
			obligations.every((o) => o.lifecycle && o.retainedEvidence) &&
			settled;
		return Object.freeze({
			records: Object.freeze([...this.#records.values()].map((r) => freeze({ ...r }))),
			writes: this.#writes,
			inFlight: this.#inFlight,
			fault: this.#fault,
			unknown: this.#unknown,
			dispatchStopped: this.#unknown || this.#fault !== undefined,
			normalEndReady,
			scheduled: this.#scheduled,
			delivering: this.#delivering,
			notifications: this.#notifications,
			maxFrameBytes: this.#maxFrameBytes,
		});
	}
}
