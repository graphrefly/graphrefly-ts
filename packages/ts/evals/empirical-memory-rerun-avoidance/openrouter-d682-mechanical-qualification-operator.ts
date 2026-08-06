import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { empiricalStrictJsonDigest } from "./canonical.js";
import {
	CLOSED_ACTOR_TOOL_REFS,
	type ClosedTaskProfileHostRunInputV1,
	D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
} from "./closed-task-profile-host.js";
import {
	createD682MechanicalQualificationScorecard,
	D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD,
	type D682MechanicalQualificationCatalogV1,
	type D682MechanicalQualificationScorecardV1,
	validateD682MechanicalActorInput,
	validateD682MechanicalQualificationCatalog,
	validateD682MechanicalToolContract,
} from "./d682-mechanical-qualification.js";
import type { EmpiricalCalibrationTrialBlockObservationV4 } from "./empirical-smoke-evidence.js";
import {
	createOpenRouterCurrentKeySpendAdmissionCapability,
	type OpenRouterCurrentKeySpendAdmissionCapabilityV1,
} from "./openrouter-current-key-spend-admission.js";
import {
	createOpenRouterCredentialCapabilityFromOperatorEnvironment,
	type OpenRouterFirstTaskRetryWaitCapabilityV1,
	runOpenRouterMatchedTrialBlock,
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
	type OpenRouterRouteQualificationV1,
	validateOperatorSuppliedOpenRouterRouteQualification,
} from "./openrouter-route-qualification.js";
import {
	type PersistedPrivateD682MechanicalQualificationGenerationV1,
	persistPrivateD682MechanicalQualificationGeneration,
} from "./private-smoke-persistence.js";

export const D682_MECHANICAL_QUALIFICATION_MAX_ELAPSED_MS = 3_600_000;

export interface OpenRouterD682MechanicalPreparedFixtureV1 {
	readonly host: Omit<
		ClosedTaskProfileHostRunInputV1,
		"modelTurnPort" | "protectionExecutor" | "signal"
	>;
}

export interface OpenRouterD682MechanicalQualificationOperatorInputV1 {
	readonly catalog: D682MechanicalQualificationCatalogV1;
	readonly routeQualifications: readonly [
		OpenRouterRouteQualificationV1,
		OpenRouterRouteQualificationV1,
		OpenRouterRouteQualificationV1,
	];
	readonly prepareFixture: (
		fixtureIndex: 0 | 1 | 2,
		signal: AbortSignal,
	) => Promise<OpenRouterD682MechanicalPreparedFixtureV1>;
	readonly privateRoot: string;
	readonly generationRef: string;
	readonly cleanup?: () => Promise<void>;
}

interface OpenRouterD682MechanicalQualificationOperatorInputModuleV1 {
	createOperatorInput(): Promise<OpenRouterD682MechanicalQualificationOperatorInputV1>;
}

export interface OpenRouterD682MechanicalQualificationOperatorResultV1 {
	readonly observations: readonly [
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
	];
	readonly scorecard: D682MechanicalQualificationScorecardV1;
	readonly persistence: PersistedPrivateD682MechanicalQualificationGenerationV1;
}

