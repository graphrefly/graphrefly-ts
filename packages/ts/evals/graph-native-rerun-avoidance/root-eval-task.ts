import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export type RootEvalTaskKind = "development-transfer" | "confirmatory-transfer";
export type RootEvalTaskManifestSlot = `development-${number}` | "confirmatory";

export const ROOT_EVAL_TASK_MANIFEST_SCHEMA =
	"graphrefly-ts.root-eval-d145-task-manifest.v3" as const;
export const ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS = Object.freeze({
	"development-1": "root-eval-d145-transfer-development-1-v1",
	"development-2": "root-eval-d145-transfer-development-2-v1",
} as const);
export const ROOT_EVAL_CONFIRMATORY_TASK_SET_REF =
	"root-eval-d145-transfer-confirmatory-v1" as const;

export interface RootEvalTaskDefinition {
	readonly kind: RootEvalTaskKind;
	readonly taskSetRef: string;
	readonly instanceRef: string;
	readonly replicate: 1 | 2 | 3 | 4 | 5;
	readonly baselineCommit: string;
	readonly writablePath: string;
	readonly taskStatement: string;
	readonly sourceWorkItemRef: string;
	readonly sourceVerifierEvidenceDigest: string;
	readonly sourceInsightDigest: string;
	readonly sourceInsightContent: string;
	readonly sourceWritablePath: string;
	readonly sourceTaskStatement: string;
	readonly sourceFixtureCorrectText: string;
	readonly sourceFixtureBuggyText: string;
	readonly sourceReadonlyFixtureFiles: readonly Readonly<{
		readonly path: string;
		readonly text: string;
	}>[];
	readonly sourceActorContext: readonly Readonly<{
		readonly heading: string;
		readonly path: string;
		readonly excerptStart?: string;
		readonly excerptEnd?: string;
	}>[];
	readonly sourcePublicVerifierPath: string;
	readonly sourceHiddenVerifierPath: string;
	readonly sourcePublicVerifierName: string;
	readonly sourceHiddenVerifierName: string;
	readonly sourcePublicVerifierSource: string;
	readonly sourceHiddenVerifierSource: string;
	readonly fixtureCorrectText: string;
	readonly fixtureBuggyText: string;
	readonly readonlyFixtureFiles: readonly Readonly<{
		readonly path: string;
		readonly text: string;
	}>[];
	readonly actorContext: readonly Readonly<{
		readonly heading: string;
		readonly path: string;
		readonly excerptStart?: string;
		readonly excerptEnd?: string;
	}>[];
	readonly publicVerifierPath: string;
	readonly hiddenVerifierPath: string;
	readonly publicVerifierName: string;
	readonly hiddenVerifierName: string;
	readonly publicVerifierSource: string;
	readonly hiddenVerifierSource: string;
}

export function rootEvalDevelopmentOrdinal(slot: RootEvalTaskManifestSlot): number | null {
	if (slot === "confirmatory") return null;
	const match = /^development-([1-9][0-9]*)$/u.exec(slot);
	if (match === null) throw new TypeError("root eval development manifest slot invalid");
	const ordinal = Number(match[1]);
	if (!Number.isSafeInteger(ordinal))
		throw new TypeError("root eval development manifest ordinal invalid");
	return ordinal;
}

export function rootEvalDevelopmentTaskSetRef(ordinal: number): string {
	if (!Number.isSafeInteger(ordinal) || ordinal < 1)
		throw new TypeError("root eval development task-set ordinal invalid");
	return `root-eval-d145-transfer-development-${ordinal}-v1`;
}

export interface RootEvalTaskManifest {
	readonly schemaVersion: typeof ROOT_EVAL_TASK_MANIFEST_SCHEMA;
	readonly slot: RootEvalTaskManifestSlot;
	readonly taskSetRef: string;
	readonly tasks: readonly RootEvalTaskDefinition[];
	readonly manifestDigest: string;
}

