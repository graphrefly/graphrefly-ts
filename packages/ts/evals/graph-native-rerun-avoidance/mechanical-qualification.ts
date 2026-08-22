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
import { assertPortableRepositoryPath } from "./canonical-repository-tree.js";
import type {
	EmpiricalSchemaCatalogV1,
	EmpiricalStrictJsonShapeV1,
	EmpiricalToolSchemaCatalogEntryV1,
} from "./contracts.js";
import {
	type EmpiricalCalibrationTrialBlockObservationV4,
	validateEmpiricalCalibrationTrialBlockObservation,
} from "./empirical-smoke-evidence.js";
import { validateEmpiricalSchemaCatalog } from "./strict-json-shape.js";

export const D682_MECHANICAL_QUALIFICATION_CATALOG_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-qualification-catalog.v1";
export const D682_MECHANICAL_ACTOR_INPUT_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-actor-input.v1";
export const D682_MECHANICAL_QUALIFICATION_SCORECARD_SCHEMA =
	"graphrefly.private-solution-eval.d682-mechanical-qualification-scorecard.v1";
export const D682_MECHANICAL_QUALIFICATION_CLAIM_BOUNDARY =
	"mechanical-tool-path-qualification-no-efficacy-claim";
export const D682_MECHANICAL_QUALIFICATION_FIXTURE_COUNT = 3;
export const D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD = 500_000;
export const D682_MECHANICAL_QUALIFICATION_MAX_CATALOG_BYTES = 65_536;
export const D682_MECHANICAL_ACTOR_INPUT_MAX_BYTES = 131_072;
const D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS = Object.freeze([
	"graphrefly.private-solution-eval.workspace.read-file.v1",
	"graphrefly.private-solution-eval.workspace.replace-exact.v1",
	"graphrefly.private-solution-eval.workspace.diff.v1",
	"graphrefly.private-solution-eval.workspace.run-command-ref.v1",
] as const);

export interface D682MechanicalToolRefsV1 {
	readonly readFile: string;
	readonly searchLiteral: string;
	readonly replaceExact: string;
	readonly workspaceDiff: string;
	readonly runCommand: string;
}

export interface D682MechanicalActorInputV1 {
	readonly schemaVersion: typeof D682_MECHANICAL_ACTOR_INPUT_SCHEMA;
	readonly workItemRef: string;
	readonly instructionRef: string;
	readonly taskKind: "replace-exact-workspace-text";
	readonly pathMode: "workspace-relative";
	readonly readablePaths: readonly string[];
	readonly writablePaths: readonly string[];
	readonly commandRefs: readonly string[];
	readonly replacementProposal: {
		readonly path: string;
		readonly oldText: string;
		readonly newText: string;
	};
	readonly requiredExecutionOrder: readonly [
		"read-file",
		"replace-exact",
		"workspace-diff",
		"run-command",
		"final",
	];
}

