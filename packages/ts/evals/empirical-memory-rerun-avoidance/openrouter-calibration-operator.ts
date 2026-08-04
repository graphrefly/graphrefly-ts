import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { empiricalStrictJsonDigest } from "./canonical.js";
import type {
	EmpiricalTaskQualificationReportV1,
	FrozenEmpiricalCampaignManifestV1,
} from "./contracts.js";
import {
	B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION,
	type B112CalibrationEmpiricalRunInputV4,
	createB112CalibrationTrialBlockIdentity,
	runB112EmpiricalCalibration,
} from "./empirical-calibration.js";
import { createEmpiricalExactPrivateNeedleProtectionExecutor } from "./exact-private-needle-protection.js";
import {
	createOpenRouterCalibrationEmpiricalRunner,
	createOpenRouterCredentialCapabilityFromOperatorEnvironment,
	type OpenRouterCalibrationPreparedTrialBlockV4,
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
} from "./openrouter-first-task-smoke.js";
import {
	readOpenRouterSmokeOperatorMonotonicMs,
	waitOpenRouterSmokeRetryDelay,
} from "./openrouter-first-task-smoke-operator.js";
import { createOpenRouterResponsesFetchByteTransport } from "./openrouter-responses-byte-transport.js";
import type {
	OpenRouterResponsesByteTransportV1,
	OpenRouterResponsesCredentialCapabilityV1,
	OpenRouterResponsesMonotonicMeasurementV1,
} from "./openrouter-responses-model-turn.js";
import {
	OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG,
	OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION,
	OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE,
	OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL,
	type QualifiedOpenRouterRouteV1,
	validateOperatorSuppliedOpenRouterRouteQualification,
} from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateCalibrationGenerationV4,
	persistPrivateCalibrationGeneration,
} from "./private-smoke-persistence.js";
import { validateFrozenEmpiricalCampaignManifest } from "./qualification.js";

export const B112_D678_CALIBRATION_BLOCK_COUNT = 15;
export const B112_D678_BLOCK_MAX_COST_MICROUSD = 3_000_000;
export const B112_D679_TASK_MAX_COST_MICROUSD = 3_600_000;
export const B112_D678_CAMPAIGN_MAX_COST_MICROUSD = 18_000_000;
export const B112_D678_BLOCK_MAX_REQUESTS = 192;
export const B112_D678_TASK_MAX_REQUESTS = 576;
export const B112_D678_CAMPAIGN_MAX_REQUESTS = 2_880;
export const B112_D678_BLOCK_MAX_LATENCY_MS = 4_800_000;
export const B112_D678_CAMPAIGN_MAX_ELAPSED_MS = 72_000_000;
export const B112_D678_BLOCK_MAX_INPUT_TOKENS = 8_000_000;
export const B112_D678_BLOCK_MAX_OUTPUT_TOKENS = 1_048_576;
export const B112_D678_MAX_CANONICAL_REQUEST_BYTES = 262_144;
export const B112_D678_AGENT_MAX_STEPS = 32;

export interface OpenRouterCalibrationOperatorInputV1 {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly routeQualifications: readonly unknown[];
	readonly prepareTrialBlock: (
		input: B112CalibrationEmpiricalRunInputV4,
	) => Promise<OpenRouterCalibrationPrivateTrialBlockV1>;
	readonly privateRoot: string;
	readonly generationRef: string;
}

export type OpenRouterCalibrationPrivateTrialBlockV1 = Pick<
	OpenRouterCalibrationPreparedTrialBlockV4,
	"host" | "prepareWarmHost"
>;

export interface OpenRouterCalibrationOperatorInputModuleV1 {
	createOperatorInput(): Promise<OpenRouterCalibrationOperatorInputV1>;
}

