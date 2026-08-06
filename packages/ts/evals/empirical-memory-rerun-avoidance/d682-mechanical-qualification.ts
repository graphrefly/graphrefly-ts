import { strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	coordinate,
	digest,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	strictSnapshot,
} from "./canonical.js";
import {
	type EmpiricalCalibrationTrialBlockObservationV4,
	validateEmpiricalCalibrationTrialBlockObservation,
} from "./empirical-smoke-evidence.js";

export const D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-qualification-catalog.v1";
export const D682_MECHANICAL_QUALIFICATION_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-qualification-scorecard.v1";
export const D682_MECHANICAL_QUALIFICATION_CLAIM_BOUNDARY =
	"mechanical-tool-path-qualification-no-efficacy-claim";
export const D682_MECHANICAL_QUALIFICATION_FIXTURE_COUNT = 3;
export const D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD = 500_000;
export const D682_MECHANICAL_QUALIFICATION_MAX_CATALOG_BYTES = 65_536;

export interface D682MechanicalQualificationFixtureV1 {
	readonly fixtureRef: string;
	readonly fixtureRevision: string;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly actorTreeDigest: string;
	readonly workItemDigest: string;
	readonly acceptanceDigest: string;
	readonly workspaceRecipeDigest: string;
	readonly verifierProfileDigest: string;
	readonly expectedWorkspaceStateDigest: string;
}

export interface D682MechanicalQualificationCatalogV1 {
	readonly schemaVersion: typeof D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA;
	readonly catalogRevision: string;
	readonly routeProfileDigest: string;
	readonly fixtures: readonly [
		D682MechanicalQualificationFixtureV1,
		D682MechanicalQualificationFixtureV1,
		D682MechanicalQualificationFixtureV1,
	];
}

export interface D682MechanicalQualificationScorecardV1 {
	readonly schemaVersion: typeof D682_MECHANICAL_QUALIFICATION_SCORECARD_SCHEMA;
	readonly catalogDigest: string;
	readonly claimBoundary: typeof D682_MECHANICAL_QUALIFICATION_CLAIM_BOUNDARY;
	readonly efficacyClaim: "none";
	readonly evidenceClass: "simulated-contract" | "live-provider";
	readonly empiricalLiveEvidence: boolean;
	readonly observationDigests: readonly [string, string, string];
	readonly attemptedFixtures: 3;
	readonly passedFixtures: number;
	readonly completeFixtures: number;
	readonly nonEvaluableFixtures: number;
	readonly requests: number;
	readonly steps: number;
	readonly attempts: number;
	readonly inputTokens: number | null;
	readonly outputTokens: number | null;
	readonly totalTokens: number | null;
	readonly latencyMs: number;
	readonly costMicrousd: number;
	readonly hardCapMicrousd: typeof D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD;
	readonly status: "qualified" | "simulated-contract-passed" | "not-qualified";
	readonly issueCodes: readonly string[];
}

export function validateD682MechanicalQualificationCatalog(
	value: unknown,
): D682MechanicalQualificationCatalogV1 {
	const catalog = record(value, "d682Mechanical");
	exactKeys(
		catalog,
		["catalogRevision", "fixtures", "routeProfileDigest", "schemaVersion"],
		"d682Mechanical",
	);
	const fixtureValues = array(catalog.fixtures, "d682Mechanical.fixtures");
	if (fixtureValues.length !== D682_MECHANICAL_QUALIFICATION_FIXTURE_COUNT) {
		throw new TypeError(
			"D682 mechanical qualification catalog must contain exactly three fixtures",
		);
	}
	const refs = new Set<string>();
	const tasks = new Set<string>();
	const fixtures = fixtureValues.map((fixtureValue, index) => {
		const path = `d682Mechanical.fixtures[${index}]`;
		const fixture = record(fixtureValue, path);
		exactKeys(
			fixture,
			[
				"acceptanceDigest",
				"actorTreeDigest",
				"expectedWorkspaceStateDigest",
				"fixtureRef",
				"fixtureRevision",
				"taskDigest",
				"taskRef",
				"verifierProfileDigest",
				"workItemDigest",
				"workspaceRecipeDigest",
			],
			path,
		);
		const fixtureRef = coordinate(fixture.fixtureRef, `${path}.fixtureRef`);
		const taskRef = coordinate(fixture.taskRef, `${path}.taskRef`);
		if (refs.has(fixtureRef) || tasks.has(taskRef)) {
			throw new TypeError("D682 mechanical qualification fixture and task refs must be unique");
		}
		refs.add(fixtureRef);
		tasks.add(taskRef);
		return strictSnapshot({
			fixtureRef,
			fixtureRevision: coordinate(fixture.fixtureRevision, `${path}.fixtureRevision`),
			taskRef,
			taskDigest: digest(fixture.taskDigest, `${path}.taskDigest`),
			actorTreeDigest: digest(fixture.actorTreeDigest, `${path}.actorTreeDigest`),
			workItemDigest: digest(fixture.workItemDigest, `${path}.workItemDigest`),
			acceptanceDigest: digest(fixture.acceptanceDigest, `${path}.acceptanceDigest`),
			workspaceRecipeDigest: digest(fixture.workspaceRecipeDigest, `${path}.workspaceRecipeDigest`),
			verifierProfileDigest: digest(fixture.verifierProfileDigest, `${path}.verifierProfileDigest`),
			expectedWorkspaceStateDigest: digest(
				fixture.expectedWorkspaceStateDigest,
				`${path}.expectedWorkspaceStateDigest`,
			),
		});
	});
	const validated = strictSnapshot({
		schemaVersion: literal(
			catalog.schemaVersion,
			D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA,
			"d682Mechanical.schemaVersion",
		),
		catalogRevision: coordinate(catalog.catalogRevision, "d682Mechanical.catalogRevision"),
		routeProfileDigest: digest(catalog.routeProfileDigest, "d682Mechanical.routeProfileDigest"),
		fixtures: fixtures as unknown as readonly [
			D682MechanicalQualificationFixtureV1,
			D682MechanicalQualificationFixtureV1,
			D682MechanicalQualificationFixtureV1,
		],
	});
	if (
		strictJsonCodec.encode(validated).byteLength > D682_MECHANICAL_QUALIFICATION_MAX_CATALOG_BYTES
	) {
		throw new TypeError("D682 mechanical qualification catalog exceeded its canonical byte bound");
	}
	return validated;
}