const ROOT_EVAL_TASK_DEFINITION_KEYS = Object.freeze(
	[
		"actorContext",
		"baselineCommit",
		"fixtureBuggyText",
		"fixtureCorrectText",
		"hiddenVerifierName",
		"hiddenVerifierPath",
		"hiddenVerifierSource",
		"instanceRef",
		"kind",
		"publicVerifierName",
		"publicVerifierPath",
		"publicVerifierSource",
		"readonlyFixtureFiles",
		"replicate",
		"sourceActorContext",
		"sourceFixtureBuggyText",
		"sourceFixtureCorrectText",
		"sourceHiddenVerifierName",
		"sourceHiddenVerifierPath",
		"sourceHiddenVerifierSource",
		"sourceInsightContent",
		"sourceInsightDigest",
		"sourcePublicVerifierName",
		"sourcePublicVerifierPath",
		"sourcePublicVerifierSource",
		"sourceReadonlyFixtureFiles",
		"sourceTaskStatement",
		"sourceVerifierEvidenceDigest",
		"sourceWorkItemRef",
		"sourceWritablePath",
		"taskSetRef",
		"taskStatement",
		"writablePath",
	].sort(),
);

function hasCurrentTaskDefinitionShape(task: RootEvalTaskDefinition, index: number): boolean {
	if (
		JSON.stringify(Object.keys(task).sort()) !== JSON.stringify(ROOT_EVAL_TASK_DEFINITION_KEYS) ||
		task.instanceRef !== `${task.taskSetRef}/instance-${index + 1}` ||
		task.sourceWorkItemRef !== `${task.instanceRef}/source-work-item` ||
		!/^sha256:[0-9a-f]{64}$/u.test(task.sourceVerifierEvidenceDigest) ||
		!/^sha256:[0-9a-f]{64}$/u.test(task.sourceInsightDigest) ||
		task.sourceInsightDigest !==
			empiricalStrictJsonDigest({
				kind: "eval-source-causal-insight-bytes",
				taskInstanceRef: task.instanceRef,
				sourceWorkItemId: task.sourceWorkItemRef,
				content: task.sourceInsightContent,
			}) ||
		!Array.isArray(task.sourceReadonlyFixtureFiles) ||
		!Array.isArray(task.sourceActorContext) ||
		!Array.isArray(task.readonlyFixtureFiles) ||
		!Array.isArray(task.actorContext)
	)
		return false;
	return [
		task.baselineCommit,
		task.writablePath,
		task.taskStatement,
		task.sourceInsightContent,
		task.sourceWritablePath,
		task.sourceTaskStatement,
		task.sourceFixtureCorrectText,
		task.sourceFixtureBuggyText,
		task.sourcePublicVerifierPath,
		task.sourceHiddenVerifierPath,
		task.sourcePublicVerifierName,
		task.sourceHiddenVerifierName,
		task.sourcePublicVerifierSource,
		task.sourceHiddenVerifierSource,
		task.fixtureCorrectText,
		task.fixtureBuggyText,
		task.publicVerifierPath,
		task.hiddenVerifierPath,
		task.publicVerifierName,
		task.hiddenVerifierName,
		task.publicVerifierSource,
		task.hiddenVerifierSource,
	].every((value) => typeof value === "string" && value.length > 0);
}

export interface RootEvalTaskBinding {
	readonly replicate: 1 | 2 | 3 | 4 | 5;
	readonly taskInstanceRef: string;
	readonly sourceWorkItemId: string;
	readonly sourceEvidenceDigest: string;
	readonly sourceInsightDigest: string;
	readonly irrelevantTaskInstanceRef: string;
	readonly irrelevantSourceWorkItemId: string;
	readonly irrelevantSourceEvidenceDigest: string;
	readonly irrelevantSourceInsightDigest: string;
}

interface TransferVariant {
	readonly slug: string;
	readonly exportName: string;
	readonly envelopeName: string;
	readonly sourceField: string;
	readonly boundaryField: string;
	readonly acceptedRule: "source" | "boundary" | "normalized-source";
	readonly publicCoordinate: string;
	readonly hiddenSourceCoordinate: string;
	readonly boundaryCoordinate: string;
	readonly sourceInsightContent: string;
}