/** Package-private D682 actor contract; it carries synthetic fixture intent, never a hidden task patch. */
export function createD682MechanicalActorInput(input: {
	readonly workItemRef: string;
	readonly instructionRef: string;
	readonly readablePaths: readonly string[];
	readonly writablePaths: readonly string[];
	readonly commandRefs: readonly string[];
	readonly path: string;
	readonly oldText: string;
	readonly newText: string;
}): D682MechanicalActorInputV1 {
	const readablePaths = [...input.readablePaths]
		.map((value, index) => assertPortableRepositoryPath(value, `d682Actor.readablePaths[${index}]`))
		.sort();
	const writablePaths = [...input.writablePaths]
		.map((value, index) => assertPortableRepositoryPath(value, `d682Actor.writablePaths[${index}]`))
		.sort();
	if (
		readablePaths.length < 1 ||
		readablePaths.length > 32 ||
		writablePaths.length < 1 ||
		writablePaths.length > 32 ||
		new Set(readablePaths).size !== readablePaths.length ||
		new Set(writablePaths).size !== writablePaths.length ||
		writablePaths.some((value) => !readablePaths.includes(value))
	) {
		throw new TypeError("D682 actor paths must be bounded, unique, and writable-implies-readable");
	}
	const commandRefs = [...input.commandRefs].map((value, index) =>
		coordinate(value, `d682Actor.commandRefs[${index}]`),
	);
	if (
		commandRefs.length < 1 ||
		commandRefs.length > 32 ||
		new Set(commandRefs).size !== commandRefs.length
	) {
		throw new TypeError("D682 actor command refs must be bounded and unique");
	}
	const path = assertPortableRepositoryPath(input.path, "d682Actor.replacementProposal.path");
	if (!writablePaths.includes(path)) {
		throw new TypeError("D682 actor replacement path must be an exact declared writable path");
	}
	if (
		input.oldText.length === 0 ||
		input.oldText.length > 32_768 ||
		input.newText.length > 32_768
	) {
		throw new TypeError("D682 actor replacement text exceeds its bounded generic fixture contract");
	}
	const value: D682MechanicalActorInputV1 = strictSnapshot({
		schemaVersion: "graphrefly.private-solution-eval.d682-mechanical-actor-input.v1" as const,
		workItemRef: coordinate(input.workItemRef, "d682Actor.workItemRef"),
		instructionRef: coordinate(input.instructionRef, "d682Actor.instructionRef"),
		taskKind: "replace-exact-workspace-text" as const,
		pathMode: "workspace-relative" as const,
		readablePaths,
		writablePaths,
		commandRefs,
		replacementProposal: { path, oldText: input.oldText, newText: input.newText },
		requiredExecutionOrder: [
			"read-file",
			"replace-exact",
			"workspace-diff",
			"run-command",
			"final",
		] as const,
	});
	if (strictJsonCodec.encode(value).byteLength > D682_MECHANICAL_ACTOR_INPUT_MAX_BYTES) {
		throw new TypeError("D682 actor input exceeded its canonical byte bound");
	}
	return value;
}

export function validateD682MechanicalActorInput(value: unknown): D682MechanicalActorInputV1 {
	const actor = record(value, "d682Actor");
	exactKeys(
		actor,
		[
			"commandRefs",
			"instructionRef",
			"pathMode",
			"readablePaths",
			"replacementProposal",
			"requiredExecutionOrder",
			"schemaVersion",
			"taskKind",
			"workItemRef",
			"writablePaths",
		],
		"d682Actor",
	);
	const replacement = record(actor.replacementProposal, "d682Actor.replacementProposal");
	exactKeys(replacement, ["newText", "oldText", "path"], "d682Actor.replacementProposal");
	const paths = (field: "readablePaths" | "writablePaths"): string[] =>
		array(actor[field], `d682Actor.${field}`).map((entry, index) =>
			assertPortableRepositoryPath(entry, `d682Actor.${field}[${index}]`),
		);
	const commandRefs = array(actor.commandRefs, "d682Actor.commandRefs").map((entry, index) =>
		coordinate(entry, `d682Actor.commandRefs[${index}]`),
	);
	const order = array(actor.requiredExecutionOrder, "d682Actor.requiredExecutionOrder");
	const requiredOrder = ["read-file", "replace-exact", "workspace-diff", "run-command", "final"];
	if (
		order.length !== requiredOrder.length ||
		order.some((entry, index) => entry !== requiredOrder[index])
	) {
		throw new TypeError("D682 actor required execution order does not match its frozen contract");
	}
	if (typeof replacement.oldText !== "string" || typeof replacement.newText !== "string") {
		throw new TypeError("D682 actor replacement text must be strings");
	}
	const validated = createD682MechanicalActorInput({
		workItemRef: coordinate(actor.workItemRef, "d682Actor.workItemRef"),
		instructionRef: coordinate(actor.instructionRef, "d682Actor.instructionRef"),
		readablePaths: paths("readablePaths"),
		writablePaths: paths("writablePaths"),
		commandRefs,
		path: assertPortableRepositoryPath(replacement.path, "d682Actor.replacementProposal.path"),
		oldText: replacement.oldText,
		newText: replacement.newText,
	});
	if (
		actor.schemaVersion !== D682_MECHANICAL_ACTOR_INPUT_SCHEMA ||
		actor.taskKind !== "replace-exact-workspace-text" ||
		actor.pathMode !== "workspace-relative" ||
		empiricalStrictJsonDigest(actor) !== empiricalStrictJsonDigest(validated)
	) {
		throw new TypeError("D682 actor input does not match its exact canonical contract");
	}
	return validated;
}

