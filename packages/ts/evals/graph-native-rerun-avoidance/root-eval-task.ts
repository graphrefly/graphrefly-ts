import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import { HARNESS_ARMS, type HarnessArm } from "./harness-campaign-policy.js";

export type RootEvalTaskKind = "development-transfer" | "confirmatory-transfer";
export type RootEvalTaskManifestSlot = `development-${number}` | "confirmatory";

export const ROOT_EVAL_TASK_MANIFEST_SCHEMA =
	"graphrefly-ts.root-eval-d157-candidate-manifest.v9" as const;
export type RootEvalSupportedDevelopmentSlot =
	keyof typeof ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY;
export const ROOT_EVAL_CONFIRMATORY_TASK_SET_REF =
	"root-eval-d152-mechanism-confirmatory-v1" as const;
export const ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME = "d157-development-horizon-v3" as const;

export interface RootEvalTaskDefinition {
	readonly kind: RootEvalTaskKind;
	readonly taskSetRef: string;
	readonly instanceRef: string;
	readonly replicate: 1 | 2 | 3 | 4 | 5;
	readonly mechanismId: string;
	readonly mechanismAction: RootEvalSourceInsightDiscriminant;
	readonly mechanismAlternativeAction: string;
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
	readonly sourceFixtureAlternativeText: string;
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
	readonly fixtureAlternativeText: string;
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
	const slot = `development-${ordinal}` as RootEvalSupportedDevelopmentSlot;
	const taskSetRef = ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS[slot];
	if (taskSetRef === undefined)
		throw new TypeError("root eval development task-set is outside the D157 finite horizon");
	return taskSetRef;
}

export function isRootEvalSupportedDevelopmentSlot(
	slot: RootEvalTaskManifestSlot,
): slot is RootEvalSupportedDevelopmentSlot {
	return Object.hasOwn(ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS, slot);
}

export interface RootEvalTaskManifest {
	readonly schemaVersion: typeof ROOT_EVAL_TASK_MANIFEST_SCHEMA;
	readonly slot: RootEvalTaskManifestSlot;
	readonly taskSetRef: string;
	readonly tasks: readonly RootEvalTaskDefinition[];
	readonly horizonPeerManifestDigest?: string;
	readonly manifestDigest: string;
}