const BASELINE_COMMIT = "dea57bdeb4b370dddbbe2505bd05f9e3551b26c6";
const QUALIFICATION_TASK_SET_REF = "root-eval-d145-transfer-qualification-v1";

export const ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES = Object.freeze([2, 3, 4, 5, 1] as const);

const VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "origin-boundary-coordinate",
		exportName: "admitTrimSensitiveCoordinate",
		envelopeName: "OriginBoundaryEnvelope",
		sourceField: "originRef",
		boundaryField: "boundaryRef",
		acceptedRule: "source",
		publicCoordinate: "proposal:tenant-alpha:run-7 ",
		hiddenSourceCoordinate: "proposal:tenant-alpha:run-7 ",
		boundaryCoordinate: "proposal:tenant-alpha:run-7",
		sourceInsightContent:
			"A prior verified Work Item established that originRef is the causal identity for this handoff. boundaryRef is a transport-facing representation and can differ without changing the source admission; compare the local coordinate with originRef and return originRef unchanged.",
	}),
	Object.freeze({
		slug: "issued-presentation-coordinate",
		exportName: "admitCaseSensitiveCoordinate",
		envelopeName: "IssuedPresentationEnvelope",
		sourceField: "issuedKey",
		boundaryField: "presentationKey",
		acceptedRule: "boundary",
		publicCoordinate: "RunAdmission:TenantA:CandidateZ",
		hiddenSourceCoordinate: "RunAdmission:TenantA:CandidateZ",
		boundaryCoordinate: "runadmission:tenanta:candidatez",
		sourceInsightContent:
			"A prior verified Work Item established that presentationKey is the signed admission identity after issuer canonicalization. issuedKey is only the pre-presentation candidate; compare the local coordinate with presentationKey and return presentationKey unchanged.",
	}),
	Object.freeze({
		slug: "causal-lookup-coordinate",
		exportName: "admitCompositeCoordinate",
		envelopeName: "CausalLookupEnvelope",
		sourceField: "causalId",
		boundaryField: "lookupId",
		acceptedRule: "source",
		publicCoordinate: "workspace-A#proposal-B#attempt-C",
		hiddenSourceCoordinate: "workspace-A#proposal-B#attempt-C",
		boundaryCoordinate: "attempt-C",
		sourceInsightContent:
			"A prior verified Work Item established that causalId retains the namespace needed for admission identity. lookupId is only an index key; compare the local coordinate with causalId and return the complete causalId.",
	}),
	Object.freeze({
		slug: "stored-rendered-coordinate",
		exportName: "admitSerializedCoordinate",
		envelopeName: "StoredRenderedEnvelope",
		sourceField: "storedToken",
		boundaryField: "renderedToken",
		acceptedRule: "boundary",
		publicCoordinate: '{ "run": "7", "tenant": "alpha" }',
		hiddenSourceCoordinate: '{ "run": "7", "tenant": "alpha" }',
		boundaryCoordinate: '{"run":"7","tenant":"alpha"}',
		sourceInsightContent:
			"A prior verified Work Item established that renderedToken is the admission identity after canonical serialization and signature. storedToken is the pre-render storage candidate; compare and return renderedToken unchanged.",
	}),
	Object.freeze({
		slug: "producer-alias-coordinate",
		exportName: "admitEncodedCoordinate",
		envelopeName: "ProducerAliasEnvelope",
		sourceField: "producerRef",
		boundaryField: "localAlias",
		acceptedRule: "normalized-source",
		publicCoordinate: "proposal/tenant-alpha/run-7",
		hiddenSourceCoordinate: "Proposal/Tenant-Alpha/Run-7",
		boundaryCoordinate: "proposal/tenant-alpha/local-alias",
		sourceInsightContent:
			"A prior verified Work Item established that producerRef must be normalized to lowercase before admission comparison and return. localAlias is an independently assigned convenience value and must not replace the normalized producer identity.",
	}),
]);