export interface OpenRouterCalibrationOperatorResultV4 {
	readonly terminalSlots: Awaited<ReturnType<typeof runB112EmpiricalCalibration>>["terminalSlots"];
	readonly scorecard: Awaited<ReturnType<typeof runB112EmpiricalCalibration>>["scorecard"];
	readonly persistence: PersistedPrivateCalibrationGenerationV4;
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const nested = relative(parent, candidate);
	return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`));
}

function ownDenseArray(value: readonly unknown[], label: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length !== B112_D678_CALIBRATION_BLOCK_COUNT) {
		throw new TypeError(`${label} must contain exactly fifteen entries`);
	}
	const copy: unknown[] = [];
	for (let index = 0; index < value.length; index += 1) {
		const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
		if (descriptor === undefined || !("value" in descriptor)) {
			throw new TypeError(`${label} must contain only own data entries`);
		}
		copy.push(descriptor.value);
	}
	return Object.freeze(copy);
}

export async function loadOpenRouterCalibrationOperatorInput(
	modulePath: string,
	privateRoot: string,
): Promise<OpenRouterCalibrationOperatorInputV1> {
	if (!isAbsolute(modulePath)) {
		throw new TypeError("OpenRouter calibration operator input module path must be absolute");
	}
	const canonicalModulePath = await realpath(modulePath);
	const canonicalPrivateRoot = await realpath(privateRoot);
	if (!isSameOrDescendant(canonicalPrivateRoot, canonicalModulePath)) {
		throw new TypeError(
			"OpenRouter calibration operator input module must remain operator-private",
		);
	}
	const loaded = (await import(
		pathToFileURL(canonicalModulePath).href
	)) as Partial<OpenRouterCalibrationOperatorInputModuleV1>;
	if (typeof loaded.createOperatorInput !== "function") {
		throw new TypeError("OpenRouter calibration operator input module has no factory");
	}
	return loaded.createOperatorInput();
}

function assertD678Manifest(frozen: FrozenEmpiricalCampaignManifestV1): void {
	const { manifest } = frozen;
	const actor = manifest.modelConfigurations.filter(
		(configuration) => configuration.role === "actor",
	);
	if (
		manifest.trialPlan.profile !== "calibration" ||
		manifest.trialPlan.activeTaskRefs.length !== 5 ||
		manifest.trialPlan.attemptedColdBlocksPerTask !== 3 ||
		actor.length !== 1 ||
		actor[0]?.model !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
		actor[0]?.settings.reasoning.effort !== "high" ||
		actor[0]?.settings.output.maxOutputTokens !== 65_536 ||
		actor[0]?.settings.tools.maxSteps !== B112_D678_AGENT_MAX_STEPS ||
		manifest.aggregation.intervalRevision !== B112_EXHAUSTIVE_TASK_CLUSTER_INTERVAL_REVISION ||
		manifest.budgets.agentRun.maxSteps !== B112_D678_AGENT_MAX_STEPS ||
		manifest.budgets.agentRun.maxRequests !== B112_D678_AGENT_MAX_STEPS ||
		manifest.budgets.agentRun.maxOutputBytes !== B112_D678_MAX_CANONICAL_REQUEST_BYTES ||
		manifest.budgets.taskModel.maxAttemptedColdBlocks !== 3 ||
		manifest.budgets.taskModel.maxRequests !== B112_D678_TASK_MAX_REQUESTS ||
		manifest.budgets.taskModel.maxCostMicrousd !== B112_D679_TASK_MAX_COST_MICROUSD ||
		manifest.budgets.campaign.maxRequests !== B112_D678_CAMPAIGN_MAX_REQUESTS ||
		manifest.budgets.campaign.maxCostMicrousd !== B112_D678_CAMPAIGN_MAX_COST_MICROUSD ||
		manifest.budgets.campaign.maxElapsedMs !== B112_D678_CAMPAIGN_MAX_ELAPSED_MS
	) {
		throw new TypeError("OpenRouter calibration manifest does not match D678-D679");
	}
}

export function validateD678CalibrationRouteQualifications(input: {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
	readonly routeQualifications: readonly unknown[];
}): readonly QualifiedOpenRouterRouteV1[] {
	const frozen = validateFrozenEmpiricalCampaignManifest(input.frozen, input.qualificationReport);
	assertD678Manifest(frozen);
	const actor = frozen.manifest.modelConfigurations.find(
		(configuration) => configuration.role === "actor",
	);
	if (actor === undefined) throw new TypeError("OpenRouter calibration actor is missing");
	const values = ownDenseArray(input.routeQualifications, "OpenRouter calibration qualifications");
	const qualified: QualifiedOpenRouterRouteV1[] = [];
	let ordinal = 0;
	for (const taskRef of frozen.manifest.trialPlan.activeTaskRefs) {
		for (const blockIndex of [1, 2, 3] as const) {
			const expected = createB112CalibrationTrialBlockIdentity(frozen, taskRef, blockIndex);
			const route = validateOperatorSuppliedOpenRouterRouteQualification(
				values[ordinal],
				frozen,
				input.qualificationReport,
				actor.configurationRef,
			);
			if (
				route.qualification.trialBlockRef !== expected.trialBlockRef ||
				route.qualification.trialBlockDigest !== expected.trialBlockDigest ||
				route.qualification.requestModel !== OPENROUTER_DEEPSEEK_V4_FLASH_REQUEST_MODEL ||
				route.qualification.downstreamProviderSlug !==
					OPENROUTER_DEEPSEEK_V4_FLASH_DOWNSTREAM_PROVIDER_SLUG ||
				route.qualification.pricing.sourceUrl !== OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_SOURCE ||
				route.qualification.pricing.pricingRevision !==
					OPENROUTER_DEEPSEEK_V4_FLASH_PRICING_REVISION ||
				route.qualification.pricing.inputMicrousdPerMillionTokens !==
					OPENROUTER_DEEPSEEK_V4_FLASH_INPUT_MICROUSD_PER_MILLION_TOKENS ||
				route.qualification.pricing.outputMicrousdPerMillionTokens !==
					OPENROUTER_DEEPSEEK_V4_FLASH_OUTPUT_MICROUSD_PER_MILLION_TOKENS ||
				route.qualification.budget.maxSmokeSpendMicrousd !== B112_D678_BLOCK_MAX_COST_MICROUSD ||
				route.qualification.budget.maxRequests !== B112_D678_BLOCK_MAX_REQUESTS ||
				route.qualification.budget.maxStepsPerRun !== B112_D678_AGENT_MAX_STEPS ||
				route.qualification.budget.maxCanonicalRequestBytes !==
					B112_D678_MAX_CANONICAL_REQUEST_BYTES ||
				route.qualification.budget.maxInputTokens !== B112_D678_BLOCK_MAX_INPUT_TOKENS ||
				route.qualification.budget.maxOutputTokens !== B112_D678_BLOCK_MAX_OUTPUT_TOKENS ||
				route.qualification.budget.maxLatencyMs !== B112_D678_BLOCK_MAX_LATENCY_MS ||
				route.qualification.keySpendLimit.limitMicrousd < B112_D678_CAMPAIGN_MAX_COST_MICROUSD ||
				route.qualification.keySpendLimit.remainingMicrousd < B112_D678_CAMPAIGN_MAX_COST_MICROUSD
			) {
				throw new TypeError("OpenRouter calibration route does not match D678-D679");
			}
			qualified.push(route);
			ordinal += 1;
		}
	}
	if (new Set(qualified.map((route) => route.qualificationDigest)).size !== qualified.length) {
		throw new TypeError("OpenRouter calibration requires distinct per-block qualifications");
	}
	const credentialCoordinates = qualified.map((route) =>
		empiricalStrictJsonDigest({
			credentialBindingRef: route.qualification.sharedCapacityQualification.credentialBindingRef,
			credentialBindingRevision:
				route.qualification.sharedCapacityQualification.credentialBindingRevision,
			workspaceRef: route.qualification.sharedCapacityQualification.workspaceRef,
			workspaceRevision: route.qualification.sharedCapacityQualification.workspaceRevision,
			capacityMode: route.qualification.sharedCapacityQualification.capacityMode,
			byokCredentialCount: route.qualification.sharedCapacityQualification.byokCredentialCount,
		}),
	);
	if (new Set(credentialCoordinates).size !== 1) {
		throw new TypeError("OpenRouter calibration qualifications changed credential or workspace");
	}
	return Object.freeze(qualified);
}

export async function runLoadedOpenRouterCalibrationOperator(input: {
	readonly operatorInput: OpenRouterCalibrationOperatorInputV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly retryWait: OpenRouterFirstTaskRetryWaitCapabilityV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly signal: AbortSignal;
}): Promise<OpenRouterCalibrationOperatorResultV4> {
	const frozen = validateFrozenEmpiricalCampaignManifest(
		input.operatorInput.frozen,
		input.operatorInput.qualificationReport,
	);
	const routes = validateD678CalibrationRouteQualifications(input.operatorInput);
	if (
		routes.some(
			(route) =>
				(route.qualification.dispatchMode === "live-approved") !==
				(input.executionClass === "live-provider"),
		)
	) {
		throw new TypeError("OpenRouter calibration execution class does not match qualifications");
	}
	const firstRoute = routes[0];
	if (
		firstRoute === undefined ||
		input.credential.credentialBindingRef !==
			firstRoute.qualification.sharedCapacityQualification.credentialBindingRef ||
		input.credential.credentialBindingRevision !==
			firstRoute.qualification.sharedCapacityQualification.credentialBindingRevision
	) {
		throw new TypeError("OpenRouter calibration credential does not match qualification");
	}
	const routesByTrialBlock = new Map(
		routes.map((route) => [route.qualification.trialBlockRef, route.qualification] as const),
	);
	const empirical = await runB112EmpiricalCalibration({
		frozen,
		qualificationReport: input.operatorInput.qualificationReport,
		runEmpiricalBlock: createOpenRouterCalibrationEmpiricalRunner(async (scheduled) => {
			const routeQualification = routesByTrialBlock.get(scheduled.trialBlockRef);
			if (routeQualification === undefined) {
				throw new TypeError("OpenRouter calibration received an unexpected scheduled block");
			}
			const prepared = await input.operatorInput.prepareTrialBlock(scheduled);
			return Object.freeze({
				...prepared,
				routeQualification,
				credential: input.credential,
				transport: input.transport,
				monotonicMeasurement: input.monotonicMeasurement,
				retryWait: input.retryWait,
				executionClass: input.executionClass,
			});
		}),
		signal: input.signal,
	});
	const protectionExecutor = createEmpiricalExactPrivateNeedleProtectionExecutor({
		policyRef: frozen.manifest.policies.protectionPolicyRef,
		policyRevision: frozen.manifest.policies.protectionPolicyRevision,
		protectedNeedleCapabilityRef: input.credential.credentialBindingRef,
		protectedNeedleCapabilityRevision: input.credential.credentialBindingRevision,
		protectedNeedles: [input.credential.bearerToken],
	});
	const persistence = await persistPrivateCalibrationGeneration({
		privateRoot: input.operatorInput.privateRoot,
		generationRef: input.operatorInput.generationRef,
		frozen,
		qualificationReport: input.operatorInput.qualificationReport,
		terminalSlots: empirical.terminalSlots,
		scorecard: empirical.scorecard,
		protectionExecutor,
	});
	return Object.freeze({ ...empirical, persistence });
}

export async function runOpenRouterCalibrationOperator(input: {
	readonly modulePath: string;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
}): Promise<OpenRouterCalibrationOperatorResultV4> {
	const operatorInput = await loadOpenRouterCalibrationOperatorInput(
		input.modulePath,
		input.privateRoot,
	);
	if (operatorInput.privateRoot !== input.privateRoot) {
		throw new TypeError("OpenRouter calibration operator input changed private artifact ownership");
	}
	const routes = validateD678CalibrationRouteQualifications(operatorInput);
	const firstRoute = routes[0];
	if (firstRoute === undefined || firstRoute.qualification.dispatchMode !== "live-approved") {
		throw new TypeError(
			"OpenRouter calibration live operator requires live-approved qualifications",
		);
	}
	const credential = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
		input.environment,
		firstRoute.qualification,
	);
	return runLoadedOpenRouterCalibrationOperator({
		operatorInput,
		credential,
		transport: createOpenRouterResponsesFetchByteTransport({ fetch: input.fetch }),
		monotonicMeasurement: { readMs: input.monotonicNowMs },
		retryWait: { wait: waitOpenRouterSmokeRetryDelay },
		executionClass: "live-provider",
		signal: AbortSignal.timeout(B112_D678_CAMPAIGN_MAX_ELAPSED_MS),
	});
}

async function main(): Promise<void> {
	const modulePath = process.argv[2];
	const privateRoot = process.argv[3];
	if (modulePath === undefined || privateRoot === undefined || process.argv.length !== 4) {
		throw new TypeError(
			"usage: openrouter-calibration-operator <absolute-input-module> <absolute-private-root>",
		);
	}
	const result = await runOpenRouterCalibrationOperator({
		modulePath,
		privateRoot,
		environment: process.env,
		fetch: globalThis.fetch,
		monotonicNowMs: readOpenRouterSmokeOperatorMonotonicMs,
	});
	process.stdout.write(
		`${JSON.stringify({
			generationDigest: result.persistence.generationDigest,
			terminalSlotsDigest: result.persistence.terminalSlotsDigest,
			scorecardDigest: result.persistence.scorecardDigest,
			status: result.scorecard.status,
			attemptedBlocks: result.scorecard.attemptedBlocks,
			costMicrousd: result.scorecard.costMicrousd,
		})}\n`,
	);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch(() => {
		process.stderr.write("OpenRouter calibration failed closed\n");
		process.exitCode = 1;
	});
}
