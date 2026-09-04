import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, lstat, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ObserveEvent } from "../../src/graph/inspect.js";
import { empiricalStrictJsonDigest } from "./canonical.js";
import { createCurrentExactModelHarnessProfileInput } from "./current-exact-profile.js";
import {
	createRootEvalTopology,
	type EvalBudgetState,
	type EvalCampaignTerminal,
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
import { readRootEvalD145CharterLedger } from "./root-eval-charter-ledger.js";
import {
	advanceRootEvalD152Ledger,
	commitRootEvalD152Transaction,
	nextRootEvalD152DevelopmentOrdinal,
	type RootEvalD152Ledger,
	readRootEvalD152Ledger,
	recoverRootEvalD152Transaction,
} from "./root-eval-d152-ledger.js";
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
	ROOT_EVAL_LIVE_OPERATOR_CONFIGURATION_NAME,
	ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD,
	ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_NAME,
	ROOT_EVAL_LIVE_REPLICATE_COUNT,
	ROOT_EVAL_LIVE_TASK_SET_REF,
	type RootEvalLiveBoundedCurrentness,
	type RootEvalLiveClaim,
	type RootEvalLiveCredential,
	type RootEvalLiveCurrentKeyAdmission,
	type RootEvalLivePricingObservation,
	type RootEvalLiveZeroByokObservation,
	readRootEvalLiveCurrentKey,
	readRootEvalLivePrecredentialGateReceipt,
	readRootEvalLivePricing,
	readRootEvalLiveRefreshablePrecredentialGateReceipt,
	replaceRootEvalLivePrecredentialGateReceipt,
} from "./root-eval-live-authority.js";
import {
	ROOT_EVAL_D157_HORIZON_SLOTS,
	readRootEvalTaskManifest,
	rootEvalDevelopmentOrdinal,
	rootEvalTaskBindings,
} from "./root-eval-task.js";
import {
	ensureRootEvalDevelopmentTaskManifest,
	readRootEvalD157HorizonReceipt,
	readRootEvalFrozenDevelopmentManifestAudit,
} from "./root-eval-task-manifest-store.js";
import { settledRootEvalSpend } from "./settled-spend.js";

export const ROOT_EVAL_LIVE_EXECUTION_APPROVAL =
	"user-authorized:d157-development-5:usd-4.138575:development-usd-40" as const;
export const ROOT_EVAL_LIVE_EXECUTION_APPROVAL_SLOT = "development-5" as const;
export const ROOT_EVAL_LIVE_EXECUTION_APPROVAL_HARD_CAP_MICROUSD = 4_138_575 as const;
export const ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_OPEN = true as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_APPROVAL =
	"graphrefly-ts:D116" as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_CLOSEOUT =
	"graphrefly-ts:D117" as const;
export const ROOT_EVAL_LIVE_CONSUMED_D121_APPROVAL = "graphrefly-ts:D121" as const;
export const ROOT_EVAL_LIVE_D121_REPAIR_RECEIPT = "graphrefly-ts:D124" as const;
export const ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_STATE =
	process.env.GRAPHREFLY_ROOT_EVAL_EXECUTION_AUTHORITY;

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const privateRoot = resolve(join(operatorRoot, `current-${ROOT_EVAL_LIVE_GENERATION_REF}`));
const historicalCharterLedgerPath = resolve(join(operatorRoot, "d145-charter-ledger.v4.json"));
const charterLedgerPath = resolve(join(operatorRoot, "d152-charter-ledger.v1.json"));
const charterTransactionPath = resolve(join(operatorRoot, "d152-charter-transaction.v1.json"));
const credentialPath = resolve(
	join(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
);
const operatorConfigurationPath = resolve(
	join(operatorRoot, ROOT_EVAL_LIVE_OPERATOR_CONFIGURATION_NAME),
);
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
						`root eval D152 precredential gate failed: ${command} ${args.join(" ")} (${signal ?? code})`,
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
		join(privateRoot, `.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v21.json`),
		join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF),
		join(privateRoot, ".d152-provider-dispatches"),
	] as const)
		await lstat(path).then(
			() => {
				throw new TypeError("root eval D152 single-use generation was already consumed");
			},
			(error: unknown) => {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			},
		);
}