const D682_STRING_SHAPE = strictSnapshot({
	kind: "string" as const,
	minLength: 1,
	maxLength: 32_768,
	enum: null,
});
const D682_REPLACEMENT_STRING_SHAPE = strictSnapshot({
	kind: "string" as const,
	minLength: 0,
	maxLength: 32_768,
	enum: null,
});

function d682StringShape(values: readonly string[] | null): EmpiricalStrictJsonShapeV1 {
	return strictSnapshot({ ...D682_STRING_SHAPE, enum: values });
}

function d682ObjectShape(
	properties: readonly {
		readonly name: string;
		readonly required: true;
		readonly shape: EmpiricalStrictJsonShapeV1;
	}[],
): EmpiricalStrictJsonShapeV1 {
	return strictSnapshot({
		kind: "object" as const,
		properties,
		additionalProperties: false as const,
	});
}

function expectedD682ToolSchemas(input: {
	readonly actorInput: D682MechanicalActorInputV1;
	readonly toolRefs: D682MechanicalToolRefsV1;
	readonly specialized: boolean;
	readonly maxSearchMatches: number;
}): ReadonlyMap<string, EmpiricalStrictJsonShapeV1> {
	const path = (values: readonly string[]) => d682StringShape(input.specialized ? values : null);
	const commandRef = d682StringShape(input.specialized ? input.actorInput.commandRefs : null);
	const maximumSearchMatches = input.specialized
		? safeInteger(input.maxSearchMatches, "d682ToolCatalog.maxSearchMatches", {
				min: 1,
				max: 4_096,
			})
		: 4_096;
	return new Map([
		[
			input.toolRefs.readFile,
			d682ObjectShape([
				{ name: "path", required: true, shape: path(input.actorInput.readablePaths) },
			]),
		],
		[
			input.toolRefs.searchLiteral,
			d682ObjectShape([
				{
					name: "maxMatches",
					required: true,
					shape: strictSnapshot({
						kind: "integer" as const,
						minimum: 1,
						maximum: maximumSearchMatches,
					}),
				},
				{ name: "path", required: true, shape: path(input.actorInput.readablePaths) },
				{ name: "query", required: true, shape: D682_STRING_SHAPE },
			]),
		],
		[
			input.toolRefs.replaceExact,
			d682ObjectShape([
				{
					name: "newText",
					required: true,
					shape: input.specialized ? D682_REPLACEMENT_STRING_SHAPE : D682_STRING_SHAPE,
				},
				{ name: "oldText", required: true, shape: D682_STRING_SHAPE },
				{ name: "path", required: true, shape: path(input.actorInput.writablePaths) },
			]),
		],
		[input.toolRefs.workspaceDiff, d682ObjectShape([])],
		[
			input.toolRefs.runCommand,
			d682ObjectShape([{ name: "commandRef", required: true, shape: commandRef }]),
		],
	]);
}

function validateD682ToolSet(input: {
	readonly tools: readonly EmpiricalToolSchemaCatalogEntryV1[];
	readonly actorInput: D682MechanicalActorInputV1;
	readonly toolRefs: D682MechanicalToolRefsV1;
	readonly schemaRevision: string;
	readonly specialized: boolean;
	readonly maxSearchMatches: number;
}): readonly EmpiricalToolSchemaCatalogEntryV1[] {
	const schemaRevision = coordinate(input.schemaRevision, "d682ToolCatalog.schemaRevision");
	const refs = Object.values(input.toolRefs).map((value, index) =>
		coordinate(value, `d682ToolCatalog.toolRefs[${index}]`),
	);
	if (new Set(refs).size !== refs.length || input.tools.length !== refs.length) {
		throw new TypeError("D682 tool catalog must contain the exact closed tool set");
	}
	const expectedSchemas = expectedD682ToolSchemas(input);
	const seen = new Set<string>();
	for (const tool of input.tools) {
		const expectedSchema = expectedSchemas.get(tool.toolRef);
		if (expectedSchema === undefined || seen.has(tool.toolRef)) {
			throw new TypeError("D682 tool catalog contains a substituted or duplicate tool");
		}
		seen.add(tool.toolRef);
		if (
			tool.schemaRevision !== schemaRevision ||
			tool.inputSchemaDigest !== empiricalStrictJsonDigest(tool.inputSchema) ||
			empiricalStrictJsonDigest(tool.inputSchema) !== empiricalStrictJsonDigest(expectedSchema)
		) {
			throw new TypeError(`D682 tool schema does not match ${tool.toolRef}`);
		}
	}
	return input.tools;
}

