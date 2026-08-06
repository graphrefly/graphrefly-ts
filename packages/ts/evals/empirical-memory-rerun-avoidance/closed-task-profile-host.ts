import { spawn } from "node:child_process";
import { chmod, lstat, readdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { type StrictJsonValue, strictJsonCodec } from "../../src/json/codec.js";
import {
	array,
	coordinate,
	digest,
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	fail,
	oneOf,
	record,
	safeInteger,
	strictSnapshot,
	string,
} from "./canonical.js";
import { assertPortableRepositoryPath } from "./canonical-repository-tree.js";
import type {
	EmpiricalCampaignTaskV1,
	EmpiricalTaskQualificationReportV1,
	EmpiricalUsageSource,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE,
	type EmpiricalExactPrivateNeedleProtectionExecutorV1,
	isEmpiricalExactPrivateNeedleProtectionExecutor,
} from "./exact-private-needle-protection.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelToolIntentV1,
	type EmpiricalModelToolResultV1,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	type EmpiricalProtectionReceiptV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnRequest,
} from "./model-execution.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";
import type { HistoryFreeSingleBaselineRepositoryMaterializationV1 } from "./single-baseline-repository-node.js";

export const CLOSED_TASK_PROFILE_HOST_SCHEMAS = Object.freeze({
	workspaceRecipe: "graphrefly.private-solution-eval.closed-workspace-recipe.v1",
	commandPolicy: "graphrefly.private-solution-eval.closed-command-policy.v1",
	verifierProfile: "graphrefly.private-solution-eval.closed-verifier-profile.v1",
	taskProfile: "graphrefly.private-solution-eval.closed-task-execution-profile.v1",
	verifierResult: "graphrefly.private-solution-eval.closed-verifier-result.v1",
	runOutcome: "graphrefly.private-solution-eval.closed-host-run-outcome.v3",
});

export const CLOSED_ACTOR_TOOL_REFS = Object.freeze({
	readFile: "graphrefly.private-solution-eval.workspace.read-file.v1",
	searchLiteral: "graphrefly.private-solution-eval.workspace.search-literal.v1",
	replaceExact: "graphrefly.private-solution-eval.workspace.replace-exact.v1",
	workspaceDiff: "graphrefly.private-solution-eval.workspace.diff.v1",
	runCommand: "graphrefly.private-solution-eval.workspace.run-command-ref.v1",
});

export const D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION = "closed-task-tools.d682.v3";

export const CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES = 256;

const CLOSED_TOOL_ORDER = Object.freeze([
	CLOSED_ACTOR_TOOL_REFS.readFile,
	CLOSED_ACTOR_TOOL_REFS.searchLiteral,
	CLOSED_ACTOR_TOOL_REFS.replaceExact,
	CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
	CLOSED_ACTOR_TOOL_REFS.runCommand,
]);
const MAX_PROFILE_FILES = 256;
const MAX_PROFILE_COMMANDS = 32;
const MAX_COMMAND_ARGUMENTS = 64;
const MAX_LITERAL_CODE_UNITS = 65_536;
const D682_PROGRESS_MAX_CANONICAL_BYTES = 512;
const MAX_TOOL_INTENTS_PER_TURN = 16;
const MAX_EVIDENCE_REFS = 32;
const MAX_WORKSPACE_SNAPSHOT_ENTRIES = 100_000;
const MAX_WORKSPACE_SNAPSHOT_BYTES = 512 * 1024 * 1024;
const FORBIDDEN_SHELL_EXECUTABLE_NAMES = new Set([
	"bash",
	"csh",
	"dash",
	"env",
	"fish",
	"find",
	"ksh",
	"nice",
	"nohup",
	"powershell",
	"pwsh",
	"script",
	"sh",
	"tcsh",
	"time",
	"timeout",
	"xargs",
	"zsh",
]);
const textDecoder = new TextDecoder("utf-8", { fatal: true });
const textEncoder = new TextEncoder();
const FIXED_COMMAND_ENV = Object.freeze({
	GIT_ATTR_NOSYSTEM: "1",
	GIT_CONFIG_GLOBAL: "/dev/null",
	GIT_CONFIG_NOSYSTEM: "1",
	GIT_CONFIG_SYSTEM: "/dev/null",
	GIT_LITERAL_PATHSPECS: "1",
	GIT_NO_LAZY_FETCH: "1",
	GIT_NO_REPLACE_OBJECTS: "1",
	GIT_OPTIONAL_LOCKS: "0",
	LANG: "C",
	LC_ALL: "C",
	PATH: "/usr/bin:/bin",
});

export interface ClosedWorkspaceFileRuleV1 {
	readonly path: string;
	readonly mode: "100644" | "100755";
}

export interface ClosedWorkspaceRecipeV1 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.workspaceRecipe;
	readonly workspaceRecipeRef: string;
	readonly workspaceRecipeRevision: string;
	readonly readableFiles: readonly string[];
	readonly writableFiles: readonly ClosedWorkspaceFileRuleV1[];
	readonly maxFileBytes: number;
	readonly maxSearchMatches: number;
	readonly maxDiffBytes: number;
	readonly maxToolResultBytes: number;
	readonly maxToolActions: number;
}

export interface ClosedCommandSpecV1 {
	readonly commandRef: string;
	readonly executable: string;
	readonly argv: readonly string[];
	readonly maxStdoutBytes: number;
	readonly maxStderrBytes: number;
}

export interface ClosedCommandPolicyV1 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy;
	readonly policyRef: string;
	readonly policyRevision: string;
	readonly environmentRevision: "posix-sanitized-v1";
	readonly commands: readonly ClosedCommandSpecV1[];
}

export interface ClosedVerifierProfileV1 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierProfile;
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly fixtureSuiteRef: string;
	readonly fixtureSuiteRevision: string;
	readonly fixtureSuiteDigest: string;
	readonly harnessRevision: string;
	readonly aggregation: "all-required";
	readonly verifierCommandRefs: readonly string[];
}

export interface ClosedTaskExecutionProfileV1 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.taskProfile;
	readonly taskRef: string;
	readonly workspaceRecipe: ClosedWorkspaceRecipeV1;
	readonly commandPolicy: ClosedCommandPolicyV1;
	readonly verifierProfile: ClosedVerifierProfileV1;
}

export interface ClosedVerifierResultV1 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult;
	readonly verdict: "passed" | "failed" | "unverifiable";
	readonly evidenceRefs: readonly ClosedVerifierRunEvidenceRefV1[];
	readonly issueCodes: readonly string[];
}

export interface ClosedVerifierRunEvidenceRefV1 {
	readonly kind: "target-verification";
	readonly id: string;
	readonly digest: string;
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly verifierProfileRef: string;
	readonly verifierProfileDigest: string;
	readonly fixtureSuiteDigest: string;
	readonly workspaceStateDigest: string;
	readonly harnessRevision: string;
}

export interface ClosedVerifierProfileCoordinatesV1 {
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly verifierProfileDigest: string;
	readonly fixtureSuiteRef: string;
	readonly fixtureSuiteRevision: string;
	readonly fixtureSuiteDigest: string;
	readonly harnessRevision: string;
}

export interface ClosedVerifierRunCoordinatesV1 extends ClosedVerifierProfileCoordinatesV1 {
	readonly workspaceStateDigest: string;
}

export interface ClosedVerifierCapabilityV1 {
	readonly verifierProfileRef: string;
	readonly verifierProfileRevision: string;
	readonly verifierProfileDigest: string;
	verify(input: {
		readonly workspace: {
			readonly kind: "graphrefly.private-solution-eval.single-baseline-workspace.v1";
			rootPathForHostRunner(): string;
		};
		readonly profileCoordinates: ClosedVerifierRunCoordinatesV1;
		readonly signal: AbortSignal;
	}): Promise<ClosedVerifierResultV1>;
}

export interface ClosedTaskProfileHostRunInputV1 {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly initialRequest: EmpiricalModelTurnRequestV1;
	readonly taskProfile: ClosedTaskExecutionProfileV1;
	readonly materialization: HistoryFreeSingleBaselineRepositoryMaterializationV1;
	readonly modelTurnPort: EmpiricalModelTurnPortV1;
	readonly protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1;
	readonly verifier: ClosedVerifierCapabilityV1;
	readonly actionReceiptObserver?: ClosedTaskProfileHostActionReceiptObserverV1;
	readonly retry?: ClosedTaskProfileHostRetryCapabilityV1;
	/** Separate ownership signal used only to classify the D682 per-run elapsed bound. */
	readonly agentRunElapsedSignal?: AbortSignal;
	readonly signal: AbortSignal;
}

export interface ClosedTaskProfileHostActionReceiptV1 {
	readonly taskRef: string;
	readonly trialBlockRef: string;
	readonly trialStage: EmpiricalModelTurnRequestV1["trialStage"];
	readonly stepIndex: number;
	readonly actionIndex: number;
	readonly toolRef: string;
	readonly intentDigest: string;
	readonly resultDigest: string;
	readonly arguments: StrictJsonValue;
	readonly result: StrictJsonValue;
}

export interface ClosedTaskProfileHostActionReceiptObserverV1 {
	readonly observerRef: string;
	readonly observerRevision: string;
	record(receipt: ClosedTaskProfileHostActionReceiptV1): void;
}

export interface ClosedTaskProfileHostRetryCapabilityV1 {
	readonly maxAttemptsPerTurn: number;
	retryDelayMs(outcome: EmpiricalModelTurnOutcomeV1, attemptOrdinal: number): number | null;
	retryAdmissionIssueCodes(): readonly string[];
	remainingElapsedMs(): number;
	wait(input: { readonly delayMs: number; readonly signal: AbortSignal }): Promise<number>;
}

export interface ClosedTaskProfileHostRunOutcomeV3 {
	readonly schemaVersion: typeof CLOSED_TASK_PROFILE_HOST_SCHEMAS.runOutcome;
	readonly status: "completed" | "non-evaluable";
	readonly taskRef: string;
	readonly taskDigest: string;
	readonly logicalStepCount: number;
	readonly attemptCount: number;
	readonly remoteRequests: number;
	readonly retryWaitMs: number;
	readonly toolActionCount: number;
	readonly hostInputBytes: number;
	readonly hostOutputBytes: number;
	readonly initialRequestDigest: string | null;
	readonly initialMemoryContextRecordDigest: string | null;
	readonly finalOutput: StrictJsonValue | null;
	readonly finalOutputDigest: string | null;
	readonly verifierVerdict: "passed" | "failed" | "unverifiable" | null;
	readonly verifierEvidenceRefs: readonly ClosedVerifierRunEvidenceRefV1[];
	readonly workspaceBaselineDigest: string | null;
	readonly workspaceStateDigest: string | null;
	readonly workspaceChangeDigest: string | null;
	readonly workspaceChanged: boolean | null;
	readonly turnEvidence: readonly {
		readonly stepIndex: number;
		readonly attemptOrdinal: number;
		readonly requestDigest: string;
		readonly status: "completed" | "non-evaluable";
		readonly finishReason: "structured-output" | "tool-intents" | null;
		readonly requests: 0 | 1;
		readonly usageSource: EmpiricalUsageSource;
		readonly inputTokens: number | null;
		readonly outputTokens: number | null;
		readonly totalTokens: number | null;
		readonly hostInputBytes: number;
		readonly hostOutputBytes: number;
		readonly latencyMs: number;
		readonly issueCodes: readonly string[];
		readonly evidenceRefs: readonly {
			readonly kind: string;
			readonly id: string;
			readonly digest: string;
		}[];
		readonly protectionReceipt: EmpiricalProtectionReceiptV1;
	}[];
	readonly retryWaitEvidence: readonly {
		readonly stepIndex: number;
		readonly afterAttemptOrdinal: number;
		readonly scheduledDelayMs: number;
		readonly elapsedMs: number;
	}[];
	readonly toolEvidence: readonly {
		readonly toolCallRef: string;
		readonly toolCallRefDigest: string;
		readonly toolRef: string;
		readonly resultDigest: string;
	}[];
	readonly actionTrace: readonly {
		readonly stepIndex: number;
		readonly actionIndex: number;
		readonly initialRequestDigest: string;
		readonly requestDigest: string;
		readonly toolCallRefDigest: string;
		readonly toolRef: string;
		readonly intentDigest: string;
		readonly resultDigest: string;
		readonly memoryContextRecordDigest: string | null;
	}[];
	readonly issueCodes: readonly string[];
	readonly cleanupSucceeded: boolean;
}

