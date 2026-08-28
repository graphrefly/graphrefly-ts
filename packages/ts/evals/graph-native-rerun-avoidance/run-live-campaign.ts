import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import { empiricalStrictJsonDigest } from "./canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "./current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalCurrentKeySnapshot,
	materialFreeObservationValue,
	type RootEvalRunResult,
	runRootEval,
} from "./eval-topology.js";
import { checkRootEvalGeneratedArtifactSnapshot } from "./generate-root-eval-artifacts.js";
import {
	assertCurrentImplementationRuntime,
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import { runRootEvalPrecredentialStagePlan } from "./precredential-stage-coordinator.js";
import {
	advanceRootEvalD145CharterLedger,
	ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD,
	type RootEvalD145CharterLedger,
	readRootEvalD145CharterLedger,
} from "./root-eval-charter-ledger.js";
import {
	commitRootEvalD145CharterTransaction,
	recoverRootEvalD145CharterTransaction,
} from "./root-eval-charter-transaction.js";
import {
	awaitRootEvalCallerSettlement,
	createRootEvalLiveExecutor,
	type RootEvalLiveExecutor,
} from "./root-eval-live.js";
import {
	acquireRootEvalLiveClaim,
	constructRootEvalLiveEvidence,
	persistRootEvalLivePreclaimFailure,
	persistRootEvalLivePrecredentialGateReceipt,
	qualifyRootEvalLivePrivateInputPreflight,
	qualifyRootEvalLivePrivateInputs,
	ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
	ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
	ROOT_EVAL_LIVE_BUDGET_PARTITION,
	ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
	ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
	ROOT_EVAL_LIVE_CAMPAIGN_SLOT,
	ROOT_EVAL_LIVE_GENERATION_REF,
	ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
	ROOT_EVAL_LIVE_REPLICATE_COUNT,
	ROOT_EVAL_LIVE_TASK_SET_REF,
	type RootEvalLiveBoundedCurrentness,
	type RootEvalLiveClaim,
	type RootEvalLiveCredential,
	type RootEvalLiveCurrentKeyAdmission,
	type RootEvalLivePricingObservation,
	type RootEvalLiveZeroByokObservation,
	readRootEvalLiveCurrentKey,
	readRootEvalLivePricing,
} from "./root-eval-live-authority.js";
import { readRootEvalTaskManifest, rootEvalTaskBindings } from "./root-eval-task.js";
import { ensureRootEvalDevelopmentTaskManifest } from "./root-eval-task-manifest-store.js";

export const ROOT_EVAL_LIVE_EXECUTION_APPROVAL = "graphrefly-ts:D145" as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_APPROVAL =
	"graphrefly-ts:D116" as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_CLOSEOUT =
	"graphrefly-ts:D117" as const;
export const ROOT_EVAL_LIVE_CONSUMED_D121_APPROVAL = "graphrefly-ts:D121" as const;
export const ROOT_EVAL_LIVE_D121_REPAIR_RECEIPT = "graphrefly-ts:D124" as const;
export const ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_STATE = "open-by-graphrefly-ts:D145" as const;

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const privateRoot = resolve(join(operatorRoot, `current-${ROOT_EVAL_LIVE_GENERATION_REF}`));
const charterLedgerPath = resolve(join(operatorRoot, "d145-charter-ledger.v3.json"));
const charterTransactionPath = resolve(join(operatorRoot, "d145-charter-transaction.v1.json"));
const credentialPath = resolve(
	join(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
);
const zeroByokPath = resolve(join(operatorRoot, "fresh-zero-byok-d145.v16.json"));
const LIVE_FETCH = globalThis.fetch;
const pnpm = resolve(process.execPath, "../pnpm");

async function runPrecredentialGate(command: string, args: readonly string[]): Promise<void> {
	const gateEnvironment = { ...process.env };
	delete gateEnvironment.GRAPHREFLY_ROOT_EVAL_CAMPAIGN_SLOT;
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, [...args], {
			cwd: repositoryRoot,
			env: gateEnvironment,
			stdio: "inherit",
			shell: false,
		});
		child.once("error", rejectPromise);
		child.once("close", (code, signal) => {
			if (code === 0) resolvePromise();
			else
				rejectPromise(
					new TypeError(
						`root eval D145 precredential gate failed: ${command} ${args.join(" ")} (${signal ?? code})`,
					),
				);
		});
	});
}

