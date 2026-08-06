import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { open as openFile, realpath, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, sep } from "node:path";
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { strictJsonCodec } from "../../src/json/codec.js";
import type { DeveloperGuidanceIndependentVerifierCapabilityV1 } from "./developer-guidance-utility.js";
import type { OpenRouterCalibrationOperatorInputV1 } from "./openrouter-calibration-operator.js";
import { B112_D678_CAMPAIGN_MAX_ELAPSED_MS } from "./openrouter-calibration-operator.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";
import {
	type D688MechanicalQualificationGateV1,
	runLoadedOpenRouterDeveloperGuidanceCalibration,
} from "./openrouter-developer-guidance-calibration-operator.js";
import { createOpenRouterCredentialCapabilityFromOperatorEnvironment } from "./openrouter-first-task-smoke.js";
import {
	readOpenRouterSmokeOperatorMonotonicMs,
	waitOpenRouterSmokeRetryDelay,
} from "./openrouter-first-task-smoke-operator.js";
import { createOpenRouterResponsesFetchByteTransport } from "./openrouter-responses-byte-transport.js";
import type { QualifiedOpenRouterRouteV1 } from "./openrouter-route-qualification.js";

interface PrivateDeveloperGuidanceInputModuleV1 {
	readonly freshRouteAttestationPath: string;
	createDeveloperGuidanceOperatorInput(): Promise<{
		readonly operatorInput: OpenRouterCalibrationOperatorInputV1;
		readonly mechanicalGate: D688MechanicalQualificationGateV1;
		readonly guidanceVerifier: DeveloperGuidanceIndependentVerifierCapabilityV1;
	}>;
	createFreshRouteQualification(input: {
		readonly qualificationRunRef: string;
		readonly generationRef: string;
		readonly blockOrdinal: number;
		readonly taskRef: string;
		readonly trialBlockRef: string;
		readonly trialBlockDigest: string;
		readonly preregisteredRoute: QualifiedOpenRouterRouteV1["qualification"];
		readonly attestation: unknown;
	}): unknown;
}

const MAX_FRESH_ROUTE_ATTESTATION_BYTES = 262_144;

function isSameOrDescendant(parent: string, candidate: string): boolean {
	const nested = relative(parent, candidate);
	return nested === "" || (nested !== ".." && !nested.startsWith(`..${sep}`));
}