function checkedSum(values: readonly number[], label: string): number {
	let total = 0;
	for (const value of values) {
		total += safeInteger(value, label);
		if (!Number.isSafeInteger(total)) throw new TypeError(`${label} overflow`);
	}
	return total;
}

function nullableSum(values: readonly (number | null)[], label: string): number | null {
	return values.some((value) => value === null)
		? null
		: checkedSum(values as readonly number[], label);
}

export function createD682MechanicalQualificationScorecard(input: {
	readonly catalog: D682MechanicalQualificationCatalogV1;
	readonly observations: readonly EmpiricalCalibrationTrialBlockObservationV4[];
}): D682MechanicalQualificationScorecardV1 {
	const catalog = validateD682MechanicalQualificationCatalog(input.catalog);
	if (input.observations.length !== D682_MECHANICAL_QUALIFICATION_FIXTURE_COUNT) {
		throw new TypeError("D682 mechanical qualification requires exactly three observations");
	}
	const observations = input.observations.map(validateEmpiricalCalibrationTrialBlockObservation);
	const evidenceClasses = new Set(observations.map((observation) => observation.executionClass));
	if (evidenceClasses.size !== 1) {
		throw new TypeError("D682 mechanical observations must share one execution class");
	}
	const evidenceClass = observations[0]?.executionClass;
	if (evidenceClass !== "simulated-contract" && evidenceClass !== "live-provider") {
		throw new TypeError("D682 mechanical observation execution class is unsupported");
	}
	for (const [index, observation] of observations.entries()) {
		const fixture = catalog.fixtures[index];
		if (
			fixture === undefined ||
			observation.taskRef !== fixture.taskRef ||
			observation.taskDigest !== fixture.taskDigest ||
			observation.empiricalLiveEvidence !== (evidenceClass === "live-provider") ||
			observation.warmBranches.some((branch) => branch.attempted)
		) {
			throw new TypeError("D682 mechanical observation does not match its preregistered fixture");
		}
	}
	const passed = observations.map(
		(observation, index) =>
			observation.result.classification === "complete" &&
			observation.result.verifierStatus === "passed" &&
			observation.cold.workspaceChanged === true &&
			observation.cold.workspaceStateDigest ===
				catalog.fixtures[index]?.expectedWorkspaceStateDigest,
	);
	const issueCodes = Object.freeze(
		[
			...new Set([
				...observations.flatMap((observation) => observation.issueCodes),
				...passed.flatMap((value, index) => (value ? [] : [`fixture-${index + 1}-not-qualified`])),
			]),
		].sort(),
	);
	const costMicrousd = checkedSum(
		observations.map((observation) => observation.result.costMicrousd),
		"d682Mechanical.costMicrousd",
	);
	if (costMicrousd > D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD) {
		throw new TypeError("D682 mechanical qualification exceeded its aggregate hard cap");
	}
	const scorecard = strictSnapshot({
		schemaVersion:
			"graphrefly.private-solution-eval.d682-mechanical-qualification-scorecard.v1" as const,
		catalogDigest: empiricalStrictJsonDigest(catalog),
		claimBoundary: "mechanical-tool-path-qualification-no-efficacy-claim" as const,
		efficacyClaim: "none" as const,
		evidenceClass,
		empiricalLiveEvidence: evidenceClass === "live-provider",
		observationDigests: observations.map(empiricalStrictJsonDigest) as unknown as readonly [
			string,
			string,
			string,
		],
		attemptedFixtures: 3 as const,
		passedFixtures: passed.filter(Boolean).length,
		completeFixtures: observations.filter(
			(observation) => observation.result.classification === "complete",
		).length,
		nonEvaluableFixtures: observations.filter(
			(observation) => observation.result.classification === "non-evaluable",
		).length,
		requests: checkedSum(
			observations.map((observation) => observation.result.requests),
			"d682Mechanical.requests",
		),
		steps: checkedSum(
			observations.map((observation) => observation.result.steps),
			"d682Mechanical.steps",
		),
		attempts: checkedSum(
			observations.map((observation) => observation.result.attempts),
			"d682Mechanical.attempts",
		),
		inputTokens: nullableSum(
			observations.map((observation) => observation.result.inputTokens),
			"d682Mechanical.inputTokens",
		),
		outputTokens: nullableSum(
			observations.map((observation) => observation.result.outputTokens),
			"d682Mechanical.outputTokens",
		),
		totalTokens: nullableSum(
			observations.map((observation) => observation.result.totalTokens),
			"d682Mechanical.totalTokens",
		),
		latencyMs: checkedSum(
			observations.map((observation) => observation.result.latencyMs),
			"d682Mechanical.latencyMs",
		),
		costMicrousd,
		hardCapMicrousd: 500_000 as const,
		status: passed.every(Boolean)
			? evidenceClass === "live-provider"
				? ("qualified" as const)
				: ("simulated-contract-passed" as const)
			: ("not-qualified" as const),
		issueCodes,
	});
	return scorecard;
}