interface ValidatedTaskProfile {
	readonly profile: ClosedTaskExecutionProfileV1;
	readonly task: EmpiricalCampaignTaskV1;
	readonly taskDigest: string;
	readonly commandByRef: ReadonlyMap<string, ClosedCommandSpecV1>;
	readonly readableFiles: ReadonlySet<string>;
	readonly writableFiles: ReadonlyMap<string, ClosedWorkspaceFileRuleV1>;
}

interface ProcessResult {
	readonly exitCode: number;
	readonly stdout: Uint8Array;
	readonly stderr: Uint8Array;
}

type WorkspaceSnapshotEntry =
	| { readonly kind: "directory"; readonly mode: number }
	| {
			readonly kind: "file";
			readonly mode: number;
			readonly byteLength: number;
			readonly digest: string;
	  };

interface WorkspaceSnapshot {
	readonly entries: ReadonlyMap<string, WorkspaceSnapshotEntry>;
}

interface MutableRunEvidence {
	logicalStepCount: number;
	attemptCount: number;
	remoteRequests: number;
	retryWaitMs: number;
	toolActionCount: number;
	hostInputBytes: number;
	hostOutputBytes: number;
	initialRequestDigest: string | null;
	initialMemoryContextRecordDigest: string | null;
	workspaceBaselineDigest: string | null;
	workspaceStateDigest: string | null;
	workspaceChangeDigest: string | null;
	readonly turnEvidence: Array<ClosedTaskProfileHostRunOutcomeV3["turnEvidence"][number]>;
	readonly retryWaitEvidence: Array<ClosedTaskProfileHostRunOutcomeV3["retryWaitEvidence"][number]>;
	readonly toolEvidence: Array<ClosedTaskProfileHostRunOutcomeV3["toolEvidence"][number]>;
	readonly actionTrace: Array<ClosedTaskProfileHostRunOutcomeV3["actionTrace"][number]>;
}

interface D682ExecutionProgress {
	readonly [key: string]: number | boolean;
	readonly remainingSteps: number;
	readonly remainingActions: number;
	readonly mutationObserved: boolean;
	readonly diffObserved: boolean;
	readonly commandObserved: boolean;
}

class HostRunFailure extends Error {
	readonly issueCode: string;

	constructor(issueCode: string) {
		super(`B112 D659 closed host run failed: ${issueCode}`);
		this.name = "HostRunFailure";
		this.issueCode = issueCode;
	}
}

/**
 * Executes D659's deterministic package-private host boundary and always attempts exact D658 cleanup.
 * Configuration failures reject after cleanup; bounded runtime failures return non-evaluable evidence.
 */
export async function runClosedTaskProfileHost(
	input: ClosedTaskProfileHostRunInputV1,
): Promise<ClosedTaskProfileHostRunOutcomeV3> {
	let taskRef = "unresolved-task";
	let taskDigest = empiricalStrictJsonDigest({ taskRef });
	let internalOutcome: ClosedTaskProfileHostRunOutcomeV3 | null = null;
	let configurationError: unknown = null;
	try {
		const frozen = validateFrozenEmpiricalCampaignManifest(input.frozen, input.qualificationReport);
		const initialRequest = validateEmpiricalModelTurnRequest(
			input.initialRequest,
			frozen,
			input.qualificationReport,
		);
		taskRef = initialRequest.taskRef;
		taskDigest = initialRequest.taskDigest;
		validateProtectionExecutor(input.protectionExecutor, frozen, initialRequest);
		const validated = validateTaskProfile(input.taskProfile, frozen, initialRequest);
		validateMaterialization(input.materialization, validated);
		const verifier = validateVerifierCapability(input.verifier, validated);
		internalOutcome = await runValidatedHost(input, frozen, initialRequest, validated, verifier);
	} catch (error) {
		if (error instanceof HostRunFailure) {
			internalOutcome = nonEvaluableOutcome(taskRef, taskDigest, emptyEvidence(), [
				error.issueCode,
			]);
		} else {
			configurationError = error;
		}
	}

	let cleanupSucceeded = false;
	try {
		cleanupSucceeded = (await input.materialization.cleanup()) === undefined;
	} catch {
		cleanupSucceeded = false;
	}
	if (configurationError !== null) {
		if (!cleanupSucceeded) {
			return nonEvaluableOutcome(taskRef, taskDigest, emptyEvidence(), [
				"configuration-invalid",
				"workspace-cleanup-failed",
			]);
		}
		throw configurationError;
	}
	if (internalOutcome === null) throw new HostRunFailure("host-outcome-missing");
	if (!cleanupSucceeded) {
		return strictSnapshot({
			...internalOutcome,
			status: "non-evaluable" as const,
			finalOutput: null,
			finalOutputDigest: null,
			verifierVerdict: null,
			verifierEvidenceRefs: [],
			issueCodes: sortedIssueCodes([...internalOutcome.issueCodes, "workspace-cleanup-failed"]),
			cleanupSucceeded: false,
		});
	}
	return strictSnapshot({ ...internalOutcome, cleanupSucceeded: true });
}

function validateProtectionExecutor(
	value: EmpiricalExactPrivateNeedleProtectionExecutorV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	request: EmpiricalModelTurnRequestV1,
): void {
	const executor = record(value, "host.protectionExecutor");
	exactKeys(
		executor,
		[
			"inspect",
			"policyRef",
			"policyRevision",
			"profile",
			"protectedNeedleCapabilityRef",
			"protectedNeedleCapabilityRevision",
		],
		"host.protectionExecutor",
	);
	if (
		!isEmpiricalExactPrivateNeedleProtectionExecutor(value) ||
		executor.profile !== EMPIRICAL_EXACT_PRIVATE_NEEDLE_PROTECTION_PROFILE ||
		executor.policyRef !== frozen.manifest.policies.protectionPolicyRef ||
		executor.policyRevision !== frozen.manifest.policies.protectionPolicyRevision ||
		executor.policyRef !== request.protectionPolicyRef ||
		executor.policyRevision !== request.protectionPolicyRevision ||
		typeof executor.inspect !== "function"
	) {
		fail("host.protectionExecutor", "does not match the frozen D656 policy coordinates");
	}
	coordinate(
		executor.protectedNeedleCapabilityRef,
		"host.protectionExecutor.protectedNeedleCapabilityRef",
	);
	coordinate(
		executor.protectedNeedleCapabilityRevision,
		"host.protectionExecutor.protectedNeedleCapabilityRevision",
	);
}

function validateTaskProfile(
	value: ClosedTaskExecutionProfileV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	request: EmpiricalModelTurnRequestV1,
): ValidatedTaskProfile {
	const candidate = record(value, "host.taskProfile");
	const taskRef = coordinate(candidate.taskRef, "host.taskProfile.taskRef");
	const task = frozen.manifest.catalog.tasks.find((candidate) => candidate.taskRef === taskRef);
	if (task === undefined || taskRef !== request.taskRef) {
		fail("host.taskProfile.taskRef", "does not resolve the exact request task");
	}
	const taskDigest = empiricalStrictJsonDigest(task);
	if (request.taskDigest !== taskDigest) {
		fail("host.initialRequest.taskDigest", "does not match the exact task");
	}
	const profile = validateClosedTaskExecutionProfile(value, task);
	const toolRefs = request.availableTools.map((tool) => tool.toolRef);
	if (
		toolRefs.length !== CLOSED_TOOL_ORDER.length ||
		toolRefs.some((toolRef, index) => toolRef !== CLOSED_TOOL_ORDER[index])
	) {
		fail("host.initialRequest.availableTools", "must equal the closed D659 actor tool order");
	}
	return Object.freeze({
		profile,
		task,
		taskDigest,
		commandByRef: new Map(
			profile.commandPolicy.commands.map((command) => [command.commandRef, command]),
		),
		readableFiles: new Set(profile.workspaceRecipe.readableFiles),
		writableFiles: new Map(profile.workspaceRecipe.writableFiles.map((rule) => [rule.path, rule])),
	});
}

/**
 * Validates one exact D659 task profile without constructing an actor/model run.
 * This package-private seam lets provider-independent qualification prove the
 * recipe, command-policy, and verifier coordinates before any model port exists.
 */
export function validateClosedTaskExecutionProfile(
	value: ClosedTaskExecutionProfileV1,
	task: EmpiricalCampaignTaskV1,
): ClosedTaskExecutionProfileV1 {
	const profile = record(value, "host.taskProfile");
	exactKeys(
		profile,
		["commandPolicy", "schemaVersion", "taskRef", "verifierProfile", "workspaceRecipe"],
		"host.taskProfile",
	);
	if (profile.schemaVersion !== CLOSED_TASK_PROFILE_HOST_SCHEMAS.taskProfile) {
		fail("host.taskProfile.schemaVersion", "unexpected schema");
	}
	const taskRef = coordinate(profile.taskRef, "host.taskProfile.taskRef");
	if (taskRef !== task.taskRef) {
		fail("host.taskProfile.taskRef", "does not match the exact task");
	}
	const workspaceRecipe = validateWorkspaceRecipe(profile.workspaceRecipe, task);
	const commandPolicy = validateCommandPolicy(profile.commandPolicy, task);
	const verifierProfile = validateVerifierProfile(profile.verifierProfile, task, commandPolicy);
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.taskProfile,
		taskRef,
		workspaceRecipe,
		commandPolicy,
		verifierProfile,
	});
}

function validateWorkspaceRecipe(
	value: unknown,
	task: EmpiricalCampaignTaskV1,
): ClosedWorkspaceRecipeV1 {
	const recipe = record(value, "host.taskProfile.workspaceRecipe");
	exactKeys(
		recipe,
		[
			"maxDiffBytes",
			"maxFileBytes",
			"maxSearchMatches",
			"maxToolActions",
			"maxToolResultBytes",
			"readableFiles",
			"schemaVersion",
			"workspaceRecipeRef",
			"workspaceRecipeRevision",
			"writableFiles",
		],
		"host.taskProfile.workspaceRecipe",
	);
	if (recipe.schemaVersion !== CLOSED_TASK_PROFILE_HOST_SCHEMAS.workspaceRecipe) {
		fail("host.taskProfile.workspaceRecipe.schemaVersion", "unexpected schema");
	}
	const readableFiles = sortedPortablePaths(
		recipe.readableFiles,
		"host.taskProfile.workspaceRecipe.readableFiles",
	);
	const writableValues = array(
		recipe.writableFiles,
		"host.taskProfile.workspaceRecipe.writableFiles",
	);
	if (writableValues.length > MAX_PROFILE_FILES) {
		fail("host.taskProfile.workspaceRecipe.writableFiles", "too many file rules");
	}
	const writableFiles = writableValues.map((entry, index) => {
		const path = `host.taskProfile.workspaceRecipe.writableFiles[${index}]`;
		const rule = record(entry, path);
		exactKeys(rule, ["mode", "path"], path);
		const portablePath = assertPortableRepositoryPath(rule.path, `${path}.path`);
		if (rule.mode !== "100644" && rule.mode !== "100755") {
			fail(`${path}.mode`, "expected regular mode 100644 or 100755");
		}
		const mode: ClosedWorkspaceFileRuleV1["mode"] = rule.mode;
		return strictSnapshot({ path: portablePath, mode });
	});
	assertSortedUnique(
		writableFiles.map((rule) => rule.path),
		"host.taskProfile.workspaceRecipe.writableFiles",
	);
	if (writableFiles.some((rule) => !readableFiles.includes(rule.path))) {
		fail("host.taskProfile.workspaceRecipe.writableFiles", "writable files must also be readable");
	}
	const validated = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.workspaceRecipe,
		workspaceRecipeRef: string(
			recipe.workspaceRecipeRef,
			"host.taskProfile.workspaceRecipe.workspaceRecipeRef",
		),
		workspaceRecipeRevision: string(
			recipe.workspaceRecipeRevision,
			"host.taskProfile.workspaceRecipe.workspaceRecipeRevision",
		),
		readableFiles,
		writableFiles,
		maxFileBytes: safeInteger(
			recipe.maxFileBytes,
			"host.taskProfile.workspaceRecipe.maxFileBytes",
			{ min: 1, max: 4 * 1024 * 1024 },
		),
		maxSearchMatches: safeInteger(
			recipe.maxSearchMatches,
			"host.taskProfile.workspaceRecipe.maxSearchMatches",
			{ min: 1, max: 4_096 },
		),
		maxDiffBytes: safeInteger(
			recipe.maxDiffBytes,
			"host.taskProfile.workspaceRecipe.maxDiffBytes",
			{ min: 1, max: 4 * 1024 * 1024 },
		),
		maxToolResultBytes: safeInteger(
			recipe.maxToolResultBytes,
			"host.taskProfile.workspaceRecipe.maxToolResultBytes",
			{ min: 1, max: 4 * 1024 * 1024 },
		),
		maxToolActions: safeInteger(
			recipe.maxToolActions,
			"host.taskProfile.workspaceRecipe.maxToolActions",
			{ min: 1, max: CLOSED_TASK_PROFILE_HOST_MAX_ACTION_TRACE_ENTRIES },
		),
	});
	if (
		validated.workspaceRecipeRef !== task.workspaceRecipeRef ||
		validated.workspaceRecipeRevision !== task.workspaceRecipeRevision ||
		empiricalStrictJsonDigest(validated) !== task.workspaceRecipeDigest
	) {
		fail("host.taskProfile.workspaceRecipe", "does not match the task recipe coordinates");
	}
	return validated;
}

