/** Independent two-node reference. No production material/join/projection import. */
import { depBatch, depLatest } from "../../packages/ts/src/ctx/types.js";
import type {
	ConstructionScope,
	StartupFact,
} from "../../packages/ts/src/graph/construction-scope.js";
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import type { Node } from "../../packages/ts/src/node/node.js";
import type { CausalBinding } from "../../packages/ts/src/solutions/causal-occurrence/capabilities.js";
import { buildCausalNodes } from "../../packages/ts/src/solutions/causal-occurrence/construction.js";
import type { CommittedEffectsView } from "../../packages/ts/src/solutions/causal-occurrence/contracts.js";
import {
	type OracleIndex,
	type OracleProfile,
	oracleCanonical,
	oracleProfile,
	oraclePublication,
	verifyPublicationMaterial,
} from "./spending-publication-oracle.js";
export function buildReferencePublication<T>(
	graph: Graph,
	scope: ConstructionScope,
	startup: Node<StartupFact>,
	prepared: Parameters<typeof buildCausalNodes<T>>[3],
	binding: CausalBinding,
	material: Node<unknown>,
	inputProfile: OracleProfile,
) {
	const profile = oracleProfile(inputProfile);
	scope.assertContext(graph, startup, profile.compositionEpoch);
	if (profile.compositionEpoch !== binding.epoch) throw TypeError("publication context mismatch");
	const causal = buildCausalNodes(graph, scope, startup, prepared, binding);
	const expectedId = `${prepared.options.name}/authority`,
		expectedBinding = oracleCanonical(binding);
	const join = scope.node<{ view: CommittedEffectsView; index: OracleIndex }>(
		[causal.committedEffects, material],
		(ctx) => {
			if (
				ctx.waveData.length !== 2 ||
				join.deps[0] !== causal.committedEffects ||
				join.deps[1] !== material
			) {
				ctx.down([["ERROR", new TypeError("publication dependency mismatch")]]);
				return;
			}
			let memory = ctx.state.get<{ input?: unknown; index?: OracleIndex }>();
			if (!memory) {
				memory = {};
				ctx.state.set(memory);
			}
			const current = depLatest(ctx, 1),
				delivered = (depBatch(ctx, 1)?.length ?? 0) > 0;
			if (current === undefined && !delivered) {
				memory.input = undefined;
				memory.index = undefined;
				return;
			}
			if (
				memory.index === undefined ||
				memory.input !== current ||
				(delivered && !memory.index.cacheable)
			) {
				memory.index = verifyPublicationMaterial(current, profile);
				memory.input = current;
			}
			const view = depLatest(ctx, 0) as CommittedEffectsView | undefined;
			if (!view) return;
			if (
				view.kind !== "causal-committed-effects" ||
				view.authorityId !== expectedId ||
				oracleCanonical(view.binding) !== expectedBinding
			) {
				ctx.down([["ERROR", new TypeError("publication authority binding")]]);
				return;
			}
			ctx.down([["DATA", Object.freeze({ view, index: memory.index })]]);
		},
		{
			name: "requestMaterialJoin",
			factory: "spendingRequestMaterialJoin",
			errorWhenDepsError: true,
		},
	);
	const publication = scope.node<ReturnType<typeof oraclePublication>>(
		[join],
		(ctx) => {
			for (const input of depBatch(ctx, 0) ?? []) {
				const value = input as { view: CommittedEffectsView; index: OracleIndex };
				const result = oraclePublication(value.view, value.index, profile);
				ctx.down([["DATA", result]]);
			}
		},
		{ name: "publication", factory: "spendingPublication", errorWhenDepsError: true },
	);
	return Object.freeze({ causal, requestMaterialJoin: join, publication });
}