/** Fail-closed check shared by the operator, host, and provider binding. */
export function validateD682MechanicalToolContract(input: {
	readonly tools: readonly EmpiricalToolSchemaCatalogEntryV1[];
	readonly actorInput: D682MechanicalActorInputV1;
	readonly toolRefs: D682MechanicalToolRefsV1;
	readonly schemaRevision: string;
	readonly maxSearchMatches: number;
}): readonly EmpiricalToolSchemaCatalogEntryV1[] {
	return validateD682ToolSet({
		...input,
		actorInput: validateD682MechanicalActorInput(input.actorInput),
		specialized: true,
	});
}

/**
 * Package-private D682 provider-contract specialization. The provider and the
 * closed host receive the same frozen readable, writable, and command values;
 * the binding still validates model-authored arguments and never coerces them.
 */
export function specializeD682MechanicalToolSchemaCatalog(input: {
	readonly catalog: EmpiricalSchemaCatalogV1;
	readonly actorInput: D682MechanicalActorInputV1;
	readonly toolRefs: D682MechanicalToolRefsV1;
	readonly sourceSchemaRevision: string;
	readonly schemaRevision: string;
	readonly maxSearchMatches: number;
}): EmpiricalSchemaCatalogV1 {
	const actorInput = validateD682MechanicalActorInput(input.actorInput);
	const catalog = validateEmpiricalSchemaCatalog(input.catalog);
	const sourceSchemaRevision = coordinate(
		input.sourceSchemaRevision,
		"d682ToolCatalog.sourceSchemaRevision",
	);
	if (catalog.catalogRevision !== sourceSchemaRevision) {
		throw new TypeError("D682 source catalog revision does not match its tool schemas");
	}
	validateD682ToolSet({
		tools: catalog.tools,
		actorInput,
		toolRefs: input.toolRefs,
		schemaRevision: sourceSchemaRevision,
		specialized: false,
		maxSearchMatches: input.maxSearchMatches,
	});
	const schemaRevision = coordinate(input.schemaRevision, "d682ToolCatalog.schemaRevision");
	const expectedSchemas = expectedD682ToolSchemas({
		actorInput,
		toolRefs: input.toolRefs,
		specialized: true,
		maxSearchMatches: input.maxSearchMatches,
	});
	const tools = catalog.tools.map((tool): EmpiricalToolSchemaCatalogEntryV1 => {
		const inputSchema = expectedSchemas.get(tool.toolRef);
		if (inputSchema === undefined)
			throw new TypeError("D682 tool catalog contains a substituted tool");
		return strictSnapshot({
			...tool,
			schemaRevision,
			inputSchema,
			inputSchemaDigest: empiricalStrictJsonDigest(inputSchema),
		});
	});
	const specialized = validateEmpiricalSchemaCatalog({
		...catalog,
		catalogRevision: schemaRevision,
		tools,
	});
	validateD682MechanicalToolContract({
		tools: specialized.tools,
		actorInput,
		toolRefs: input.toolRefs,
		schemaRevision,
		maxSearchMatches: input.maxSearchMatches,
	});
	return specialized;
}

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

export function hasQualifiedD682ActionSequence(toolRefs: readonly string[]): boolean {
	let requiredIndex = 0;
	for (const toolRef of toolRefs) {
		if (toolRef === D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS[requiredIndex]) {
			requiredIndex += 1;
			continue;
		}
		const knownIndex = D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS.indexOf(
			toolRef as (typeof D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS)[number],
		);
		if (knownIndex > requiredIndex) return false;
		if (
			knownIndex >= 0 &&
			knownIndex < requiredIndex &&
			toolRef !== D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS[0]
		) {
			return false;
		}
	}
	return requiredIndex === D682_MECHANICAL_REQUIRED_ACTION_TOOL_REFS.length;
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
			hasQualifiedD682ActionSequence(observation.cold.actionTrace.map((entry) => entry.toolRef)) &&
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
