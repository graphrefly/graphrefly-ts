import {
	empiricalStrictJsonDigest,
	strictSnapshot,
} from "../../../../evals/empirical-memory-rerun-avoidance/canonical.js";
import type {
	EmpiricalTaskQualificationReportV1,
	EmpiricalUsageSource,
	FrozenEmpiricalCampaignManifestV1,
} from "../../../../evals/empirical-memory-rerun-avoidance/contracts.js";
import {
	EMPIRICAL_MODEL_EXECUTION_SCHEMAS,
	type EmpiricalModelTurnOutcomeV1,
	type EmpiricalModelTurnPortV1,
	type EmpiricalModelTurnRequestV1,
	executeEmpiricalProtection,
	validateEmpiricalModelTurnOutcome,
	validateEmpiricalModelTurnRequest,
} from "../../../../evals/empirical-memory-rerun-avoidance/model-execution.js";
import { freezeEmpiricalCampaignManifest } from "../../../../evals/empirical-memory-rerun-avoidance/qualification.js";
import { buildEmpiricalCampaignFixture, empiricalFixtureDigest } from "./fixtures.js";

export interface EmpiricalModelTurnAuthorityFixture {
	readonly frozen: FrozenEmpiricalCampaignManifestV1;
	readonly qualificationReport: EmpiricalTaskQualificationReportV1;
}

export interface DeterministicCredentialCapabilityFixture {
	readonly credentialBindingRef: string;
	readonly credentialBindingRevision: string;
}

const allowProtection = Object.freeze({
	inspect() {
		return { disposition: "allowed" as const };
	},
});

export function buildEmpiricalModelTurnAuthorityFixture(
	usageSource: EmpiricalUsageSource = "provider-reported",
): EmpiricalModelTurnAuthorityFixture {
	const campaign = buildEmpiricalCampaignFixture();
	const manifest =
		usageSource === "provider-reported"
			? campaign.manifest
			: {
					...campaign.manifest,
					modelConfigurations: campaign.manifest.modelConfigurations.map((configuration) => ({
						...configuration,
						usageSource,
					})),
				};
	return Object.freeze({
		frozen: freezeEmpiricalCampaignManifest(manifest, campaign.report),
		qualificationReport: campaign.report,
	});
}

export function buildEmpiricalModelTurnRequestFixture(
	authority: EmpiricalModelTurnAuthorityFixture = buildEmpiricalModelTurnAuthorityFixture(),
): EmpiricalModelTurnRequestV1 {
	const manifest = authority.frozen.manifest;
	const task = manifest.catalog.tasks[0];
	const configuration = manifest.modelConfigurations[0];
	if (task === undefined || configuration === undefined) {
		throw new TypeError("model-turn fixture requires one task and configuration");
	}
	const availableTools = configuration.settings.tools.toolRefs.map((toolRef) => {
		const tool = manifest.schemaCatalog.tools.find((entry) => entry.toolRef === toolRef);
		if (tool === undefined) throw new TypeError(`missing fixture tool schema ${toolRef}`);
		return tool;
	});
	const outputSchema = manifest.schemaCatalog.outputs.find(
		(entry) => entry.schemaRef === configuration.settings.output.schemaRef,
	);
	if (outputSchema === undefined) throw new TypeError("missing fixture output schema");
	const structuredInput = strictSnapshot({
		workItemRef: task.workItemRef,
		instructionRef: "instruction-placeholder",
		contextRefs: ["context-placeholder"],
	});
	const structuredInputDigest = empiricalStrictJsonDigest(structuredInput);
	const inputProtectionReceipt = executeEmpiricalProtection(allowProtection, {
		policyRef: manifest.policies.protectionPolicyRef,
		policyRevision: manifest.policies.protectionPolicyRevision,
		stage: "source-ingress",
		subject: structuredInput,
	}).receipt;
	return validateEmpiricalModelTurnRequest(
		{
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.request,
			requestRef: "model-turn-request-placeholder",
			manifestDigest: authority.frozen.manifestDigest,
			campaignRef: manifest.campaignRef,
			taskRef: task.taskRef,
			taskDigest: empiricalStrictJsonDigest(task),
			trialBlockRef: "trial-block-placeholder",
			trialBlockDigest: empiricalFixtureDigest("trial-block-placeholder"),
			trialStage: "cold",
			stepIndex: 0,
			configurationRef: configuration.configurationRef,
			configurationDigest: empiricalStrictJsonDigest(configuration),
			role: configuration.role,
			credentialBindingRef: manifest.policies.actorCredentialBindingRef,
			credentialBindingRevision: manifest.policies.actorCredentialBindingRevision,
			inputAuthorityRef: manifest.policies.actorInputAuthorityRef,
			inputAuthorityRevision: manifest.policies.actorInputAuthorityRevision,
			protectionPolicyRef: manifest.policies.protectionPolicyRef,
			protectionPolicyRevision: manifest.policies.protectionPolicyRevision,
			usageSource: configuration.usageSource,
			structuredInput,
			structuredInputDigest,
			inputProtectionReceipt,
			priorToolResults: [],
			toolSetRevision: configuration.settings.tools.schemaRevision,
			toolSetDigest: configuration.settings.tools.toolSetDigest,
			availableTools,
			outputSchema,
			remainingTurnBudget: {
				maxOutputTokens: configuration.settings.output.maxOutputTokens,
				maxOutputBytes: manifest.budgets.agentRun.maxOutputBytes,
			},
		},
		authority.frozen,
		authority.qualificationReport,
	);
}