function contractSource(variant: TransferVariant): string {
	return `export interface ${variant.envelopeName} {
	readonly ${variant.sourceField}: string;
	readonly ${variant.boundaryField}: string;
}
`;
}

function taskSource(input: {
	readonly exportName: string;
	readonly envelopeName: string;
	readonly contractImport: string;
	readonly acceptedExpression: string;
}): string {
	return `import type { ${input.envelopeName} } from "${input.contractImport}";

export function ${input.exportName}(
	envelope: ${input.envelopeName},
	locallyDerivedCoordinate: string,
): string {
	const acceptedCoordinate = ${input.acceptedExpression};
	if (acceptedCoordinate !== locallyDerivedCoordinate)
		throw new TypeError("handoff coordinate mismatch");
	return acceptedCoordinate;
}
`;
}

function acceptedExpression(
	variant: TransferVariant,
	rule: TransferVariant["acceptedRule"] = variant.acceptedRule,
): string {
	if (rule === "normalized-source") return `envelope.${variant.sourceField}.toLowerCase()`;
	return `envelope.${rule === "source" ? variant.sourceField : variant.boundaryField}`;
}

function verifierSource(input: {
	readonly importPath: string;
	readonly exportName: string;
	readonly testName: string;
	readonly coordinate: string;
	readonly boundaryCoordinate: string;
	readonly sourceField: string;
	readonly boundaryField: string;
	readonly acceptedRule: TransferVariant["acceptedRule"];
	readonly hidden: boolean;
}): string {
	const coordinate = JSON.stringify(input.coordinate);
	const boundaryCoordinate = JSON.stringify(input.boundaryCoordinate);
	const mismatchedCoordinate = JSON.stringify(`${input.coordinate}:mismatch`);
	const envelope = `{ ${input.sourceField}: sourceCoordinate, ${input.boundaryField}: boundaryCoordinate }`;
	const acceptedCoordinate =
		input.acceptedRule === "source"
			? "sourceCoordinate"
			: input.acceptedRule === "boundary"
				? "boundaryCoordinate"
				: "sourceCoordinate.toLowerCase()";
	const rejectedCoordinate =
		input.acceptedRule === "source" ? "boundaryCoordinate" : "sourceCoordinate";
	const hiddenAssertion = input.hidden
		? `\t\texpect(${input.exportName}(${envelope}, ${acceptedCoordinate})).toBe(${acceptedCoordinate});
\t\texpect(() => ${input.exportName}(${envelope}, ${rejectedCoordinate})).toThrow(
\t\t\t/handoff coordinate mismatch/u,
\t\t);`
		: "";
	return `import { describe, expect, it } from "vitest";
import { ${input.exportName} } from "${input.importPath}";

describe("D145 prior Work Item transfer task", () => {
	it(${JSON.stringify(input.testName)}, () => {
		const sourceCoordinate = ${coordinate};
		const boundaryCoordinate = ${input.hidden ? boundaryCoordinate : "sourceCoordinate"};
		expect(${input.exportName}(${envelope}, ${acceptedCoordinate})).toBe(${acceptedCoordinate});
		expect(() => ${input.exportName}(${envelope}, ${mismatchedCoordinate})).toThrow(
			/handoff coordinate mismatch/u,
		);
${hiddenAssertion}
	});
});
`;
}