export async function readAndConsumeD688FreshRouteAttestation(input: {
	readonly path: string;
	readonly signal: AbortSignal;
}): Promise<unknown> {
	if (input.signal.aborted) {
		throw new DOMException("D688 fresh qualification cancelled", "AbortError");
	}
	let attestationHandle: Awaited<ReturnType<typeof openFile>>;
	try {
		attestationHandle = await openFile(input.path, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
	} catch (error) {
		await rm(input.path, { force: true });
		throw error;
	}
	let attestationBytes: Uint8Array;
	try {
		const attestationStat = await attestationHandle.stat();
		if (
			!attestationStat.isFile() ||
			(attestationStat.mode & 0o777) !== 0o600 ||
			attestationStat.size < 1 ||
			attestationStat.size > MAX_FRESH_ROUTE_ATTESTATION_BYTES
		) {
			throw new TypeError("D688 fresh route attestation is not one bounded 0600 file");
		}
		const buffer = Buffer.alloc(MAX_FRESH_ROUTE_ATTESTATION_BYTES + 1);
		const { bytesRead } = await attestationHandle.read(
			buffer,
			0,
			MAX_FRESH_ROUTE_ATTESTATION_BYTES + 1,
			0,
		);
		if (input.signal.aborted) {
			throw new DOMException("D688 fresh qualification cancelled", "AbortError");
		}
		if (bytesRead < 1 || bytesRead > MAX_FRESH_ROUTE_ATTESTATION_BYTES) {
			throw new TypeError("D688 fresh route attestation changed its bounded byte extent");
		}
		attestationBytes = buffer.subarray(0, bytesRead);
	} finally {
		await attestationHandle.close();
		await rm(input.path, { force: true });
	}
	return strictJsonCodec.decode(attestationBytes);
}

async function loadPrivateInput(
	modulePath: string,
	privateRoot: string,
): Promise<PrivateDeveloperGuidanceInputModuleV1> {
	if (!isAbsolute(modulePath) || !isAbsolute(privateRoot)) {
		throw new TypeError("D688 runner paths must be absolute");
	}
	const [canonicalModulePath, canonicalPrivateRoot] = await Promise.all([
		realpath(modulePath),
		realpath(privateRoot),
	]);
	if (!isSameOrDescendant(canonicalPrivateRoot, canonicalModulePath)) {
		throw new TypeError("D688 runner input module must remain operator-private");
	}
	const loaded = (await import(
		pathToFileURL(canonicalModulePath).href
	)) as Partial<PrivateDeveloperGuidanceInputModuleV1>;
	if (
		typeof loaded.createDeveloperGuidanceOperatorInput !== "function" ||
		typeof loaded.createFreshRouteQualification !== "function" ||
		typeof loaded.freshRouteAttestationPath !== "string" ||
		!isAbsolute(loaded.freshRouteAttestationPath) ||
		!isSameOrDescendant(canonicalPrivateRoot, loaded.freshRouteAttestationPath) ||
		(await realpath(dirname(loaded.freshRouteAttestationPath))) !== canonicalPrivateRoot
	) {
		throw new TypeError("D688 runner input module is incomplete or escaped private ownership");
	}
	return loaded as PrivateDeveloperGuidanceInputModuleV1;
}

export async function runOpenRouterDeveloperGuidanceCalibration(input: {
	readonly modulePath: string;
	readonly privateRoot: string;
	readonly environment: Readonly<Record<string, string | undefined>>;
	readonly fetch: typeof fetch;
	readonly monotonicNowMs: () => number;
	readonly awaitFreshQualification: (input: {
		readonly blockOrdinal: number;
		readonly qualificationRunRef: string;
		readonly generationRef: string;
		readonly taskRef: string;
		readonly trialBlockRef: string;
		readonly trialBlockDigest: string;
		readonly attestationPath: string;
		readonly signal: AbortSignal;
	}) => Promise<void>;
}) {
	const canonicalPrivateRoot = await realpath(input.privateRoot);
	const qualificationRunRef = `d688-fresh-qualification-run.${randomUUID()}`;
	const privateInput = await loadPrivateInput(input.modulePath, input.privateRoot);
	const loaded = await privateInput.createDeveloperGuidanceOperatorInput();
	if ((await realpath(loaded.operatorInput.privateRoot)) !== canonicalPrivateRoot) {
		throw new TypeError("D688 runner input changed private artifact ownership");
	}
	const firstQualification = loaded.operatorInput.routeQualifications[0] as
		| QualifiedOpenRouterRouteV1["qualification"]
		| undefined;
	if (firstQualification === undefined) {
		throw new TypeError("D688 runner has no preregistered route qualification");
	}
	const credential = createOpenRouterCredentialCapabilityFromOperatorEnvironment(
		input.environment,
		firstQualification,
	);
	return runLoadedOpenRouterDeveloperGuidanceCalibration({
		...loaded,
		credential,
		transport: createOpenRouterResponsesFetchByteTransport({ fetch: input.fetch }),
		currentKeySpendAdmission: createOpenRouterCurrentKeySpendAdmissionCapability({
			fetch: input.fetch,
		}),
		monotonicMeasurement: { readMs: input.monotonicNowMs },
		retryWait: { wait: waitOpenRouterSmokeRetryDelay },
		executionClass: "live-provider",
		signal: AbortSignal.timeout(B112_D678_CAMPAIGN_MAX_ELAPSED_MS),
		freshRouteQualification: {
			capabilityRef: "d688-out-of-band-fresh-zero-byok",
			capabilityRevision: "d688-out-of-band-fresh-zero-byok.2026-08-06.v1",
			async qualify(qualificationInput) {
				await input.awaitFreshQualification({
					blockOrdinal: qualificationInput.blockOrdinal,
					qualificationRunRef,
					generationRef: loaded.operatorInput.generationRef,
					taskRef: qualificationInput.taskRef,
					trialBlockRef: qualificationInput.trialBlockRef,
					trialBlockDigest: qualificationInput.trialBlockDigest,
					attestationPath: privateInput.freshRouteAttestationPath,
					signal: qualificationInput.signal,
				});
				if (qualificationInput.signal.aborted) {
					throw new DOMException("D688 fresh qualification cancelled", "AbortError");
				}
				const attestation = await readAndConsumeD688FreshRouteAttestation({
					path: privateInput.freshRouteAttestationPath,
					signal: qualificationInput.signal,
				});
				return privateInput.createFreshRouteQualification({
					qualificationRunRef,
					generationRef: loaded.operatorInput.generationRef,
					blockOrdinal: qualificationInput.blockOrdinal,
					taskRef: qualificationInput.taskRef,
					trialBlockRef: qualificationInput.trialBlockRef,
					trialBlockDigest: qualificationInput.trialBlockDigest,
					preregisteredRoute: qualificationInput.preregisteredRoute,
					attestation,
				});
			},
		},
	});
}

async function main(): Promise<void> {
	const modulePath = process.argv[2];
	const privateRoot = process.argv[3];
	if (modulePath === undefined || privateRoot === undefined || process.argv.length !== 4) {
		throw new TypeError(
			"usage: openrouter-developer-guidance-calibration-runner <absolute-input-module> <absolute-private-root>",
		);
	}
	const lines = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
	try {
		const result = await runOpenRouterDeveloperGuidanceCalibration({
			modulePath,
			privateRoot,
			environment: process.env,
			fetch: globalThis.fetch,
			monotonicNowMs: readOpenRouterSmokeOperatorMonotonicMs,
			async awaitFreshQualification(coordinates) {
				process.stdout.write(
					`${JSON.stringify({
						status: "fresh-zero-byok-required",
						qualificationRunRef: coordinates.qualificationRunRef,
						generationRef: coordinates.generationRef,
						blockOrdinal: coordinates.blockOrdinal,
						taskRef: coordinates.taskRef,
						trialBlockRef: coordinates.trialBlockRef,
						trialBlockDigest: coordinates.trialBlockDigest,
						attestationPath: coordinates.attestationPath,
					})}\n`,
				);
				await lines.question("", { signal: coordinates.signal });
			},
		});
		process.stdout.write(
			`${JSON.stringify({
				status: result.sourceScorecard.status,
				generationDigest: result.persistence.generationDigest,
				terminalSlotsDigest: result.persistence.terminalSlotsDigest,
				guidanceObservationsDigest: result.persistence.guidanceObservationsDigest,
				guidanceScorecardDigest: result.persistence.guidanceScorecardDigest,
				recommendationDigest: result.persistence.recommendationDigest,
				matchedPairCount: result.guidanceScorecard.matchedPairCount,
				recommendConfirmatoryDesign: result.recommendation.recommendConfirmatoryDesign,
				efficacyClaim: result.recommendation.efficacyClaim,
			})}\n`,
		);
	} finally {
		lines.close();
	}
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
	void main().catch(() => {
		process.stderr.write(
			`${JSON.stringify({ issueCode: "openrouter-developer-guidance-runner-failed" })}\n`,
		);
		process.exitCode = 1;
	});
}
