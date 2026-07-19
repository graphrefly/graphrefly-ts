import { evalId } from "./canonical.js";

export const MEMORY_RERUN_AVOIDANCE_SCHEMAS = Object.freeze({
	caseObservation: "graphrefly.private-solution-eval.case-observation.v1",
	familyScorecard: "graphrefly.private-solution-eval.family-scorecard.v1",
});

export const MEMORY_RERUN_AVOIDANCE_FAMILY_REF = evalId("family", "memory-rerun-avoidance", "v1");

export const MEMORY_RERUN_AVOIDANCE_CASE_REFS = Object.freeze({
	relevantApplied: evalId("case", "relevant-applied", "v1"),
	proposalOnly: evalId("case", "proposal-only", "v1"),
	admissionRejected: evalId("case", "admission-rejected", "v1"),
	irrelevantApplied: evalId("case", "irrelevant-applied", "v1"),
	wrongScopeApplied: evalId("case", "wrong-scope-applied", "v1"),
});

export const MEMORY_RERUN_AVOIDANCE_REQUIRED_CASE_REFS = Object.freeze([
	MEMORY_RERUN_AVOIDANCE_CASE_REFS.relevantApplied,
	MEMORY_RERUN_AVOIDANCE_CASE_REFS.proposalOnly,
	MEMORY_RERUN_AVOIDANCE_CASE_REFS.admissionRejected,
	MEMORY_RERUN_AVOIDANCE_CASE_REFS.irrelevantApplied,
	MEMORY_RERUN_AVOIDANCE_CASE_REFS.wrongScopeApplied,
]);

export const MEMORY_RERUN_AVOIDANCE_WORLD_REVISION = "b105-world.v1";

export const MEMORY_RERUN_AVOIDANCE_REVISIONS = Object.freeze({
	planner: "b105-planner.v1",
	executor: "b105-executor.v1",
	verifier: "b105-verifier.v1",
	reflector: "b105-reflector.v1",
	mapper: "b105-mapper.v1",
});

export const MEMORY_RERUN_AVOIDANCE_GENERATOR_REVISION = "b105-family-scorecard-generator.v1";