function validateCommandPolicy(
	value: unknown,
	task: EmpiricalCampaignTaskV1,
): ClosedCommandPolicyV1 {
	const policy = record(value, "host.taskProfile.commandPolicy");
	exactKeys(
		policy,
		["commands", "environmentRevision", "policyRef", "policyRevision", "schemaVersion"],
		"host.taskProfile.commandPolicy",
	);
	if (
		policy.schemaVersion !== CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy ||
		policy.environmentRevision !== "posix-sanitized-v1"
	) {
		fail("host.taskProfile.commandPolicy", "unexpected schema or environment revision");
	}
	const commandValues = array(policy.commands, "host.taskProfile.commandPolicy.commands");
	if (commandValues.length < 1 || commandValues.length > MAX_PROFILE_COMMANDS) {
		fail("host.taskProfile.commandPolicy.commands", "expected a bounded non-empty command list");
	}
	const commands = commandValues.map((entry, index) =>
		validateCommand(entry, `host.taskProfile.commandPolicy.commands[${index}]`),
	);
	assertSortedUnique(
		commands.map((command) => command.commandRef),
		"host.taskProfile.commandPolicy.commands",
	);
	const validated = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.commandPolicy,
		policyRef: string(policy.policyRef, "host.taskProfile.commandPolicy.policyRef"),
		policyRevision: string(policy.policyRevision, "host.taskProfile.commandPolicy.policyRevision"),
		environmentRevision: "posix-sanitized-v1" as const,
		commands,
	});
	if (
		validated.policyRef !== task.allowedCommandPolicyRef ||
		validated.policyRevision !== task.allowedCommandPolicyRevision ||
		empiricalStrictJsonDigest(validated) !== task.allowedCommandPolicyDigest
	) {
		fail("host.taskProfile.commandPolicy", "does not match the task command-policy coordinates");
	}
	return validated;
}

function validateCommand(value: unknown, path: string): ClosedCommandSpecV1 {
	const command = record(value, path);
	exactKeys(
		command,
		["argv", "commandRef", "executable", "maxStderrBytes", "maxStdoutBytes"],
		path,
	);
	const executable = string(command.executable, `${path}.executable`, 1_024);
	if (!isAbsolute(executable) || executable.includes("\0")) {
		fail(`${path}.executable`, "expected an exact absolute executable path");
	}
	if (FORBIDDEN_SHELL_EXECUTABLE_NAMES.has(basename(executable).toLowerCase())) {
		fail(`${path}.executable`, "shell and command-launcher executables are forbidden");
	}
	const argvValues = array(command.argv, `${path}.argv`);
	if (argvValues.length > MAX_COMMAND_ARGUMENTS) fail(`${path}.argv`, "too many arguments");
	const argv = argvValues.map((argument, index) => {
		const decoded = string(argument, `${path}.argv[${index}]`, 4_096);
		if (decoded.includes("\0")) fail(`${path}.argv[${index}]`, "NUL is forbidden");
		return decoded;
	});
	return strictSnapshot({
		commandRef: coordinate(command.commandRef, `${path}.commandRef`),
		executable,
		argv,
		maxStdoutBytes: safeInteger(command.maxStdoutBytes, `${path}.maxStdoutBytes`, {
			min: 1,
			max: 4 * 1024 * 1024,
		}),
		maxStderrBytes: safeInteger(command.maxStderrBytes, `${path}.maxStderrBytes`, {
			min: 1,
			max: 4 * 1024 * 1024,
		}),
	});
}

function validateVerifierProfile(
	value: unknown,
	task: EmpiricalCampaignTaskV1,
	commandPolicy: ClosedCommandPolicyV1,
): ClosedVerifierProfileV1 {
	const profile = record(value, "host.taskProfile.verifierProfile");
	exactKeys(
		profile,
		[
			"aggregation",
			"fixtureSuiteDigest",
			"fixtureSuiteRef",
			"fixtureSuiteRevision",
			"harnessRevision",
			"schemaVersion",
			"verifierCommandRefs",
			"verifierProfileRef",
			"verifierProfileRevision",
		],
		"host.taskProfile.verifierProfile",
	);
	if (
		profile.schemaVersion !== CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierProfile ||
		profile.aggregation !== "all-required"
	) {
		fail("host.taskProfile.verifierProfile", "unexpected schema or aggregation");
	}
	const verifierCommandRefs = sortedCoordinates(
		profile.verifierCommandRefs,
		"host.taskProfile.verifierProfile.verifierCommandRefs",
		1,
		32,
	);
	const actorCommandRefs = new Set(commandPolicy.commands.map((command) => command.commandRef));
	if (verifierCommandRefs.some((commandRef) => actorCommandRefs.has(commandRef))) {
		fail("host.taskProfile.verifierProfile.verifierCommandRefs", "must be actor-disjoint");
	}
	const validated = strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierProfile,
		verifierProfileRef: coordinate(
			profile.verifierProfileRef,
			"host.taskProfile.verifierProfile.verifierProfileRef",
		),
		verifierProfileRevision: string(
			profile.verifierProfileRevision,
			"host.taskProfile.verifierProfile.verifierProfileRevision",
		),
		fixtureSuiteRef: coordinate(
			profile.fixtureSuiteRef,
			"host.taskProfile.verifierProfile.fixtureSuiteRef",
		),
		fixtureSuiteRevision: string(
			profile.fixtureSuiteRevision,
			"host.taskProfile.verifierProfile.fixtureSuiteRevision",
		),
		fixtureSuiteDigest: digest(
			profile.fixtureSuiteDigest,
			"host.taskProfile.verifierProfile.fixtureSuiteDigest",
		),
		harnessRevision: coordinate(
			profile.harnessRevision,
			"host.taskProfile.verifierProfile.harnessRevision",
		),
		aggregation: "all-required" as const,
		verifierCommandRefs,
	});
	if (
		validated.verifierProfileRef !== task.verifierProfileRef ||
		validated.verifierProfileRevision !== task.verifierProfileRevision ||
		empiricalStrictJsonDigest(validated) !== task.verifierProfileDigest
	) {
		fail("host.taskProfile.verifierProfile", "does not match the task verifier coordinates");
	}
	return validated;
}

function validateMaterialization(
	materialization: HistoryFreeSingleBaselineRepositoryMaterializationV1,
	validated: ValidatedTaskProfile,
): void {
	const evidence = materialization.evidence;
	if (
		evidence.repositoryRef !== "graphrefly-ts" ||
		evidence.sourceCommitSha !== validated.task.originalCommitSha ||
		evidence.originalTreeDigest !== validated.task.originalTreeDigest ||
		evidence.actorTreeDigest !== validated.task.actorTreeDigest ||
		evidence.overlayDigest !== validated.task.overlayDigest ||
		evidence.repositoryState !== "clean-single-baseline" ||
		!evidence.fullFilesystemMatch ||
		evidence.sourceHistoryVisible ||
		evidence.overlayVisibleAsDiff
	) {
		throw new HostRunFailure("workspace-evidence-mismatch");
	}
}

function validateVerifierCapability(
	value: ClosedVerifierCapabilityV1,
	validated: ValidatedTaskProfile,
): ClosedVerifierCapabilityV1 {
	const capability = record(value, "host.verifier");
	exactKeys(
		capability,
		["verifierProfileDigest", "verifierProfileRef", "verifierProfileRevision", "verify"],
		"host.verifier",
	);
	if (
		capability.verifierProfileRef !== validated.task.verifierProfileRef ||
		capability.verifierProfileRevision !== validated.task.verifierProfileRevision ||
		capability.verifierProfileDigest !== validated.task.verifierProfileDigest ||
		typeof capability.verify !== "function"
	) {
		fail("host.verifier", "does not match the exact task verifier capability");
	}
	return value;
}

function ownCapabilityFunction<T extends (...args: never[]) => unknown>(
	value: Record<string, unknown>,
	key: string,
	path: string,
): T {
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	if (
		descriptor === undefined ||
		"get" in descriptor ||
		"set" in descriptor ||
		typeof descriptor.value !== "function"
	) {
		fail(path, "expected an own function data property");
	}
	return descriptor.value as T;
}

function validateRetryCapability(
	value: ClosedTaskProfileHostRetryCapabilityV1 | undefined,
): ClosedTaskProfileHostRetryCapabilityV1 | null {
	if (value === undefined) return null;
	const capability = record(value, "host.retry");
	exactKeys(
		capability,
		[
			"maxAttemptsPerTurn",
			"remainingElapsedMs",
			"retryAdmissionIssueCodes",
			"retryDelayMs",
			"wait",
		],
		"host.retry",
	);
	const maxAttemptsPerTurn = safeInteger(
		capability.maxAttemptsPerTurn,
		"host.retry.maxAttemptsPerTurn",
		{ min: 1, max: 3 },
	);
	const retryDelayMs = ownCapabilityFunction<
		ClosedTaskProfileHostRetryCapabilityV1["retryDelayMs"]
	>(capability, "retryDelayMs", "host.retry.retryDelayMs");
	const retryAdmissionIssueCodes = ownCapabilityFunction<
		ClosedTaskProfileHostRetryCapabilityV1["retryAdmissionIssueCodes"]
	>(capability, "retryAdmissionIssueCodes", "host.retry.retryAdmissionIssueCodes");
	const remainingElapsedMs = ownCapabilityFunction<
		ClosedTaskProfileHostRetryCapabilityV1["remainingElapsedMs"]
	>(capability, "remainingElapsedMs", "host.retry.remainingElapsedMs");
	const wait = ownCapabilityFunction<ClosedTaskProfileHostRetryCapabilityV1["wait"]>(
		capability,
		"wait",
		"host.retry.wait",
	);
	return Object.freeze({
		maxAttemptsPerTurn,
		retryDelayMs,
		retryAdmissionIssueCodes,
		remainingElapsedMs,
		wait,
	});
}