const ROOT_EVAL_TASK_DEFINITION_KEYS = Object.freeze(
	[
		"actorContext",
		"baselineCommit",
		"fixtureBuggyText",
		"fixtureCorrectText",
		"fixtureAlternativeText",
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
		"sourceFixtureAlternativeText",
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
		task.sourceFixtureAlternativeText,
		task.sourcePublicVerifierPath,
		task.sourceHiddenVerifierPath,
		task.sourcePublicVerifierName,
		task.sourceHiddenVerifierName,
		task.sourcePublicVerifierSource,
		task.sourceHiddenVerifierSource,
		task.fixtureCorrectText,
		task.fixtureBuggyText,
		task.fixtureAlternativeText,
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
	readonly sourceCandidateCatalogDigest: string;
	readonly sourceCandidateRefs: readonly [string, string];
	readonly targetCandidateCatalogs: Readonly<
		Record<
			HarnessArm,
			Readonly<{
				readonly workItemId: string;
				readonly candidateCatalogDigest: string;
				readonly candidateRefs: readonly [string, string];
			}>
		>
	>;
}

export interface RootEvalToolCandidate {
	readonly candidateRef: string;
	readonly taskInstanceRef: string;
	readonly workItemId: string;
	readonly workItemRole: "source" | "target";
	readonly path: string;
	readonly action: string;
	readonly workspaceSnapshotDigest: string;
	readonly oldSpanDigest: string;
	readonly oldSpanText: string;
	readonly replacementDigest: string;
	readonly replacementText: string;
}

export interface RootEvalToolCandidateCatalog {
	readonly taskInstanceRef: string;
	readonly workItemId: string;
	readonly workItemRole: "source" | "target";
	readonly catalogDigest: string;
	readonly candidates: readonly [RootEvalToolCandidate, RootEvalToolCandidate];
}

interface TransferVariant {
	readonly slug: string;
	readonly mechanismId: string;
	readonly exportName: string;
	readonly envelopeName: string;
	readonly acceptedRule: RootEvalSourceInsightDiscriminant;
	readonly correctSlot: "first" | "second" | "third";
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
	| "canonical-cache-key"
	| "exclusive-lease-expiry"
	| "capacity-only-retry"
	| "segment-safe-path-boundary"
	| "highest-compatible-version"
	| "canonical-header-name"
	| "exclusive-window-end"
	| "two-hundred-only-success"
	| "dns-label-host-boundary"
	| "lowest-compatible-version"
	| "ceiling-allocation-rounding"
	| "geometric-pair-combination"
	| "unicode-codepoint-count"
	| "all-required-bits"
	| "last-write-duplicate-precedence"
	| "single-percent-decode"
	| "gregorian-century-leap-year"
	| "euclidean-nonnegative-remainder"
	| "earliest-maximum-tie-precedence"
	| "eight-bit-rotate-left"
	| "preserve-present-empty-value"
	| "own-property-only-presence"
	| "csv-double-quote-escaping"
	| "unicode-compatibility-normalization"
	| "strict-majority-threshold";

const BASELINE_COMMIT = "dea57bdeb4b370dddbbe2505bd05f9e3551b26c6";
const QUALIFICATION_TASK_SET_REF = "root-eval-d152-mechanism-qualification-v1";

const SOURCE_INSIGHT_LENGTH = 96;
const SOURCE_INSIGHT_PREFIX = "mechanism-invariant.v2;rule=";

const SOURCE_INSIGHT_DISCRIMINANTS = Object.freeze([
	"canonical-cache-key",
	"exclusive-lease-expiry",
	"capacity-only-retry",
	"segment-safe-path-boundary",
	"highest-compatible-version",
	"canonical-header-name",
	"exclusive-window-end",
	"two-hundred-only-success",
	"dns-label-host-boundary",
	"lowest-compatible-version",
	"ceiling-allocation-rounding",
	"geometric-pair-combination",
	"unicode-codepoint-count",
	"all-required-bits",
	"last-write-duplicate-precedence",
	"single-percent-decode",
	"gregorian-century-leap-year",
	"euclidean-nonnegative-remainder",
	"earliest-maximum-tie-precedence",
	"eight-bit-rotate-left",
	"preserve-present-empty-value",
	"own-property-only-presence",
	"csv-double-quote-escaping",
	"unicode-compatibility-normalization",
	"strict-majority-threshold",
] as const satisfies readonly RootEvalSourceInsightDiscriminant[]);

function sourceInsightContent(rule: TransferVariant["acceptedRule"]): string {
	const content = `${SOURCE_INSIGHT_PREFIX}${rule}`;
	if (content.length > SOURCE_INSIGHT_LENGTH)
		throw new TypeError("root eval source insight exceeded its matched bound");
	return content.padEnd(SOURCE_INSIGHT_LENGTH, " ");
}

export function rootEvalSourceInsightDiscriminant(
	content: string,
): RootEvalSourceInsightDiscriminant {
	for (const discriminant of SOURCE_INSIGHT_DISCRIMINANTS) {
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
		acceptedRule: "canonical-cache-key",
		correctSlot: "first",
		contractSource: "\treadonly rawKey: string;",
		correctExpression: "input.rawKey.trim().toLowerCase()",
		alternativeExpression: "input.rawKey",
		thirdExpression: "input.rawKey.trim()",
		publicFixture: '{ rawKey: "cache-key" }',
		publicExpected: '"cache-key"',
		hiddenFixture: '{ rawKey: " Cache-Key " }',
		hiddenExpected: '"cache-key"',
		sourceInsightContent: sourceInsightContent("canonical-cache-key"),
	}),
	Object.freeze({
		slug: "lease-boundary",
		mechanismId: "exclusive-lease-expiry",
		exportName: "leaseState",
		envelopeName: "LeaseStateInput",
		acceptedRule: "exclusive-lease-expiry",
		correctSlot: "second",
		contractSource:
			"\treadonly nowMs: number;\n\treadonly expiresAtMs: number;\n\treadonly token: string;",
		correctExpression: 'input.nowMs < input.expiresAtMs ? input.token : "expired"',
		alternativeExpression: 'input.nowMs <= input.expiresAtMs ? input.token : "expired"',
		thirdExpression: 'input.nowMs !== input.expiresAtMs ? input.token : "expired"',
		publicFixture: '{ nowMs: 9, expiresAtMs: 10, token: "active" }',
		publicExpected: '"active"',
		hiddenFixture: '{ nowMs: 10, expiresAtMs: 10, token: "active" }',
		hiddenExpected: '"expired"',
		sourceInsightContent: sourceInsightContent("exclusive-lease-expiry"),
	}),
	Object.freeze({
		slug: "retry-class",
		mechanismId: "capacity-only-retry",
		exportName: "retryDisposition",
		envelopeName: "RetryDispositionInput",
		acceptedRule: "capacity-only-retry",
		correctSlot: "third",
		contractSource: "\treadonly status: number;",
		correctExpression: 'input.status === 429 ? "retry" : "fail"',
		alternativeExpression: 'input.status >= 400 && input.status < 500 ? "retry" : "fail"',
		thirdExpression: 'input.status >= 500 ? "retry" : "fail"',
		publicFixture: "{ status: 429 }",
		publicExpected: '"retry"',
		hiddenFixture: "{ status: 404 }",
		hiddenExpected: '"fail"',
		sourceInsightContent: sourceInsightContent("capacity-only-retry"),
	}),
	Object.freeze({
		slug: "path-boundary",
		mechanismId: "segment-safe-path-boundary",
		exportName: "pathDisposition",
		envelopeName: "PathDispositionInput",
		acceptedRule: "segment-safe-path-boundary",
		correctSlot: "first",
		contractSource: "\treadonly root: string;\n\treadonly candidate: string;",
		correctExpression:
			'input.candidate === input.root || input.candidate.startsWith(input.root + "/") ? "inside" : "outside"',
		alternativeExpression: 'input.candidate.startsWith(input.root) ? "inside" : "outside"',
		thirdExpression: 'input.candidate.includes(input.root) ? "inside" : "outside"',
		publicFixture: '{ root: "/srv/app", candidate: "/srv/app/file" }',
		publicExpected: '"inside"',
		hiddenFixture: '{ root: "/srv/app", candidate: "/srv/application" }',
		hiddenExpected: '"outside"',
		sourceInsightContent: sourceInsightContent("segment-safe-path-boundary"),
	}),
	Object.freeze({
		slug: "version-selection",
		mechanismId: "highest-compatible-version",
		exportName: "selectedVersion",
		envelopeName: "VersionSelectionInput",
		acceptedRule: "highest-compatible-version",
		correctSlot: "second",
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
		sourceInsightContent: sourceInsightContent("highest-compatible-version"),
	}),
]);

const DEVELOPMENT_TWO_VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "header-name",
		mechanismId: "canonical-header-name",
		exportName: "headerLookupName",
		envelopeName: "HeaderLookupInput",
		acceptedRule: "canonical-header-name",
		correctSlot: "third",
		contractSource: "\treadonly name: string;",
		correctExpression: "input.name.trim().toLowerCase()",
		alternativeExpression: "input.name.toLowerCase()",
		thirdExpression: "input.name.trim()",
		publicFixture: '{ name: "content-type" }',
		publicExpected: '"content-type"',
		hiddenFixture: '{ name: " Content-Type " }',
		hiddenExpected: '"content-type"',
		sourceInsightContent: sourceInsightContent("canonical-header-name"),
	}),
	Object.freeze({
		slug: "window-end",
		mechanismId: "exclusive-window-end",
		exportName: "windowState",
		envelopeName: "WindowStateInput",
		acceptedRule: "exclusive-window-end",
		correctSlot: "first",
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
		sourceInsightContent: sourceInsightContent("exclusive-window-end"),
	}),
	Object.freeze({
		slug: "http-success",
		mechanismId: "two-hundred-only-success",
		exportName: "httpDisposition",
		envelopeName: "HttpDispositionInput",
		acceptedRule: "two-hundred-only-success",
		correctSlot: "second",
		contractSource: "\treadonly status: number;",
		correctExpression: 'input.status >= 200 && input.status < 300 ? "success" : "fail"',
		alternativeExpression: 'input.status >= 200 && input.status < 400 ? "success" : "fail"',
		thirdExpression: 'input.status === 200 ? "success" : "fail"',
		publicFixture: "{ status: 200 }",
		publicExpected: '"success"',
		hiddenFixture: "{ status: 304 }",
		hiddenExpected: '"fail"',
		sourceInsightContent: sourceInsightContent("two-hundred-only-success"),
	}),
	Object.freeze({
		slug: "host-boundary",
		mechanismId: "dns-label-host-boundary",
		exportName: "hostDisposition",
		envelopeName: "HostDispositionInput",
		acceptedRule: "dns-label-host-boundary",
		correctSlot: "third",
		contractSource: "\treadonly domain: string;\n\treadonly host: string;",
		correctExpression:
			'input.host === input.domain || input.host.endsWith("." + input.domain) ? "inside" : "outside"',
		alternativeExpression: 'input.host.endsWith(input.domain) ? "inside" : "outside"',
		thirdExpression: 'input.host.includes(input.domain) ? "inside" : "outside"',
		publicFixture: '{ domain: "example.test", host: "api.example.test" }',
		publicExpected: '"inside"',
		hiddenFixture: '{ domain: "example.test", host: "badexample.test" }',
		hiddenExpected: '"outside"',
		sourceInsightContent: sourceInsightContent("dns-label-host-boundary"),
	}),
	Object.freeze({
		slug: "minimum-version",
		mechanismId: "lowest-compatible-version",
		exportName: "minimumVersion",
		envelopeName: "MinimumVersionInput",
		acceptedRule: "lowest-compatible-version",
		correctSlot: "first",
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
		sourceInsightContent: sourceInsightContent("lowest-compatible-version"),
	}),
]);

