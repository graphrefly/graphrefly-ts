import { spawn } from "node:child_process";
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
import { checkRootEvalGeneratedArtifacts } from "./generate-root-eval-artifacts.js";
import {
	assertCurrentImplementationRuntime,
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import {
	awaitRootEvalCallerSettlement,
	createRootEvalLiveExecutor,
	type RootEvalLiveExecutor,
} from "./root-eval-live.js";
import {
	acquireRootEvalLiveClaim,
	constructRootEvalLiveEvidence,
	persistRootEvalLiveEvidence,
	persistRootEvalLivePreclaimFailure,
	qualifyRootEvalLivePrivateInputs,
	ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
	ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
	ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
	ROOT_EVAL_LIVE_GENERATION_REF,
	type RootEvalLiveClaim,
	type RootEvalLiveCredential,
	type RootEvalLiveCurrentKeyAdmission,
	type RootEvalLivePricingObservation,
	type RootEvalLiveZeroByokObservation,
	readRootEvalLiveCurrentKey,
	readRootEvalLivePricing,
} from "./root-eval-live-authority.js";

export const ROOT_EVAL_LIVE_EXECUTION_APPROVAL = "graphrefly-ts:D125" as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_APPROVAL =
	"graphrefly-ts:D116" as const;
export const ROOT_EVAL_LIVE_MOST_RECENT_SUCCESSFUL_CANONICAL_CLOSEOUT =
	"graphrefly-ts:D117" as const;
export const ROOT_EVAL_LIVE_CONSUMED_D121_APPROVAL = "graphrefly-ts:D121" as const;
export const ROOT_EVAL_LIVE_D121_REPAIR_RECEIPT = "graphrefly-ts:D124" as const;

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const privateRoot = resolve(join(operatorRoot, "current-live-d125"));
const credentialPath = resolve(
	join(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
);
const zeroByokPath = resolve(join(operatorRoot, "fresh-zero-byok-d125.v12.json"));
const LIVE_FETCH = globalThis.fetch;
const pnpm = resolve(process.execPath, "../pnpm");

async function runPrecredentialGate(command: string, args: readonly string[]): Promise<void> {
	await new Promise<void>((resolvePromise, rejectPromise) => {
		const child = spawn(command, [...args], {
			cwd: repositoryRoot,
			stdio: "inherit",
			shell: false,
		});
		child.once("error", rejectPromise);
		child.once("close", (code, signal) => {
			if (code === 0) resolvePromise();
			else
				rejectPromise(
					new TypeError(
						`root eval D125 precredential gate failed: ${command} ${args.join(" ")} (${signal ?? code})`,
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

async function assertFreshGeneration(): Promise<void> {
	for (const path of [
		join(privateRoot, `.${ROOT_EVAL_LIVE_GENERATION_REF}.disposition.v15.json`),
		join(privateRoot, ROOT_EVAL_LIVE_GENERATION_REF),
		join(privateRoot, ".d125-provider-dispatches"),
	] as const)
		await lstat(path).then(
			() => {
				throw new TypeError("root eval D125 single-use generation was already consumed");
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
}): Promise<void> {
	const evidence = constructRootEvalLiveEvidence(input);
	const persistence = await persistRootEvalLiveEvidence({ privateRoot, evidence });
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
		})}\n`,
	);
}

async function executeClaimedCampaign(input: {
	readonly claimCommit: Awaited<ReturnType<typeof acquireRootEvalLiveClaim>>;
	readonly credential: RootEvalLiveCredential;
	readonly pricing: RootEvalLivePricingObservation;
	readonly zeroByok: RootEvalLiveZeroByokObservation;
	readonly currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	readonly initialFailure?: unknown;
}): Promise<void> {
	const claim = input.claimCommit.claim;
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
			maxCostMicrousd: ROOT_EVAL_LIVE_CAMPAIGN_HARD_CAP_MICROUSD,
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
	});
}

async function main(): Promise<void> {
	if (
		process.env.GRAPHREFLY_D125_ISOLATED_LIVE_CHILD !== "1" ||
		process.env.NODE_OPTIONS !== undefined ||
		process.env.NODE_PATH !== undefined ||
		process.execArgv.length !== 2 ||
		process.execArgv[0] !== "--import" ||
		process.execArgv[1] !== "tsx"
	)
		throw new TypeError("root eval D125 live entry requires the clean precredential bootstrap");
	await runPrecredentialGates();
	assertCurrentImplementationRuntime();
	if ((await measureCurrentImplementation()) !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("root eval live implementation manifest drifted");
	await checkRootEvalGeneratedArtifacts();
	const implementationCommit = await runGit(["rev-parse", "HEAD"]);
	if (!/^[0-9a-f]{40}$/u.test(implementationCommit))
		throw new TypeError("root eval live implementation commit was invalid");
	await mkdir(privateRoot, { recursive: true, mode: 0o700 });
	await chmod(privateRoot, 0o700);
	await assertFreshGeneration();
	let credential: RootEvalLiveCredential;
	let pricing: RootEvalLivePricingObservation;
	let zeroByok: RootEvalLiveZeroByokObservation;
	let currentKeyBefore: RootEvalLiveCurrentKeyAdmission;
	try {
		const privateInputs = await qualifyRootEvalLivePrivateInputs({ credentialPath, zeroByokPath });
		credential = privateInputs.credential;
		zeroByok = privateInputs.zeroByok;
		pricing = await readRootEvalLivePricing({ fetchImpl: LIVE_FETCH });
		currentKeyBefore = await readRootEvalLiveCurrentKey({
			fetchImpl: LIVE_FETCH,
			credential,
		});
	} catch (error) {
		return await persistPreclaimFailure(error);
	}
	const implementationCoordinate = `worktree:${implementationCommit}:${CURRENT_IMPLEMENTATION_MANIFEST_DIGEST}`;
	let acquisition: Awaited<ReturnType<typeof acquireRootEvalLiveClaim>>;
	try {
		acquisition = await acquireRootEvalLiveClaim({
			privateRoot,
			implementationCoordinate,
			implementationManifestDigest: CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
			qualificationArtifactDigest: ROOT_EVAL_CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
			qualificationDigest: ROOT_EVAL_CURRENT_QUALIFICATION_DIGEST,
			taskBindingDigest: ROOT_EVAL_CURRENT_TASK_BINDING_DIGEST,
			pricing,
			zeroByok,
			credential,
			currentKeyBefore,
		});
	} catch (error) {
		return await persistPreclaimFailure(error);
	}
	await executeClaimedCampaign({
		claimCommit: acquisition,
		credential,
		pricing,
		zeroByok,
		currentKeyBefore,
		initialFailure:
			acquisition.postCommitFailureDigest === null
				? undefined
				: new TypeError("root eval live claim post-commit verification failed"),
	});
}

await main();