async function runPrecredentialGates(): Promise<void> {
	const gates = [
		[
			pnpm,
			[
				"exec",
				"vitest",
				"run",
				"packages/ts/src/__tests__/solutions-agentic-memory-work-item-root-eval-topology.test.ts",
				"packages/ts/src/__tests__/solutions-agentic-memory-work-item-root-eval-live.test.ts",
				"--maxWorkers=1",
			],
		],
		[pnpm, ["test"]],
		[pnpm, ["run", "lint"]],
		[pnpm, ["run", "build"]],
		[
			process.execPath,
			[
				"/Users/davidchenallio/src/graphrefly/authority/federation.mjs",
				"check",
				"--workspace",
				"/Users/davidchenallio/src",
			],
		],
		[process.execPath, ["/Users/davidchenallio/src/graphrefly/dashboard/build.mjs", "--check"]],
		[
			pnpm,
			[
				"exec",
				"tsx",
				"packages/ts/evals/graph-native-rerun-avoidance/generate-root-eval-artifacts.ts",
				"--check",
			],
		],
		["/usr/bin/git", ["diff", "--check"]],
	] as const;
	for (const [command, args] of gates) await runPrecredentialGate(command, args);
}

async function runGit(args: readonly string[]): Promise<string> {
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("/usr/bin/git", [...args], {
			cwd: repositoryRoot,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let bytes = 0;
		for (const [stream, target] of [
			[child.stdout, stdout],
			[child.stderr, stderr],
		] as const)
			stream.on("data", (chunk: Buffer) => {
				bytes += chunk.byteLength;
				if (bytes > 1_048_576) child.kill("SIGKILL");
				target.push(chunk);
			});
		child.once("error", rejectPromise);
		child.once("close", (code) => {
			if (code === 0) resolvePromise(Buffer.concat(stdout).toString("utf8").trim());
			else
				rejectPromise(
					new TypeError(
						`root eval live git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
					),
				);
		});
	});
}

async function runGitOutputDigest(args: readonly string[], maxBytes: number): Promise<string> {
	return await new Promise((resolvePromise, rejectPromise) => {
		const child = spawn("/usr/bin/git", [...args], {
			cwd: repositoryRoot,
			stdio: ["ignore", "pipe", "pipe"],
			shell: false,
		});
		const hash = createHash("sha256");
		const stderr: Buffer[] = [];
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let exceeded = false;
		child.stdout.on("data", (chunk: Buffer) => {
			stdoutBytes += chunk.byteLength;
			if (stdoutBytes > maxBytes) {
				exceeded = true;
				child.kill("SIGKILL");
				return;
			}
			hash.update(chunk);
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderrBytes += chunk.byteLength;
			if (stderrBytes <= 65_536) stderr.push(chunk);
		});
		child.once("error", rejectPromise);
		child.once("close", (code) => {
			if (exceeded)
				rejectPromise(new TypeError("root eval live repository snapshot exceeded its byte bound"));
			else if (code === 0) resolvePromise(`sha256:${hash.digest("hex")}`);
			else
				rejectPromise(
					new TypeError(
						`root eval live repository snapshot failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
					),
				);
		});
	});
}