// D152 development-3: new policies, not renamed cache/time/status/boundary/version tasks.
// Target-visible coordinates name the domain, never the withheld choice of policy.
const DEVELOPMENT_THREE_VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "allocation-count",
		mechanismId: "ceiling-allocation-rounding",
		exportName: "allocationCount",
		envelopeName: "AllocationInput",
		acceptedRule: "ceiling-allocation-rounding",
		correctSlot: "first",
		contractSource: "\treadonly units: number;\n\treadonly blockSize: number;",
		correctExpression: "String(Math.ceil(input.units / input.blockSize))",
		alternativeExpression: "String(Math.floor(input.units / input.blockSize))",
		thirdExpression: "String(Math.round(input.units / input.blockSize))",
		publicFixture: "{ units: 20, blockSize: 10 }",
		publicExpected: '"2"',
		hiddenFixture: "{ units: 21, blockSize: 10 }",
		hiddenExpected: '"3"',
		sourceInsightContent: sourceInsightContent("ceiling-allocation-rounding"),
	}),
	Object.freeze({
		slug: "paired-measurement",
		mechanismId: "geometric-pair-combination",
		exportName: "pairedMeasurement",
		envelopeName: "MeasurementInput",
		acceptedRule: "geometric-pair-combination",
		correctSlot: "second",
		contractSource: "\treadonly left: number;\n\treadonly right: number;",
		correctExpression: "String(Math.sqrt(input.left * input.right))",
		alternativeExpression: "String((input.left + input.right) / 2)",
		thirdExpression: "String(Math.sqrt((input.left ** 2 + input.right ** 2) / 2))",
		publicFixture: "{ left: 4, right: 4 }",
		publicExpected: '"4"',
		hiddenFixture: "{ left: 4, right: 9 }",
		hiddenExpected: '"6"',
		sourceInsightContent: sourceInsightContent("geometric-pair-combination"),
	}),
	Object.freeze({
		slug: "text-measurement",
		mechanismId: "unicode-codepoint-count",
		exportName: "textMeasurement",
		envelopeName: "TextMeasurementInput",
		acceptedRule: "unicode-codepoint-count",
		correctSlot: "third",
		contractSource: "\treadonly text: string;",
		correctExpression: "String(Array.from(input.text).length)",
		alternativeExpression: "String(input.text.length)",
		thirdExpression: "String(new TextEncoder().encode(input.text).length)",
		publicFixture: '{ text: "abc" }',
		publicExpected: '"3"',
		hiddenFixture: '{ text: "A😀" }',
		hiddenExpected: '"2"',
		sourceInsightContent: sourceInsightContent("unicode-codepoint-count"),
	}),
	Object.freeze({
		slug: "flag-disposition",
		mechanismId: "all-required-bits",
		exportName: "flagDisposition",
		envelopeName: "FlagInput",
		acceptedRule: "all-required-bits",
		correctSlot: "first",
		contractSource: "\treadonly flags: readonly number[];\n\treadonly required: number;",
		correctExpression:
			'input.flags.map((flags) => (flags & input.required) === input.required).join(",")',
		alternativeExpression: 'input.flags.map((flags) => (flags & input.required) !== 0).join(",")',
		thirdExpression: 'input.flags.map((flags) => flags === input.required).join(",")',
		publicFixture: "{ flags: [3], required: 3 }",
		publicExpected: '"true"',
		hiddenFixture: "{ flags: [1, 7], required: 3 }",
		hiddenExpected: '"false,true"',
		sourceInsightContent: sourceInsightContent("all-required-bits"),
	}),
	Object.freeze({
		slug: "record-value",
		mechanismId: "last-write-duplicate-precedence",
		exportName: "recordValue",
		envelopeName: "RecordValueInput",
		acceptedRule: "last-write-duplicate-precedence",
		correctSlot: "second",
		contractSource:
			"\treadonly records: readonly (readonly [string, number])[];\n\treadonly key: string;",
		correctExpression: "String(new Map(input.records).get(input.key) ?? 0)",
		alternativeExpression: "String(input.records.find(([key]) => key === input.key)?.[1] ?? 0)",
		thirdExpression:
			"String(input.records.reduce((sum, [key, value]) => sum + (key === input.key ? value : 0), 0))",
		publicFixture: '{ records: [["x", 5]], key: "x" }',
		publicExpected: '"5"',
		hiddenFixture: '{ records: [["x", 2], ["x", 5]], key: "x" }',
		hiddenExpected: '"5"',
		sourceInsightContent: sourceInsightContent("last-write-duplicate-precedence"),
	}),
]);