async function persistOrReusePrecredentialGateReceipt(
	currentness: RootEvalLiveBoundedCurrentness,
): Promise<void> {
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	await assertFreshGeneration();
	const receiptPath = join(privateRoot, ROOT_EVAL_LIVE_PRECREDENTIAL_GATE_RECEIPT_NAME);
	const exists = await lstat(receiptPath).then(
		() => true,
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
			throw error;
		},
	);
	if (exists) {
		try {
			const receipt = await readRootEvalLivePrecredentialGateReceipt({ privateRoot });
			if (
				receipt.implementationCommit === currentness.implementationCommit &&
				receipt.repositoryStateDigest === currentness.repositoryStateDigest &&
				receipt.artifactSetDigest === currentness.artifactSetDigest
			)
				return;
		} catch {}
		// Strict admission can reject an old closure coordinate before currentness
		// comparison. Require the old receipt to remain self-consistent before the
		// still-unconsumed generation is allowed to replace it atomically.
		await readRootEvalLiveRefreshablePrecredentialGateReceipt({ privateRoot });
		await replaceRootEvalLivePrecredentialGateReceipt({ privateRoot, currentness });
		return;
	}
	await persistRootEvalLivePrecredentialGateReceipt({ privateRoot, currentness });
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
	readonly budgetReceipt: EvalBudgetState | null;
	readonly claim: RootEvalLiveClaim;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	readonly currentKeyAfter: RootEvalLiveCurrentKeyAdmission | null;
	readonly providerCalls: number;
	readonly graphResult: RootEvalRunResult | null;
	readonly stoppedTerminal?: EvalCampaignTerminal | null;
	readonly partialGraphObservations: readonly ObserveEvent[];
	readonly failure: unknown | null;
	readonly cleanupDisposition: "complete" | "failed";
	readonly charterLedger: RootEvalD152Ledger;
}): Promise<void> {
	const conservativeSpend = settledRootEvalSpend({
		budget: input.budgetReceipt,
		providerCalls: input.providerCalls,
		authorizedMaximumMicrousd: Math.min(
			input.claim.campaignHardCapMicrousd,
			input.claim.partitionHardCapMicrousd - input.claim.partitionSpentBeforeMicrousd,
		),
	});
	const evidence = constructRootEvalLiveEvidence({
		...input,
		failure:
			input.failure ??
			(conservativeSpend.complete
				? null
				: new Error("independent Graph budget receipt unavailable")),
	});
	if (input.charterLedger.ledgerDigest !== input.claim.partitionLedgerDigest)
		throw new TypeError("root eval D152 claim and charter ledger drifted before commit");
	const {
		providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd,
	} = conservativeSpend;
	const terminalQualification =
		evidence.admissionReport.status === "admitted"
			? evidence.graphResult?.observations
					.map(materialFreeObservationValue)
					.filter((value) => value?.finding !== "pending")
					.at(-1)?.developmentQualification
			: null;

	const nextLedger = advanceRootEvalD152Ledger({
		ledger: input.charterLedger,
		generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
		taskSetRef: input.claim.taskSetRef,
		taskManifestDigest: input.claim.taskManifestDigest,
		providerReportedMicrousd,
		unreportedSettledUpperBoundMicrousd,
		accountedUpperBoundMicrousd,
		admissionStatus: evidence.admissionReport.status,
		developmentQualification: terminalQualification ?? null,
		evidenceDigest: evidence.evidenceDigest,
	});
	const transaction = await commitRootEvalD152Transaction({
		journalPath: charterTransactionPath,
		privateRoot,
		ledgerPath: charterLedgerPath,
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
			stoppingReason:
				evidence.stoppedTerminal?.stoppingReason ??
				evidence.graphResult?.finding.stoppingReason ??
				null,
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
	readonly charterLedger: RootEvalD152Ledger;
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
	let stoppedTerminal: EvalCampaignTerminal | null = null;
	let currentKeyAfter: RootEvalLiveCurrentKeyAdmission | null = null;
	let failure: unknown | null = input.initialFailure ?? null;
	let cleanupDisposition: "complete" | "failed" = "complete";
	const partialGraphObservations: ObserveEvent[] = [];
	let executor: RootEvalLiveExecutor | null = null;
	let stopObservation: () => void = () => undefined;
	let stopBudget: () => void = () => undefined;
	let budgetReceipt: EvalBudgetState | null = null;
	const callerCancellation = new AbortController();
	const processSignalHandlers = new Map<NodeJS.Signals, () => void>();
	for (const signal of ["SIGHUP", "SIGINT", "SIGTERM"] as const) {
		const handler = () => {
			const error = new Error(`root eval live runner received ${signal}`);
			failure ??= error;
			if (!callerCancellation.signal.aborted) callerCancellation.abort(error);
		};
		processSignalHandlers.set(signal, handler);
		process.once(signal, handler);
	}
	try {
		if (failure !== null) throw failure;
		const topology = createRootEvalTopology({
			profileInput: createCurrentExactModelHarnessProfileInput(),
			currentKeyBefore: graphCurrentKey(bindingDigest, input.currentKeyBefore),
			campaignRef: ROOT_EVAL_LIVE_GENERATION_REF,
			campaignPurpose: ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE,
			taskSetRef: ROOT_EVAL_LIVE_TASK_SET_REF,
			taskManifestDigest: taskManifest.manifestDigest,
			taskDefinitions: taskManifest.tasks,
			taskBindings: rootEvalTaskBindings(taskManifest.tasks, ROOT_EVAL_LIVE_GENERATION_REF),
			generationRef: ROOT_EVAL_LIVE_GENERATION_REF,
			replicateCount: ROOT_EVAL_LIVE_REPLICATE_COUNT,
			heldOutSealDigest: ROOT_EVAL_LIVE_HELD_OUT_SEAL_DIGEST,
			budgetPartition: ROOT_EVAL_LIVE_BUDGET_PARTITION,
			partitionHardCapMicrousd: ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD,
			partitionSpentBeforeMicrousd:
				String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
					? input.charterLedger.developmentSpentMicrousd
					: input.charterLedger.confirmatorySpentMicrousd,
			partitionLedgerDigest: input.charterLedger.ledgerDigest,
			developmentQualificationStreakBefore: input.charterLedger.developmentQualificationStreak,
			maxCostMicrousd: Math.min(
				ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
				ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD -
					(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
						? input.charterLedger.developmentSpentMicrousd
						: input.charterLedger.confirmatorySpentMicrousd),
			),
			reservationMicrousd: 200_000,
		});
		stopBudget = topology.nodes.budgets.subscribe((message) => {
			if (message[0] === "DATA") budgetReceipt = message[1] as EvalBudgetState;
		});
		stopObservation = topology.graph.observe("eval/observation").subscribe((event) => {
			partialGraphObservations.push(event);
			const observation = materialFreeObservationValue(event);
			if (observation !== undefined)
				process.stderr.write(`${JSON.stringify({ stream: "graph-progress", observation })}\n`);
		});
		executor = createRootEvalLiveExecutor({
			graph: topology.graph,
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
		const outcome = await awaitRootEvalCallerSettlement(
			() => runRootEval(topology, executor!.execute, { signal: callerCancellation.signal }),
			{
				onDeadline: (error) => callerCancellation.abort(error),
			},
		);
		if (outcome.finding === null) stoppedTerminal = outcome.terminal;
		else graphResult = outcome;
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
	try {
		await persistClaimedEvidence({
			budgetReceipt,
			claim,
			currentKeyBefore: input.currentKeyBefore,
			currentKeyAfter,
			pricing: input.pricing,
			zeroByok: input.zeroByok,
			providerCalls,
			graphResult,
			stoppedTerminal,
			partialGraphObservations,
			failure,
			cleanupDisposition,
			charterLedger: input.charterLedger,
		});
	} finally {
		stopBudget();
		for (const [signal, handler] of processSignalHandlers) process.off(signal, handler);
	}
}

async function main(): Promise<void> {
	if (
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY !== undefined ||
		process.env.GRAPHREFLY_D152_ISOLATED_LIVE_CHILD !== "1" ||
		process.env.NODE_OPTIONS !== undefined ||
		process.env.NODE_PATH !== undefined ||
		process.execArgv.length !== 2 ||
		process.execArgv[0] !== "--import" ||
		process.execArgv[1] !== "tsx"
	)
		throw new TypeError("root eval D152 live entry requires the clean precredential bootstrap");
	const mode = process.argv[2] ?? "--execute-live";
	if (mode !== "--execute-live") throw new TypeError("root eval D152 live entry mode was invalid");
	if (
		!ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_OPEN ||
		ROOT_EVAL_LIVE_EXECUTION_AUTHORITY_STATE !== ROOT_EVAL_LIVE_EXECUTION_APPROVAL ||
		ROOT_EVAL_LIVE_CAMPAIGN_SLOT !== ROOT_EVAL_LIVE_EXECUTION_APPROVAL_SLOT ||
		ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD !==
			ROOT_EVAL_LIVE_EXECUTION_APPROVAL_HARD_CAP_MICROUSD ||
		ROOT_EVAL_LIVE_BUDGET_PARTITION !== "development-usd-40" ||
		ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD !== 40_000_000 ||
		!ROOT_EVAL_D157_HORIZON_SLOTS.includes(
			ROOT_EVAL_LIVE_CAMPAIGN_SLOT as (typeof ROOT_EVAL_D157_HORIZON_SLOTS)[number],
		) ||
		ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE !== "development"
	)
		throw new TypeError("root eval D157 development horizon live authority is unavailable");
	let currentness: RootEvalLiveBoundedCurrentness | undefined;
	let privateInputs: Awaited<ReturnType<typeof qualifyRootEvalLivePrivateInputs>> | undefined;
	let pricing: RootEvalLivePricingObservation | undefined;
	let currentKeyBefore: RootEvalLiveCurrentKeyAdmission | undefined;
	let acquisition: Awaited<ReturnType<typeof acquireRootEvalLiveClaim>> | undefined;
	await recoverRootEvalD152Transaction(charterTransactionPath);
	const historicalLedger = await readRootEvalD145CharterLedger(historicalCharterLedgerPath);
	const charterLedger = await readRootEvalD152Ledger({
		path: charterLedgerPath,
		historicalLedger,
	});
	if (String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development") {
		const currentOrdinal = rootEvalDevelopmentOrdinal(ROOT_EVAL_LIVE_CAMPAIGN_SLOT)!;
		if (currentOrdinal !== nextRootEvalD152DevelopmentOrdinal(charterLedger))
			throw new TypeError("root eval D152 development slot did not follow charter order");
		await readRootEvalD157HorizonReceipt();
		for (const [index, entry] of charterLedger.entries.entries()) {
			const historicalManifest = await readRootEvalFrozenDevelopmentManifestAudit(
				`development-${index + 1}`,
			);
			if (
				entry.taskSetRef !== historicalManifest.taskSetRef ||
				entry.taskManifestDigest !== historicalManifest.manifestDigest
			)
				throw new TypeError("root eval D157 prior development manifest drifted from ledger");
		}
		await ensureRootEvalDevelopmentTaskManifest(ROOT_EVAL_LIVE_CAMPAIGN_SLOT);
	} else readRootEvalTaskManifest("confirmatory");
	const partitionSpentBeforeMicrousd =
		String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development"
			? charterLedger.developmentSpentMicrousd
			: charterLedger.confirmatorySpentMicrousd;
	if (
		partitionSpentBeforeMicrousd >= ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD ||
		(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "development" &&
			(charterLedger.developmentQualificationStreak === 2 || charterLedger.heldOutConsumed)) ||
		(String(ROOT_EVAL_LIVE_CAMPAIGN_PURPOSE) === "confirmatory" &&
			(charterLedger.developmentQualificationStreak !== 2 || charterLedger.heldOutConsumed))
	)
		throw new TypeError("root eval D152 charter ledger does not authorize this generation");
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
					throw new TypeError("root eval D152 stage requires bounded currentness");
				if (stage === "persist-receipt") {
					await persistOrReusePrecredentialGateReceipt(currentness);
					const receipt = await readRootEvalLivePrecredentialGateReceipt({ privateRoot });
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
					privateInputs = await qualifyRootEvalLivePrivateInputs({
						credentialPath,
						zeroByokPath: operatorConfigurationPath,
						precredentialPrivateRoot: privateRoot,
						currentness,
					});
					return;
				}
				if (privateInputs === undefined)
					throw new TypeError("root eval D152 stage requires admitted private inputs");
				if (stage === "control-plane-admission") {
					pricing = await readRootEvalLivePricing({ fetchImpl: LIVE_FETCH });
					preclaimPersistenceArmed = true;
					currentKeyBefore = await readRootEvalLiveCurrentKey({
						fetchImpl: LIVE_FETCH,
						credential: privateInputs.credential,
						minimumRemainingMicrousd: Math.min(
							ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
							ROOT_EVAL_LIVE_PARTITION_HARD_CAP_MICROUSD - partitionSpentBeforeMicrousd,
						),
					});
					return;
				}
				if (pricing === undefined || currentKeyBefore === undefined)
					throw new TypeError("root eval D152 stage requires admitted control-plane state");
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
					throw new TypeError("root eval D152 campaign requires a committed claim");
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

// D155: campaigns and independent qualification share an execution exclusion
// as well as an atomic budget ledger. A stale lock requires explicit recovery.
const { acquireRootEvalD152Execution } = await import("./root-eval-d152-ledger.js");
const releaseExecution = await acquireRootEvalD152Execution(charterLedgerPath);
try {
	await main();
} finally {
	await releaseExecution();
}