function validateActionReceiptObserver(
	value: ClosedTaskProfileHostActionReceiptObserverV1 | undefined,
): ClosedTaskProfileHostActionReceiptObserverV1 | null {
	if (value === undefined) return null;
	const capability = record(value, "host.actionReceiptObserver");
	exactKeys(
		capability,
		["observerRef", "observerRevision", "record"],
		"host.actionReceiptObserver",
	);
	return Object.freeze({
		observerRef: coordinate(capability.observerRef, "host.actionReceiptObserver.observerRef"),
		observerRevision: coordinate(
			capability.observerRevision,
			"host.actionReceiptObserver.observerRevision",
		),
		record: ownCapabilityFunction<ClosedTaskProfileHostActionReceiptObserverV1["record"]>(
			capability,
			"record",
			"host.actionReceiptObserver.record",
		),
	});
}

async function runValidatedHost(
	input: ClosedTaskProfileHostRunInputV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	initialRequest: EmpiricalModelTurnRequestV1,
	validated: ValidatedTaskProfile,
	verifier: ClosedVerifierCapabilityV1,
): Promise<ClosedTaskProfileHostRunOutcomeV3> {
	const evidence = emptyEvidence();
	try {
		const outcome = await executeValidatedHost(
			input,
			frozen,
			initialRequest,
			validated,
			verifier,
			validateActionReceiptObserver(input.actionReceiptObserver),
			validateRetryCapability(input.retry),
			evidence,
		);
		return classifyAgentRunElapsedOutcome(input, outcome);
	} catch (error) {
		if (error instanceof HostRunFailure) {
			const issueCode =
				error.issueCode === "host-cancelled" && agentRunElapsedBoundOwned(input)
					? "agent-run-elapsed-budget-exhausted"
					: error.issueCode;
			return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
				issueCode,
			]);
		}
		throw error;
	}
}

function agentRunElapsedBoundOwned(input: ClosedTaskProfileHostRunInputV1): boolean {
	return (
		input.signal.aborted &&
		input.agentRunElapsedSignal?.aborted === true &&
		Object.is(input.signal.reason, input.agentRunElapsedSignal.reason)
	);
}

function classifyAgentRunElapsedOutcome(
	input: ClosedTaskProfileHostRunInputV1,
	outcome: ClosedTaskProfileHostRunOutcomeV3,
): ClosedTaskProfileHostRunOutcomeV3 {
	if (
		!agentRunElapsedBoundOwned(input) ||
		outcome.status !== "non-evaluable" ||
		(!outcome.issueCodes.includes("host-cancelled") &&
			!outcome.issueCodes.includes("openrouter-host-cancelled"))
	) {
		return outcome;
	}
	const elapsedIssueCodes = (issueCodes: readonly string[]): readonly string[] =>
		sortedIssueCodes([
			...issueCodes.filter(
				(code) =>
					code !== "host-cancelled" &&
					code !== "openrouter-host-cancelled" &&
					code !== "openrouter-unavailable-transport",
			),
			"agent-run-elapsed-budget-exhausted",
		]);
	return strictSnapshot({
		...outcome,
		issueCodes: elapsedIssueCodes(outcome.issueCodes),
		turnEvidence: outcome.turnEvidence.map((turn) =>
			turn.issueCodes.includes("host-cancelled") ||
			turn.issueCodes.includes("openrouter-host-cancelled")
				? strictSnapshot({ ...turn, issueCodes: elapsedIssueCodes(turn.issueCodes) })
				: turn,
		),
	});
}

function usesD682HostDerivedReplace(
	request: EmpiricalModelTurnRequestV1,
	maxSearchMatches: number,
): boolean {
	const d682Tools = request.availableTools.filter(
		(tool) => tool.schemaRevision === D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
	);
	if (d682Tools.length === 0) return false;
	if (d682Tools.length !== request.availableTools.length) {
		throw new HostRunFailure("d682-tool-catalog-revision-mixed");
	}
	const structuredInput = record(request.structuredInput, "host.d682.structuredInput");
	const enumValues = (key: "readablePaths" | "writablePaths" | "commandRefs") =>
		array(structuredInput[key], `host.d682.structuredInput.${key}`).map((value, index) =>
			string(value, `host.d682.structuredInput.${key}[${index}]`, 32_768),
		);
	const readablePaths = enumValues("readablePaths");
	const writablePaths = enumValues("writablePaths");
	const commandRefs = enumValues("commandRefs");
	const stringShape = (values: readonly string[] | null) =>
		strictSnapshot({
			kind: "string" as const,
			minLength: 1,
			maxLength: 32_768,
			enum: values,
		});
	const replacementStringShape = strictSnapshot({
		kind: "string" as const,
		minLength: 0,
		maxLength: 32_768,
		enum: null,
	});
	const objectShape = (
		properties: readonly {
			readonly name: string;
			readonly required: true;
			readonly shape: EmpiricalModelTurnRequestV1["availableTools"][number]["inputSchema"];
		}[],
	) =>
		strictSnapshot({ kind: "object" as const, properties, additionalProperties: false as const });
	const expectedSchemas = new Map<
		string,
		EmpiricalModelTurnRequestV1["availableTools"][number]["inputSchema"]
	>([
		[
			CLOSED_ACTOR_TOOL_REFS.readFile,
			objectShape([{ name: "path", required: true, shape: stringShape(readablePaths) }]),
		],
		[
			CLOSED_ACTOR_TOOL_REFS.searchLiteral,
			objectShape([
				{
					name: "maxMatches",
					required: true,
					shape: { kind: "integer" as const, minimum: 1, maximum: maxSearchMatches },
				},
				{ name: "path", required: true, shape: stringShape(readablePaths) },
				{ name: "query", required: true, shape: stringShape(null) },
			]),
		],
		[
			CLOSED_ACTOR_TOOL_REFS.replaceExact,
			objectShape([
				{ name: "newText", required: true, shape: replacementStringShape },
				{ name: "oldText", required: true, shape: stringShape(null) },
				{ name: "path", required: true, shape: stringShape(writablePaths) },
			]),
		],
		[CLOSED_ACTOR_TOOL_REFS.workspaceDiff, objectShape([])],
		[
			CLOSED_ACTOR_TOOL_REFS.runCommand,
			objectShape([{ name: "commandRef", required: true, shape: stringShape(commandRefs) }]),
		],
	]);
	if (d682Tools.length !== expectedSchemas.size) {
		throw new HostRunFailure("d682-tool-catalog-invalid");
	}
	for (const tool of d682Tools) {
		const expected = expectedSchemas.get(tool.toolRef);
		if (
			expected === undefined ||
			tool.inputSchemaDigest !== empiricalStrictJsonDigest(tool.inputSchema) ||
			empiricalStrictJsonDigest(tool.inputSchema) !== empiricalStrictJsonDigest(expected)
		) {
			throw new HostRunFailure("d682-tool-catalog-invalid");
		}
	}
	return true;
}