function createTask(
	kind: RootEvalTaskKind,
	replicate: 1 | 2 | 3 | 4 | 5,
	variant: TransferVariant,
	taskSetRef: string,
	publicCoordinate = variant.publicCoordinate,
	hiddenSourceCoordinate = variant.hiddenSourceCoordinate,
): RootEvalTaskDefinition {
	const lane = kind === "development-transfer" ? "development" : "confirmatory";
	const instanceRef = `${taskSetRef}/instance-${replicate}`;
	const targetDirectory = `packages/ts/src/.root-eval-transfer/${lane}`;
	const writablePath = `${targetDirectory}/${replicate}-${variant.slug}.ts`;
	const contractPath = `${targetDirectory}/${replicate}-${variant.slug}.contract.ts`;
	const verifierDirectory = `packages/ts/src/__tests__/.root-eval-transfer/${lane}`;
	const publicVerifierPath = `${verifierDirectory}/${replicate}-${variant.slug}.public.test.ts`;
	const hiddenVerifierPath = `${verifierDirectory}/${replicate}-${variant.slug}.hidden.test.ts`;
	const publicVerifierName = `preserves the producer coordinate for transfer instance ${replicate}`;
	const hiddenVerifierName = `withheld: rejects reconstruction for transfer instance ${replicate}`;
	const relativeImport = `../../../.root-eval-transfer/${lane}/${replicate}-${variant.slug}.js`;
	const contractImport = `./${replicate}-${variant.slug}.contract.js`;
	const sourceWorkItemRef = `${instanceRef}/source-work-item`;
	const sourceDirectory = `packages/ts/src/.root-eval-transfer/source/${lane}`;
	const sourceWritablePath = `${sourceDirectory}/${replicate}-${variant.slug}.ts`;
	const sourceContractPath = `${sourceDirectory}/${replicate}-${variant.slug}.contract.ts`;
	const sourceVerifierDirectory = `packages/ts/src/__tests__/.root-eval-transfer/source/${lane}`;
	const sourcePublicVerifierPath = `${sourceVerifierDirectory}/${replicate}-${variant.slug}.public.test.ts`;
	const sourceHiddenVerifierPath = `${sourceVerifierDirectory}/${replicate}-${variant.slug}.hidden.test.ts`;
	const sourcePublicVerifierName = `establishes the producer coordinate for source instance ${replicate}`;
	const sourceHiddenVerifierName = `withheld: verifies causal source identity for instance ${replicate}`;
	const sourceExportName = `${variant.exportName}AtSource`;
	const sourceRelativeImport = `../../../../.root-eval-transfer/source/${lane}/${replicate}-${variant.slug}.js`;
	const sourceContractImport = `./${replicate}-${variant.slug}.contract.js`;
	const sourceFixtureCorrectText = taskSource({
		exportName: sourceExportName,
		envelopeName: variant.envelopeName,
		contractImport: sourceContractImport,
		acceptedExpression: acceptedExpression(variant),
	});
	const sourceFixtureBuggyText = taskSource({
		exportName: sourceExportName,
		envelopeName: variant.envelopeName,
		contractImport: sourceContractImport,
		acceptedExpression: acceptedExpression(
			variant,
			variant.acceptedRule === "source" ? "boundary" : "source",
		),
	});
	const sourcePublicVerifierSource = verifierSource({
		importPath: sourceRelativeImport,
		exportName: sourceExportName,
		testName: sourcePublicVerifierName,
		coordinate: publicCoordinate,
		boundaryCoordinate: variant.boundaryCoordinate,
		sourceField: variant.sourceField,
		boundaryField: variant.boundaryField,
		acceptedRule: variant.acceptedRule,
		hidden: false,
	});
	const sourceHiddenVerifierSource = verifierSource({
		importPath: sourceRelativeImport,
		exportName: sourceExportName,
		testName: sourceHiddenVerifierName,
		coordinate: hiddenSourceCoordinate,
		boundaryCoordinate: variant.boundaryCoordinate,
		sourceField: variant.sourceField,
		boundaryField: variant.boundaryField,
		acceptedRule: variant.acceptedRule,
		hidden: true,
	});
	const sourceInsightDigest = empiricalStrictJsonDigest({
		kind: "eval-source-causal-insight-bytes",
		taskInstanceRef: instanceRef,
		sourceWorkItemId: sourceWorkItemRef,
		content: variant.sourceInsightContent,
	});
	const sourceVerifierEvidenceDigest = empiricalStrictJsonDigest({
		kind: "eval-source-evidence",
		taskInstanceRef: instanceRef,
		sourceWorkItemId: sourceWorkItemRef,
		sourceTaskDigest: empiricalStrictJsonDigest({
			writablePath: sourceWritablePath,
			fixtureBuggyText: sourceFixtureBuggyText,
			fixtureCorrectText: sourceFixtureCorrectText,
			publicVerifierPath: sourcePublicVerifierPath,
			publicVerifierSource: sourcePublicVerifierSource,
			hiddenVerifierPath: sourceHiddenVerifierPath,
			hiddenVerifierSource: sourceHiddenVerifierSource,
		}),
		verification: "passed",
		cleanupCompleted: true,
	});
	const rejectedSourceIdentity =
		variant.acceptedRule === "source"
			? variant.boundaryField
			: variant.acceptedRule === "boundary"
				? variant.sourceField
				: `unnormalized ${variant.sourceField}`;
	const admittedSourceIdentity =
		variant.acceptedRule === "boundary"
			? variant.boundaryField
			: variant.acceptedRule === "normalized-source"
				? `normalized ${variant.sourceField}`
				: variant.sourceField;
	return Object.freeze({
		kind,
		taskSetRef,
		instanceRef,
		replicate,
		baselineCommit: BASELINE_COMMIT,
		writablePath,
		taskStatement: `A handoff regression causes some valid admission coordinates to be rejected. Restore stable agreement while retaining mismatch rejection. The two envelope coordinates can coincide in ordinary traffic but are not guaranteed to do so. Make the smallest change in the admitted file only.

Acceptance criteria:
1. Valid handoff fixtures are accepted and round-trip through the consumer.
2. A locally derived coordinate that does not identify the admitted handoff is rejected.
3. Preserve the causal identity established by the upstream handoff.
4. Only ${writablePath} changes.`,
		sourceWorkItemRef,
		sourceVerifierEvidenceDigest,
		sourceInsightDigest,
		sourceInsightContent: variant.sourceInsightContent,
		sourceWritablePath,
		sourceTaskStatement: `A source Work Item found that a producer handoff was accepting ${rejectedSourceIdentity} instead of the admitted ${admittedSourceIdentity}. Repair the admitted source file so the verified identity is preserved and mismatches are rejected. Make the smallest change in ${sourceWritablePath} only.`,
		sourceFixtureCorrectText,
		sourceFixtureBuggyText,
		sourceReadonlyFixtureFiles: Object.freeze([
			Object.freeze({ path: sourceContractPath, text: contractSource(variant) }),
		]),
		sourceActorContext: Object.freeze([
			Object.freeze({ heading: "Source handoff contract", path: sourceContractPath }),
			Object.freeze({ heading: "Source Work Item target", path: sourceWritablePath }),
		]),
		sourcePublicVerifierPath,
		sourceHiddenVerifierPath,
		sourcePublicVerifierName,
		sourceHiddenVerifierName,
		sourcePublicVerifierSource,
		sourceHiddenVerifierSource,
		fixtureCorrectText: taskSource({
			exportName: variant.exportName,
			envelopeName: variant.envelopeName,
			contractImport,
			acceptedExpression: acceptedExpression(variant),
		}),
		fixtureBuggyText: taskSource({
			exportName: variant.exportName,
			envelopeName: variant.envelopeName,
			contractImport,
			acceptedExpression: acceptedExpression(
				variant,
				variant.acceptedRule === "source" ? "boundary" : "source",
			),
		}),
		readonlyFixtureFiles: Object.freeze([
			Object.freeze({ path: contractPath, text: contractSource(variant) }),
		]),
		actorContext: Object.freeze([
			Object.freeze({ heading: "Upstream handoff contract", path: contractPath }),
			Object.freeze({ heading: "Current admitted target", path: writablePath }),
		]),
		publicVerifierPath,
		hiddenVerifierPath,
		publicVerifierName,
		hiddenVerifierName,
		publicVerifierSource: verifierSource({
			importPath: relativeImport,
			exportName: variant.exportName,
			testName: publicVerifierName,
			coordinate: publicCoordinate,
			boundaryCoordinate: variant.boundaryCoordinate,
			sourceField: variant.sourceField,
			boundaryField: variant.boundaryField,
			acceptedRule: variant.acceptedRule,
			hidden: false,
		}),
		hiddenVerifierSource: verifierSource({
			importPath: relativeImport,
			exportName: variant.exportName,
			testName: hiddenVerifierName,
			coordinate: hiddenSourceCoordinate,
			boundaryCoordinate: variant.boundaryCoordinate,
			sourceField: variant.sourceField,
			boundaryField: variant.boundaryField,
			acceptedRule: variant.acceptedRule,
			hidden: true,
		}),
	});
}

