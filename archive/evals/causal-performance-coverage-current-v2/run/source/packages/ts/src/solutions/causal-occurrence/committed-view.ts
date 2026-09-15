import type { CausalBinding } from "./capabilities.js";
import type { CommittedEffectsView, RuntimeState } from "./contracts.js";

/** D163: fixed passive projection inside the authority invocation, before its single commit. */
export function prepareCommittedEffectsView<T>(
	state: RuntimeState<T>,
	changed: boolean,
	hasFacts: boolean,
	authorityId: string,
	binding: CausalBinding,
): CommittedEffectsView | undefined {
	if (!changed && (state.committedEffects !== undefined || !hasFacts))
		return state.committedEffects;
	const effects = Object.freeze(
		Array.from(state.effects.values(), (record) =>
			Object.freeze({
				proposal: record.proposal,
				...(record.admission === undefined ? {} : { admission: record.admission }),
				...(record.outcome === undefined ? {} : { outcome: record.outcome }),
			}),
		),
	);
	const domains = new Set([
		...state.retentionFloorByDomain.keys(),
		...state.retentionGapThroughByDomain.keys(),
	]);
	const retention = Object.freeze(
		Array.from(domains, (revisionDomain) =>
			Object.freeze({
				revisionDomain,
				floor: state.retentionFloorByDomain.get(revisionDomain) ?? 0,
				gapThrough: state.retentionGapThroughByDomain.get(revisionDomain) ?? 0,
			}),
		),
	);
	return Object.freeze({
		kind: "causal-committed-effects",
		authorityId,
		binding,
		effects,
		retention,
	});
}