export function buildEmpiricalModelTurnOutcomeFixture(
	request: EmpiricalModelTurnRequestV1,
	authority: EmpiricalModelTurnAuthorityFixture,
): EmpiricalModelTurnOutcomeV1 {
	const structuredOutput = strictSnapshot({
		kind: "model-turn-output-placeholder",
		summary: "bounded-placeholder",
	});
	const evidenceRefs = strictSnapshot([
		{
			kind: "provider-response-summary",
			id: "provider-response-summary-placeholder",
			digest: empiricalFixtureDigest("provider-response-summary-placeholder"),
		},
	]);
	const issueCodes = strictSnapshot([] as const);
	const toolIntents = strictSnapshot([] as const);
	const egressMaterial = strictSnapshot({
		evidenceRefs,
		issueCodes,
		structuredOutput,
		toolIntents,
	});
	const protectionReceipt = executeEmpiricalProtection(allowProtection, {
		policyRef: request.protectionPolicyRef,
		policyRevision: request.protectionPolicyRevision,
		stage: "model-egress",
		subject: egressMaterial,
	}).receipt;
	return validateEmpiricalModelTurnOutcome(
		{
			schemaVersion: EMPIRICAL_MODEL_EXECUTION_SCHEMAS.outcome,
			requestRef: request.requestRef,
			requestDigest: empiricalStrictJsonDigest(request),
			configurationRef: request.configurationRef,
			configurationDigest: request.configurationDigest,
			role: request.role,
			status: "completed",
			finishReason: "structured-output",
			outputSchemaDigest: request.outputSchema.schemaDigest,
			structuredOutput,
			structuredOutputDigest: empiricalStrictJsonDigest(structuredOutput),
			toolIntents,
			usage: {
				source: request.usageSource,
				inputTokens: request.usageSource === "host-measured" ? null : 100,
				outputTokens: request.usageSource === "host-measured" ? null : 20,
				totalTokens: request.usageSource === "host-measured" ? null : 120,
				requests: 1,
				hostInputBytes: 1_024,
				hostOutputBytes: 512,
			},
			latencyMs: 1_000,
			issueCodes,
			evidenceRefs,
			protectionReceipt,
		},
		request,
		authority.frozen,
		authority.qualificationReport,
	);
}

export class DeterministicEmpiricalModelTurnFake implements EmpiricalModelTurnPortV1 {
	readonly #capability: DeterministicCredentialCapabilityFixture;
	readonly #authority: EmpiricalModelTurnAuthorityFixture;
	readonly #request: EmpiricalModelTurnRequestV1;
	readonly #requestDigest: string;
	readonly #outcome: EmpiricalModelTurnOutcomeV1;

	constructor(
		capability: DeterministicCredentialCapabilityFixture,
		authority: EmpiricalModelTurnAuthorityFixture,
		request: EmpiricalModelTurnRequestV1,
		outcome: EmpiricalModelTurnOutcomeV1,
	) {
		this.#capability = strictSnapshot(capability);
		this.#authority = strictSnapshot(authority);
		this.#request = validateEmpiricalModelTurnRequest(
			request,
			this.#authority.frozen,
			this.#authority.qualificationReport,
		);
		this.#requestDigest = empiricalStrictJsonDigest(this.#request);
		if (
			this.#request.credentialBindingRef !== this.#capability.credentialBindingRef ||
			this.#request.credentialBindingRevision !== this.#capability.credentialBindingRevision
		) {
			throw new TypeError("fake binding credential capability does not match the request");
		}
		this.#outcome = validateEmpiricalModelTurnOutcome(
			outcome,
			this.#request,
			this.#authority.frozen,
			this.#authority.qualificationReport,
		);
	}

	invoke(
		request: EmpiricalModelTurnRequestV1,
		signal: AbortSignal,
	): Promise<EmpiricalModelTurnOutcomeV1> {
		if (signal.aborted) {
			return Promise.reject(new DOMException("model turn cancelled by host", "AbortError"));
		}
		const validated = validateEmpiricalModelTurnRequest(
			request,
			this.#authority.frozen,
			this.#authority.qualificationReport,
		);
		if (empiricalStrictJsonDigest(validated) !== this.#requestDigest) {
			return Promise.reject(new TypeError("fake binding received an unexpected request"));
		}
		if (
			validated.credentialBindingRef !== this.#capability.credentialBindingRef ||
			validated.credentialBindingRevision !== this.#capability.credentialBindingRevision
		) {
			return Promise.reject(new TypeError("fake binding credential capability mismatch"));
		}
		return Promise.resolve(this.#outcome);
	}
}