// D157 development-4: five new domains frozen before either horizon outcome is observed.
const DEVELOPMENT_FOUR_VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "percent-decoding",
		mechanismId: "single-percent-decode",
		exportName: "decodedComponent",
		envelopeName: "DecodedComponentInput",
		acceptedRule: "single-percent-decode",
		correctSlot: "first",
		contractSource: "\treadonly value: string;",
		correctExpression: "decodeURIComponent(input.value)",
		alternativeExpression: "decodeURIComponent(decodeURIComponent(input.value))",
		thirdExpression: "input.value",
		publicFixture: '{ value: "alpha" }',
		publicExpected: '"alpha"',
		hiddenFixture: '{ value: "%252F" }',
		hiddenExpected: '"%2F"',
		sourceInsightContent: sourceInsightContent("single-percent-decode"),
	}),
	Object.freeze({
		slug: "calendar-year",
		mechanismId: "gregorian-century-leap-year",
		exportName: "leapYearDisposition",
		envelopeName: "LeapYearInput",
		acceptedRule: "gregorian-century-leap-year",
		correctSlot: "second",
		contractSource: "\treadonly year: number;",
		correctExpression:
			"String((input.year % 4 === 0 && input.year % 100 !== 0) || input.year % 400 === 0)",
		alternativeExpression: "String(input.year % 4 === 0)",
		thirdExpression: "String(input.year % 100 === 0)",
		publicFixture: "{ year: 2000 }",
		publicExpected: '"true"',
		hiddenFixture: "{ year: 1900 }",
		hiddenExpected: '"false"',
		sourceInsightContent: sourceInsightContent("gregorian-century-leap-year"),
	}),
	Object.freeze({
		slug: "integer-remainder",
		mechanismId: "euclidean-nonnegative-remainder",
		exportName: "normalizedRemainder",
		envelopeName: "RemainderInput",
		acceptedRule: "euclidean-nonnegative-remainder",
		correctSlot: "third",
		contractSource: "\treadonly value: number;\n\treadonly modulus: number;",
		correctExpression: "String(((input.value % input.modulus) + input.modulus) % input.modulus)",
		alternativeExpression: "String(input.value % input.modulus)",
		thirdExpression: "String(Math.abs(input.value % input.modulus))",
		publicFixture: "{ value: 5, modulus: 3 }",
		publicExpected: '"2"',
		hiddenFixture: "{ value: -5, modulus: 3 }",
		hiddenExpected: '"1"',
		sourceInsightContent: sourceInsightContent("euclidean-nonnegative-remainder"),
	}),
	Object.freeze({
		slug: "maximum-tie",
		mechanismId: "earliest-maximum-tie-precedence",
		exportName: "maximumEntryKey",
		envelopeName: "MaximumEntryInput",
		acceptedRule: "earliest-maximum-tie-precedence",
		correctSlot: "first",
		contractSource: "\treadonly entries: readonly (readonly [string, number])[];",
		correctExpression:
			"input.entries.reduce((best, entry) => entry[1] > best[1] ? entry : best)[0]",
		alternativeExpression:
			"input.entries.reduce((best, entry) => entry[1] >= best[1] ? entry : best)[0]",
		thirdExpression: 'input.entries.at(-1)?.[0] ?? "none"',
		publicFixture: '{ entries: [["only", 5]] }',
		publicExpected: '"only"',
		hiddenFixture: '{ entries: [["first", 5], ["second", 5]] }',
		hiddenExpected: '"first"',
		sourceInsightContent: sourceInsightContent("earliest-maximum-tie-precedence"),
	}),
	Object.freeze({
		slug: "byte-rotation",
		mechanismId: "eight-bit-rotate-left",
		exportName: "rotatedByte",
		envelopeName: "RotatedByteInput",
		acceptedRule: "eight-bit-rotate-left",
		correctSlot: "second",
		contractSource: "\treadonly value: number;",
		correctExpression: "String(((input.value << 1) | (input.value >> 7)) & 0xff)",
		alternativeExpression: "String(input.value << 1)",
		thirdExpression: "String((input.value << 1) & 0xff)",
		publicFixture: "{ value: 1 }",
		publicExpected: '"2"',
		hiddenFixture: "{ value: 129 }",
		hiddenExpected: '"3"',
		sourceInsightContent: sourceInsightContent("eight-bit-rotate-left"),
	}),
]);

// D157 development-5 is authored and sealed with development-4, not after its result.
const DEVELOPMENT_FIVE_VARIANTS: readonly TransferVariant[] = Object.freeze([
	Object.freeze({
		slug: "present-empty-value",
		mechanismId: "preserve-present-empty-value",
		exportName: "valueOrFallback",
		envelopeName: "ValueOrFallbackInput",
		acceptedRule: "preserve-present-empty-value",
		correctSlot: "third",
		contractSource: "\treadonly value?: string;\n\treadonly fallback: string;",
		correctExpression: "input.value ?? input.fallback",
		alternativeExpression: "input.value || input.fallback",
		thirdExpression: "input.value === undefined ? input.fallback : input.value",
		publicFixture: '{ value: "chosen", fallback: "fallback" }',
		publicExpected: '"chosen"',
		hiddenFixture: '{ value: "", fallback: "fallback" }',
		hiddenExpected: '""',
		sourceInsightContent: sourceInsightContent("preserve-present-empty-value"),
	}),
	Object.freeze({
		slug: "own-property-presence",
		mechanismId: "own-property-only-presence",
		exportName: "hasOwnRecordKey",
		envelopeName: "OwnPropertyInput",
		acceptedRule: "own-property-only-presence",
		correctSlot: "first",
		contractSource: "\treadonly record: Readonly<Record<string, number>>;\n\treadonly key: string;",
		correctExpression: "String(Object.hasOwn(input.record, input.key))",
		alternativeExpression: "String(input.key in input.record)",
		thirdExpression: "String(input.record[input.key] !== undefined)",
		publicFixture: '{ record: { own: 1 }, key: "own" }',
		publicExpected: '"true"',
		hiddenFixture: '{ record: Object.create({ inherited: 1 }), key: "inherited" }',
		hiddenExpected: '"false"',
		sourceInsightContent: sourceInsightContent("own-property-only-presence"),
	}),
	Object.freeze({
		slug: "csv-field-escaping",
		mechanismId: "csv-double-quote-escaping",
		exportName: "quotedCsvField",
		envelopeName: "CsvFieldInput",
		acceptedRule: "csv-double-quote-escaping",
		correctSlot: "second",
		contractSource: "\treadonly value: string;",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the value is frozen executable fixture source.
		correctExpression: '`"${input.value.replaceAll(\'"\', \'""\')}"`',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the value is frozen executable fixture source.
		alternativeExpression: '`"${input.value}"`',
		thirdExpression: "JSON.stringify(input.value)",
		publicFixture: '{ value: "alpha" }',
		publicExpected: JSON.stringify('"alpha"'),
		hiddenFixture: String.raw`{ value: "a\"b" }`,
		hiddenExpected: JSON.stringify('"a""b"'),
		sourceInsightContent: sourceInsightContent("csv-double-quote-escaping"),
	}),
	Object.freeze({
		slug: "compatibility-normalization",
		mechanismId: "unicode-compatibility-normalization",
		exportName: "normalizedCompatibilityText",
		envelopeName: "CompatibilityTextInput",
		acceptedRule: "unicode-compatibility-normalization",
		correctSlot: "third",
		contractSource: "\treadonly text: string;",
		correctExpression: 'input.text.normalize("NFKC")',
		alternativeExpression: 'input.text.normalize("NFC")',
		thirdExpression: "input.text",
		publicFixture: '{ text: "office" }',
		publicExpected: '"office"',
		hiddenFixture: '{ text: "\ufb01" }',
		hiddenExpected: '"fi"',
		sourceInsightContent: sourceInsightContent("unicode-compatibility-normalization"),
	}),
	Object.freeze({
		slug: "majority-threshold",
		mechanismId: "strict-majority-threshold",
		exportName: "majorityDisposition",
		envelopeName: "MajorityInput",
		acceptedRule: "strict-majority-threshold",
		correctSlot: "first",
		contractSource: "\treadonly yes: number;\n\treadonly total: number;",
		correctExpression: 'input.yes * 2 > input.total ? "accepted" : "rejected"',
		alternativeExpression: 'input.yes * 2 >= input.total ? "accepted" : "rejected"',
		thirdExpression: 'input.yes > 0 ? "accepted" : "rejected"',
		publicFixture: "{ yes: 3, total: 3 }",
		publicExpected: '"accepted"',
		hiddenFixture: "{ yes: 1, total: 2 }",
		hiddenExpected: '"rejected"',
		sourceInsightContent: sourceInsightContent("strict-majority-threshold"),
	}),
]);

const ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY = Object.freeze({
	"development-1": Object.freeze({
		taskSetRef: "root-eval-d152-mechanism-development-1-v1",
		variants: VARIANTS,
	}),
	"development-2": Object.freeze({
		taskSetRef: "root-eval-d152-mechanism-development-2-v1",
		variants: DEVELOPMENT_TWO_VARIANTS,
	}),
	"development-3": Object.freeze({
		taskSetRef: "root-eval-d152-mechanism-development-3-v1",
		variants: DEVELOPMENT_THREE_VARIANTS,
	}),
	"development-4": Object.freeze({
		taskSetRef: "root-eval-d152-mechanism-development-4-v1",
		variants: DEVELOPMENT_FOUR_VARIANTS,
	}),
	"development-5": Object.freeze({
		taskSetRef: "root-eval-d152-mechanism-development-5-v2",
		variants: DEVELOPMENT_FIVE_VARIANTS,
	}),
} as const satisfies Readonly<
	Record<string, { taskSetRef: string; variants: readonly TransferVariant[] }>
>);

export const ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS = Object.freeze(
	Object.fromEntries(
		Object.entries(ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY).map(([slot, bank]) => [
			slot,
			bank.taskSetRef,
		]),
	),
) as Readonly<{
	[K in RootEvalSupportedDevelopmentSlot]: (typeof ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY)[K]["taskSetRef"];
}>;
export const ROOT_EVAL_SUPPORTED_DEVELOPMENT_SLOTS = Object.freeze(
	Object.keys(ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY) as RootEvalSupportedDevelopmentSlot[],
);
export const ROOT_EVAL_D157_HORIZON_SLOTS = Object.freeze([
	"development-4",
	"development-5",
] as const satisfies readonly RootEvalSupportedDevelopmentSlot[]);

function developmentVariants(
	slot: RootEvalTaskManifestSlot,
): readonly TransferVariant[] | undefined {
	return isRootEvalSupportedDevelopmentSlot(slot)
		? ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY[slot].variants
		: undefined;
}