async function executeValidatedHost(
	input: ClosedTaskProfileHostRunInputV1,
	frozen: FrozenEmpiricalCampaignManifestV1,
	initialRequest: EmpiricalModelTurnRequestV1,
	validated: ValidatedTaskProfile,
	verifier: ClosedVerifierCapabilityV1,
	actionReceiptObserver: ClosedTaskProfileHostActionReceiptObserverV1 | null,
	retry: ClosedTaskProfileHostRetryCapabilityV1 | null,
	evidence: MutableRunEvidence,
): Promise<ClosedTaskProfileHostRunOutcomeV3> {
	assertNotCancelled(input.signal);
	const workspaceRoot = await validateWorkspaceRoot(
		input.materialization.workspace.rootPathForHostRunner(),
	);
	await normalizeWorkspaceIndex(workspaceRoot, input.signal);
	const baselineSnapshot = await captureWorkspaceSnapshot(workspaceRoot, input.signal);
	assertSnapshotMatchesProfileBaseline(baselineSnapshot, validated);
	evidence.workspaceBaselineDigest = workspaceSnapshotDigest(baselineSnapshot);
	evidence.initialRequestDigest = empiricalStrictJsonDigest(initialRequest);
	evidence.initialMemoryContextRecordDigest = initialMemoryContextRecordDigest(initialRequest);
	const configuration = frozen.manifest.modelConfigurations.find(
		(candidate) => candidate.configurationRef === initialRequest.configurationRef,
	);
	if (configuration === undefined || configuration.role !== "actor") {
		fail("host.initialRequest.configurationRef", "must select one frozen actor configuration");
	}
	if (initialRequest.stepIndex !== 0 || initialRequest.priorToolResults.length !== 0) {
		fail("host.initialRequest", "must begin at step zero without prior tool results");
	}
	const maximumTurns = Math.min(
		frozen.manifest.budgets.agentRun.maxSteps,
		configuration.settings.tools.maxSteps,
	);
	const hostDerivedReplace = usesD682HostDerivedReplace(
		initialRequest,
		validated.profile.workspaceRecipe.maxSearchMatches,
	);
	let request = initialRequest;
	let pendingToolResults: EmpiricalModelToolResultV1[] = [];
	let pendingToolResultBytes = 0;
	const seenToolCallRefs = new Set<string>();
	let remainingOutputBytes = initialRequest.remainingTurnBudget.maxOutputBytes;
	let mutationObserved = false;
	let diffObserved = false;
	let commandObserved = false;

	for (let stepIndex = 0; stepIndex < maximumTurns; stepIndex += 1) {
		assertNotCancelled(input.signal);
		if (stepIndex > 0) {
			if (remainingOutputBytes === 0) {
				throw new HostRunFailure("agent-output-byte-budget-exhausted");
			}
			try {
				request = nextTurnRequest(
					initialRequest,
					stepIndex,
					pendingToolResults,
					remainingOutputBytes,
					frozen,
					input.qualificationReport,
				);
				pendingToolResults = [];
				pendingToolResultBytes = 0;
			} catch {
				throw new HostRunFailure("next-turn-request-invalid");
			}
		}
		let outcome: EmpiricalModelTurnOutcomeV1 | null = null;
		const maximumAttempts = retry?.maxAttemptsPerTurn ?? 1;
		for (let attemptOrdinal = 1; attemptOrdinal <= maximumAttempts; attemptOrdinal += 1) {
			if (evidence.attemptCount >= frozen.manifest.budgets.agentRun.maxRequests) {
				throw new HostRunFailure("agent-request-budget-exhausted");
			}
			let outcomeValue: unknown;
			try {
				outcomeValue = await input.modelTurnPort.invoke(request, input.signal);
			} catch {
				if (input.signal.aborted) throw new HostRunFailure("host-cancelled");
				throw new HostRunFailure("model-turn-invocation-failed");
			}
			const cancelledAfterInvocation = input.signal.aborted;
			try {
				outcome = validateEmpiricalModelTurnOutcome(
					outcomeValue,
					request,
					frozen,
					input.qualificationReport,
				);
			} catch (error) {
				throw new HostRunFailure(classifyModelOutcomeValidationFailure(error));
			}
			evidence.logicalStepCount = stepIndex + 1;
			evidence.attemptCount += 1;
			if (cancelledAfterInvocation && outcome.status !== "non-evaluable") {
				throw new HostRunFailure("host-cancelled");
			}
			evidence.remoteRequests += outcome.usage.requests;
			evidence.hostInputBytes = checkedSum(
				evidence.hostInputBytes,
				outcome.usage.hostInputBytes,
				"host-input-byte-budget-overflow",
			);
			evidence.hostOutputBytes = checkedSum(
				evidence.hostOutputBytes,
				outcome.usage.hostOutputBytes,
				"host-output-byte-budget-overflow",
			);
			remainingOutputBytes -= outcome.usage.hostOutputBytes;
			evidence.turnEvidence.push(
				strictSnapshot({
					stepIndex,
					attemptOrdinal,
					requestDigest: empiricalStrictJsonDigest(request),
					status: outcome.status,
					finishReason: outcome.finishReason,
					requests: outcome.usage.requests,
					usageSource: outcome.usage.source,
					inputTokens: outcome.usage.inputTokens,
					outputTokens: outcome.usage.outputTokens,
					totalTokens: outcome.usage.totalTokens,
					hostInputBytes: outcome.usage.hostInputBytes,
					hostOutputBytes: outcome.usage.hostOutputBytes,
					latencyMs: outcome.latencyMs,
					issueCodes: outcome.issueCodes,
					evidenceRefs: outcome.evidenceRefs,
					protectionReceipt: outcome.protectionReceipt,
				}),
			);
			if (remainingOutputBytes < 0) {
				throw new HostRunFailure("agent-output-byte-budget-exhausted");
			}
			if (outcome.status !== "non-evaluable") break;
			let delayMs: number | null = null;
			if (retry !== null) {
				try {
					const candidate = retry.retryDelayMs(outcome, attemptOrdinal);
					delayMs =
						candidate === null
							? null
							: safeInteger(candidate, "host.retry.delayMs", { min: 1, max: 600_000 });
				} catch {
					throw new HostRunFailure("model-turn-retry-policy-invalid");
				}
			}
			if (delayMs === null) {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...outcome.issueCodes,
					"model-turn-non-evaluable",
				]);
			}
			if (attemptOrdinal >= maximumAttempts) {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...outcome.issueCodes,
					"model-turn-non-evaluable",
					"model-turn-retry-exhausted",
				]);
			}
			if (retry === null) {
				throw new HostRunFailure("model-turn-retry-policy-invalid");
			}
			let retryAdmissionIssueCodes: readonly string[];
			try {
				retryAdmissionIssueCodes = sortedIssueCodes(retry.retryAdmissionIssueCodes());
			} catch {
				throw new HostRunFailure("model-turn-retry-policy-invalid");
			}
			if (retryAdmissionIssueCodes.length > 0) {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...outcome.issueCodes,
					...retryAdmissionIssueCodes,
					"model-turn-non-evaluable",
					"model-turn-retry-admission-rejected",
				]);
			}
			let remainingElapsedMs: number;
			try {
				remainingElapsedMs = safeInteger(
					retry.remainingElapsedMs(),
					"host.retry.remainingElapsedMs",
					{ min: 0, max: 86_400_000 },
				);
			} catch {
				throw new HostRunFailure("model-turn-retry-policy-invalid");
			}
			if (delayMs > remainingElapsedMs) {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...outcome.issueCodes,
					"model-turn-non-evaluable",
					"model-turn-retry-elapsed-budget-exhausted",
				]);
			}
			let elapsedMs: number;
			try {
				elapsedMs = safeInteger(
					await retry.wait({ delayMs, signal: input.signal }),
					"host.retry.elapsedMs",
					{ min: delayMs, max: 86_400_000 },
				);
			} catch {
				if (input.signal.aborted) throw new HostRunFailure("host-cancelled");
				throw new HostRunFailure("model-turn-retry-wait-failed");
			}
			evidence.retryWaitMs = checkedSum(
				evidence.retryWaitMs,
				elapsedMs,
				"model-turn-retry-wait-budget-overflow",
			);
			evidence.retryWaitEvidence.push(
				strictSnapshot({
					stepIndex,
					afterAttemptOrdinal: attemptOrdinal,
					scheduledDelayMs: delayMs,
					elapsedMs,
				}),
			);
			assertNotCancelled(input.signal);
			let remainingAfterWaitMs: number;
			try {
				remainingAfterWaitMs = safeInteger(
					retry.remainingElapsedMs(),
					"host.retry.remainingElapsedMs",
					{ min: 0, max: 86_400_000 },
				);
			} catch {
				throw new HostRunFailure("model-turn-retry-policy-invalid");
			}
			if (remainingAfterWaitMs === 0) {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...outcome.issueCodes,
					"model-turn-non-evaluable",
					"model-turn-retry-elapsed-budget-exhausted",
				]);
			}
		}
		if (outcome === null || outcome.status === "non-evaluable") {
			throw new HostRunFailure("model-turn-retry-outcome-missing");
		}
		if (outcome.finishReason === "structured-output" && outcome.structuredOutput !== null) {
			let workspaceStateDigest: string;
			let workspaceChangeDigest: string;
			try {
				const workspaceEvidence = await assertAllowedWorkspaceDiff(
					workspaceRoot,
					validated,
					baselineSnapshot,
					input.signal,
				);
				workspaceStateDigest = workspaceEvidence.workspaceStateDigest;
				workspaceChangeDigest = workspaceEvidence.workspaceChangeDigest;
			} catch (error) {
				if (error instanceof HostRunFailure) throw error;
				if (input.signal.aborted) throw new HostRunFailure("host-cancelled");
				throw new HostRunFailure("workspace-diff-policy-check-failed");
			}
			evidence.workspaceStateDigest = workspaceStateDigest;
			evidence.workspaceChangeDigest = workspaceChangeDigest;
			let verifierResult: ClosedVerifierResultV1;
			let verifierValue: unknown;
			try {
				verifierValue = await verifier.verify({
					workspace: input.materialization.workspace,
					profileCoordinates: strictSnapshot({
						taskRef: validated.task.taskRef,
						taskDigest: validated.taskDigest,
						verifierProfileRef: validated.profile.verifierProfile.verifierProfileRef,
						verifierProfileRevision: validated.profile.verifierProfile.verifierProfileRevision,
						verifierProfileDigest: validated.task.verifierProfileDigest,
						fixtureSuiteRef: validated.profile.verifierProfile.fixtureSuiteRef,
						fixtureSuiteRevision: validated.profile.verifierProfile.fixtureSuiteRevision,
						fixtureSuiteDigest: validated.profile.verifierProfile.fixtureSuiteDigest,
						harnessRevision: validated.profile.verifierProfile.harnessRevision,
						workspaceStateDigest,
					}),
					signal: input.signal,
				});
				assertNotCancelled(input.signal);
			} catch {
				if (input.signal.aborted) throw new HostRunFailure("host-cancelled");
				throw new HostRunFailure("verifier-execution-failed");
			}
			try {
				verifierResult = validateVerifierResult(verifierValue, validated, workspaceStateDigest);
			} catch {
				throw new HostRunFailure("verifier-result-invalid");
			}
			if (verifierResult.verdict === "unverifiable") {
				return nonEvaluableOutcome(validated.task.taskRef, validated.taskDigest, evidence, [
					...verifierResult.issueCodes,
					"verifier-unverifiable",
				]);
			}
			return strictSnapshot({
				schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.runOutcome,
				status: "completed" as const,
				taskRef: validated.task.taskRef,
				taskDigest: validated.taskDigest,
				logicalStepCount: evidence.logicalStepCount,
				attemptCount: evidence.attemptCount,
				remoteRequests: evidence.remoteRequests,
				retryWaitMs: evidence.retryWaitMs,
				toolActionCount: evidence.toolActionCount,
				hostInputBytes: evidence.hostInputBytes,
				hostOutputBytes: evidence.hostOutputBytes,
				initialRequestDigest: evidence.initialRequestDigest,
				initialMemoryContextRecordDigest: evidence.initialMemoryContextRecordDigest,
				finalOutput: outcome.structuredOutput,
				finalOutputDigest: outcome.structuredOutputDigest,
				verifierVerdict: verifierResult.verdict,
				verifierEvidenceRefs: verifierResult.evidenceRefs,
				workspaceBaselineDigest: evidence.workspaceBaselineDigest,
				workspaceStateDigest,
				workspaceChangeDigest,
				workspaceChanged: workspaceChangeDigest !== empiricalStrictJsonDigest([]),
				turnEvidence: evidence.turnEvidence,
				retryWaitEvidence: evidence.retryWaitEvidence,
				toolEvidence: evidence.toolEvidence,
				actionTrace: evidence.actionTrace,
				issueCodes: verifierResult.issueCodes,
				cleanupSucceeded: false,
			});
		}
		if (outcome.finishReason !== "tool-intents" || outcome.toolIntents.length === 0) {
			throw new HostRunFailure("model-turn-outcome-shape-invalid");
		}
		if (outcome.toolIntents.length > MAX_TOOL_INTENTS_PER_TURN) {
			throw new HostRunFailure("tool-intent-count-exceeded");
		}
		for (const intent of outcome.toolIntents) {
			if (evidence.toolActionCount >= validated.profile.workspaceRecipe.maxToolActions) {
				throw new HostRunFailure("tool-action-budget-exhausted");
			}
			if (seenToolCallRefs.has(intent.toolCallRef)) {
				throw new HostRunFailure("duplicate-tool-call-ref");
			}
			seenToolCallRefs.add(intent.toolCallRef);
			let maximumResultBytes: number;
			try {
				maximumResultBytes = preflightToolResultByteBound(intent, validated, hostDerivedReplace);
			} catch (error) {
				if (error instanceof HostRunFailure) throw error;
				throw new HostRunFailure("tool-execution-invalid");
			}
			if (
				maximumResultBytes >
				validated.profile.workspaceRecipe.maxToolResultBytes - pendingToolResultBytes
			) {
				throw new HostRunFailure("tool-result-byte-budget-exhausted");
			}
			const progress: D682ExecutionProgress | null = hostDerivedReplace
				? strictSnapshot({
						remainingSteps: Math.max(0, maximumTurns - (stepIndex + 1)),
						remainingActions: Math.max(
							0,
							validated.profile.workspaceRecipe.maxToolActions - (evidence.toolActionCount + 1),
						),
						mutationObserved:
							mutationObserved || intent.toolRef === CLOSED_ACTOR_TOOL_REFS.replaceExact,
						diffObserved: diffObserved || intent.toolRef === CLOSED_ACTOR_TOOL_REFS.workspaceDiff,
						commandObserved:
							commandObserved || intent.toolRef === CLOSED_ACTOR_TOOL_REFS.runCommand,
					})
				: null;
			const result = await executeToolIntent(
				workspaceRoot,
				intent,
				validated,
				input.protectionExecutor,
				request,
				input.signal,
				hostDerivedReplace,
				progress,
			);
			mutationObserved = progress?.mutationObserved ?? mutationObserved;
			diffObserved = progress?.diffObserved ?? diffObserved;
			commandObserved = progress?.commandObserved ?? commandObserved;
			pendingToolResultBytes = checkedSum(
				pendingToolResultBytes,
				strictJsonCodec.encode(result.result).byteLength,
				"tool-result-byte-budget-overflow",
			);
			if (pendingToolResultBytes > validated.profile.workspaceRecipe.maxToolResultBytes) {
				throw new HostRunFailure("tool-result-byte-budget-exhausted");
			}
			pendingToolResults.push(result);
			const actionIndex = evidence.toolActionCount;
			evidence.toolActionCount += 1;
			evidence.toolEvidence.push(
				strictSnapshot({
					toolCallRef: result.toolCallRef,
					toolCallRefDigest: empiricalStrictJsonDigest({ toolCallRef: result.toolCallRef }),
					toolRef: result.toolRef,
					resultDigest: result.resultDigest,
				}),
			);
			const action = strictSnapshot({
				stepIndex,
				actionIndex,
				initialRequestDigest: empiricalStrictJsonDigest(initialRequest),
				requestDigest: empiricalStrictJsonDigest(request),
				toolCallRefDigest: empiricalStrictJsonDigest({ toolCallRef: result.toolCallRef }),
				toolRef: result.toolRef,
				intentDigest: empiricalStrictJsonDigest({
					toolRef: intent.toolRef,
					arguments: intent.arguments,
				}),
				resultDigest: result.resultDigest,
				memoryContextRecordDigest: evidence.initialMemoryContextRecordDigest,
			});
			if (actionReceiptObserver !== null) {
				try {
					const observerResult = actionReceiptObserver.record(
						strictSnapshot({
							taskRef: request.taskRef,
							trialBlockRef: request.trialBlockRef,
							trialStage: request.trialStage,
							stepIndex,
							actionIndex,
							toolRef: result.toolRef,
							intentDigest: action.intentDigest,
							resultDigest: result.resultDigest,
							arguments: intent.arguments,
							result: result.result,
						}),
					);
					if (observerResult !== undefined) {
						throw new HostRunFailure("action-receipt-observer-failed");
					}
				} catch {
					throw new HostRunFailure("action-receipt-observer-failed");
				}
			}
			evidence.actionTrace.push(action);
		}
	}
	throw new HostRunFailure("agent-step-budget-exhausted");
}