export interface OpenRouterD682MechanicalQualificationLiveOperatorResultV1
	extends OpenRouterD682MechanicalQualificationOperatorResultV1 {
	readonly cleanupStatus: "completed" | "failed";
}

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const nested = relative(parent, candidate);
	return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`));
}

export async function loadOpenRouterD682MechanicalQualificationOperatorInput(
	modulePath: string,
	privateRoot: string,
): Promise<OpenRouterD682MechanicalQualificationOperatorInputV1> {
	if (!isAbsolute(modulePath)) {
		throw new TypeError("D682 mechanical operator input module path must be absolute");
	}
	const canonicalModulePath = await realpath(modulePath);
	const canonicalPrivateRoot = await realpath(privateRoot);
	if (!isSameOrDescendant(canonicalPrivateRoot, canonicalModulePath)) {
		throw new TypeError("D682 mechanical operator input module must remain operator-private");
	}
	const loaded = (await import(
		pathToFileURL(canonicalModulePath).href
	)) as Partial<OpenRouterD682MechanicalQualificationOperatorInputModuleV1>;
	if (typeof loaded.createOperatorInput !== "function") {
		throw new TypeError("D682 mechanical operator input module has no factory");
	}
	return loaded.createOperatorInput();
}

export function d682MechanicalRouteProfileDigest(route: OpenRouterRouteQualificationV1): string {
	return empiricalStrictJsonDigest({
		configurationRef: route.configurationRef,
		configurationDigest: route.configurationDigest,
		requestModel: route.requestModel,
		modelIdentityKind: route.modelIdentityKind,
		downstreamProviderSlug: route.downstreamProviderSlug,
		downstreamProviderName: route.downstreamProviderName,
		endpoint: route.endpoint,
		endpointRevision: route.endpointRevision,
		adapterRevision: route.adapterRevision,
		bindingRevision: route.bindingRevision,
		capabilitiesDigest: route.capabilitiesDigest,
		settingsDigest: route.settingsDigest,
		usageSource: route.usageSource,
		usageRevision: route.usageRevision,
		routeEvidenceSchemaRevision: route.routeEvidenceSchemaRevision,
		pricing: route.pricing,
		budget: route.budget,
		keySpendLimit: route.keySpendLimit,
		sharedCapacityQualification: route.sharedCapacityQualification,
	});
}

function sameFrozenRoute(
	left: OpenRouterRouteQualificationV1,
	right: OpenRouterRouteQualificationV1,
): boolean {
	return d682MechanicalRouteProfileDigest(left) === d682MechanicalRouteProfileDigest(right);
}

export async function runLoadedOpenRouterD682MechanicalQualificationOperator(input: {
	readonly operatorInput: OpenRouterD682MechanicalQualificationOperatorInputV1;
	readonly credential: OpenRouterResponsesCredentialCapabilityV1;
	readonly transport: OpenRouterResponsesByteTransportV1;
	readonly currentKeySpendAdmission: OpenRouterCurrentKeySpendAdmissionCapabilityV1;
	readonly monotonicMeasurement: OpenRouterResponsesMonotonicMeasurementV1;
	readonly retryWait: OpenRouterFirstTaskRetryWaitCapabilityV1;
	readonly executionClass: "simulated-contract" | "live-provider";
	readonly signal: AbortSignal;
}): Promise<OpenRouterD682MechanicalQualificationOperatorResultV1> {
	const catalog = validateD682MechanicalQualificationCatalog(input.operatorInput.catalog);
	const rawRoutes = input.operatorInput.routeQualifications;
	if (rawRoutes.length !== 3 || rawRoutes.some((route) => !sameFrozenRoute(rawRoutes[0], route))) {
		throw new TypeError(
			"D682 mechanical qualification requires one frozen route across all fixtures",
		);
	}
	const firstRoute = rawRoutes[0];
	if (firstRoute === undefined) {
		throw new TypeError("D682 mechanical qualification route is missing");
	}
	if (catalog.routeProfileDigest !== d682MechanicalRouteProfileDigest(firstRoute)) {
		throw new TypeError("D682 mechanical catalog does not match the frozen route profile");
	}
	if (
		input.credential.credentialBindingRef !==
			firstRoute.sharedCapacityQualification.credentialBindingRef ||
		input.credential.credentialBindingRevision !==
			firstRoute.sharedCapacityQualification.credentialBindingRevision
	) {
		throw new TypeError("D682 mechanical credential does not match the frozen route");
	}
	let spentMicrousd = 0;
	let spentRequests = 0;
	let spentElapsedMs = 0;
	const observations: EmpiricalCalibrationTrialBlockObservationV4[] = [];
	let protectionExecutor:
		| Awaited<ReturnType<typeof runOpenRouterMatchedTrialBlock>>["protectionExecutor"]
		| null = null;
	for (const fixtureIndex of [0, 1, 2] as const) {
		if (input.signal.aborted) {
			throw new DOMException("D682 mechanical qualification cancelled", "AbortError");
		}
		const prepared = await input.operatorInput.prepareFixture(fixtureIndex, input.signal);
		let handedToHost = false;
		try {
			const route = validateOperatorSuppliedOpenRouterRouteQualification(
				rawRoutes[fixtureIndex],
				prepared.host.frozen,
				prepared.host.qualificationReport,
				prepared.host.initialRequest.configurationRef,
			).qualification;
			const descriptor = catalog.fixtures[fixtureIndex];
			const task = prepared.host.frozen.manifest.catalog.tasks.find(
				(candidate) => candidate.taskRef === prepared.host.initialRequest.taskRef,
			);
			const actorInput = validateD682MechanicalActorInput(
				prepared.host.initialRequest.structuredInput,
			);
			validateD682MechanicalToolContract({
				tools: prepared.host.initialRequest.availableTools,
				actorInput,
				toolRefs: CLOSED_ACTOR_TOOL_REFS,
				schemaRevision: D682_HOST_DERIVED_REPLACE_SCHEMA_REVISION,
				maxSearchMatches: prepared.host.taskProfile.workspaceRecipe.maxSearchMatches,
			});
			const actorPathsMatch =
				empiricalStrictJsonDigest(actorInput.readablePaths) ===
					empiricalStrictJsonDigest(prepared.host.taskProfile.workspaceRecipe.readableFiles) &&
				empiricalStrictJsonDigest(actorInput.writablePaths) ===
					empiricalStrictJsonDigest(
						prepared.host.taskProfile.workspaceRecipe.writableFiles.map((rule) => rule.path),
					) &&
				empiricalStrictJsonDigest(actorInput.commandRefs) ===
					empiricalStrictJsonDigest(
						prepared.host.taskProfile.commandPolicy.commands.map((command) => command.commandRef),
					);
			if (
				descriptor === undefined ||
				task === undefined ||
				actorInput.workItemRef !== task.workItemRef ||
				!actorPathsMatch ||
				prepared.host.initialRequest.taskRef !== descriptor.taskRef ||
				prepared.host.initialRequest.taskDigest !== descriptor.taskDigest ||
				empiricalStrictJsonDigest(task) !== descriptor.taskDigest ||
				task.actorTreeDigest !== descriptor.actorTreeDigest ||
				task.workItemDigest !== descriptor.workItemDigest ||
				task.acceptanceDigest !== descriptor.acceptanceDigest ||
				task.workspaceRecipeDigest !== descriptor.workspaceRecipeDigest ||
				task.verifierProfileDigest !== descriptor.verifierProfileDigest ||
				empiricalStrictJsonDigest(prepared.host.taskProfile.workspaceRecipe) !==
					descriptor.workspaceRecipeDigest ||
				empiricalStrictJsonDigest(prepared.host.taskProfile.verifierProfile) !==
					descriptor.verifierProfileDigest ||
				d682MechanicalRouteProfileDigest(route) !== catalog.routeProfileDigest ||
				route.trialBlockRef !== prepared.host.initialRequest.trialBlockRef ||
				route.trialBlockDigest !== prepared.host.initialRequest.trialBlockDigest ||
				(input.executionClass === "live-provider") !== (route.dispatchMode === "live-approved")
			) {
				throw new TypeError("D682 prepared fixture does not match its preregistration");
			}
			const remainingCostMicrousd = D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD - spentMicrousd;
			await input.currentKeySpendAdmission.read({
				credential: input.credential,
				expectedLimitMicrousd: route.keySpendLimit.limitMicrousd,
				requiredRemainingMicrousd: remainingCostMicrousd,
				signal: input.signal,
			});
			handedToHost = true;
			const result = await runOpenRouterMatchedTrialBlock({
				host: prepared.host,
				routeQualification: route,
				credential: input.credential,
				transport: input.transport,
				monotonicMeasurement: input.monotonicMeasurement,
				retryWait: input.retryWait,
				executionClass: input.executionClass,
				signal: input.signal,
				blockIndex: 1,
				remainingBudget: {
					campaignRequests: Math.max(0, 96 - spentRequests),
					campaignCostMicrousd: remainingCostMicrousd,
					campaignElapsedMs: Math.max(
						0,
						D682_MECHANICAL_QUALIFICATION_MAX_ELAPSED_MS - spentElapsedMs,
					),
					taskRequests: route.budget.maxRequests,
					taskCostMicrousd: remainingCostMicrousd,
				},
			});
			if (result.profile !== "calibration") {
				throw new TypeError("D682 mechanical fixture did not use the calibration evidence shape");
			}
			protectionExecutor ??= result.protectionExecutor;
			observations.push(result.observation);
			spentMicrousd += result.observation.result.costMicrousd;
			spentRequests += result.observation.result.requests;
			spentElapsedMs += result.observation.result.latencyMs;
			if (spentMicrousd > D682_MECHANICAL_QUALIFICATION_MAX_COST_MICROUSD) {
				throw new TypeError("D682 mechanical qualification exceeded its aggregate hard cap");
			}
		} finally {
			if (!handedToHost) {
				await prepared.host.materialization.cleanup().catch(() => undefined);
			}
		}
	}
	if (observations.length !== 3 || protectionExecutor === null) {
		throw new TypeError("D682 mechanical qualification did not produce exactly three observations");
	}
	const observationTuple = observations as unknown as readonly [
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
		EmpiricalCalibrationTrialBlockObservationV4,
	];
	const scorecard = createD682MechanicalQualificationScorecard({
		catalog,
		observations: observationTuple,
	});
	const persistence = await persistPrivateD682MechanicalQualificationGeneration({
		privateRoot: input.operatorInput.privateRoot,
		generationRef: input.operatorInput.generationRef,
		catalog,
		observations: observationTuple,
		scorecard,
		protectionExecutor,
	});
	return Object.freeze({ observations: observationTuple, scorecard, persistence });
}

export async function runOpenRouterD682MechanicalQualificationOperator(input: {
	readonly modulePath: string;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
}): Promise<OpenRouterD682MechanicalQualificationLiveOperatorResultV1> {
	const operatorInput = await loadOpenRouterD682MechanicalQualificationOperatorInput(
		input.modulePath,
		input.privateRoot,
	);
	if (operatorInput.privateRoot !== input.privateRoot) {
		throw new TypeError("D682 mechanical operator input changed private artifact ownership");
	}
	const firstRoute = operatorInput.routeQualifications[0];
	const credential = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
		input.environment,
		firstRoute,
	);
	let result: OpenRouterD682MechanicalQualificationOperatorResultV1;
	try {
		result = await runLoadedOpenRouterD682MechanicalQualificationOperator({
			operatorInput,
			credential,
			transport: createOpenRouterResponsesFetchByteTransport({ fetch: input.fetch }),
			currentKeySpendAdmission: createOpenRouterCurrentKeySpendAdmissionCapability({
				fetch: input.fetch,
			}),
			monotonicMeasurement: { readMs: input.monotonicNowMs },
			retryWait: { wait: waitOpenRouterSmokeRetryDelay },
			executionClass: "live-provider",
			signal: AbortSignal.timeout(D682_MECHANICAL_QUALIFICATION_MAX_ELAPSED_MS),
		});
	} catch (error) {
		try {
			await operatorInput.cleanup?.();
		} catch {
			process.stderr.write(
				`${JSON.stringify({ stage: "d682-mechanical-cleanup", code: "cleanup-failed-after-execution-failure" })}\n`,
			);
		}
		throw error;
	}
	let cleanupStatus: "completed" | "failed" = "completed";
	try {
		await operatorInput.cleanup?.();
	} catch {
		cleanupStatus = "failed";
		process.stderr.write(
			`${JSON.stringify({ stage: "d682-mechanical-cleanup", code: "cleanup-failed-after-committed-result" })}\n`,
		);
	}
	return Object.freeze({ ...result, cleanupStatus });
}

async function main(): Promise<void> {
	const modulePath = process.argv[2];
	const privateRoot = process.argv[3];
	if (modulePath === undefined || privateRoot === undefined || process.argv.length !== 4) {
		throw new TypeError(
			"usage: openrouter-d682-mechanical-qualification-operator <absolute-input-module> <absolute-private-root>",
		);
	}
	const result = await runOpenRouterD682MechanicalQualificationOperator({
		modulePath,
		privateRoot,
		environment: process.env,
		fetch: globalThis.fetch,
		monotonicNowMs: readOpenRouterSmokeOperatorMonotonicMs,
	});
	process.stdout.write(
		`${JSON.stringify({
			generationDigest: result.persistence.generationDigest,
			catalogDigest: result.persistence.catalogDigest,
			observationsDigest: result.persistence.observationsDigest,
			scorecardDigest: result.persistence.scorecardDigest,
			status: result.scorecard.status,
			passedFixtures: result.scorecard.passedFixtures,
			requests: result.scorecard.requests,
			costMicrousd: result.scorecard.costMicrousd,
			cleanupStatus: result.cleanupStatus,
		})}\n`,
	);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error: unknown) => {
		process.stderr.write(
			`${JSON.stringify({
				stage: "d682-mechanical-qualification",
				code: error instanceof DOMException && error.name === "AbortError" ? "cancelled" : "failed",
			})}\n`,
		);
		process.exitCode = 1;
	});
}