function createTaskSet(
	kind: RootEvalTaskKind,
	taskSetRef: string,
	variants: readonly TransferVariant[] = VARIANTS,
	coordinateSuffix = "",
): readonly RootEvalTaskDefinition[] {
	return Object.freeze(
		variants.map((_variant, index) =>
			createTask(
				kind,
				(index + 1) as 1 | 2 | 3 | 4 | 5,
				variants[index]!,
				taskSetRef,
				`${variants[index]!.publicCoordinate}${coordinateSuffix}`,
				`${variants[index]!.hiddenSourceCoordinate}${coordinateSuffix}`,
			),
		),
	);
}

export const ROOT_EVAL_DEVELOPMENT_TASKS = createTaskSet(
	"development-transfer",
	QUALIFICATION_TASK_SET_REF,
);

export const ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST = empiricalStrictJsonDigest(
	strictSnapshot({ decisionRef: "graphrefly-ts:D145", tasks: ROOT_EVAL_DEVELOPMENT_TASKS }),
);

export function rootEvalTaskBindings(
	tasks: readonly RootEvalTaskDefinition[],
): readonly RootEvalTaskBinding[] {
	if (
		tasks.length !== 5 ||
		tasks.some((task, index) => task.replicate !== index + 1) ||
		new Set(tasks.map((task) => task.instanceRef)).size !== 5
	)
		throw new TypeError("root eval task bindings require five ordered distinct tasks");
	return Object.freeze(
		tasks.map((task, index) => {
			const irrelevant = tasks[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]!;
			return Object.freeze({
				replicate: task.replicate,
				taskInstanceRef: task.instanceRef,
				sourceWorkItemId: task.sourceWorkItemRef,
				sourceEvidenceDigest: task.sourceVerifierEvidenceDigest,
				sourceInsightDigest: task.sourceInsightDigest,
				irrelevantTaskInstanceRef: irrelevant.instanceRef,
				irrelevantSourceWorkItemId: irrelevant.sourceWorkItemRef,
				irrelevantSourceEvidenceDigest: irrelevant.sourceVerifierEvidenceDigest,
				irrelevantSourceInsightDigest: irrelevant.sourceInsightDigest,
			});
		}),
	);
}