function initialMemoryContextRecordDigest(
	initialRequest: EmpiricalModelTurnRequestV1,
): string | null {
	const structuredInput = initialRequest.structuredInput;
	if (
		structuredInput === null ||
		typeof structuredInput !== "object" ||
		Array.isArray(structuredInput) ||
		!("memoryContext" in structuredInput)
	) {
		return null;
	}
	const memoryContext = record(structuredInput.memoryContext, "host.initialRequest.memoryContext");
	exactKeys(
		memoryContext,
		["kind", "recordDigest", "revision", "text"],
		"host.initialRequest.memoryContext",
	);
	if (memoryContext.kind !== "agentic-memory-context") {
		throw new HostRunFailure("memory-context-invalid");
	}
	coordinate(memoryContext.revision, "host.initialRequest.memoryContext.revision");
	string(memoryContext.text, "host.initialRequest.memoryContext.text", 64 * 1024);
	return digest(memoryContext.recordDigest, "host.initialRequest.memoryContext.recordDigest");
}

function nextTurnRequest(
	initial: EmpiricalModelTurnRequestV1,
	stepIndex: number,
	priorToolResults: readonly EmpiricalModelToolResultV1[],
	remainingOutputBytes: number,
	frozen: FrozenEmpiricalCampaignManifestV1,
	qualificationReport: EmpiricalTaskQualificationReportV1,
): EmpiricalModelTurnRequestV1 {
	const requestRef = coordinate(
		`${initial.trialBlockRef}:actor-turn:${stepIndex}`,
		"host.nextTurn.requestRef",
	);
	return validateEmpiricalModelTurnRequest(
		{
			...initial,
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request,
			requestRef,
			stepIndex,
			priorToolResults,
			remainingTurnBudget: {
				maxOutputTokens: initial.remainingTurnBudget.maxOutputTokens,
				maxOutputBytes: remainingOutputBytes,
			},
		},
		frozen,
		qualificationReport,
	);
}

function preflightToolResultByteBound(
	intent: EmpiricalModelToolIntentV1,
	validated: ValidatedTaskProfile,
	hostDerivedReplace: boolean,
): number {
	const payloadBound = preflightToolPayloadByteBound(intent, validated, hostDerivedReplace);
	return hostDerivedReplace
		? checkedSum(
				payloadBound,
				D682_PROGRESS_MAX_CANONICAL_BYTES,
				"tool-result-byte-budget-overflow",
			)
		: payloadBound;
}

function preflightToolPayloadByteBound(
	intent: EmpiricalModelToolIntentV1,
	validated: ValidatedTaskProfile,
	hostDerivedReplace: boolean,
): number {
	switch (intent.toolRef) {
		case CLOSED_ACTOR_TOOL_REFS.readFile: {
			const args = exactArguments(intent.arguments, ["path"], "tool.readFile");
			allowedReadablePath(args.path, validated, "tool.readFile.path");
			return 1_024 + validated.profile.workspaceRecipe.maxFileBytes * 6;
		}
		case CLOSED_ACTOR_TOOL_REFS.searchLiteral: {
			const args = exactArguments(
				intent.arguments,
				["maxMatches", "path", "query"],
				"tool.searchLiteral",
			);
			allowedReadablePath(args.path, validated, "tool.searchLiteral.path");
			string(args.query, "tool.searchLiteral.query", MAX_LITERAL_CODE_UNITS);
			const maxMatches = safeInteger(args.maxMatches, "tool.searchLiteral.maxMatches", {
				min: 1,
				max: validated.profile.workspaceRecipe.maxSearchMatches,
			});
			return 1_024 + maxMatches * 128;
		}
		case CLOSED_ACTOR_TOOL_REFS.replaceExact: {
			const args = exactArguments(
				intent.arguments,
				hostDerivedReplace
					? ["newText", "oldText", "path"]
					: ["baseContentDigest", "newText", "oldText", "path"],
				"tool.replaceExact",
			);
			allowedWritablePath(args.path, validated, "tool.replaceExact.path");
			if (!hostDerivedReplace) {
				digest(args.baseContentDigest, "tool.replaceExact.baseContentDigest");
			}
			string(args.oldText, "tool.replaceExact.oldText", MAX_LITERAL_CODE_UNITS);
			if (typeof args.newText !== "string" || args.newText.length > MAX_LITERAL_CODE_UNITS) {
				fail("tool.replaceExact.newText", "expected a bounded string");
			}
			return 1_024;
		}
		case CLOSED_ACTOR_TOOL_REFS.workspaceDiff:
			exactArguments(intent.arguments, [], "tool.workspaceDiff");
			return 1_024 + validated.profile.workspaceRecipe.maxDiffBytes * 6;
		case CLOSED_ACTOR_TOOL_REFS.runCommand: {
			const args = exactArguments(intent.arguments, ["commandRef"], "tool.runCommand");
			const commandRef = coordinate(args.commandRef, "tool.runCommand.commandRef");
			const command = validated.commandByRef.get(commandRef);
			if (command === undefined) throw new HostRunFailure("command-ref-not-allowed");
			return 2_048 + (command.maxStdoutBytes + command.maxStderrBytes) * 6;
		}
		default:
			throw new HostRunFailure("unsupported-tool-ref");
	}
}

async function executeToolIntent(
	workspaceRoot: string,
	intent: EmpiricalModelToolIntentV1,
	validated: ValidatedTaskProfile,
	protectionExecutor: EmpiricalExactPrivateNeedleProtectionExecutorV1,
	request: EmpiricalModelTurnRequestV1,
	signal: AbortSignal,
	hostDerivedReplace: boolean,
	progress: D682ExecutionProgress | null,
): Promise<EmpiricalModelToolResultV1> {
	assertNotCancelled(signal);
	let result: StrictJsonValue;
	try {
		switch (intent.toolRef) {
			case CLOSED_ACTOR_TOOL_REFS.readFile:
				result = await readFileTool(workspaceRoot, intent.arguments, validated, signal);
				break;
			case CLOSED_ACTOR_TOOL_REFS.searchLiteral:
				result = await searchLiteralTool(workspaceRoot, intent.arguments, validated, signal);
				break;
			case CLOSED_ACTOR_TOOL_REFS.replaceExact:
				result = await replaceExactTool(
					workspaceRoot,
					intent.arguments,
					validated,
					signal,
					hostDerivedReplace,
				);
				break;
			case CLOSED_ACTOR_TOOL_REFS.workspaceDiff:
				result = await workspaceDiffTool(workspaceRoot, intent.arguments, validated, signal);
				break;
			case CLOSED_ACTOR_TOOL_REFS.runCommand:
				result = await runCommandTool(workspaceRoot, intent.arguments, validated, signal);
				break;
			default:
				throw new HostRunFailure("unsupported-tool-ref");
		}
	} catch (error) {
		if (error instanceof HostRunFailure) throw error;
		if (signal.aborted) throw new HostRunFailure("host-cancelled");
		throw new HostRunFailure("tool-execution-invalid");
	}
	if (progress !== null) result = strictSnapshot({ ...record(result, "tool.result"), progress });
	const resultBytes = strictJsonCodec.encode(result);
	if (resultBytes.byteLength > validated.profile.workspaceRecipe.maxToolResultBytes) {
		throw new HostRunFailure("tool-result-byte-budget-exhausted");
	}
	const protection = executeEmpiricalProtection(protectionExecutor, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "tool-ingress",
		subject: result,
	});
	if (protection.receipt.disposition !== "allowed") {
		throw new HostRunFailure(
			protection.issueCode === null
				? "tool-result-protection-blocked"
				: "tool-result-protection-failed",
		);
	}
	const resultDigest = empiricalStrictJsonDigest(result);
	if (protection.subjectDigest !== resultDigest) {
		throw new HostRunFailure("tool-result-protection-digest-mismatch");
	}
	return strictSnapshot({
		toolCallRef: intent.toolCallRef,
		toolRef: intent.toolRef,
		resultDigest,
		result,
		protectionReceipt: protection.receipt,
	});
}

async function readFileTool(
	workspaceRoot: string,
	value: StrictJsonValue,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
): Promise<StrictJsonValue> {
	const args = exactArguments(value, ["path"], "tool.readFile");
	const path = allowedReadablePath(args.path, validated, "tool.readFile.path");
	const bytes = await readBoundedRegularFile(workspaceRoot, path, validated, signal);
	const content = decodeUtf8(bytes, "tool.readFile.content");
	return strictSnapshot({
		kind: "read-file",
		path,
		byteLength: bytes.byteLength,
		contentDigest: empiricalSha256(bytes),
		content,
	});
}

async function searchLiteralTool(
	workspaceRoot: string,
	value: StrictJsonValue,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
): Promise<StrictJsonValue> {
	const args = exactArguments(value, ["maxMatches", "path", "query"], "tool.searchLiteral");
	const path = allowedReadablePath(args.path, validated, "tool.searchLiteral.path");
	const query = string(args.query, "tool.searchLiteral.query", MAX_LITERAL_CODE_UNITS);
	const maxMatches = safeInteger(args.maxMatches, "tool.searchLiteral.maxMatches", {
		min: 1,
		max: validated.profile.workspaceRecipe.maxSearchMatches,
	});
	const bytes = await readBoundedRegularFile(workspaceRoot, path, validated, signal);
	const content = decodeUtf8(bytes, "tool.searchLiteral.content");
	const matches: Array<{ readonly index: number; readonly line: number; readonly column: number }> =
		[];
	let cursor = 0;
	let scanned = 0;
	let line = 1;
	let column = 1;
	while (matches.length < maxMatches) {
		const index = content.indexOf(query, cursor);
		if (index < 0) break;
		while (scanned < index) {
			if (content.charCodeAt(scanned) === 10) {
				line += 1;
				column = 1;
			} else {
				column += 1;
			}
			scanned += 1;
		}
		matches.push({ index, line, column });
		cursor = index + query.length;
	}
	return strictSnapshot({
		kind: "search-literal",
		path,
		queryDigest: empiricalSha256(textEncoder.encode(query)),
		truncated: content.indexOf(query, cursor) >= 0,
		matches,
	});
}

async function replaceExactTool(
	workspaceRoot: string,
	value: StrictJsonValue,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
	hostDerivedReplace: boolean,
): Promise<StrictJsonValue> {
	const args = exactArguments(
		value,
		hostDerivedReplace
			? ["newText", "oldText", "path"]
			: ["baseContentDigest", "newText", "oldText", "path"],
		"tool.replaceExact",
	);
	const path = allowedWritablePath(args.path, validated, "tool.replaceExact.path");
	const oldText = string(args.oldText, "tool.replaceExact.oldText", MAX_LITERAL_CODE_UNITS);
	const newText =
		typeof args.newText === "string" && args.newText.length <= MAX_LITERAL_CODE_UNITS
			? args.newText
			: fail("tool.replaceExact.newText", "expected a bounded string");
	const target = await containedRegularFile(workspaceRoot, path);
	const bytes = await readFile(target);
	const currentContentDigest = empiricalSha256(bytes);
	const suppliedBaseContentDigest = hostDerivedReplace
		? currentContentDigest
		: digest(args.baseContentDigest, "tool.replaceExact.baseContentDigest");
	if (bytes.byteLength > validated.profile.workspaceRecipe.maxFileBytes) {
		throw new HostRunFailure("workspace-file-byte-budget-exhausted");
	}
	if (!hostDerivedReplace && currentContentDigest !== suppliedBaseContentDigest) {
		throw new HostRunFailure("stale-base-content-digest");
	}
	const content = decodeUtf8(bytes, "tool.replaceExact.content");
	const first = content.indexOf(oldText);
	if (first < 0 || content.indexOf(oldText, first + 1) >= 0) {
		throw new HostRunFailure("exact-replacement-match-count-invalid");
	}
	const nextContent = `${content.slice(0, first)}${newText}${content.slice(first + oldText.length)}`;
	const nextBytes = textEncoder.encode(nextContent);
	if (nextBytes.byteLength > validated.profile.workspaceRecipe.maxFileBytes) {
		throw new HostRunFailure("replacement-file-byte-budget-exhausted");
	}
	assertNotCancelled(signal);
	await writeFile(target, nextBytes, { flag: "w" });
	const rule = validated.writableFiles.get(path) as ClosedWorkspaceFileRuleV1;
	await chmod(target, rule.mode === "100755" ? 0o755 : 0o644);
	assertNotCancelled(signal);
	return strictSnapshot({
		kind: "replace-exact",
		path,
		previousContentDigest: currentContentDigest,
		nextContentDigest: empiricalSha256(nextBytes),
		replacements: 1,
	});
}

