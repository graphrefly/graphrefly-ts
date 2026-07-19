import {
	MEMORY_RERUN_AVOIDANCE_FAMILY_REF,
	MEMORY_RERUN_AVOIDANCE_GENERATOR_REVISION,
	MEMORY_RERUN_AVOIDANCE_REQUIRED_CASE_REFS,
	MEMORY_RERUN_AVOIDANCE_REVISIONS,
	MEMORY_RERUN_AVOIDANCE_SCHEMAS,
	MEMORY_RERUN_AVOIDANCE_WORLD_REVISION,
} from "../../src/__tests__/eval-support/memory-rerun-avoidance/identity.js";
import { canonicalTupleKey } from "../../src/identity.js";

export const MEMORY_RERUN_AVOIDANCE_PUBLICATION = Object.freeze({
	manifestSchemaVersion: "graphrefly.private-solution-eval.publication-manifest.v1",
	scorecardSchemaVersion: MEMORY_RERUN_AVOIDANCE_SCHEMAS.familyScorecard,
	caseSchemaVersion: MEMORY_RERUN_AVOIDANCE_SCHEMAS.caseObservation,
	artifactRef: canonicalTupleKey([
		"b106",
		"solution-eval-publication",
		"memory-rerun-avoidance",
		"v1",
	]),
	familyRef: MEMORY_RERUN_AVOIDANCE_FAMILY_REF,
	lane: "deterministic",
	generatorRevision: MEMORY_RERUN_AVOIDANCE_GENERATOR_REVISION,
	requiredCaseRefs: MEMORY_RERUN_AVOIDANCE_REQUIRED_CASE_REFS,
	inputRevisions: Object.freeze({
		worldRevision: MEMORY_RERUN_AVOIDANCE_WORLD_REVISION,
		plannerRevision: MEMORY_RERUN_AVOIDANCE_REVISIONS.planner,
		executorRevision: MEMORY_RERUN_AVOIDANCE_REVISIONS.executor,
		verifierRevision: MEMORY_RERUN_AVOIDANCE_REVISIONS.verifier,
		reflectorRevision: MEMORY_RERUN_AVOIDANCE_REVISIONS.reflector,
		mapperRevision: MEMORY_RERUN_AVOIDANCE_REVISIONS.mapper,
	}),
	sourceRefs: Object.freeze([
		Object.freeze({
			kind: "generator-source",
			id: "packages/ts/src/__tests__/eval-support/memory-rerun-avoidance/family.ts",
		}),
		Object.freeze({
			kind: "verification-test",
			id: "packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.eval.test.ts",
		}),
	]),
});
