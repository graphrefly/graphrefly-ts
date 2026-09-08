/** Independent finite contract-v2 model. No GraphReFly implementation imports.
 * Covers the frozen admitted/success/unknown traces used by this qualification;
 * it is not a second implementation of every malformed-input diagnostic.
 */
import { createHash } from "node:crypto";

export function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value !== null && typeof value === "object")
		return `{${Object.keys(value)
			.sort()
			.map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
export function frozenFacts(revision, id = `e${revision}`, bytes = 0) {
	const raw = {
		revisionDomain: "d",
		occurrenceId: `o${revision}`,
		revision,
		sourceRefs: [{ kind: "input", id: `i${revision}` }],
		value: revision,
	};
	const occurrence = {
		...raw,
		digest: `sha256:${createHash("sha256")
			.update(
				canonical({
					schemaRevision: "graphrefly/causal-occurrence-contract/v1@contract-v2",
					...raw,
				}),
			)
			.digest("hex")}`,
	};
	const proposal = {
		occurrence,
		effectId: id,
		requestRef: { kind: "request", id },
		proposalDigest: `sha256:${"b".repeat(64)}`,
	};
	const admission = { ...proposal, state: "admitted", admissionRef: { kind: "admission", id } };
	const outcome = {
		...admission,
		state: "succeeded",
		result: { kind: "ok", value: "x".repeat(bytes) },
	};
	const freeze = (value) => {
		if (value && typeof value === "object") {
			for (const nested of Object.values(value)) freeze(nested);
			Object.freeze(value);
		}
		return value;
	};
	return freeze(JSON.parse(JSON.stringify({ occurrence, proposal, admission, outcome })));
}
const key = (f) => canonical([f.occurrence, f.effectId, f.requestRef, f.proposalDigest]);
export class PlainCommitted {
	constructor(capacity = 64) {
		this.capacity = capacity;
		this.occurrences = new Map();
		this.decisions = new Set();
		this.watermark = 0;
		this.released = new Set();
		this.effects = new Map();
		this.pending = [];
		this.terminals = new Set();
		this.floor = 0;
		this.sinks = new Set();
	}
	subscribe(sink) {
		this.sinks.add(sink);
		sink(this.snapshot());
		return () => this.sinks.delete(sink);
	}
	snapshot() {
		return structuredClone({
			effects: [...this.effects.values()],
			retention: this.floor
				? [{ revisionDomain: "d", floor: this.floor, gapThrough: this.floor }]
				: [],
		});
	}
	push(lane, value) {
		const revision = value.occurrence?.revision ?? value.revision;
		if (lane === "occurrences" && !this.occurrences.has(revision) && revision > this.floor) {
			if (this.occurrences.size === this.capacity) {
				const oldest = [...this.occurrences.keys()]
					.sort((a, b) => a - b)
					.find(
						(r) =>
							this.terminals.has(r) &&
							[...this.effects.values()]
								.filter((e) => e.proposal.occurrence.revision === r)
								.every(
									(e) =>
										e.admission?.state === "rejected" ||
										(e.outcome && !["unknown", "reconcile-required"].includes(e.outcome.state)),
								),
					);
				if (oldest === undefined) return;
				this.occurrences.delete(oldest);
				this.released.delete(oldest);
				this.decisions.delete(oldest);
				this.terminals.delete(oldest);
				this.floor = oldest;
				for (const [k, e] of this.effects)
					if (e.proposal.occurrence.revision <= oldest) this.effects.delete(k);
				this.pending = this.pending.filter(([, v]) => v.occurrence.revision > oldest);
			}
			this.occurrences.set(revision, value);
		} else if (lane === "admissions") this.decisions.add(revision);
		else if (lane === "watermarks") this.watermark = Math.max(this.watermark, revision);
		else if (lane === "branchTerminals") this.terminals.add(revision);
		else if (["effectProposals", "effectAdmissions", "effectOutcomes"].includes(lane))
			this.pending.push([lane, value]);
		// contract-v2 currentness is fail-closed after a retention gap (qualification README).
		if (
			this.floor === 0 &&
			this.watermark > 0 &&
			this.watermark <= this.occurrences.size &&
			Array.from({ length: this.watermark }, (_, i) => i + 1).every(
				(r) => this.occurrences.has(r) && this.decisions.has(r),
			)
		) {
			for (const r of this.occurrences.keys()) if (r <= this.watermark) this.released.add(r);
		}
		// A fixed point over a finite pending set, independent of runtime helper ordering.
		let progress = true;
		while (progress) {
			progress = false;
			this.pending = this.pending.filter(([kind, f]) => {
				const r = f.occurrence.revision,
					record = this.effects.get(key(f));
				if (r <= this.floor) return false;
				if (kind === "effectProposals") {
					if (!this.released.has(r)) return true;
					if (!record && this.effects.size < this.capacity)
						this.effects.set(key(f), { proposal: f });
				} else if (kind === "effectAdmissions") {
					if (!record) return true;
					if (!record.admission) record.admission = f;
				} else {
					if (!record?.admission) return true;
					if (
						canonical(record.admission.admissionRef) === canonical(f.admissionRef) &&
						!record.outcome
					)
						record.outcome = f;
				}
				progress = true;
				return false;
			});
		}
		for (const sink of this.sinks) sink(this.snapshot());
	}
}