export const ROOT_EVAL_HELD_OUT_SEAL_DIGEST =
	"sha256:3ccbca4701877bb96781eab2f92e16600dafe5aa0f85e1b756bb997e8d447982" as const;

export const ROOT_EVAL_D145_TASK_SET_BINDING_DIGEST = empiricalStrictJsonDigest(
	strictSnapshot({
		developmentTaskSetDigest: ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST,
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
	}),
);

function manifestMaterial(manifest: Omit<RootEvalTaskManifest, "manifestDigest">): object {
	return strictSnapshot(manifest);
}

export function createRootEvalTaskManifest(input: {
	readonly slot: RootEvalTaskManifestSlot;
	readonly variantOrder: readonly number[];
	readonly coordinateSuffix: string;
}): RootEvalTaskManifest {
	const developmentOrdinal = rootEvalDevelopmentOrdinal(input.slot);
	if (
		input.variantOrder.length !== 5 ||
		new Set(input.variantOrder).size !== 5 ||
		input.variantOrder.some(
			(index) => !Number.isSafeInteger(index) || index < 0 || index >= VARIANTS.length,
		) ||
		!/^[a-z0-9-]{16,128}$/u.test(input.coordinateSuffix)
	)
		throw new TypeError("root eval task manifest generation input invalid");
	const kind = input.slot === "confirmatory" ? "confirmatory-transfer" : "development-transfer";
	const taskSetRef =
		input.slot === "confirmatory"
			? ROOT_EVAL_CONFIRMATORY_TASK_SET_REF
			: rootEvalDevelopmentTaskSetRef(developmentOrdinal!);
	const tasks = createTaskSet(
		kind,
		taskSetRef,
		input.variantOrder.map((index) => VARIANTS[index]!),
		`:${input.coordinateSuffix}`,
	);
	const material = Object.freeze({
		schemaVersion: ROOT_EVAL_TASK_MANIFEST_SCHEMA,
		slot: input.slot,
		taskSetRef,
		tasks,
	});
	return Object.freeze({
		...material,
		manifestDigest: empiricalStrictJsonDigest(manifestMaterial(material)),
	});
}