function contractSource(variant: TransferVariant, manifestSalt = ""): string {
	const remaining = [variant.alternativeExpression, variant.thirdExpression];
	const expressions = (["first", "second", "third"] as const).map((slot) =>
		slot === variant.correctSlot ? variant.correctExpression : remaining.shift()!,
	);
	return `export interface ${variant.envelopeName} {
${variant.contractSource}
}
// The public contract deliberately exposes three plausible implementations.
// first: ${expressions[0]}
// second: ${expressions[1]}
// third: ${expressions[2]}
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
	const occurrenceTaskSource = (input: Parameters<typeof taskSource>[0]) => {
		const text = taskSource(input);
		return replicate === 1 ? text.replace(/\n/gu, "\r\n") : text;
	};
	const sourceFixtureCorrectText = occurrenceTaskSource({
		exportName: sourceExportName,
		envelopeName: variant.envelopeName,
		contractImport: sourceContractImport,
		acceptedExpression: acceptedExpression(variant),
	});
	const sourceFixtureBuggyText = occurrenceTaskSource({
		exportName: sourceExportName,
		envelopeName: variant.envelopeName,
		contractImport: sourceContractImport,
		acceptedExpression: acceptedExpression(variant, "alternative"),
	});
	const sourceFixtureAlternativeText = occurrenceTaskSource({
		exportName: sourceExportName,
		envelopeName: variant.envelopeName,
		contractImport: sourceContractImport,
		acceptedExpression: `(${variant.alternativeExpression})`,
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
			fixtureAlternativeText: sourceFixtureAlternativeText,
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
		mechanismAlternativeAction: `Use the public contract expression ${variant.alternativeExpression}.`,
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
		sourceFixtureAlternativeText,
		sourceReadonlyFixtureFiles: Object.freeze([
			Object.freeze({
				path: sourceContractPath,
				text: contractSource(variant, manifestSalt),
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
		fixtureCorrectText: occurrenceTaskSource({
			exportName: variant.exportName,
			envelopeName: variant.envelopeName,
			contractImport,
			acceptedExpression: acceptedExpression(variant),
		}),
		fixtureBuggyText: occurrenceTaskSource({
			exportName: variant.exportName,
			envelopeName: variant.envelopeName,
			contractImport,
			acceptedExpression: acceptedExpression(variant, "alternative"),
		}),
		fixtureAlternativeText: occurrenceTaskSource({
			exportName: variant.exportName,
			envelopeName: variant.envelopeName,
			contractImport,
			acceptedExpression: `(${variant.alternativeExpression})`,
		}),
		readonlyFixtureFiles: Object.freeze([
			Object.freeze({
				path: contractPath,
				text: contractSource(variant, manifestSalt),
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
		const targetCatalog = rootEvalToolCandidateCatalog(
			task,
			"target",
			`${task.instanceRef}/stimulus-target-work-item`,
		);
		const sourceCatalog = rootEvalToolCandidateCatalog(task, "source", task.sourceWorkItemRef);
		if (
			!hasCurrentTaskDefinitionShape(task, index) ||
			task.taskStatement !== targetTaskStatement(task.writablePath) ||
			rootEvalSourceInsightDiscriminant(task.sourceInsightContent) !==
				taskSourceDiscriminant(task) ||
			task.mechanismAction !== taskSourceDiscriminant(task) ||
			task.mechanismAlternativeAction === task.mechanismAction ||
			task.fixtureCorrectText === task.fixtureBuggyText ||
			task.fixtureAlternativeText === task.fixtureBuggyText ||
			task.fixtureAlternativeText === task.fixtureCorrectText ||
			task.sourceFixtureCorrectText === task.sourceFixtureBuggyText ||
			task.sourceFixtureAlternativeText === task.sourceFixtureBuggyText ||
			task.sourceFixtureAlternativeText === task.sourceFixtureCorrectText ||
			task.publicVerifierSource === task.hiddenVerifierSource ||
			task.sourceInsightContent.length !== SOURCE_INSIGHT_LENGTH ||
			/compare|reject|return|patch|verifier|fixture|packages\/|candidate|first|second|third/iu.test(
				task.sourceInsightContent,
			) ||
			[targetCatalog, sourceCatalog].some(
				(catalog) =>
					catalog.candidates.length !== 2 ||
					new Set(catalog.candidates.map((candidate) => candidate.candidateRef)).size !== 2 ||
					new Set(catalog.candidates.map((candidate) => candidate.action)).size !== 2 ||
					catalog.candidates.some(
						(candidate) =>
							candidate.workItemId !== catalog.workItemId ||
							candidate.action.includes(task.mechanismAction),
					) ||
					catalog.candidates[0].candidateRef.endsWith("candidate-a") !== true ||
					catalog.candidates[1].candidateRef.endsWith("candidate-b") !== true,
			)
		)
			throw new TypeError("root eval task stimulus violated its orthogonal-mechanism contract");
		const irrelevant = tasks[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]!;
		if (
			task.instanceRef === irrelevant.instanceRef ||
			task.mechanismId === irrelevant.mechanismId ||
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

type RootEvalMechanismAuditTask = Pick<
	RootEvalTaskDefinition,
	| "taskSetRef"
	| "mechanismId"
	| "sourceInsightContent"
	| "sourceFixtureCorrectText"
	| "fixtureCorrectText"
	| "sourceHiddenVerifierSource"
	| "hiddenVerifierSource"
> & {
	readonly replicate: number;
	readonly sourceReadonlyFixtureFiles: readonly Readonly<{ readonly text: string }>[];
	readonly readonlyFixtureFiles: readonly Readonly<{ readonly text: string }>[];
};

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

function normalizedBehavioralRule(task: RootEvalMechanismAuditTask): string {
	const match = /\breturn\s+([^;]+);/u.exec(task.fixtureCorrectText);
	if (match === null) throw new TypeError("root eval mechanism audit requires one return rule");
	return match[1]!.replace(/\s+/gu, "").toLowerCase();
}

function executableContractTokens(task: RootEvalMechanismAuditTask): ReadonlySet<string> {
	const candidateExpressions = (text: string): readonly string[] =>
		[...text.matchAll(/^\/\/ (?:first|second|third): (.+)$/gmu)].map((match) => match[1]!);
	const contractTexts = [
		task.sourceReadonlyFixtureFiles[0]?.text ?? "",
		task.readonlyFixtureFiles[0]?.text ?? "",
	];
	const omitted = new Set(["input", "math", "string"]);
	for (const text of contractTexts)
		for (const match of text.matchAll(/\breadonly\s+([a-z][a-z0-9]*)\s*[?:]/giu))
			omitted.add(match[1]!.toLowerCase());
	return lexicalTokens(
		[normalizedBehavioralRule(task), ...contractTexts.flatMap(candidateExpressions)].join("\n"),
		omitted,
	);
}

function mechanismPairwiseAudit(
	tasks: readonly RootEvalMechanismAuditTask[],
	includePair: (leftIndex: number, rightIndex: number) => boolean = () => true,
): readonly RootEvalMechanismPairwiseAudit[] {
	const audits: RootEvalMechanismPairwiseAudit[] = [];
	for (let leftIndex = 0; leftIndex < tasks.length; leftIndex += 1) {
		const left = tasks[leftIndex]!;
		for (let rightIndex = leftIndex + 1; rightIndex < tasks.length; rightIndex += 1) {
			if (!includePair(leftIndex, rightIndex)) continue;
			const right = tasks[rightIndex]!;
			const actionTokenOverlap = tokenOverlap(
				lexicalTokens(left.sourceInsightContent, new Set(["mechanism", "invariant", "v2", "rule"])),
				lexicalTokens(
					right.sourceInsightContent,
					new Set(["mechanism", "invariant", "v2", "rule"]),
				),
			);
			const executableTokenOverlap = tokenOverlap(
				executableContractTokens(left),
				executableContractTokens(right),
			);
			const semanticInterchangeable =
				normalizedBehavioralRule(left) === normalizedBehavioralRule(right) ||
				left.sourceFixtureCorrectText.replace(/\s+/gu, "") ===
					right.sourceFixtureCorrectText.replace(/\s+/gu, "") ||
				left.readonlyFixtureFiles[0]?.text === right.readonlyFixtureFiles[0]?.text ||
				left.sourceReadonlyFixtureFiles[0]?.text === right.sourceReadonlyFixtureFiles[0]?.text ||
				(left.readonlyFixtureFiles[0]?.text === right.readonlyFixtureFiles[0]?.text &&
					left.fixtureCorrectText === right.fixtureCorrectText &&
					left.hiddenVerifierSource === right.hiddenVerifierSource) ||
				(left.sourceReadonlyFixtureFiles[0]?.text === right.sourceReadonlyFixtureFiles[0]?.text &&
					left.sourceFixtureCorrectText === right.sourceFixtureCorrectText &&
					left.sourceHiddenVerifierSource === right.sourceHiddenVerifierSource);
			if (
				left.mechanismId === right.mechanismId ||
				left.fixtureCorrectText === right.fixtureCorrectText ||
				semanticInterchangeable ||
				actionTokenOverlap > 0.2 ||
				(left.taskSetRef !== right.taskSetRef && executableTokenOverlap > 0.2)
			)
				throw new TypeError(
					`root eval mechanisms ${left.taskSetRef}/${left.mechanismId} (replicate ${left.replicate}) and ${right.taskSetRef}/${right.mechanismId} (replicate ${right.replicate}) failed the pairwise isolation audit (action overlap ${actionTokenOverlap.toFixed(3)}, executable overlap ${executableTokenOverlap.toFixed(3)})`,
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

/** Explicit D152 within-bank semantic, lexical and executable-scaffolding audit. */
export function rootEvalMechanismPairwiseAudit(
	tasks: readonly RootEvalMechanismAuditTask[],
): readonly RootEvalMechanismPairwiseAudit[] {
	if (tasks.length !== 5)
		throw new TypeError("root eval mechanism audit requires exactly five tasks");
	return mechanismPairwiseAudit(tasks);
}

/** D157 cross-bank audit over the complete five-bank, twenty-five-mechanism registry. */
export function rootEvalDevelopmentRegistryPairwiseAudit(
	tasks: readonly RootEvalMechanismAuditTask[],
): readonly RootEvalMechanismPairwiseAudit[] {
	if (tasks.length !== 25)
		throw new TypeError("root eval D157 registry audit requires exactly twenty-five tasks");
	const horizonTaskSetRefs = new Set<string>([
		ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS["development-4"],
		ROOT_EVAL_DEVELOPMENT_TASK_SET_REFS["development-5"],
	]);
	return mechanismPairwiseAudit(tasks, (leftIndex, rightIndex) =>
		[tasks[leftIndex]!, tasks[rightIndex]!].some((task) => horizonTaskSetRefs.has(task.taskSetRef)),
	);
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
	return Object.freeze({
		selected: verified ? "verified" : "alternative",
		replacement: verified ? task.fixtureCorrectText : task.fixtureAlternativeText,
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
	slot: RootEvalTaskManifestSlot = "development-1",
): boolean {
	const variants = developmentVariants(slot);
	if (
		variants === undefined ||
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
	strictSnapshot({
		decisionRef: "graphrefly-ts:D156",
		tasks: ROOT_EVAL_DEVELOPMENT_TASKS,
		candidateContract: "occurrence-bound-two-symmetric-semantic-actions",
	}),
);

function candidateDigestMaterial(candidate: RootEvalToolCandidate) {
	return {
		candidateRef: candidate.candidateRef,
		taskInstanceRef: candidate.taskInstanceRef,
		workItemId: candidate.workItemId,
		workItemRole: candidate.workItemRole,
		path: candidate.path,
		action: candidate.action,
		workspaceSnapshotDigest: candidate.workspaceSnapshotDigest,
		oldSpanDigest: candidate.oldSpanDigest,
		replacementDigest: candidate.replacementDigest,
	};
}

function candidateWorkspaceSnapshotMaterial(
	task: RootEvalTaskDefinition,
	workItemRole: "source" | "target",
) {
	const writablePath = workItemRole === "source" ? task.sourceWritablePath : task.writablePath;
	const writableText =
		workItemRole === "source" ? task.sourceFixtureBuggyText : task.fixtureBuggyText;
	const readonlyFixtures =
		workItemRole === "source" ? task.sourceReadonlyFixtureFiles : task.readonlyFixtureFiles;
	return Object.freeze({
		writable: Object.freeze({
			path: writablePath,
			digest: empiricalStrictJsonDigest(writableText),
		}),
		readonly: Object.freeze(
			readonlyFixtures.map((fixture) =>
				Object.freeze({ path: fixture.path, digest: empiricalStrictJsonDigest(fixture.text) }),
			),
		),
	});
}

export function rootEvalCandidateWorkspaceSnapshotDigest(
	task: RootEvalTaskDefinition,
	workItemRole: "source" | "target",
): string {
	return empiricalStrictJsonDigest(candidateWorkspaceSnapshotMaterial(task, workItemRole));
}

function candidateAction(replacementText: string): string {
	const match = /\r?\n\treturn (?<expression>[^\r\n]+);\r?\n\}/u.exec(replacementText);
	if (match?.groups?.expression === undefined)
		throw new TypeError("root eval candidate action lacked one return expression");
	return `Adopt the documented behavior whose return expression evaluates ${match.groups.expression}.`;
}

/** D156 private catalog: Graph sees refs/digests; only the exact tool receives replacement bytes. */
export function rootEvalToolCandidateCatalog(
	task: RootEvalTaskDefinition,
	workItemRole: "source" | "target",
	workItemId: string,
): RootEvalToolCandidateCatalog {
	if (workItemId.length < 1 || workItemId.length > 512)
		throw new TypeError("root eval candidate catalog Work Item occurrence was invalid");
	const path = workItemRole === "source" ? task.sourceWritablePath : task.writablePath;
	const source = workItemRole === "source" ? task.sourceFixtureBuggyText : task.fixtureBuggyText;
	const verified =
		workItemRole === "source" ? task.sourceFixtureCorrectText : task.fixtureCorrectText;
	const alternative =
		workItemRole === "source" ? task.sourceFixtureAlternativeText : task.fixtureAlternativeText;
	if (source === verified || source === alternative || verified === alternative)
		throw new TypeError("root eval candidate interventions were not symmetric changes");
	const entries = [
		{ action: candidateAction(verified), replacementText: verified },
		{ action: candidateAction(alternative), replacementText: alternative },
	] as const;
	// The verified action alternates A/B across replicates; neither opaque ref encodes correctness.
	const ordered = task.replicate % 2 === 1 ? entries : ([entries[1], entries[0]] as const);
	const candidates = ordered.map((entry, index) =>
		Object.freeze({
			candidateRef: `${workItemId}/candidate-${index === 0 ? "a" : "b"}`,
			taskInstanceRef: task.instanceRef,
			workItemId,
			workItemRole,
			path,
			action: entry.action,
			workspaceSnapshotDigest: rootEvalCandidateWorkspaceSnapshotDigest(task, workItemRole),
			oldSpanDigest: empiricalStrictJsonDigest(source),
			oldSpanText: source,
			replacementDigest: empiricalStrictJsonDigest(entry.replacementText),
			replacementText: entry.replacementText,
		}),
	) as unknown as readonly [RootEvalToolCandidate, RootEvalToolCandidate];
	const catalogDigest = empiricalStrictJsonDigest({
		kind: "root-eval-d156-tool-candidate-catalog",
		taskInstanceRef: task.instanceRef,
		workItemId,
		workItemRole,
		candidates: candidates.map(candidateDigestMaterial),
	});
	return Object.freeze({
		taskInstanceRef: task.instanceRef,
		workItemId,
		workItemRole,
		catalogDigest,
		candidates: Object.freeze(candidates),
	});
}

export function rootEvalTaskBindings(
	tasks: readonly RootEvalTaskDefinition[],
	campaignRef = "graphrefly-efficacy-eval",
): readonly RootEvalTaskBinding[] {
	assertRootEvalTaskStimulusContract(tasks);
	return Object.freeze(
		tasks.map((task, index) => {
			const irrelevant = tasks[ROOT_EVAL_IRRELEVANT_SOURCE_REPLICATES[index]! - 1]!;
			const sourceCatalog = rootEvalToolCandidateCatalog(task, "source", task.sourceWorkItemRef);
			const targetCandidateCatalogs = Object.fromEntries(
				HARNESS_ARMS.map((arm) => {
					const workItemId = `${campaignRef}/replicate-${task.replicate}/${arm}`;
					const catalog = rootEvalToolCandidateCatalog(task, "target", workItemId);
					return [
						arm,
						Object.freeze({
							workItemId,
							candidateCatalogDigest: catalog.catalogDigest,
							candidateRefs: Object.freeze(
								catalog.candidates.map((candidate) => candidate.candidateRef),
							) as readonly [string, string],
						}),
					] as const;
				}),
			) as RootEvalTaskBinding["targetCandidateCatalogs"];
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
				sourceCandidateCatalogDigest: sourceCatalog.catalogDigest,
				sourceCandidateRefs: Object.freeze(
					sourceCatalog.candidates.map((candidate) => candidate.candidateRef),
				) as readonly [string, string],
				targetCandidateCatalogs: Object.freeze(targetCandidateCatalogs),
			});
		}),
	);
}

export const ROOT_EVAL_HELD_OUT_SEAL_DIGEST = empiricalStrictJsonDigest({
	kind: "root-eval-d156-unmaterialized-held-out-seal",
	decisionRef: "graphrefly-ts:D156",
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
			empiricalStrictJsonDigest(task.sourceFixtureAlternativeText),
			empiricalStrictJsonDigest(task.fixtureCorrectText),
			empiricalStrictJsonDigest(task.fixtureBuggyText),
			empiricalStrictJsonDigest(task.fixtureAlternativeText),
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
	const variants = developmentVariants(input.slot);
	if (
		variants === undefined ||
		input.variantOrder.length !== 5 ||
		new Set(input.variantOrder).size !== 5 ||
		input.variantOrder.some(
			(index) => !Number.isSafeInteger(index) || index < 0 || index >= variants.length,
		) ||
		!/^[a-z0-9-]{16,128}$/u.test(input.coordinateSuffix) ||
		!rootEvalVariantOrderSupportsIrrelevantControls(input.variantOrder, input.slot)
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

export function bindRootEvalD157HorizonManifests(
	development4: RootEvalTaskManifest,
	development5: RootEvalTaskManifest,
): readonly [RootEvalTaskManifest, RootEvalTaskManifest] {
	if (
		development4.slot !== "development-4" ||
		development5.slot !== "development-5" ||
		development4.horizonPeerManifestDigest !== undefined ||
		development5.horizonPeerManifestDigest !== undefined
	)
		throw new TypeError("root eval D157 horizon manifest binding input invalid");
	const material = Object.freeze({
		schemaVersion: development4.schemaVersion,
		slot: development4.slot,
		taskSetRef: development4.taskSetRef,
		tasks: development4.tasks,
		horizonPeerManifestDigest: development5.manifestDigest,
	});
	return Object.freeze([
		Object.freeze({
			...material,
			manifestDigest: empiricalStrictJsonDigest(manifestMaterial(material)),
		}),
		development5,
	]);
}

function assertRootEvalTaskManifestRegistryMembership(manifest: RootEvalTaskManifest): void {
	if (!isRootEvalSupportedDevelopmentSlot(manifest.slot)) return;
	const variants = ROOT_EVAL_DEVELOPMENT_TASK_BANK_REGISTRY[manifest.slot].variants;
	for (const [index, task] of manifest.tasks.entries()) {
		const variant = variants.find((candidate) => candidate.mechanismId === task.mechanismId);
		const coordinate = /\/\/ sealed-manifest-coordinate: (:[a-z0-9-]{16,128})\n/u.exec(
			task.readonlyFixtureFiles[0]?.text ?? "",
		)?.[1];
		if (variant === undefined || coordinate === undefined)
			throw new TypeError("root eval task manifest was not a member of its finite registry bank");
		const expected = createTask(
			"development-transfer",
			(index + 1) as 1 | 2 | 3 | 4 | 5,
			variant,
			manifest.taskSetRef,
			coordinate,
		);
		if (empiricalStrictJsonDigest(task) !== empiricalStrictJsonDigest(expected))
			throw new TypeError("root eval task manifest drifted from its finite registry definition");
	}
}

export function rootEvalTaskManifestDirectory(): string {
	return resolve(
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY ??
			resolve(
				import.meta.dirname,
				"../.private/empirical-memory-rerun-avoidance/d152-mechanism-manifests",
			),
	);
}

export function rootEvalTaskManifestPath(slot: RootEvalTaskManifestSlot): string {
	const directory = rootEvalTaskManifestDirectory();
	return resolve(
		ROOT_EVAL_D157_HORIZON_SLOTS.includes(slot as (typeof ROOT_EVAL_D157_HORIZON_SLOTS)[number])
			? resolve(directory, ROOT_EVAL_D157_HORIZON_DIRECTORY_NAME)
			: directory,
		`${slot}.json`,
	);
}

export function readRootEvalTaskManifest(slot: RootEvalTaskManifestSlot): RootEvalTaskManifest {
	const developmentOrdinal = rootEvalDevelopmentOrdinal(slot);
	if (developmentOrdinal !== null && developmentOrdinal <= 3)
		throw new TypeError(`root eval ${slot} manifest is immutable audit-only evidence`);
	const path = rootEvalTaskManifestPath(slot);
	const handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	let raw: string;
	try {
		const file = fstatSync(handle);
		if (
			!file.isFile() ||
			file.nlink !== 1 ||
			(file.mode & 0o777) !== 0o600 ||
			file.size < 1 ||
			file.size > 4 * 1_048_576
		)
			throw new TypeError(`root eval ${slot} task manifest must be a mode-0600 regular file`);
		raw = readFileSync(handle, "utf8");
	} finally {
		closeSync(handle);
	}
	const value = JSON.parse(raw) as RootEvalTaskManifest;
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
		(slot === "development-4"
			? !/^sha256:[0-9a-f]{64}$/u.test(value.horizonPeerManifestDigest ?? "")
			: value.horizonPeerManifestDigest !== undefined) ||
		value.manifestDigest !==
			empiricalStrictJsonDigest(
				manifestMaterial({
					schemaVersion: value.schemaVersion,
					slot: value.slot,
					taskSetRef: value.taskSetRef,
					tasks: value.tasks,
					...(value.horizonPeerManifestDigest === undefined
						? {}
						: { horizonPeerManifestDigest: value.horizonPeerManifestDigest }),
				}),
			)
	)
		throw new TypeError(`root eval ${slot} task manifest failed closed`);
	assertRootEvalTaskStimulusContract(value.tasks);
	assertRootEvalTaskManifestRegistryMembership(value);
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
