import { constants } from "node:fs";
import { mkdtemp, open, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	empiricalSha256,
	empiricalStrictJsonDigest,
	exactKeys,
	literal,
	record,
	safeInteger,
	sameBytes,
} from "./canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "./current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalCurrentKeySnapshot,
	type EvalObservation,
	materialFreeObservationValue,
	runRootEval,
} from "./eval-topology.js";
import {
	advanceRootEvalD145CharterLedger,
	latestRootEvalGraphSpend,
	readRootEvalD145CharterLedger,
} from "./root-eval-charter-ledger.js";
import { commitRootEvalD145CharterTransaction } from "./root-eval-charter-transaction.js";
import { createRootEvalNoNetworkQualificationExecutor } from "./root-eval-live.js";
import {
	constructRootEvalLiveEvidence,
	ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
	ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
	ROOT_EVAL_LIVE_CAMPAIGN_SLOT,
	ROOT_EVAL_LIVE_GENERATION_REF,
	type RootEvalLiveClaim,
} from "./root-eval-live-authority.js";
import { readRootEvalTaskManifest, rootEvalTaskBindings } from "./root-eval-task.js";

const DIAGNOSTIC_SCHEMA = "graphrefly-ts.root-eval-development-private-diagnostic.v1";
const EXPECTED_FAILURE = "source Work Item verification failed closed";

async function readCanonicalPrivateFile(path: string, maximumBytes: number): Promise<unknown> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o777) !== 0o600)
			throw new TypeError("D145 recovery input private file identity invalid");
		if (stat.size < 1 || stat.size > maximumBytes)
			throw new TypeError("D145 recovery input private file size invalid");
		const bytes = new Uint8Array(await handle.readFile());
		const decoded = strictJsonCodec.decode(bytes);
		if (!sameBytes(strictJsonCodec.encode(decoded), bytes))
			throw new TypeError("D145 recovery input private file was not canonical");
		return decoded;
	} finally {
		await handle.close();
	}
}

function assertOwnDigest(value: Readonly<Record<string, unknown>>, key: string): void {
	const claimed = value[key];
	if (typeof claimed !== "string") throw new TypeError("D145 recovery digest was absent");
	const { [key]: _claimed, ...material } = value;
	if (claimed !== empiricalStrictJsonDigest(material))
		throw new TypeError("D145 recovery digest was invalid");
}

async function readClaim(generationRoot: string): Promise<RootEvalLiveClaim> {
	const raw = record(
		await readCanonicalPrivateFile(
			join(generationRoot, `.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v20.json`),
			65_536,
		),
		"D145 recovery claim",
	);
	assertOwnDigest(raw, "claimDigest");
	literal(raw.generationRef, ROOT_EVAL_LIVE_GENERATION_REF, "D145 recovery generation");
	literal(raw.executionMode, "live", "D145 recovery execution mode");
	return raw as unknown as RootEvalLiveClaim;
}

interface FrozenProviderResponse {
	readonly replicate: number;
	readonly admissionId: string;
	readonly status: number;
	readonly retryAfter: string | null;
	readonly bytes: Uint8Array;
}

