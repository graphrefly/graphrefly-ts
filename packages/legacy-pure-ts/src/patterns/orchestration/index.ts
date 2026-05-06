/**
 * Orchestration patterns (roadmap §4.1).
 *
 * Domain-layer helpers that build workflow shapes on top of core + extra primitives.
 * Exported under the `patterns.orchestration` namespace to avoid collisions with
 * Phase 2 operator names (for example `gate`, `forEach`).
 */

export {
	type HumanInputOpts,
	type HumanPromptPayload,
	humanInput,
} from "./human-input.js";
export {
	type CatchOptions,
	type ClassifyResult,
	type Decision,
	type DecisionAction,
	decisionKeyOf,
	type GateController,
	type GateOptions,
	PipelineGraph,
	pipelineGraph,
	type StepRef,
	type TerminalCause,
} from "./pipeline-graph.js";
export {
	type TrackerBundle,
	type TrackerOpts,
	tracker,
} from "./tracker.js";
