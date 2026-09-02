import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";

export type RootEvalTaskKind = "development-transfer" | "confirmatory-transfer";
export type RootEvalTaskManifestSlot = `development-${number}` | "confirmatory";

export const ROOT_EVAL_TASK_MANIFEST_SCHEMA =
	"graphrefly-ts.root-eval-d152-mechanism-manifest.v7" as const;
export const ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS = Object.freeze({
	"development-1": "root-eval-d152-mechanism-development-1-v1",
	"development-2": "root-eval-d152-mechanism-development-2-v1",
} as const);
export const ROOT_EVAL_CONFIRMATORY_TASK_SET_REF =
	"root-eval-d152-mechanism-confirmatory-v1" as const;

export interface RootEvalTaskDefinition {
	readonly kind: RootEvalTaskKind;
	readonly taskSetRef: string;
	readonly instanceRef: string;
	readonly replicate: 1 | 2 | 3 | 4 | 5;
	readonly mechanismId: string;
	readonly mechanismAction: RootEvalSourceInsightDiscriminant;
	readonly mechanismAlternativeAction: RootEvalSourceInsightDiscriminant;
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
	return `root-eval-d152-mechanism-development-${ordinal}-v1`;
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
		"mechanismAction",
		"mechanismAlternativeAction",
		"mechanismId",
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
		!Array.isArray(task.actorContext) ||
		task.sourceReadonlyFixtureFiles.length !== 1 ||
		task.readonlyFixtureFiles.length !== 1 ||
		task.sourceActorContext.length !== 2 ||
		task.actorContext.length !== 2 ||
		[...task.sourceReadonlyFixtureFiles, ...task.readonlyFixtureFiles].some(
			(fixture) =>
				typeof fixture.path !== "string" ||
				fixture.path.length === 0 ||
				typeof fixture.text !== "string" ||
				fixture.text.length === 0,
		)
	)
		return false;
	return [
		task.baselineCommit,
		task.mechanismId,
		task.mechanismAction,
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
	readonly mechanismId: string;
	readonly exportName: string;
	readonly envelopeName: string;
	readonly acceptedRule: RootEvalSourceInsightDiscriminant;
	readonly contractSource: string;
	readonly correctExpression: string;
	readonly alternativeExpression: string;
	readonly thirdExpression: string;
	readonly publicFixture: string;
	readonly publicExpected: string;
	readonly hiddenFixture: string;
	readonly hiddenExpected: string;
	readonly sourceInsightContent: string;
}

export type RootEvalSourceInsightDiscriminant =
	| "select-first-candidate"
	| "select-second-candidate"
	| "select-third-candidate";

const BASELINE_COMMIT = "dea57bdeb4b370dddbbe2505bd05f9e3551b26c6";
const QUALIFICATION_TASK_SET_REF = "root-eval-d152-mechanism-qualification-v1";

const SOURCE_INSIGHT_LENGTH = 80;
const SOURCE_INSIGHT_PREFIX = "mechanism-invariant.v1;action=";

function sourceInsightContent(rule: TransferVariant["acceptedRule"]): string {
	const content = `${SOURCE_INSIGHT_PREFIX}${rule}`;
	if (content.length > SOURCE_INSIGHT_LENGTH)
		throw new TypeError("root eval source insight exceeded its matched bound");
	return content.padEnd(SOURCE_INSIGHT_LENGTH, " ");
}

export function rootEvalSourceInsightDiscriminant(
	content: string,
): RootEvalSourceInsightDiscriminant {
	for (const discriminant of [
		"select-first-candidate",
		"select-second-candidate",
		"select-third-candidate",
	] as const) {
		if (content === `${SOURCE_INSIGHT_PREFIX}${discriminant}`.padEnd(SOURCE_INSIGHT_LENGTH, " "))
			return discriminant;
	}
	throw new TypeError("root eval source insight violated its closed discriminant grammar");
}

export const ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES = Object.freeze([2, 3, 4, 5, 1] as const);

const VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "cache-key",
		mechanismId: "canonical-cache-key",
		exportName: "cacheLookupKey",
		envelopeName: "CacheLookupInput",
		acceptedRule: "select-first-candidate",
		contractSource: "\treadonly rawKey: string;",
		correctExpression: "input.rawKey.trim().toLowerCase()",
		alternativeExpression: "input.rawKey",
		thirdExpression: "input.rawKey.trim()",
		publicFixture: '{ rawKey: "cache-key" }',
		publicExpected: '"cache-key"',
		hiddenFixture: '{ rawKey: " Cache-Key " }',
		hiddenExpected: '"cache-key"',
		sourceInsightContent: sourceInsightContent("select-first-candidate"),
	}),
	Object.freeze({
		slug: "lease-boundary",
		mechanismId: "exclusive-lease-expiry",
		exportName: "leaseState",
		envelopeName: "LeaseStateInput",
		acceptedRule: "select-second-candidate",
		contractSource:
			"\treadonly nowMs: number;\n\treadonly expiresAtMs: number;\n\treadonly token: string;",
		correctExpression: 'input.nowMs < input.expiresAtMs ? input.token : "expired"',
		alternativeExpression: 'input.nowMs <= input.expiresAtMs ? input.token : "expired"',
		thirdExpression: 'input.nowMs !== input.expiresAtMs ? input.token : "expired"',
		publicFixture: '{ nowMs: 9, expiresAtMs: 10, token: "active" }',
		publicExpected: '"active"',
		hiddenFixture: '{ nowMs: 10, expiresAtMs: 10, token: "active" }',
		hiddenExpected: '"expired"',
		sourceInsightContent: sourceInsightContent("select-second-candidate"),
	}),
	Object.freeze({
		slug: "retry-class",
		mechanismId: "capacity-only-retry",
		exportName: "retryDisposition",
		envelopeName: "RetryDispositionInput",
		acceptedRule: "select-third-candidate",
		contractSource: "\treadonly status: number;",
		correctExpression: 'input.status === 429 ? "retry" : "fail"',
		alternativeExpression: 'input.status >= 400 && input.status < 500 ? "retry" : "fail"',
		thirdExpression: 'input.status >= 500 ? "retry" : "fail"',
		publicFixture: "{ status: 429 }",
		publicExpected: '"retry"',
		hiddenFixture: "{ status: 404 }",
		hiddenExpected: '"fail"',
		sourceInsightContent: sourceInsightContent("select-third-candidate"),
	}),
	Object.freeze({
		slug: "path-boundary",
		mechanismId: "segment-safe-path-boundary",
		exportName: "pathDisposition",
		envelopeName: "PathDispositionInput",
		acceptedRule: "select-first-candidate",
		contractSource: "\treadonly root: string;\n\treadonly candidate: string;",
		correctExpression:
			'input.candidate === input.root || input.candidate.startsWith(input.root + "/") ? "inside" : "outside"',
		alternativeExpression: 'input.candidate.startsWith(input.root) ? "inside" : "outside"',
		thirdExpression: 'input.candidate.includes(input.root) ? "inside" : "outside"',
		publicFixture: '{ root: "/srv/app", candidate: "/srv/app/file" }',
		publicExpected: '"inside"',
		hiddenFixture: '{ root: "/srv/app", candidate: "/srv/application" }',
		hiddenExpected: '"outside"',
		sourceInsightContent: sourceInsightContent("select-first-candidate"),
	}),
	Object.freeze({
		slug: "version-selection",
		mechanismId: "highest-compatible-version",
		exportName: "selectedVersion",
		envelopeName: "VersionSelectionInput",
		acceptedRule: "select-second-candidate",
		contractSource: "\treadonly versions: readonly number[];\n\treadonly maxVersion: number;",
		correctExpression:
			'[...input.versions].filter((version) => version <= input.maxVersion).sort((left, right) => right - left)[0]?.toString() ?? "none"',
		alternativeExpression:
			'input.versions.filter((version) => version <= input.maxVersion).at(-1)?.toString() ?? "none"',
		thirdExpression:
			'input.versions.find((version) => version <= input.maxVersion)?.toString() ?? "none"',
		publicFixture: "{ versions: [1, 2, 3], maxVersion: 3 }",
		publicExpected: '"3"',
		hiddenFixture: "{ versions: [3, 1, 2], maxVersion: 3 }",
		hiddenExpected: '"3"',
		sourceInsightContent: sourceInsightContent("select-second-candidate"),
	}),
]);