function privateManifestDirectory(): string {
	return resolve(
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY ??
			resolve(
				import.meta.dirname,
				"../.private/empirical-memory-rerun-avoidance/d145-task-manifests",
			),
	);
}

export function readRootEvalTaskManifest(slot: RootEvalTaskManifestSlot): RootEvalTaskManifest {
	const developmentOrdinal = rootEvalDevelopmentOrdinal(slot);
	const path = resolve(privateManifestDirectory(), `${slot}.json`);
	const file = statSync(path);
	if (!file.isFile() || (file.mode & 0o077) !== 0)
		throw new TypeError(`root eval ${slot} task manifest must be a mode-0600 regular file`);
	const value = JSON.parse(readFileSync(path, "utf8")) as RootEvalTaskManifest;
	if (
		value.schemaVersion !== ROOT_EVAL_TASK_MANIFEST_SCHEMA ||
		value.slot !== slot ||
		value.taskSetRef !==
			(slot === "confirmatory"
				? ROOT_EVAL_CONFIRMATORY_TASK_SET_REF
				: rootEvalDevelopmentTaskSetRef(developmentOrdinal!)) ||
		value.tasks?.length !== 5 ||
		value.tasks.some(
			(task, index) =>
				task.replicate !== index + 1 ||
				task.taskSetRef !== value.taskSetRef ||
				task.kind !==
					(slot === "confirmatory" ? "confirmatory-transfer" : "development-transfer") ||
				!hasCurrentTaskDefinitionShape(task, index),
		) ||
		value.manifestDigest !==
			empiricalStrictJsonDigest(
				manifestMaterial({
					schemaVersion: value.schemaVersion,
					slot: value.slot,
					taskSetRef: value.taskSetRef,
					tasks: value.tasks,
				}),
			)
	)
		throw new TypeError(`root eval ${slot} task manifest failed closed`);
	return Object.freeze(value);
}

export function rootEvalTask(
	kind: RootEvalTaskKind,
	replicate: number,
	manifestSlot?: RootEvalTaskManifestSlot,
): RootEvalTaskDefinition {
	if (!Number.isSafeInteger(replicate) || replicate < 1 || replicate > 5)
		throw new TypeError("root eval transfer task replicate must be 1..5");
	const tasks =
		manifestSlot === undefined
			? kind === "development-transfer"
				? ROOT_EVAL_DEVELOPMENT_TASKS
				: (() => {
						throw new TypeError("root eval confirmatory task requires a sealed private manifest");
					})()
			: readRootEvalTaskManifest(manifestSlot).tasks;
	if (tasks[0]?.kind !== kind)
		throw new TypeError("root eval task kind did not match its private manifest slot");
	return tasks[replicate - 1]!;
}