async function readProviderResponses(
	generationRoot: string,
): Promise<ReadonlyMap<number, FrozenProviderResponse>> {
	const directory = join(generationRoot, ".d145-development-diagnostics");
	const responses = new Map<number, FrozenProviderResponse>();
	for (const name of (await readdir(directory)).sort()) {
		if (!/^[0-9a-f]{64}\.json$/u.test(name))
			throw new TypeError("D145 recovery diagnostic name invalid");
		const diagnostic = record(
			await readCanonicalPrivateFile(join(directory, name), 9 * 1_048_576),
			"D145 recovery diagnostic",
		);
		assertOwnDigest(diagnostic, "diagnosticDigest");
		if (diagnostic.kind !== "provider-response") continue;
		literal(diagnostic.schemaVersion, DIAGNOSTIC_SCHEMA, "D145 recovery diagnostic schema");
		literal(diagnostic.generationRef, ROOT_EVAL_LIVE_GENERATION_REF, "D145 recovery diagnostic");
		literal(diagnostic.arm, "source", "D145 recovery provider response arm");
		literal(diagnostic.attempt, 1, "D145 recovery provider response attempt");
		const replicate = safeInteger(diagnostic.replicate, "D145 recovery replicate", { max: 5 });
		if (replicate < 1 || responses.has(replicate))
			throw new TypeError("D145 recovery provider response replicate invalid");
		const material = record(diagnostic.material, "D145 recovery provider response material");
		exactKeys(
			material,
			["status", "retryAfter", "responseByteLength", "responseDigest", "responseBase64"],
			"D145 recovery provider response material",
		);
		const status = safeInteger(material.status, "D145 recovery provider response status", {
			max: 599,
		});
		if (status < 100 || (material.retryAfter !== null && typeof material.retryAfter !== "string"))
			throw new TypeError("D145 recovery provider response metadata invalid");
		if (typeof material.responseBase64 !== "string")
			throw new TypeError("D145 recovery provider response bytes absent");
		const bytes = new Uint8Array(Buffer.from(material.responseBase64, "base64"));
		if (
			Buffer.from(bytes).toString("base64") !== material.responseBase64 ||
			bytes.byteLength !== material.responseByteLength ||
			empiricalSha256(bytes) !== material.responseDigest
		)
			throw new TypeError("D145 recovery provider response bytes drifted");
		responses.set(
			replicate,
			Object.freeze({
				replicate,
				admissionId: String(diagnostic.admissionId),
				status,
				retryAfter: material.retryAfter,
				bytes,
			}),
		);
	}
	if (responses.size !== 5)
		throw new TypeError("D145 recovery requires exactly five frozen provider responses");
	return responses;
}

async function assertDispatchReceipts(
	generationRoot: string,
	claim: RootEvalLiveClaim,
	responses: ReadonlyMap<number, FrozenProviderResponse>,
): Promise<void> {
	const directory = join(generationRoot, ".d145-provider-dispatches");
	const names = (await readdir(directory)).sort();
	if (names.length !== responses.size)
		throw new TypeError("D145 recovery dispatch/response count drifted");
	const admissionIds = new Set([...responses.values()].map((response) => response.admissionId));
	for (const name of names) {
		if (!/^[0-9a-f]{64}\.json$/u.test(name))
			throw new TypeError("D145 recovery dispatch receipt name invalid");
		const receipt = record(
			await readCanonicalPrivateFile(join(directory, name), 16_384),
			"D145 recovery dispatch receipt",
		);
		exactKeys(
			receipt,
			["claimDigest", "executionId", "admissionId", "operationId", "attempt", "receiptDigest"],
			"D145 recovery dispatch receipt",
		);
		literal(receipt.claimDigest, claim.claimDigest, "D145 recovery dispatch claim");
		assertOwnDigest(receipt, "receiptDigest");
		if (!admissionIds.delete(String(receipt.admissionId)))
			throw new TypeError("D145 recovery dispatch receipt was not response-correlated");
	}
	if (admissionIds.size !== 0)
		throw new TypeError("D145 recovery provider response lacked a dispatch receipt");
}

function graphCurrentKey(claim: RootEvalLiveClaim): EvalCurrentKeySnapshot {
	const current = claim.recoveryEnvelope.currentKeyBefore;
	return Object.freeze({
		kind: "eval-current-key-snapshot",
		keyBindingDigest: claim.credentialBindingDigest,
		limitMicrousd: current.limitMicrousd,
		remainingMicrousd: current.remainingMicrousd,
		usageMicrousd: current.usageMicrousd,
		limitReset: current.limitReset,
		isManagementKey: current.isManagementKey,
		admissionDigest: current.admissionDigest,
	});
}

function conservativeSpend(observations: readonly ObserveEvent[]): Readonly<{
	providerReportedMicrousd: number;
	unreportedSettledUpperBoundMicrousd: number;
	accountedUpperBoundMicrousd: number;
}> {
	const values = observations
		.map((event) =>
			event.msg[0] === "DATA"
				? event.path === "eval/observation"
					? materialFreeObservationValue(event)
					: (event.msg[1] as EvalObservation)
				: undefined,
		)
		.filter((value): value is EvalObservation => value !== undefined);
	return latestRootEvalGraphSpend(
		values.map((value) => ({
			providerReportedMicrousd: value.providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd: value.unreportedSettledUpperBoundMicrousd,
			activeReservedMicrousd: value.activeReservedMicrousd,
		})),
	);
}

