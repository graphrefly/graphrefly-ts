/** D164: retain bytes before proposing; no active/admitted/settled shadow authority. */

import { depBatch } from "../../packages/ts/src/ctx/types.js";
import type { DataIssue } from "../../packages/ts/src/data/index.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type { Message } from "../../packages/ts/src/protocol/messages.js";
import type { CausalEffectProposal } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	type BusinessFrame,
	frame,
	type Item,
	join,
	type MakeNode,
	type MessageValue,
} from "./causal-business.js";
import {
	frozen,
	issue,
	materialProfile,
	occurrenceKey,
	type SpendingBinding,
} from "./causal-inputs.js";
import {
	canonicalMaterial,
	type MaterialSnapshot,
	makeMaterialSnapshot,
	makeRequestMaterial,
	materialDigest,
	proposalForMaterial,
	type RequestMaterial,
} from "./causal-publication.js";
import type { Flagged } from "./pipeline.js";

export type MaterialResult =
	| Readonly<{ kind: "normal" }>
	| Readonly<{ kind: "retained"; material: RequestMaterial }>
	| Readonly<{ kind: "rejected"; issue: DataIssue }>;
export interface StoredFrame extends BusinessFrame<MaterialResult> {
	readonly snapshot: MaterialSnapshot;
}
export function buildMaterials(
	make: MakeNode,
	business: {
		evaluationSelections: Node<BusinessFrame<unknown>>;
		thresholdGate: Node<BusinessFrame<Flagged>>;
		alertMessage: Node<BusinessFrame<MessageValue>>;
	},
	binding: SpendingBinding,
) {
	const profile = materialProfile(binding);
	const requestMaterials = join<MaterialResult>(
		make,
		"requestMaterials",
		[business.evaluationSelections, business.thresholdGate, business.alertMessage],
		([, g, m], e) => {
			const gate = g as Flagged,
				message = m as MessageValue;
			if (!gate.flagged) return { kind: "normal" };
			try {
				const payloadText = canonicalMaterial({
					transactionId: gate.txn.id,
					vendor: gate.txn.vendor,
					severity: message.severity,
					message: message.message,
				});
				if (Buffer.byteLength(payloadText) + 1 > 4096) throw new TypeError("payload-capacity");
				const material = makeRequestMaterial({
					schema: "spending-alerts/request-material/v1",
					occurrence: e.occurrence,
					effectId: `alert:${e.evaluationRef}`,
					inputDigest: e.inputDigest,
					policyDigest: e.policyDigest,
					payloadText,
					payloadDigest: materialDigest(payloadText),
					sourceDigest: profile.sourceDigest,
					runtimeDigest: profile.runtimeDigest,
					destinationRef: profile.destinationRef,
					compositionEpoch: profile.compositionEpoch,
					hostEpoch: profile.hostEpoch,
				});
				return { kind: "retained", material };
			} catch {
				return { kind: "rejected", issue: issue("material-format-or-capacity", e.evaluationRef) };
			}
		},
	);
	const materialStore = make<StoredFrame>("materialStore", [requestMaterials], (ctx) => {
		let s = ctx.state.get<{
			materials: Map<string, RequestMaterial>;
			snapshot: MaterialSnapshot;
		}>();
		if (!s) {
			s = { materials: new Map(), snapshot: makeMaterialSnapshot(profile, []) };
			ctx.state.set(s);
		}
		for (const f of (depBatch(ctx, 0) ?? []) as BusinessFrame<MaterialResult>[]) {
			const rows: Item<MaterialResult>[] = [],
				problems: DataIssue[] = [...f.issues];
			for (const row of f.rows) {
				const result = row.value;
				if (result.kind !== "retained") {
					rows.push(row);
					if (result.kind === "rejected") problems.push(result.issue);
					continue;
				}
				const key = occurrenceKey(row.evaluation.occurrence),
					prior = s.materials.get(key);
				let failure: DataIssue | undefined;
				if (prior) {
					if (canonicalMaterial(prior) !== canonicalMaterial(result.material))
						failure = issue("material-conflict", row.evaluation.evaluationRef);
					else {
						rows.push({ evaluation: row.evaluation, value: { kind: "retained", material: prior } });
						continue;
					}
				} else if (s.materials.size >= 64)
					failure = issue("material-count-capacity", row.evaluation.evaluationRef);
				else {
					try {
						const next = makeMaterialSnapshot(profile, [...s.materials.values(), result.material]);
						canonicalMaterial(next, 1048576);
						s.materials.set(key, result.material);
						s.snapshot = next;
					} catch {
						failure = issue("material-byte-capacity", row.evaluation.evaluationRef);
					}
				}
				if (failure) {
					problems.push(failure);
					rows.push({ evaluation: row.evaluation, value: { kind: "rejected", issue: failure } });
				} else rows.push(row);
			}
			// State is owned by this node before any downstream proposal is delivered.
			ctx.state.set(s);
			ctx.down([["DATA", frozen({ ...frame(rows, problems, f.valid), snapshot: s.snapshot })]]);
		}
	});
	const materialSnapshot = make<MaterialSnapshot>("materialSnapshot", [materialStore], (ctx) => {
		for (const f of (depBatch(ctx, 0) ?? []) as StoredFrame[]) ctx.down([["DATA", f.snapshot]]);
	});
	const effectProposals = make<CausalEffectProposal>("effectProposals", [materialStore], (ctx) => {
		const outputs: Message[] = [];
		for (const f of (depBatch(ctx, 0) ?? []) as StoredFrame[])
			if (f.valid)
				for (const row of f.rows)
					if (row.value.kind === "retained")
						outputs.push(["DATA", proposalForMaterial(row.value.material)]);
		if (outputs.length) ctx.down(outputs);
	});
	return { requestMaterials, materialStore, materialSnapshot, effectProposals };
}
