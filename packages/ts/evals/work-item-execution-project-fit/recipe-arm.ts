import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type { D686PathObservation, D686Scenario } from "./contracts.js";
import { runD686GraphArm } from "./graph-arm-harness.js";

export function runD686RecipeArm(scenario: D686Scenario): D686PathObservation {
	// D686_COORDINATOR:default-recipe:dependency-rich-fan-out-fan-in:START
	// D686_COORDINATOR:default-recipe:dependency-rich-fan-out-fan-in:END
	// D686_COORDINATOR:default-recipe:failed-prerequisite-independent-branch-join:START
	// D686_COORDINATOR:default-recipe:failed-prerequisite-independent-branch-join:END
	return runD686GraphArm("default-recipe", scenario, (graph, sources) => {
		const recipe = workItemExecutionRecipe(graph, {
			name: "d686/defaultRecipe",
			workItems: sources.workItems,
			effectPlanProposals: sources.proposals,
			effectRunResults: sources.admittedResults,
			policy: { allowedEffectKinds: ["d686-offline-effect"] },
			now: () => 0,
		});
		return {
			plan: recipe.plan,
			effectRuns: recipe.effectRuns,
			requestFacts: recipe.requestFacts,
			requests: recipe.requests,
		};
	});
}