async function main(): Promise<void> {
	const generationRootArgument = process.argv[2];
	const ledgerPathArgument = process.argv[3];
	const verifyOnly = process.argv[4] === "--verify-only";
	if (
		generationRootArgument === undefined ||
		ledgerPathArgument === undefined ||
		!isAbsolute(generationRootArgument) ||
		!isAbsolute(ledgerPathArgument) ||
		ROOT_EVAL_LIVE_CAMPAIGN_SLOT !== "development-4" ||
		ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE !== "development" ||
		(process.argv[4] !== undefined && !verifyOnly)
	)
		throw new TypeError(
			"usage: GRAPHREFLY_ROOT_EVAL_CAMPAIGN_SLOT=development-4 recover-d145-source-failure <generation-root> <ledger-path>",
		);
	const generationRoot = resolve(generationRootArgument);
	const ledgerPath = resolve(ledgerPathArgument);
	if (
		(await realpath(generationRoot)) !== generationRoot ||
		basename(generationRoot) !== `current-${ROOT_EVAL_LIVE_GENERATION_REF}` ||
		(await realpath(dirname(ledgerPath))) !== dirname(ledgerPath)
	)
		throw new TypeError("D145 recovery path identity drifted");
	const privateRoot = dirname(generationRoot);
	const claim = await readClaim(generationRoot);
	const ledger = verifyOnly ? null : await readRootEvalD145CharterLedger(ledgerPath);
	if (
		ledger !== null &&
		(ledger.ledgerDigest !== claim.partitionLedgerDigest ||
			ledger.developmentSpentMicrousd !== claim.partitionSpentBeforeMicrousd)
	)
		throw new TypeError("D145 recovery claim/ledger authority drifted");
	const taskManifest = readRootEvalTaskManifest(ROOT_EVAL_LIVE_CAMPAIGN_SLOT);
	if (
		taskManifest.manifestDigest !== claim.taskManifestDigest ||
		taskManifest.taskSetRef !== claim.taskSetRef
	)
		throw new TypeError("D145 recovery task manifest drifted");
	const responses = await readProviderResponses(generationRoot);
	await assertDispatchReceipts(generationRoot, claim, responses);

	const temporary = await mkdtemp(join(await realpath(tmpdir()), "/graphrefly-d145-recovery-"));
	const observations: ObserveEvent[] = [];
	const sourceStageObservations: ObserveEvent[] = [];
	let failure: unknown = null;
	const topology = createRootEvalTopology({
		profileInput: createCurrentExactModelHarnessProfileInput(),
		currentKeyBefore: graphCurrentKey(claim),
		campaignRef: claim.generationRef,
		campaignPurpose: claim.campaignPurpose,
		taskSetRef: claim.taskSetRef,
		taskManifestDigest: taskManifest.manifestDigest,
		taskBindings: rootEvalTaskBindings(taskManifest.tasks),
		generationRef: claim.generationRef,
		replicateCount: claim.replicateCount,
		heldOutSealDigest: claim.heldOutSealDigest,
		budgetPartition: claim.budgetPartition,
		partitionHardCapMicrousd: claim.partitionHardCapMicrousd,
		partitionSpentBeforeMicrousd: claim.partitionSpentBeforeMicrousd,
		partitionLedgerDigest: claim.partitionLedgerDigest,
		developmentQualificationStreakBefore: claim.developmentQualificationStreakBefore,
		maxCostMicrousd: claim.campaignHardCapMicrousd - claim.partitionSpentBeforeMicrousd,
		reservationMicrousd: 200_000,
	});
	const stop = topology.graph
		.observe("eval/observation")
		.subscribe((event) => observations.push(event));
	const stopSourceStage = topology.graph
		.observe("eval/observation/source-stage-state")
		.subscribe((event) => sourceStageObservations.push(event));
	const executor = createRootEvalNoNetworkQualificationExecutor({
		repositoryRoot: resolve(import.meta.dirname, "../../../.."),
		materializationRoot: join(temporary, "workspaces"),
		pricing: claim.recoveryEnvelope.pricing,
		taskKind: "development-transfer",
		taskManifestSlot: ROOT_EVAL_LIVE_CAMPAIGN_SLOT,
		providerResponses: [],
		providerResponseForEffect(effect) {
			if (effect.workItemRole !== "source" || effect.attempt !== 1)
				throw new TypeError("D145 recovery attempted a non-recorded provider effect");
			const response = responses.get(effect.replicate);
			if (response === undefined || response.admissionId !== effect.admissionId)
				throw new TypeError("D145 recovery provider effect correlation drifted");
			return response;
		},
	});
	try {
		await runRootEval(topology, executor.execute);
		throw new TypeError("D145 recovery unexpectedly reached a terminal finding");
	} catch (error) {
		failure = error;
	} finally {
		stop();
		stopSourceStage();
		await executor.dispose(failure);
		await rm(temporary, { recursive: true, force: true });
	}
	if (!(failure instanceof Error) || failure.message !== EXPECTED_FAILURE)
		throw new TypeError("D145 recovery did not reproduce the exact source failure");
	if (executor.providerRequestSummaries().length !== 5)
		throw new TypeError("D145 recovery did not consume exactly five frozen responses");
	const spend = conservativeSpend(observations);
	if (
		spend.providerReportedMicrousd < 1 ||
		spend.accountedUpperBoundMicrousd > ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD
	)
		throw new TypeError("D145 recovery Graph-visible spend was invalid");
	if (verifyOnly) {
		const sourceStageSpend = conservativeSpend(sourceStageObservations);
		const sourceStageBudgetProgress = sourceStageObservations.flatMap((event) =>
			event.msg[0] === "DATA"
				? [
						{
							providerCallCount: (event.msg[1] as EvalObservation).providerCallCount,
							providerReportedMicrousd: (event.msg[1] as EvalObservation).providerReportedMicrousd,
							activeReservedMicrousd: (event.msg[1] as EvalObservation).activeReservedMicrousd,
						},
					]
				: [],
		);
		process.stdout.write(
			`${JSON.stringify({
				disposition: "verified-no-network-replay",
				providerCalls: 5,
				providerReportedMicrousd: spend.providerReportedMicrousd,
				unreportedSettledUpperBoundMicrousd: spend.unreportedSettledUpperBoundMicrousd,
				accountedUpperBoundMicrousd: spend.accountedUpperBoundMicrousd,
				sourceStageProviderReportedMicrousd: sourceStageSpend.providerReportedMicrousd,
				sourceStageUnreportedSettledUpperBoundMicrousd:
					sourceStageSpend.unreportedSettledUpperBoundMicrousd,
				sourceStageBudgetProgress,
			})}\n`,
		);
		return;
	}
	if (ledger === null) throw new TypeError("D145 recovery ledger was unavailable");
	const evidence = constructRootEvalLiveEvidence({
		claim,
		currentKeyBefore: claim.recoveryEnvelope.currentKeyBefore,
		currentKeyAfter: null,
		pricing: claim.recoveryEnvelope.pricing,
		zeroByok: claim.recoveryEnvelope.zeroByok,
		providerCalls: 5,
		observationProvenance: "exact-response-no-network-recovery",
		graphResult: null,
		partialGraphObservations: observations,
		failure,
		cleanupDisposition: "complete",
	});
	const nextLedger = advanceRootEvalD145CharterLedger({
		ledger,
		generationRef: claim.generationRef,
		campaignPurpose: claim.campaignPurpose,
		taskSetRef: claim.taskSetRef,
		taskManifestDigest: claim.taskManifestDigest,
		budgetPartition: claim.budgetPartition,
		providerReportedMicrousd: spend.providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd: spend.unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd: spend.accountedUpperBoundMicrousd,
		admissionStatus: evidence.admissionReport.status,
		developmentQualification: null,
		evidenceDigest: evidence.evidenceDigest,
	});
	const transaction = await commitRootEvalD145CharterTransaction({
		journalPath: join(privateRoot, ".d145-charter-transaction.v1.json"),
		privateRoot: generationRoot,
		charterLedgerPath: ledgerPath,
		previousLedgerDigest: ledger.ledgerDigest,
		evidence,
		nextLedger,
	});
	process.stdout.write(
		`${JSON.stringify({
			disposition: evidence.disposition,
			observationProvenance: evidence.observationProvenance,
			providerCalls: evidence.providerCalls,
			providerReportedMicrousd: spend.providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd: spend.unreportedSettledUpperBoundMicrousd,
			accountedUpperBoundMicrousd: spend.accountedUpperBoundMicrousd,
			efficacyClaim: evidence.efficacyClaim,
			persistence: transaction.persistence,
			charterLedgerDigest: nextLedger.ledgerDigest,
		})}\n`,
	);
}

await main();