async function assertBoundedCurrentness(): Promise<RootEvalLiveBoundedCurrentness> {
	assertCurrentImplementationRuntime();
	if ((await measureCurrentImplementation()) !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("root eval live implementation manifest drifted");
	const artifactSnapshot = await checkRootEvalGeneratedArtifactSnapshot();
	const implementationCommit = await runGit(["rev-parse", "HEAD"]);
	if (!/^[0-9a-f]{40}$/u.test(implementationCommit))
		throw new TypeError("root eval live implementation commit was invalid");
	const diffDigest = await runGitOutputDigest(
		["diff", "HEAD", "--binary", "--no-ext-diff", "--", "."],
		32 * 1_048_576,
	);
	const statusDigest = await runGitOutputDigest(
		["status", "--porcelain=v1", "-z", "--untracked-files=all"],
		4 * 1_048_576,
	);
	const repositoryStateDigest = empiricalStrictJsonDigest({
		implementationCommit,
		diffDigest,
		statusDigest,
	});
	if (
		(await runGit(["rev-parse", "HEAD"])) !== implementationCommit ||
		(await runGitOutputDigest(
			["diff", "HEAD", "--binary", "--no-ext-diff", "--", "."],
			32 * 1_048_576,
		)) !== diffDigest ||
		(await runGitOutputDigest(
			["status", "--porcelain=v1", "-z", "--untracked-files=all"],
			4 * 1_048_576,
		)) !== statusDigest ||
		(await measureCurrentImplementation()) !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("root eval live repository changed during bounded currentness check");
	return Object.freeze({
		implementationCommit,
		repositoryStateDigest,
		artifactSetDigest: artifactSnapshot.artifactSetDigest,
	});
}

async function assertFreshGeneration(): Promise<void> {
	for (const path of [
		join(privateRoot, `.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v20.json`),
		join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF),
		join(privateRoot, ".d145-provider-dispatches"),
	] as const)
		await lstat(path).then(
			() => {
				throw new TypeError("root eval D145 single-use generation was already consumed");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);
}

function graphCurrentKey(
	credentialBindingDigest: string,
	currentKey: RootEvalLiveCurrentKeyAdmission,
): EvalCurrentKeySnapshot {
	return Object.freeze({
		kind: "eval-current-key-snapshot" as const,
		keyBindingDigest: credentialBindingDigest,
		limitMicrousd: currentKey.limitMicrousd,
		remainingMicrousd: currentKey.remainingMicrousd,
		usageMicrousd: currentKey.usageMicrousd,
		limitReset: currentKey.limitReset,
		isManagementKey: currentKey.isManagementKey,
		admissionDigest: currentKey.admissionDigest,
	});
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function persistPreclaimFailure(failure: unknown): Promise<never> {
	const persistence = await persistRootEvalLivePreclaimFailure({
		privateRoot,
		implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
		qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
		taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
		failure,
	});
	process.stdout.write(
		`${JSON.stringify({
			disposition: "preclaim-failure",
			executionApprovalRef: ROOT_EVAL_LIVE_EXECUTION_APPROVAL,
			generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
			failureDigest: empiricalStrictJsonDigest({ message: errorMessage(failure) }),
			persistence,
		})}\n`,
	);
	throw failure;
}

async function persistClaimedEvidence(input: {
	readonly claim: RootEvalLiveClaim;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	readonly currentKeyAfter: RootEvalLiveCurrentKeyAdmission | null;
	readonly providerCalls: number;
	readonly graphResult: RootEvalRunResult | null;
	readonly partialGraphObservations: readonly ObserveEvent[];
	readonly failure: unknown | null;
	readonly cleanupDisposition: "complete" | "failed";
	readonly charterLedger: RootEvalD145CharterLedger;
}): Promise<void> {
	const evidence = constructRootEvalLiveEvidence(input);
	if (input.charterLedger.ledgerDigest !== input.claim.partitionLedgerDigest)
		throw new TypeError("root eval D145 claim and charter ledger drifted before commit");
	const observationValues = [
		...(input.graphResult?.observations ?? []),
		...input.partialGraphObservations,
	]
		.map(materialFreeObservationValue)
		.filter((value) => value !== undefined);
	if (input.providerCalls > 0 && observationValues.length === 0)
		throw new TypeError("root eval D145 provider spend lacked Graph-visible usage authority");
	const spendSnapshots = [
		...observationValues.map((observation) => ({
			providerReportedMicrousd: observation.providerReportedMicrousd,
			unreportedSettledUpperBoundMicrousd:
				observation.unreportedSettledUpperBoundMicrousd + observation.activeReservedMicrousd,
		})),
		...(input.graphResult === null
			? []
			: [
					{
						providerReportedMicrousd: input.graphResult.finding.providerReportedMicrousd,
						unreportedSettledUpperBoundMicrousd:
							input.graphResult.finding.unreportedSettledUpperBoundMicrousd +
							input.graphResult.finding.activeReservedMicrousd,
					},
				]),
	];
	const conservativeSpend = spendSnapshots.reduce(
		(maximum, snapshot) =>
			snapshot.providerReportedMicrousd + snapshot.unreportedSettledUpperBoundMicrousd >
			maximum.providerReportedMicrousd + maximum.unreportedSettledUpperBoundMicrousd
				? snapshot
				: maximum,
		{ providerReportedMicrousd: 0, unreportedSettledUpperBoundMicrousd: 0 },
	);
	const { providerReportedMicrousd, unreportedSettledUpperBoundMicrousd } = conservativeSpend;
	const accountedUpperBoundMicrousd =
		providerReportedMicrousd + unreportedSettledUpperBoundMicrousd;
	const terminalQualification = observationValues
		.filter((observation) => observation.finding !== "pending")
		.at(-1)?.developmentQualification;
	const nextLedger = advanceRootEvalD145CharterLedger({
		ledger: input.charterLedger,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
		taskSetRef: input.claim.taskSetRef,
		taskManifestDigest: input.claim.taskManifestDigest,
		budgetPartition: ROOT_EVAL_LIVE_BUDGET_PARTITION,
		providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd,
		developmentQualification: terminalQualification ?? null,
		evidenceDigest: evidence.evidenceDigest,
	});
	const transaction = await commitRootEvalD145CharterTransaction({
		journalPath: charterTransactionPath,
		privateRoot,
		charterLedgerPath,
		previousLedgerDigest: input.charterLedger.ledgerDigest,
		evidence,
		nextLedger,
	});
	const persistence = transaction.persistence;
	process.stdout.write(
		`${JSON.stringify({
			disposition: evidence.disposition,
			executionApprovalRef: ROOT_EVAL_LIVE_EXECUTION_APPROVAL,
			generationRef: evidence.generationRef,
			claimDigest: evidence.claimDigest,
			evidenceDigest: evidence.evidenceDigest,
			providerCalls: evidence.providerCalls,
			currentKeyRemainingMicrousd: input.currentKeyAfter?.remainingMicrousd ?? null,
			finding: evidence.graphResult?.finding.finding ?? null,
			stoppingReason: evidence.graphResult?.finding.stoppingReason ?? null,
			efficacyClaim: evidence.efficacyClaim,
			causalAttribution: evidence.causalAttribution,
			admissionReport: evidence.admissionReport,
			persistence,
			charterLedgerDigest: nextLedger.ledgerDigest,
			developmentQualificationStreak: nextLedger.developmentQualificationStreak,
			partitionSpentMicrousd:
				String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
					? nextLedger.developmentSpentMicrousd
					: nextLedger.confirmatorySpentMicrousd,
		})}\n`,
	);
}

async function executeClaimedCampaign(input: {
	readonly claimCommit: Awaited<ReturnType<typeof acquireRootEvalLiveClaim>>;
	readonly credential: RootEvalLiveCredential;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	readonly charterLedger: RootEvalD145CharterLedger;
	readonly initialFailure?: unknown;
}): Promise<void> {
	const claim = input.claimCommit.claim;
	const taskManifest = readRootEvalTaskManifest(ROOT_EVAL_LIVE_CAMPAIGN_SLOT);
	if (
		taskManifest.manifestDigest !== claim.taskManifestDigest ||
		taskManifest.taskSetRef !== claim.taskSetRef
	)
		throw new TypeError("root eval claim-bound task manifest drifted before campaign creation");
	const bindingDigest = claim.credentialBindingDigest;
	let providerCalls = 0;
	let graphResult: RootEvalRunResult | null = null;
	let currentKeyAfter: RootEvalLiveCurrentKeyAdmission | null = null;
	let failure: unknown | null = input.initialFailure ?? null;
	let cleanupDisposition: "complete" | "failed" = "complete";
	const partialGraphObservations: ObserveEvent[] = [];
	let executor: RootEvalLiveExecutor | null = null;
	let stopObservation: () => void = () => undefined;
	const callerCancellation = new AbortController();
	try {
		if (failure !== null) throw failure;
		const topology = createRootEvalTopology({
			profileInput: createCurrentExactModelHarnessProfileInput(),
			currentKeyBefore: graphCurrentKey(bindingDigest, input.currentKeyBefore),
			campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
			campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
			taskSetRef: ROOT_EVAL_LIVE_TASK_SET_REF,
			taskManifestDigest: taskManifest.manifestDigest,
			taskBindings: rootEvalTaskBindings(taskManifest.tasks),
			generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
			replicateCount: ROOT_EVAL_LIVE_REPLICATE_COUNT,
			heldOutSealDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
			budgetPartition: ROOT_EVAL_LIVE_BUDGET_PARTITION,
			partitionHardCapMicrousd: ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD,
			partitionSpentBeforeMicrousd:
				String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
					? input.charterLedger.developmentSpentMicrousd
					: input.charterLedger.confirmatorySpentMicrousd,
			partitionLedgerDigest: input.charterLedger.ledgerDigest,
			developmentQualificationStreakBefore: input.charterLedger.developmentQualificationStreak,
			maxCostMicrousd:
				ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD -
				(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
					? input.charterLedger.developmentSpentMicrousd
					: input.charterLedger.confirmatorySpentMicrousd),
			reservationMicrousd: 200_000,
		});
		stopObservation = topology.graph.observe("eval/observation").subscribe((event) => {
			partialGraphObservations.push(event);
			const observation = materialFreeObservationValue(event);
			if (observation !== undefined)
				process.stderr.write(`${JSON.stringify({ stream: "graph-progress", observation })}\n`);
		});
		executor = createRootEvalLiveExecutor({
			repositoryRoot,
			materializationRoot: join(privateRoot, ".workspaces"),
			privateRoot,
			claimCommit: input.claimCommit,
			bearerToken: input.credential.bearerToken,
			pricing: {
				inputMicrousdPerMillionTokens: input.pricing.inputMicrousdPerMillionTokens,
				outputMicrousdPerMillionTokens: input.pricing.outputMicrousdPerMillionTokens,
				cacheReadMicrousdPerMillionTokens: input.pricing.cacheReadMicrousdPerMillionTokens,
			},
			taskKind:
				String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
					? "development-transfer"
					: "confirmatory-transfer",
			taskManifestSlot: ROOT_EVAL_LIVE_CAMPAIGN_SLOT,
			taskManifest,
			diagnosticMode:
				String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development" ? "development-private" : "none",
			onProviderCall: () => {
				providerCalls += 1;
			},
			observeCurrentKey: async (_effect, signal) => {
				const observed = await readRootEvalLiveCurrentKey({
					fetchImpl: LIVE_FETCH,
					credential: input.credential,
					minimumRemainingMicrousd: 0,
					signal,
				});
				currentKeyAfter = observed;
				return graphCurrentKey(bindingDigest, observed);
			},
		});
		graphResult = await awaitRootEvalCallerSettlement(
			() => runRootEval(topology, executor!.execute, { signal: callerCancellation.signal }),
			{
				onDeadline: (error) => callerCancellation.abort(error),
			},
		);
	} catch (error) {
		failure = error;
	} finally {
		stopObservation();
		if (executor !== null)
			try {
				await executor.dispose(failure);
			} catch (error) {
				cleanupDisposition = "failed";
				failure ??= error;
			}
	}
	if (currentKeyAfter === null)
		try {
			currentKeyAfter = await readRootEvalLiveCurrentKey({
				fetchImpl: LIVE_FETCH,
				credential: input.credential,
				minimumRemainingMicrousd: 0,
			});
		} catch (error) {
			failure ??= error;
		}
	await persistClaimedEvidence({
		claim,
		currentKeyBefore: input.currentKeyBefore,
		currentKeyAfter,
		pricing: input.pricing,
		zeroByok: input.zeroByok,
		providerCalls,
		graphResult,
		partialGraphObservations,
		failure,
		cleanupDisposition,
		charterLedger: input.charterLedger,
	});
}

async function main(): Promise<void> {
	if (
		process.env.GRAPHREFLY_D145_ISOLATED_LIVE_CHILD !== "1" ||
		process.env.NODE_OPTIONS !== undefined ||
		process.env.NODE_PATH !== undefined ||
		process.execArgv.length !== 2 ||
		process.execArgv[0] !== "--import" ||
		process.execArgv[1] !== "tsx"
	)
		throw new TypeError("root eval D145 live entry requires the clean precredential bootstrap");
	const mode = process.argv[2] ?? "--execute-live";
	if (
		mode !== "--execute-live" &&
		mode !== "--prepare-browser" &&
		mode !== "--qualify-private-inputs"
	)
		throw new TypeError("root eval D145 live entry mode was invalid");
	if (ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_STATE !== ("open-by-graphrefly-ts:D145" as string))
		throw new TypeError("root eval D145 live authority is unavailable");
	let currentness: RootEvalLiveBoundedCurrentness | undefined;
	let privateInputs: Awaited<ReturnType<typeof qualifyRootEvalLivePrivateInputs>> | undefined;
	let pricing: RootEvalLivePricingObservation | undefined;
	let currentKeyBefore: RootEvalLiveCurrentKeyAdmission | undefined;
	let acquisition: Awaited<ReturnType<typeof acquireRootEvalLiveClaim>> | undefined;
	await recoverRootEvalD145CharterTransaction(charterTransactionPath);
	const charterLedger = await readRootEvalD145CharterLedger(charterLedgerPath);
	if (String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development") {
		const expectedSlot = `development-${
			charterLedger.entries.filter((entry) => entry.campaignPurpose === "development").length + 1
		}`;
		if (ROOT_EVAL_LIVE_CAMPAIGN_SLOT !== expectedSlot)
			throw new TypeError("root eval D145 development slot did not follow charter order");
		await ensureRootEvalDevelopmentTaskManifest(ROOT_EVAL_LIVE_CAMPAIGN_SLOT);
	} else readRootEvalTaskManifest("confirmatory");
	if (
		(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development" &&
			(charterLedger.developmentQualificationStreak === 2 ||
				charterLedger.developmentSpentMicrousd >= ROOT_EVAL_D145_PARTITION_HARD_CAP_MICROUSD)) ||
		(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "confirmatory" &&
			(charterLedger.developmentQualificationStreak !== 2 || charterLedger.heldOutConsumed))
	)
		throw new TypeError("root eval D145 charter ledger does not authorize this generation");
	let preclaimPersistenceArmed = false;
	try {
		await runRootEvalPrecredentialStagePlan({
			mode,
			run: async (stage) => {
				if (stage === "long-gates") {
					await runPrecredentialGates();
					return;
				}
				if (stage === "bounded-currentness") {
					currentness = await assertBoundedCurrentness();
					return;
				}
				if (currentness === undefined)
					throw new TypeError("root eval D145 stage requires bounded currentness");
				if (stage === "persist-receipt") {
					await mkdir(privateRoot, { recursive: true, mode: 0o700 });
					await chmod(privateRoot, 0o700);
					await assertFreshGeneration();
					const receipt = await persistRootEvalLivePrecredentialGateReceipt({
						privateRoot,
						currentness,
					});
					process.stdout.write(
						`${JSON.stringify({
							disposition: "precredential-gates-passed",
							executionApprovalRef: ROOT_EVAL_LIVE_EXECUTION_APPROVAL,
							generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
							completedAtMs: receipt.completedAtMs,
							receiptDigest: receipt.receiptDigest,
						})}\n`,
					);
					return;
				}
				if (stage === "private-input-admission") {
					await mkdir(privateRoot, { recursive: true, mode: 0o700 });
					await chmod(privateRoot, 0o700);
					await assertFreshGeneration();
					preclaimPersistenceArmed = mode === "--execute-live";
					if (mode === "--qualify-private-inputs") {
						const preflight = await qualifyRootEvalLivePrivateInputPreflight({
							credentialPath,
							zeroByokPath,
							precredentialPrivateRoot: privateRoot,
							currentness,
						});
						process.stdout.write(
							`${JSON.stringify({
								...preflight,
								executionApprovalRef: ROOT_EVAL_LIVE_EXECUTION_APPROVAL,
							})}\n`,
						);
					} else {
						privateInputs = await qualifyRootEvalLivePrivateInputs({
							credentialPath,
							zeroByokPath,
							precredentialPrivateRoot: privateRoot,
							currentness,
						});
					}
					return;
				}
				if (privateInputs === undefined)
					throw new TypeError("root eval D145 stage requires admitted private inputs");
				if (stage === "control-plane-admission") {
					pricing = await readRootEvalLivePricing({ fetchImpl: LIVE_FETCH });
					currentKeyBefore = await readRootEvalLiveCurrentKey({
						fetchImpl: LIVE_FETCH,
						credential: privateInputs.credential,
					});
					return;
				}
				if (pricing === undefined || currentKeyBefore === undefined)
					throw new TypeError("root eval D145 stage requires admitted control-plane state");
				if (stage === "claim") {
					const implementationCoordinate = `worktree:${currentness.implementationCommit}:${CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`;
					const taskManifest = readRootEvalTaskManifest(ROOT_EVAL_LIVE_CAMPAIGN_SLOT);
					acquisition = await acquireRootEvalLiveClaim({
						privateRoot,
						implementationCoordinate,
						implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
						qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
						qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
						taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
						taskManifestDigest: taskManifest.manifestDigest,
						pricing,
						zeroByok: privateInputs.zeroByok,
						credential: privateInputs.credential,
						currentKeyBefore,
						partitionSpentBeforeMicrousd:
							String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
								? charterLedger.developmentSpentMicrousd
								: charterLedger.confirmatorySpentMicrousd,
						partitionLedgerDigest: charterLedger.ledgerDigest,
						developmentQualificationStreakBefore: charterLedger.developmentQualificationStreak,
					});
					return;
				}
				if (acquisition === undefined)
					throw new TypeError("root eval D145 campaign requires a committed claim");
				await executeClaimedCampaign({
					claimCommit: acquisition,
					credential: privateInputs.credential,
					pricing,
					zeroByok: privateInputs.zeroByok,
					currentKeyBefore,
					charterLedger,
					initialFailure:
						acquisition.postCommitFailureDigest === null
							? undefined
							: new TypeError("root eval live claim post-commit verification failed"),
				});
			},
		});
	} catch (error) {
		if (mode === "--execute-live" && preclaimPersistenceArmed && acquisition === undefined)
			return await persistPreclaimFailure(error);
		throw error;
	}
}

await main();
