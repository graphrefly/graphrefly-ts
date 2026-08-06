import { workItemExecutionRecipe } from "../../src/solutions/work-item/execution.js";
import type { D687ArmComposer } from "./contracts.js";

export const composeD687RecipeArm: D687ArmComposer = (graph, sources) =>
	workItemExecutionRecipe(graph, {
		name: "d687/recipe",
		workItems: sources.workItems,
		effectPlanProposals: sources.proposals,
		effectRunResults: sources.admittedResults,
		now: () => 0,
	});