const DEVELOPMENT_TWO_VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "header-name",
		mechanismId: "canonical-header-name",
		exportName: "headerLookupName",
		envelopeName: "HeaderLookupInput",
		acceptedRule: "select-third-candidate",
		contractSource: "\treadonly name: string;",
		correctExpression: "input.name.trim().toLowerCase()",
		alternativeExpression: "input.name.toLowerCase()",
		thirdExpression: "input.name.trim()",
		publicFixture: '{ name: "content-type" }',
		publicExpected: '"content-type"',
		hiddenFixture: '{ name: " Content-Type " }',
		hiddenExpected: '"content-type"',
		sourceInsightContent: sourceInsightContent("select-third-candidate"),
	}),
	Object.freeze({
		slug: "window-end",
		mechanismId: "exclusive-window-end",
		exportName: "windowState",
		envelopeName: "WindowStateInput",
		acceptedRule: "select-first-candidate",
		contractSource:
			"\treadonly atMs: number;\n\treadonly startMs: number;\n\treadonly endMs: number;",
		correctExpression:
			'input.atMs >= input.startMs && input.atMs < input.endMs ? "inside" : "outside"',
		alternativeExpression:
			'input.atMs >= input.startMs && input.atMs <= input.endMs ? "inside" : "outside"',
		thirdExpression:
			'input.atMs > input.startMs && input.atMs < input.endMs ? "inside" : "outside"',
		publicFixture: "{ atMs: 5, startMs: 0, endMs: 10 }",
		publicExpected: '"inside"',
		hiddenFixture: "{ atMs: 10, startMs: 0, endMs: 10 }",
		hiddenExpected: '"outside"',
		sourceInsightContent: sourceInsightContent("select-first-candidate"),
	}),
	Object.freeze({
		slug: "http-success",
		mechanismId: "two-hundred-only-success",
		exportName: "httpDisposition",
		envelopeName: "HttpDispositionInput",
		acceptedRule: "select-second-candidate",
		contractSource: "\treadonly status: number;",
		correctExpression: 'input.status >= 200 && input.status < 300 ? "success" : "fail"',
		alternativeExpression: 'input.status >= 200 && input.status < 400 ? "success" : "fail"',
		thirdExpression: 'input.status === 200 ? "success" : "fail"',
		publicFixture: "{ status: 200 }",
		publicExpected: '"success"',
		hiddenFixture: "{ status: 304 }",
		hiddenExpected: '"fail"',
		sourceInsightContent: sourceInsightContent("select-second-candidate"),
	}),
	Object.freeze({
		slug: "host-boundary",
		mechanismId: "dns-label-host-boundary",
		exportName: "hostDisposition",
		envelopeName: "HostDispositionInput",
		acceptedRule: "select-third-candidate",
		contractSource: "\treadonly domain: string;\n\treadonly host: string;",
		correctExpression:
			'input.host === input.domain || input.host.endsWith("." + input.domain) ? "inside" : "outside"',
		alternativeExpression: 'input.host.endsWith(input.domain) ? "inside" : "outside"',
		thirdExpression: 'input.host.includes(input.domain) ? "inside" : "outside"',
		publicFixture: '{ domain: "example.test", host: "api.example.test" }',
		publicExpected: '"inside"',
		hiddenFixture: '{ domain: "example.test", host: "badexample.test" }',
		hiddenExpected: '"outside"',
		sourceInsightContent: sourceInsightContent("select-third-candidate"),
	}),
	Object.freeze({
		slug: "minimum-version",
		mechanismId: "lowest-compatible-version",
		exportName: "minimumVersion",
		envelopeName: "MinimumVersionInput",
		acceptedRule: "select-first-candidate",
		contractSource: "\treadonly versions: readonly number[];\n\treadonly minVersion: number;",
		correctExpression:
			'[...input.versions].filter((version) => version >= input.minVersion).sort((left, right) => left - right)[0]?.toString() ?? "none"',
		alternativeExpression:
			'input.versions.find((version) => version >= input.minVersion)?.toString() ?? "none"',
		thirdExpression:
			'input.versions.filter((version) => version >= input.minVersion).at(-1)?.toString() ?? "none"',
		publicFixture: "{ versions: [1, 2, 3], minVersion: 1 }",
		publicExpected: '"1"',
		hiddenFixture: "{ versions: [3, 1, 2], minVersion: 1 }",
		hiddenExpected: '"1"',
		sourceInsightContent: sourceInsightContent("select-first-candidate"),
	}),
]);

function expressionForAction(
	variant: TransferVariant,
	alternativeRule: RootEvalSourceInsightDiscriminant,
	action: RootEvalSourceInsightDiscriminant,
): string {
	if (action === variant.acceptedRule) return variant.correctExpression;
	if (action === alternativeRule) return variant.alternativeExpression;
	return variant.thirdExpression;
}