async function workspaceDiffTool(
	workspaceRoot: string,
	value: StrictJsonValue,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
): Promise<StrictJsonValue> {
	exactArguments(value, [], "tool.workspaceDiff");
	const process = await runProcess(
		workspaceRoot,
		"/usr/bin/git",
		["diff", "--no-ext-diff", "--no-color", "--no-renames", "--"],
		validated.profile.workspaceRecipe.maxDiffBytes,
		64 * 1024,
		signal,
	);
	if (process.exitCode !== 0) throw new HostRunFailure("workspace-diff-command-failed");
	const diff = decodeUtf8(process.stdout, "tool.workspaceDiff.output");
	return strictSnapshot({
		kind: "workspace-diff",
		diff,
		byteLength: process.stdout.byteLength,
		diffDigest: empiricalSha256(process.stdout),
	});
}

async function runCommandTool(
	workspaceRoot: string,
	value: StrictJsonValue,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
): Promise<StrictJsonValue> {
	const args = exactArguments(value, ["commandRef"], "tool.runCommand");
	const commandRef = coordinate(args.commandRef, "tool.runCommand.commandRef");
	const command = validated.commandByRef.get(commandRef);
	if (command === undefined) throw new HostRunFailure("command-ref-not-allowed");
	const process = await runProcess(
		workspaceRoot,
		command.executable,
		command.argv,
		command.maxStdoutBytes,
		command.maxStderrBytes,
		signal,
	);
	if (process.exitCode !== 0) throw new HostRunFailure("command-nonzero-exit");
	const stdout = decodeUtf8(process.stdout, "tool.runCommand.stdout");
	const stderr = decodeUtf8(process.stderr, "tool.runCommand.stderr");
	return strictSnapshot({
		kind: "run-command-ref",
		commandRef,
		exitCode: process.exitCode,
		stdout,
		stderr,
		stdoutDigest: empiricalSha256(process.stdout),
		stderrDigest: empiricalSha256(process.stderr),
	});
}

async function assertAllowedWorkspaceDiff(
	workspaceRoot: string,
	validated: ValidatedTaskProfile,
	baselineSnapshot: WorkspaceSnapshot,
	signal: AbortSignal,
): Promise<{
	readonly workspaceStateDigest: string;
	readonly workspaceChangeDigest: string;
}> {
	const process = await runProcess(
		workspaceRoot,
		"/usr/bin/git",
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		validated.profile.workspaceRecipe.maxDiffBytes,
		64 * 1024,
		signal,
	);
	if (process.exitCode !== 0 || process.stderr.byteLength !== 0) {
		throw new HostRunFailure("workspace-diff-policy-check-failed");
	}
	const status = decodeUtf8(process.stdout, "host.workspaceStatus");
	const entries = status === "" ? [] : status.split("\0").filter((entry) => entry !== "");
	for (const entry of entries) {
		if (entry.length < 4 || entry.slice(0, 3) !== " M ") {
			throw new HostRunFailure("out-of-policy-workspace-diff");
		}
		const path = assertPortableRepositoryPath(entry.slice(3), "host.workspaceStatus.path");
		const rule = validated.writableFiles.get(path);
		if (rule === undefined) throw new HostRunFailure("out-of-policy-workspace-diff");
		const target = await containedRegularFile(workspaceRoot, path);
		const metadata = await lstat(target);
		if ((metadata.mode & 0o7777) !== (rule.mode === "100755" ? 0o755 : 0o644)) {
			throw new HostRunFailure("out-of-policy-workspace-mode");
		}
	}
	await normalizeWorkspaceIndex(workspaceRoot, signal);
	const finalSnapshot = await captureWorkspaceSnapshot(workspaceRoot, signal);
	assertWorkspaceSnapshotDifference(baselineSnapshot, finalSnapshot, validated);
	return Object.freeze({
		workspaceStateDigest: workspaceSnapshotDigest(finalSnapshot),
		workspaceChangeDigest: workspaceSnapshotDifferenceDigest(baselineSnapshot, finalSnapshot),
	});
}

async function normalizeWorkspaceIndex(workspaceRoot: string, signal: AbortSignal): Promise<void> {
	const indexPath = join(workspaceRoot, ".git", "index");
	const metadata = await lstat(indexPath).catch(() => {
		throw new HostRunFailure("workspace-index-normalization-failed");
	});
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new HostRunFailure("workspace-index-normalization-failed");
	}
	await unlink(indexPath);
	const process = await runProcess(
		workspaceRoot,
		"/usr/bin/git",
		["read-tree", "--reset", "HEAD"],
		64 * 1024,
		64 * 1024,
		signal,
	);
	if (
		process.exitCode !== 0 ||
		process.stdout.byteLength !== 0 ||
		process.stderr.byteLength !== 0
	) {
		throw new HostRunFailure("workspace-index-normalization-failed");
	}
}

async function captureWorkspaceSnapshot(
	workspaceRoot: string,
	signal: AbortSignal,
): Promise<WorkspaceSnapshot> {
	// D659 closes deterministic evidence for a trusted repository run. This snapshot is not
	// containment against a hostile same-UID process racing the host or escaping its process group.
	const entries = new Map<string, WorkspaceSnapshotEntry>();
	let totalBytes = 0;
	const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
		assertNotCancelled(signal);
		const children = await readdir(absoluteDirectory, { withFileTypes: true });
		children.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
		for (const child of children) {
			assertNotCancelled(signal);
			const path = relativeDirectory === "" ? child.name : `${relativeDirectory}/${child.name}`;
			const absolutePath = join(absoluteDirectory, child.name);
			const metadata = await lstat(absolutePath);
			if (entries.size >= MAX_WORKSPACE_SNAPSHOT_ENTRIES || metadata.isSymbolicLink()) {
				throw new HostRunFailure("workspace-snapshot-closure-invalid");
			}
			const mode = metadata.mode & 0o7777;
			if (metadata.isDirectory()) {
				entries.set(path, Object.freeze({ kind: "directory", mode }));
				await visit(absolutePath, path);
				continue;
			}
			if (!metadata.isFile()) {
				throw new HostRunFailure("workspace-snapshot-closure-invalid");
			}
			totalBytes += metadata.size;
			if (
				!Number.isSafeInteger(totalBytes) ||
				totalBytes > MAX_WORKSPACE_SNAPSHOT_BYTES ||
				metadata.size > MAX_WORKSPACE_SNAPSHOT_BYTES
			) {
				throw new HostRunFailure("workspace-snapshot-byte-budget-exhausted");
			}
			const bytes = new Uint8Array(await readFile(absolutePath));
			assertNotCancelled(signal);
			entries.set(
				path,
				Object.freeze({
					kind: "file",
					mode,
					byteLength: bytes.byteLength,
					digest: empiricalSha256(bytes),
				}),
			);
		}
	};
	await visit(workspaceRoot, "");
	return Object.freeze({ entries });
}

function assertSnapshotMatchesProfileBaseline(
	snapshot: WorkspaceSnapshot,
	validated: ValidatedTaskProfile,
): void {
	for (const path of validated.readableFiles) {
		const entry = snapshot.entries.get(path);
		if (
			entry === undefined ||
			entry.kind !== "file" ||
			entry.byteLength > validated.profile.workspaceRecipe.maxFileBytes
		) {
			throw new HostRunFailure("workspace-profile-baseline-mismatch");
		}
	}
}

function assertWorkspaceSnapshotDifference(
	baselineSnapshot: WorkspaceSnapshot,
	finalSnapshot: WorkspaceSnapshot,
	validated: ValidatedTaskProfile,
): void {
	if (finalSnapshot.entries.size !== baselineSnapshot.entries.size) {
		throw new HostRunFailure("out-of-policy-workspace-diff");
	}
	for (const [path, baselineEntry] of baselineSnapshot.entries) {
		const finalEntry = finalSnapshot.entries.get(path);
		if (finalEntry === undefined || finalEntry.kind !== baselineEntry.kind) {
			throw new HostRunFailure("out-of-policy-workspace-diff");
		}
		const writableRule = validated.writableFiles.get(path);
		if (writableRule !== undefined) {
			if (
				finalEntry.kind !== "file" ||
				finalEntry.byteLength > validated.profile.workspaceRecipe.maxFileBytes ||
				finalEntry.mode !== (writableRule.mode === "100755" ? 0o755 : 0o644)
			) {
				throw new HostRunFailure("out-of-policy-workspace-mode");
			}
			continue;
		}
		if (
			finalEntry.mode !== baselineEntry.mode ||
			(finalEntry.kind === "file" &&
				baselineEntry.kind === "file" &&
				(finalEntry.byteLength !== baselineEntry.byteLength ||
					finalEntry.digest !== baselineEntry.digest))
		) {
			throw new HostRunFailure("out-of-policy-workspace-diff");
		}
	}
}

function workspaceSnapshotDigest(snapshot: WorkspaceSnapshot): string {
	return empiricalStrictJsonDigest(
		[...snapshot.entries].map(([path, entry]) =>
			entry.kind === "directory"
				? { path, kind: entry.kind, mode: entry.mode }
				: {
						path,
						kind: entry.kind,
						mode: entry.mode,
						byteLength: entry.byteLength,
						digest: entry.digest,
					},
		),
	);
}

function workspaceSnapshotDifferenceDigest(
	baseline: WorkspaceSnapshot,
	final: WorkspaceSnapshot,
): string {
	const entryProjection = (entry: WorkspaceSnapshotEntry): StrictJsonValue =>
		entry.kind === "directory"
			? { kind: entry.kind, mode: entry.mode }
			: {
					kind: entry.kind,
					mode: entry.mode,
					byteLength: entry.byteLength,
					digest: entry.digest,
				};
	const changes: StrictJsonValue[] = [];
	for (const [path, baselineEntry] of baseline.entries) {
		const finalEntry = final.entries.get(path);
		if (
			finalEntry !== undefined &&
			empiricalStrictJsonDigest(entryProjection(baselineEntry)) !==
				empiricalStrictJsonDigest(entryProjection(finalEntry))
		) {
			changes.push({
				path,
				before: entryProjection(baselineEntry),
				after: entryProjection(finalEntry),
			});
		}
	}
	return empiricalStrictJsonDigest(changes);
}

