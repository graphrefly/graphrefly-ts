/** Three consumer-private audience examples. Exposure is not a security sandbox. */
import type { Graph } from "../../packages/ts/src/graph/graph.js";
import {
	assertCausalCapabilities,
	type CausalBinding,
	type FullCausalCapability,
} from "../../packages/ts/src/solutions/causal-occurrence/capabilities.js";
import type { SpendingAlertsView } from "./causal-preset.js";
import type { Publication } from "./causal-publication.js";
import { mountSpendingView } from "./causal-view-binding.js";
/** A display component receives only the actual five-port object. Subscription is observation. */
export function ordinaryExample(view: SpendingAlertsView, render: (value: Publication) => void) {
	return mountSpendingView(view, ({ values }) => {
		if (values.publication) render(values.publication);
	});
}
/** Frameworks pass exact issued handles; an execution view grants no I/O method. */
export function frameworkExample<T>(
	graph: Graph,
	capabilities: FullCausalCapability<T>,
	binding: CausalBinding,
) {
	assertCausalCapabilities(graph, capabilities, binding);
	return capabilities.execution;
}
/** The maintainer still inspects the complete executing graph. */
export function maintainerExample(graph: Graph) {
	return graph.describe();
}
function compileOnly(view: SpendingAlertsView) {
	// @ts-expect-error Ordinary view has no internal authority capability.
	view.capabilities;
	// @ts-expect-error No imperative publication command.
	view.publish();
	// @ts-expect-error Eight input lanes are not component responsibilities.
	view.effectAdmissions;
}
void compileOnly;