function contractSource(
	variant: TransferVariant,
	alternativeRule: RootEvalSourceInsightDiscriminant,
	manifestSalt = "",
): string {
	return `export interface ${variant.envelopeName} {
${variant.contractSource}
}
// The public contract deliberately exposes three plausible implementations.
// first: ${expressionForAction(variant, alternativeRule, "select-first-candidate")}
// second: ${expressionForAction(variant, alternativeRule, "select-second-candidate")}
// third: ${expressionForAction(variant, alternativeRule, "select-third-candidate")}
${manifestSalt.length === 0 ? "" : `// sealed-manifest-coordinate: ${manifestSalt}\n`}
`;
}

function taskSource(input: {
	readonly exportName: string;
	readonly envelopeName: string;
	readonly contractImport: string;
	readonly acceptedExpression: string;
}): string {
	return `import type { ${input.envelopeName} } from "${input.contractImport}";

export function ${input.exportName}(input: ${input.envelopeName}): string {
	return ${input.acceptedExpression};
}
`;
}

function acceptedExpression(
	variant: TransferVariant,
	rule: "correct" | "alternative" = "correct",
): string {
	return rule === "correct" ? variant.correctExpression : variant.alternativeExpression;
}

function sourceTaskStatement(variant: TransferVariant, sourceWritablePath: string): string {
	return `A source Work Item verified the ${variant.mechanismId} mechanism. Replace the observed alternative expression with the verified expression ${variant.correctExpression}. Change ${sourceWritablePath} only.`;
}

function targetTaskStatement(writablePath: string): string {
	return `A regression remains in ${writablePath}. Public examples intentionally permit more than one plausible rule. Restore the withheld production invariant, using admitted causal memory as the only authority when it is exposed. Do not infer the rule from actor-visible names. Return one exact replacement for this file and change no other path.`;
}

function verifierSource(input: {
	readonly importPath: string;
	readonly exportName: string;
	readonly testName: string;
	readonly variant: TransferVariant;
	readonly hidden: boolean;
}): string {
	const fixture = input.hidden ? input.variant.hiddenFixture : input.variant.publicFixture;
	const expected = input.hidden ? input.variant.hiddenExpected : input.variant.publicExpected;
	return `import { describe, expect, it } from "vitest";
import { ${input.exportName} } from "${input.importPath}";

describe("D152 orthogonal mechanism task", () => {
	it(${JSON.stringify(input.testName)}, () => {
		expect(${input.exportName}(${fixture})).toBe(${expected});
	});
});
`;
}

function createTask(
	kind: RootEvalTaskKind,
	replicate: 1 | 2 | 3 | 4 | 5,
	variant: TransferVariant,
	alternativeRule: RootEvalSourceInsightDiscriminant,
	taskSetRef: string,
	manifestSalt = "",
): RootEvalTaskDefinition {
	const lane = kind === "development-transfer" ? "development" : "confirmatory";
	const instanceRef = `${taskSetRef}/instance-${replicate}`;
	const targetDirectory = `packages/ts/src/.root-eval-mechanism/${lane}`;
	const writablePath = `${targetDirectory}/${replicate}-${variant.slug}.ts`;
	const contractPath = `${targetDirectory}/${replicate}-${variant.slug}.contract.ts`;
	const verifierDirectory = `packages/ts/src/__tests__/.root-eval-mechanism/${lane}`;
	const publicVerifierPath = `${verifierDirectory}/${replicate}-${variant.slug}.public.test.ts`;
	const hiddenVerifierPath = `${verifierDirectory}/${replicate}-${variant.slug}.hidden.test.ts`;
	const publicVerifierName = `permits both plausible rules for mechanism instance ${replicate}`;
	const hiddenVerifierName = `withheld: selects the verified rule for mechanism instance ${replicate}`;
	const relativeImport = `../../../.root-eval-mechanism/${lane}/${replicate}-${variant.slug}.js`;
	const contractImport = `./${replicate}-${variant.slug}.contract.js`;
	const sourceWorkItemRef = `${instanceRef}/source-work-item`;
	const sourceDirectory = `packages/ts/src/.root-eval-mechanism/source/${lane}`;
	const sourceWritablePath = `${sourceDirectory}/${replicate}-${variant.slug}.ts`;
	const sourceContractPath = `${sourceDirectory}/${replicate}-${variant.slug}.contract.ts`;
	const sourceVerifierDirectory = `packages/ts/src/__tests__/.root-eval-mechanism/source/${lane}`;
	const sourcePublicVerifierPath = `${sourceVerifierDirectory}/${replicate}-${variant.slug}.public.test.ts`;
	const sourceHiddenVerifierPath = `${sourceVerifierDirectory}/${replicate}-${variant.slug}.hidden.test.ts`;
	const sourcePublicVerifierName = `permits the source mechanism public example ${replicate}`;
	const sourceHiddenVerifierName = `withheld: verifies the causal mechanism rule ${replicate}`;
	const sourceExportName = `${variant.exportName}AtSource`;
	const sourceRelativeImport = `../../../../.root-eval-mechanism/source/${lane}/${replicate}-${variant.slug}.js`;
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
		acceptedExpression: acceptedExpression(variant, "alternative"),
	});
	const sourcePublicVerifierSource = verifierSource({
		importPath: sourceRelativeImport,
		exportName: sourceExportName,
		testName: sourcePublicVerifierName,
		variant,
		hidden: false,
	});
	const sourceHiddenVerifierSource = verifierSource({
		importPath: sourceRelativeImport,
		exportName: sourceExportName,
		testName: sourceHiddenVerifierName,
		variant,
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
	return Object.freeze({
		kind,
		taskSetRef,
		instanceRef,
		replicate,
		mechanismId: variant.mechanismId,
		mechanismAction: variant.acceptedRule,
		mechanismAlternativeAction: alternativeRule,
		baselineCommit: BASELINE_COMMIT,
		writablePath,
		taskStatement: targetTaskStatement(writablePath),
		sourceWorkItemRef,
		sourceVerifierEvidenceDigest,
		sourceInsightDigest,
		sourceInsightContent: variant.sourceInsightContent,
		sourceWritablePath,
		sourceTaskStatement: sourceTaskStatement(variant, sourceWritablePath),
		sourceFixtureCorrectText,
		sourceFixtureBuggyText,
		sourceReadonlyFixtureFiles: Object.freeze([
			Object.freeze({
				path: sourceContractPath,
				text: contractSource(variant, alternativeRule, manifestSalt),
			}),
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
			acceptedExpression: acceptedExpression(variant, "alternative"),
		}),
		readonlyFixtureFiles: Object.freeze([
			Object.freeze({
				path: contractPath,
				text: contractSource(variant, alternativeRule, manifestSalt),
			}),
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
			variant,
			hidden: false,
		}),
		hiddenVerifierSource: verifierSource({
			importPath: relativeImport,
			exportName: variant.exportName,
			testName: hiddenVerifierName,
			variant,
			hidden: true,
		}),
	});
}

function createTaskSet(
	kind: RootEvalTaskKind,
	taskSetRef: string,
	variants: readonly TransferVariant[] = VARIANTS,
	manifestSalt = "",
): readonly RootEvalTaskDefinition[] {
	return Object.freeze(
		variants.map((_variant, index) =>
			createTask(
				kind,
				(index + 1) as 1 | 2 | 3 | 4 | 5,
				variants[index]!,
				variants[(index + 1) % variants.length]!.acceptedRule,
				taskSetRef,
				manifestSalt,
			),
		),
	);
}

function taskSourceDiscriminant(task: RootEvalTaskDefinition): RootEvalSourceInsightDiscriminant {
	const action = rootEvalSourceInsightDiscriminant(task.sourceInsightContent);
	if (
		task.sourceFixtureCorrectText === task.sourceFixtureBuggyText ||
		!task.sourceFixtureCorrectText.includes("return ") ||
		!task.sourceFixtureBuggyText.includes("return ")
	)
		throw new TypeError("root eval source fixture did not establish one closed mechanism");
	return action;
}

export function assertRootEvalTaskStimulusContract(tasks: readonly RootEvalTaskDefinition[]): void {
	if (
		tasks.length !== 5 ||
		tasks.some((task, index) => task.replicate !== index + 1) ||
		new Set(tasks.map((task) => task.taskSetRef)).size !== 1 ||
		new Set(tasks.map((task) => task.instanceRef)).size !== 5 ||
		new Set(tasks.map((task) => task.sourceWorkItemRef)).size !== 5 ||
		new Set(tasks.map((task) => task.sourceVerifierEvidenceDigest)).size !== 5 ||
		new Set(tasks.map((task) => task.sourceInsightDigest)).size !== 5 ||
		new Set(tasks.map((task) => task.mechanismId)).size !== 5 ||
		new Set(tasks.map((task) => task.sourceFixtureCorrectText)).size !== 5 ||
		new Set(tasks.map((task) => task.readonlyFixtureFiles[0]?.text)).size !== 5
	)
		throw new TypeError("root eval task stimulus requires five isolated orthogonal mechanisms");
	rootEvalMechanismPairwiseAudit(tasks);
	for (const [index, task] of tasks.entries()) {
		if (
			!hasCurrentTaskDefinitionShape(task, index) ||
			task.taskStatement !== targetTaskStatement(task.writablePath) ||
			rootEvalSourceInsightDiscriminant(task.sourceInsightContent) !==
				taskSourceDiscriminant(task) ||
			task.mechanismAction !== taskSourceDiscriminant(task) ||
			task.mechanismAlternativeAction === task.mechanismAction ||
			task.fixtureCorrectText === task.fixtureBuggyText ||
			task.sourceFixtureCorrectText === task.sourceFixtureBuggyText ||
			task.publicVerifierSource === task.hiddenVerifierSource ||
			task.sourceInsightContent.length !== SOURCE_INSIGHT_LENGTH ||
			/compare|reject|return|patch|verifier|fixture|packages\//iu.test(task.sourceInsightContent)
		)
			throw new TypeError("root eval task stimulus violated its orthogonal-mechanism contract");
		const irrelevant = tasks[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]!;
		if (
			task.instanceRef === irrelevant.instanceRef ||
			task.mechanismId === irrelevant.mechanismId ||
			task.mechanismAlternativeAction !== irrelevant.mechanismAction ||
			task.sourceWorkItemRef === irrelevant.sourceWorkItemRef ||
			task.sourceVerifierEvidenceDigest === irrelevant.sourceVerifierEvidenceDigest ||
			task.sourceInsightDigest === irrelevant.sourceInsightDigest ||
			rootEvalSourceInsightDiscriminant(task.sourceInsightContent) ===
				rootEvalSourceInsightDiscriminant(irrelevant.sourceInsightContent)
		)
			throw new TypeError(
				"root eval irrelevant source must have distinct provenance and an incompatible discriminant",
			);
	}
}

export type RootEvalMechanismPairwiseAudit = Readonly<{
	readonly leftReplicate: number;
	readonly rightReplicate: number;
	readonly semanticInterchangeable: false;
	readonly actionTokenOverlap: number;
	readonly executableTokenOverlap: number;
}>;

function lexicalTokens(value: string, omitted: ReadonlySet<string>): ReadonlySet<string> {
	return new Set(
		(value.toLowerCase().match(/[a-z][a-z0-9]*/gu) ?? []).filter((token) => !omitted.has(token)),
	);
}

function tokenOverlap(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
	const union = new Set([...left, ...right]);
	if (union.size === 0) return 0;
	let intersection = 0;
	for (const token of left) if (right.has(token)) intersection += 1;
	return intersection / union.size;
}

/** Explicit D152 pairwise semantic, lexical and executable-scaffolding audit. */
export function rootEvalMechanismPairwiseAudit(
	tasks: readonly RootEvalTaskDefinition[],
): readonly RootEvalMechanismPairwiseAudit[] {
	if (tasks.length !== 5)
		throw new TypeError("root eval mechanism audit requires exactly five tasks");
	const audits: RootEvalMechanismPairwiseAudit[] = [];
	for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
		const left = tasks[leftIndex]!;
		for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
			const right = tasks[rightIndex]!;
			const actionTokenOverlap = tokenOverlap(
				lexicalTokens(
					left.sourceInsightContent,
					new Set([
						"mechanism",
						"invariant",
						"v1",
						"action",
						"select",
						"candidate",
						"first",
						"second",
						"third",
					]),
				),
				lexicalTokens(
					right.sourceInsightContent,
					new Set([
						"mechanism",
						"invariant",
						"v1",
						"action",
						"select",
						"candidate",
						"first",
						"second",
						"third",
					]),
				),
			);
			const executableTokenOverlap = tokenOverlap(
				lexicalTokens(left.mechanismId, new Set()),
				lexicalTokens(right.mechanismId, new Set()),
			);
			const semanticInterchangeable =
				left.readonlyFixtureFiles[0]?.text === right.readonlyFixtureFiles[0]?.text &&
				left.fixtureCorrectText === right.fixtureCorrectText &&
				left.hiddenVerifierSource === right.hiddenVerifierSource;
			if (
				left.mechanismId === right.mechanismId ||
				left.fixtureCorrectText === right.fixtureCorrectText ||
				semanticInterchangeable ||
				actionTokenOverlap > 0.2 ||
				executableTokenOverlap > 0.2
			)
				throw new TypeError(
					`root eval mechanisms ${left.replicate} and ${right.replicate} failed the pairwise isolation audit`,
				);
			audits.push(
				Object.freeze({
					leftReplicate: left.replicate,
					rightReplicate: right.replicate,
					semanticInterchangeable,
					actionTokenOverlap,
					executableTokenOverlap,
				}),
			);
		}
	}
	return Object.freeze(audits);
}

export type RootEvalScriptedMemoryState = Readonly<{
	readonly sourceInsightContent?: string;
	readonly admitted: boolean;
	readonly applied: boolean;
	readonly scopeMatches: boolean;
}>;

/** Deterministic D152 discrimination oracle. This qualifies stimuli; it is not model efficacy. */
export function rootEvalScriptedMechanismReplacement(
	task: RootEvalTaskDefinition,
	memory: RootEvalScriptedMemoryState,
): Readonly<{ readonly selected: "verified" | "alternative"; readonly replacement: string }> {
	let action: RootEvalSourceInsightDiscriminant | undefined;
	if (memory.sourceInsightContent !== undefined) {
		try {
			action = rootEvalSourceInsightDiscriminant(memory.sourceInsightContent);
		} catch {
			action = undefined;
		}
	}
	const verified =
		memory.admitted && memory.applied && memory.scopeMatches && action === task.mechanismAction;
	const explicitAlternative =
		memory.admitted &&
		memory.applied &&
		memory.scopeMatches &&
		action === task.mechanismAlternativeAction;
	if (
		memory.admitted &&
		memory.applied &&
		memory.scopeMatches &&
		action !== undefined &&
		!verified &&
		!explicitAlternative
	)
		throw new TypeError("root eval memory discriminant did not select a target-visible candidate");
	return Object.freeze({
		selected: verified ? "verified" : "alternative",
		replacement: verified ? task.fixtureCorrectText : task.fixtureBuggyText,
	});
}

export function rootEvalMechanismDiscriminationOracle(
	tasks: readonly RootEvalTaskDefinition[],
): readonly Readonly<{
	readonly replicate: number;
	readonly relevantSelected: "verified";
	readonly irrelevantSelected: "alternative";
	readonly controlsSelected: readonly "alternative"[];
}>[] {
	assertRootEvalTaskStimulusContract(tasks);
	return Object.freeze(
		tasks.map((task, index) => {
			const irrelevant = tasks[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]!;
			const relevant = rootEvalScriptedMechanismReplacement(task, {
				sourceInsightContent: task.sourceInsightContent,
				admitted: true,
				applied: true,
				scopeMatches: true,
			});
			const rotated = rootEvalScriptedMechanismReplacement(task, {
				sourceInsightContent: irrelevant.sourceInsightContent,
				admitted: true,
				applied: true,
				scopeMatches: true,
			});
			const controls = [
				rootEvalScriptedMechanismReplacement(task, {
					admitted: false,
					applied: false,
					scopeMatches: true,
				}),
				rootEvalScriptedMechanismReplacement(task, {
					sourceInsightContent: task.sourceInsightContent,
					admitted: false,
					applied: false,
					scopeMatches: true,
				}),
				rootEvalScriptedMechanismReplacement(task, {
					sourceInsightContent: task.sourceInsightContent,
					admitted: false,
					applied: true,
					scopeMatches: true,
				}),
				rootEvalScriptedMechanismReplacement(task, {
					sourceInsightContent: task.sourceInsightContent,
					admitted: true,
					applied: true,
					scopeMatches: false,
				}),
			];
			if (
				relevant.selected !== "verified" ||
				rotated.selected !== "alternative" ||
				controls.some((control) => control.selected !== "alternative")
			)
				throw new TypeError("root eval mechanism discrimination oracle failed closed");
			return Object.freeze({
				replicate: task.replicate,
				relevantSelected: relevant.selected,
				irrelevantSelected: rotated.selected,
				controlsSelected: Object.freeze(controls.map(() => "alternative" as const)),
			});
		}),
	);
}

export function rootEvalVariantOrderSupportsIrrelevantControls(
	variantOrder: readonly number[],
	variants: readonly TransferVariant[] = VARIANTS,
): boolean {
	if (
		variantOrder.length !== 5 ||
		new Set(variantOrder).size !== 5 ||
		variantOrder.some(
			(index) => !Number.isSafeInteger(index) || index < 0 || index >= variants.length,
		)
	)
		return false;
	return variantOrder.every((variantIndex, index) => {
		const irrelevantIndex = ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1;
		return (
			variants[variantIndex]!.acceptedRule !==
			variants[variantOrder[irrelevantIndex]!]!.acceptedRule
		);
	});
}

export const ROOT_EVAL_DEVELOPMENT_TASKS = createTaskSet(
	"development-transfer",
	QUALIFICATION_TASK_SET_REF,
);

export const ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST = empiricalStrictJsonDigest(
	strictSnapshot({ decisionRef: "graphrefly-ts:D152", tasks: ROOT_EVAL_DEVELOPMENT_TASKS }),
);

export function rootEvalTaskBindings(
	tasks: readonly RootEvalTaskDefinition[],
): readonly RootEvalTaskBinding[] {
	assertRootEvalTaskStimulusContract(tasks);
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

export const ROOT_EVAL_HELD_OUT_SEAL_DIGEST = empiricalStrictJsonDigest({
	kind: "root-eval-d152-unmaterialized-held-out-seal",
	decisionRef: "graphrefly-ts:D152",
	schemaVersion: ROOT_EVAL_TASK_MANIFEST_SCHEMA,
	taskSetRef: ROOT_EVAL_CONFIRMATORY_TASK_SET_REF,
});

export const ROOT_EVAL_D152_TASK_SET_BINDING_DIGEST = empiricalStrictJsonDigest(
	strictSnapshot({
		developmentTaskSetDigest: ROOT_EVAL_DEVELOPMENT_TASK_SET_DIGEST,
		heldOutSealDigest: ROOT_EVAL_HELD_OUT_SEAL_DIGEST,
	}),
);

function manifestMaterial(manifest: Omit<RootEvalTaskManifest, "manifestDigest">): object {
	return strictSnapshot(manifest);
}

export type RootEvalTaskManifestDisjointAudit = Readonly<{
	readonly leftSlot: RootEvalTaskManifestSlot;
	readonly rightSlot: RootEvalTaskManifestSlot;
	readonly sharedMechanismIds: readonly string[];
	readonly sharedFixtureDigests: readonly string[];
	readonly sharedVerifierDigests: readonly string[];
	readonly disjoint: true;
}>;

/** D152 cross-generation bank audit. This does not materialize held-out content. */
export function rootEvalTaskManifestDisjointAudit(
	left: RootEvalTaskManifest,
	right: RootEvalTaskManifest,
): RootEvalTaskManifestDisjointAudit {
	assertRootEvalTaskStimulusContract(left.tasks);
	assertRootEvalTaskStimulusContract(right.tasks);
	const intersection = (leftValues: readonly string[], rightValues: readonly string[]) => {
		const rightSet = new Set(rightValues);
		return Object.freeze([...new Set(leftValues.filter((value) => rightSet.has(value)))].sort());
	};
	const fixtureDigests = (manifest: RootEvalTaskManifest) =>
		manifest.tasks.flatMap((task) => [
			empiricalStrictJsonDigest(task.sourceFixtureCorrectText),
			empiricalStrictJsonDigest(task.sourceFixtureBuggyText),
			empiricalStrictJsonDigest(task.fixtureCorrectText),
			empiricalStrictJsonDigest(task.fixtureBuggyText),
		]);
	const verifierDigests = (manifest: RootEvalTaskManifest) =>
		manifest.tasks.flatMap((task) => [
			empiricalStrictJsonDigest(task.sourceHiddenVerifierSource),
			empiricalStrictJsonDigest(task.hiddenVerifierSource),
		]);
	const sharedMechanismIds = intersection(
		left.tasks.map((task) => task.mechanismId),
		right.tasks.map((task) => task.mechanismId),
	);
	const sharedFixtureDigests = intersection(fixtureDigests(left), fixtureDigests(right));
	const sharedVerifierDigests = intersection(verifierDigests(left), verifierDigests(right));
	if (
		left.slot === right.slot ||
		left.taskSetRef === right.taskSetRef ||
		left.manifestDigest === right.manifestDigest ||
		sharedMechanismIds.length > 0 ||
		sharedFixtureDigests.length > 0 ||
		sharedVerifierDigests.length > 0
	)
		throw new TypeError("root eval D152 task manifests were not disjoint");
	return Object.freeze({
		leftSlot: left.slot,
		rightSlot: right.slot,
		sharedMechanismIds,
		sharedFixtureDigests,
		sharedVerifierDigests,
		disjoint: true,
	});
}

export function createRootEvalTaskManifest(input: {
	readonly slot: RootEvalTaskManifestSlot;
	readonly variantOrder: readonly number[];
	readonly coordinateSuffix: string;
}): RootEvalTaskManifest {
	const developmentOrdinal = rootEvalDevelopmentOrdinal(input.slot);
	if (input.slot === "confirmatory")
		throw new TypeError(
			"root eval D152 confirmatory material is unmaterialized until development qualification",
		);
	const variants =
		developmentOrdinal === 1
			? VARIANTS
			: developmentOrdinal === 2
				? DEVELOPMENT_TWO_VARIANTS
				: undefined;
	if (
		variants === undefined ||
		input.variantOrder.length !== 5 ||
		new Set(input.variantOrder).size !== 5 ||
		input.variantOrder.some(
			(index) => !Number.isSafeInteger(index) || index < 0 || index >= variants.length,
		) ||
		!/^[a-z0-9-]{16,128}$/u.test(input.coordinateSuffix) ||
		!rootEvalVariantOrderSupportsIrrelevantControls(input.variantOrder, variants)
	)
		throw new TypeError("root eval task manifest generation input invalid");
	const kind = "development-transfer";
	const taskSetRef = rootEvalDevelopmentTaskSetRef(developmentOrdinal!);
	const tasks = createTaskSet(
		kind,
		taskSetRef,
		input.variantOrder.map((index) => variants[index]!),
		`:${input.coordinateSuffix}`,
	);
	assertRootEvalTaskStimulusContract(tasks);
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
				"../.private/empirical-memory-rerun-avoidance/d152-mechanism-manifests",
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
	assertRootEvalTaskStimulusContract(value.tasks);
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