function validateVerifierResult(
	value: unknown,
	validated: ValidatedTaskProfile,
	workspaceStateDigest: string,
): ClosedVerifierResultV1 {
	const result = record(value, "host.verifier.result");
	exactKeys(
		result,
		["evidenceRefs", "issueCodes", "schemaVersion", "verdict"],
		"host.verifier.result",
	);
	if (result.schemaVersion !== CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult) {
		fail("host.verifier.result.schemaVersion", "unexpected schema");
	}
	const refs = array(result.evidenceRefs, "host.verifier.result.evidenceRefs");
	if (refs.length < 1 || refs.length > MAX_EVIDENCE_REFS) {
		fail("host.verifier.result.evidenceRefs", "expected a bounded non-empty evidence set");
	}
	const evidenceRefs = refs.map((entry, index) => {
		const path = `host.verifier.result.evidenceRefs[${index}]`;
		const ref = record(entry, path);
		exactKeys(
			ref,
			[
				"digest",
				"fixtureSuiteDigest",
				"harnessRevision",
				"id",
				"kind",
				"taskDigest",
				"taskRef",
				"verifierProfileDigest",
				"verifierProfileRef",
				"workspaceStateDigest",
			],
			path,
		);
		const evidence = strictSnapshot({
			kind: oneOf(ref.kind, ["target-verification"] as const, `${path}.kind`),
			id: coordinate(ref.id, `${path}.id`),
			digest: digest(ref.digest, `${path}.digest`),
			taskRef: coordinate(ref.taskRef, `${path}.taskRef`),
			taskDigest: digest(ref.taskDigest, `${path}.taskDigest`),
			verifierProfileRef: coordinate(ref.verifierProfileRef, `${path}.verifierProfileRef`),
			verifierProfileDigest: digest(ref.verifierProfileDigest, `${path}.verifierProfileDigest`),
			fixtureSuiteDigest: digest(ref.fixtureSuiteDigest, `${path}.fixtureSuiteDigest`),
			workspaceStateDigest: digest(ref.workspaceStateDigest, `${path}.workspaceStateDigest`),
			harnessRevision: coordinate(ref.harnessRevision, `${path}.harnessRevision`),
		});
		if (
			evidence.taskRef !== validated.task.taskRef ||
			evidence.taskDigest !== validated.taskDigest ||
			evidence.verifierProfileRef !== validated.profile.verifierProfile.verifierProfileRef ||
			evidence.verifierProfileDigest !== validated.task.verifierProfileDigest ||
			evidence.fixtureSuiteDigest !== validated.profile.verifierProfile.fixtureSuiteDigest ||
			evidence.harnessRevision !== validated.profile.verifierProfile.harnessRevision ||
			evidence.workspaceStateDigest !== workspaceStateDigest
		) {
			fail(path, "does not bind the exact target workspace and verifier coordinates");
		}
		return evidence;
	});
	if (
		new Set(evidenceRefs.map((evidence) => `${evidence.kind}\0${evidence.id}`)).size !==
		evidenceRefs.length
	) {
		fail("host.verifier.result.evidenceRefs", "evidence identities must be unique");
	}
	const issueCodes = sortedCoordinates(result.issueCodes, "host.verifier.result.issueCodes", 0, 32);
	const verdict = oneOf(
		result.verdict,
		["passed", "failed", "unverifiable"] as const,
		"host.verifier.result.verdict",
	);
	if (
		(verdict === "passed" && issueCodes.length !== 0) ||
		(verdict !== "passed" && issueCodes.length === 0)
	) {
		fail("host.verifier.result", "verdict and issueCodes are inconsistent");
	}
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.verifierResult,
		verdict,
		evidenceRefs,
		issueCodes,
	});
}

async function readBoundedRegularFile(
	workspaceRoot: string,
	path: string,
	validated: ValidatedTaskProfile,
	signal: AbortSignal,
): Promise<Uint8Array> {
	assertNotCancelled(signal);
	const target = await containedRegularFile(workspaceRoot, path);
	const bytes = new Uint8Array(await readFile(target));
	if (bytes.byteLength > validated.profile.workspaceRecipe.maxFileBytes) {
		throw new HostRunFailure("file-byte-budget-exhausted");
	}
	assertNotCancelled(signal);
	return bytes;
}

async function containedRegularFile(workspaceRoot: string, path: string): Promise<string> {
	const target = join(workspaceRoot, ...path.split("/"));
	const targetMetadata = await lstat(target).catch(() => {
		throw new HostRunFailure("workspace-path-missing");
	});
	if (!targetMetadata.isFile() || targetMetadata.isSymbolicLink()) {
		throw new HostRunFailure("workspace-path-not-regular-file");
	}
	const resolvedTarget = await realpath(target).catch(() => {
		throw new HostRunFailure("workspace-path-missing");
	});
	if (!isSameOrDescendant(workspaceRoot, resolvedTarget) || resolvedTarget === workspaceRoot) {
		throw new HostRunFailure("workspace-path-outside-root");
	}
	const metadata = await lstat(resolvedTarget);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new HostRunFailure("workspace-path-not-regular-file");
	}
	return resolvedTarget;
}

async function validateWorkspaceRoot(rootPath: string): Promise<string> {
	if (sep !== "/" || typeof rootPath !== "string" || !isAbsolute(rootPath)) {
		throw new HostRunFailure("unsupported-host-platform");
	}
	const suppliedMetadata = await lstat(rootPath).catch(() => {
		throw new HostRunFailure("workspace-root-invalid");
	});
	if (!suppliedMetadata.isDirectory() || suppliedMetadata.isSymbolicLink()) {
		throw new HostRunFailure("workspace-root-invalid");
	}
	const resolvedRoot = await realpath(rootPath);
	const metadata = await lstat(resolvedRoot);
	if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
		throw new HostRunFailure("workspace-root-invalid");
	}
	return resolvedRoot;
}

function allowedReadablePath(
	value: unknown,
	validated: ValidatedTaskProfile,
	path: string,
): string {
	const portablePath = assertPortableRepositoryPath(value, path);
	if (!validated.readableFiles.has(portablePath)) throw new HostRunFailure("read-path-not-allowed");
	return portablePath;
}

function allowedWritablePath(
	value: unknown,
	validated: ValidatedTaskProfile,
	path: string,
): string {
	const portablePath = assertPortableRepositoryPath(value, path);
	if (!validated.writableFiles.has(portablePath)) {
		throw new HostRunFailure("write-path-not-allowed");
	}
	return portablePath;
}

function exactArguments(
	value: StrictJsonValue,
	keys: readonly string[],
	path: string,
): Record<string, unknown> {
	const args = record(value, path);
	exactKeys(args, keys, path);
	return args;
}

function sortedPortablePaths(value: unknown, path: string): readonly string[] {
	const values = array(value, path);
	if (values.length < 1 || values.length > MAX_PROFILE_FILES) {
		fail(path, "expected a bounded non-empty file list");
	}
	const paths = values.map((entry, index) =>
		assertPortableRepositoryPath(entry, `${path}[${index}]`),
	);
	assertSortedUnique(paths, path);
	return Object.freeze(paths);
}

function sortedCoordinates(
	value: unknown,
	path: string,
	minimum: number,
	maximum: number,
): readonly string[] {
	const values = array(value, path);
	if (values.length < minimum || values.length > maximum) {
		fail(path, `expected between ${minimum} and ${maximum} coordinates`);
	}
	const coordinates = values.map((entry, index) => coordinate(entry, `${path}[${index}]`));
	assertSortedUnique(coordinates, path);
	return Object.freeze(coordinates);
}

function assertSortedUnique(values: readonly string[], path: string): void {
	for (let index = 0; index < values.length; index += 1) {
		if (index > 0 && values[index - 1] >= values[index]) {
			fail(path, "expected unique byte-sorted values");
		}
	}
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
	try {
		return textDecoder.decode(bytes);
	} catch {
		throw new HostRunFailure(`${path}-invalid-utf8`);
	}
}

function classifyModelOutcomeValidationFailure(error: unknown): string {
	const message = error instanceof TypeError ? error.message : "";
	if (message.includes("exceeds the remaining output")) {
		return "model-turn-output-budget-exhausted";
	}
	if (message.includes("outcome.toolIntents") || message.includes(".arguments")) {
		return "model-turn-tool-intent-invalid";
	}
	return "model-turn-outcome-invalid";
}

function assertNotCancelled(signal: AbortSignal): void {
	if (signal.aborted) throw new HostRunFailure("host-cancelled");
}

function checkedSum(left: number, right: number, issueCode: string): number {
	const sum = left + right;
	if (!Number.isSafeInteger(sum) || sum < 0) throw new HostRunFailure(issueCode);
	return sum;
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const relativePath = relative(parent, candidate);
	return relativePath === "" || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`));
}

function emptyEvidence(): MutableRunEvidence {
	return {
		logicalStepCount: 0,
		attemptCount: 0,
		remoteRequests: 0,
		retryWaitMs: 0,
		toolActionCount: 0,
		hostInputBytes: 0,
		hostOutputBytes: 0,
		initialRequestDigest: null,
		initialMemoryContextRecordDigest: null,
		workspaceBaselineDigest: null,
		workspaceStateDigest: null,
		workspaceChangeDigest: null,
		turnEvidence: [],
		retryWaitEvidence: [],
		toolEvidence: [],
		actionTrace: [],
	};
}

function nonEvaluableOutcome(
	taskRef: string,
	taskDigest: string,
	evidence: MutableRunEvidence,
	issueCodes: readonly string[],
): ClosedTaskProfileHostRunOutcomeV3 {
	return strictSnapshot({
		schemaVersion: CLOSED_TASK_PROFILE_HOST_SCHEMAS.runOutcome,
		status: "non-evaluable" as const,
		taskRef,
		taskDigest,
		logicalStepCount: evidence.logicalStepCount,
		attemptCount: evidence.attemptCount,
		remoteRequests: evidence.remoteRequests,
		retryWaitMs: evidence.retryWaitMs,
		toolActionCount: evidence.toolActionCount,
		hostInputBytes: evidence.hostInputBytes,
		hostOutputBytes: evidence.hostOutputBytes,
		initialRequestDigest: evidence.initialRequestDigest,
		initialMemoryContextRecordDigest: evidence.initialMemoryContextRecordDigest,
		finalOutput: null,
		finalOutputDigest: null,
		verifierVerdict: null,
		verifierEvidenceRefs: [],
		workspaceBaselineDigest: evidence.workspaceBaselineDigest,
		workspaceStateDigest: evidence.workspaceStateDigest,
		workspaceChangeDigest: evidence.workspaceChangeDigest,
		workspaceChanged:
			evidence.workspaceChangeDigest === null
				? null
				: evidence.workspaceChangeDigest !== empiricalStrictJsonDigest([]),
		turnEvidence: evidence.turnEvidence,
		retryWaitEvidence: evidence.retryWaitEvidence,
		toolEvidence: evidence.toolEvidence,
		actionTrace: evidence.actionTrace,
		issueCodes: sortedIssueCodes(issueCodes),
		cleanupSucceeded: false,
	});
}

function sortedIssueCodes(value: readonly string[]): readonly string[] {
	return Object.freeze([...new Set(value)].sort());
}

function runProcess(
	workspaceRoot: string,
	executable: string,
	argv: readonly string[],
	maxStdoutBytes: number,
	maxStderrBytes: number,
	signal: AbortSignal,
): Promise<ProcessResult> {
	assertNotCancelled(signal);
	return new Promise((resolveResult, rejectResult) => {
		let settled = false;
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let overflow = false;
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		const child = spawn(executable, [...argv], {
			cwd: workspaceRoot,
			detached: true,
			env: FIXED_COMMAND_ENV,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		const killProcessGroup = (): void => {
			if (child.pid !== undefined) {
				try {
					process.kill(-child.pid, "SIGKILL");
					return;
				} catch {
					// The process group may already have exited.
				}
			}
			child.kill("SIGKILL");
		};
		const abort = (): void => killProcessGroup();
		signal.addEventListener("abort", abort, { once: true });
		if (signal.aborted) abort();
		const finish = (): void => {
			signal.removeEventListener("abort", abort);
		};
		const rejectOnce = (issueCode: string): void => {
			if (settled) return;
			settled = true;
			finish();
			rejectResult(new HostRunFailure(issueCode));
		};
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > maxStdoutBytes) {
				overflow = true;
				killProcessGroup();
				return;
			}
			stdout.push(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.byteLength;
			if (stderrBytes > maxStderrBytes) {
				overflow = true;
				killProcessGroup();
				return;
			}
			stderr.push(chunk);
		});
		child.on("error", () =>
			rejectOnce(signal.aborted ? "host-cancelled" : "command-driver-failed"),
		);
		child.on("exit", () => killProcessGroup());
		child.on("close", (code) => {
			if (settled) return;
			if (signal.aborted) {
				rejectOnce("host-cancelled");
				return;
			}
			if (overflow) {
				rejectOnce("command-output-overflow");
				return;
			}
			if (!Number.isSafeInteger(code) || (code as number) < 0 || (code as number) > 255) {
				rejectOnce("command-exit-invalid");
				return;
			}
			settled = true;
			finish();
			resolveResult(
				Object.freeze({
					exitCode: code as number,
					stdout: new Uint8Array(Buffer.concat(stdout)),
					stderr: new Uint8Array(Buffer.concat(stderr)),
				}),
			);
		});
	});
}
