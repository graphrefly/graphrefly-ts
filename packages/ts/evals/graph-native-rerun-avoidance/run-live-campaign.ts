import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { empiricalStrictJsonDigest, sameBytes } from "./canonical.js";
import {
	CURRENT_IMPLEMENTATION_MANIFEST_DIGEST,
	CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	CURRENT_QUALIFICATION_DIGEST,
	measureCurrentImplementation,
} from "./implementation-manifest.js";
import {
	admitD65LivePartialReplicateResult as admitCurrentLivePartialReplicateResult,
	admitD65LiveReplicateResult as admitCurrentLiveReplicateResult,
	createD65LiveGraphCampaignAuthority as createCurrentLiveGraphCampaignAuthority,
	snapshotD65LiveCampaignEvidence as snapshotCurrentLiveCampaignEvidence,
	snapshotD65LivePartialCampaignEvidence as snapshotCurrentLivePartialCampaignEvidence,
	startD65LiveReplicateExecution as startCurrentLiveReplicateExecution,
	takeD65LiveAdmittedReplicate as takeCurrentLiveAdmittedReplicate,
} from "./live-campaign-authority.js";
import {
	constructCurrentLiveCampaignBundle,
	persistCurrentLiveCampaignBundle,
} from "./live-campaign-bundle.js";
import {
	acquireCurrentLiveDispatchClaim,
	CURRENT_LIVE_GENERATION_REF,
	CURRENT_LIVE_PRIVATE_ROOT,
	composeCurrentLivePreclaim,
	consumeCurrentLiveDispatchClaim,
	prepareCurrentLivePrivateRoot,
} from "./live-campaign-claim.js";
import { runCurrentLiveInjectedNoNetworkQualification } from "./live-campaign-qualification.js";
import { createD44LiveExecutor, D44_D45_BASELINE_COMMIT } from "./live-effect-executor.js";
import {
	admitD44D45FreshZeroByok,
	type D44D45CredentialV1,
	readD44D45FreshPricing,
} from "./live-preflight.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";
import { runD65ReplicateMeasurement } from "./replicate-measurement.js";
import { D65_REPLICATE_COUNT } from "./replicated-campaign-authority.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/graph-native-rerun-avoidance");
const credentialPath = resolve(
	process.env.GRAPHREFLY_EVAL_CREDENTIAL_PATH ??
		join(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance/openrouter.env"),
);
const zeroByokPath = resolve(
	process.env.GRAPHREFLY_EVAL_ZERO_BYOK_PATH ?? join(operatorRoot, "fresh-zero-byok.v1.json"),
);

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
						`Current git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
					),
				);
		});
	});
}

async function readPrivate(path: string, maxBytes: number): Promise<Uint8Array> {
	const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
	try {
		const stat = await handle.stat();
		if (
			!stat.isFile() ||
			stat.nlink !== 1 ||
			(stat.mode & 0o777) !== 0o600 ||
			stat.size < 1 ||
			stat.size > maxBytes ||
			(await realpath(path)) !== path
		)
			throw new TypeError("Current private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("Current private input changed during read");
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

function parseCredential(bytes: Uint8Array): D44D45CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const line of text.split(/\r?\n/u)) {
		const match = /^OPENROUTER_API_KEY=(.*)$/u.exec(line);
		if (match === null) continue;
		if (token !== null) throw new TypeError("Current credential file contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("Current credential was unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2",
		credentialBindingRevision: "2026-08-21.d45.v1",
	});
}

async function assertGenerationAbsent(): Promise<void> {
	const generationPath = join(CURRENT_LIVE_PRIVATE_ROOT, CURRENT_LIVE_GENERATION_REF);
	await lstat(generationPath).then(
		() => {
			throw new TypeError("Current live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareCurrentLivePrivateRoot(CURRENT_LIVE_PRIVATE_ROOT);
const implementationManifestDigest = await measureCurrentImplementation();
if (implementationManifestDigest !== CURRENT_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("current live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
const implementationPaths = [
	"packages/ts/evals/graph-native-rerun-avoidance",
	"packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.current.test.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("Current live implementation worktree drifted");
await assertGenerationAbsent();
const liveQualification = await runCurrentLiveInjectedNoNetworkQualification();
if (
	liveQualification.qualificationDigest !== CURRENT_QUALIFICATION_DIGEST ||
	empiricalStrictJsonDigest(liveQualification) !== CURRENT_QUALIFICATION_ARTIFACT_DIGEST ||
	liveQualification.providerNetworkCalls !== 0 ||
	!liveQualification.responseSchemaRejectionsQualified ||
	!liveQualification.materialFreeProgressQualified ||
	!liveQualification.liveCapabilityReplayRejected ||
	!liveQualification.forgedLiveCapabilityRejected ||
	!liveQualification.partialCampaignEvidenceQualified
)
	throw new TypeError("Current injected live qualification drifted");

const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeCurrentLivePreclaim({ pricing, zeroByok, credential });
const claim = await acquireCurrentLiveDispatchClaim({
	privateRoot: CURRENT_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
});
let currentKeyCalls = 0;
const currentKeyAdmission = await createOpenRouterCurrentKeySpendAdmissionCapability({
	fetch: async (request, init) => {
		currentKeyCalls += 1;
		return await globalThis.fetch(request, init);
	},
}).read({
	credential,
	expectedLimitMicrousd: 32_000_000,
	requiredRemainingMicrousd: 6_000_000,
	signal: AbortSignal.timeout(30_000),
});
const liveCapability = await consumeCurrentLiveDispatchClaim({ claim, currentKeyAdmission });
const authority = createCurrentLiveGraphCampaignAuthority({
	liveCampaignCapability: liveCapability,
});
let providerCalls = 0;
let measurement:
	| Readonly<{
			disposition: "success";
			evidence: ReturnType<typeof snapshotCurrentLiveCampaignEvidence>;
	  }>
	| Readonly<{
			disposition: "partial-failure";
			partialEvidence: ReturnType<typeof snapshotCurrentLivePartialCampaignEvidence>;
	  }>
	| null = null;

for (let index = 2; index <= D65_REPLICATE_COUNT; index += 1) {
	const effect = takeCurrentLiveAdmittedReplicate(authority);
	if (effect === null) {
		measurement = Object.freeze({
			disposition: "partial-failure" as const,
			partialEvidence: snapshotCurrentLivePartialCampaignEvidence(authority),
		});
		break;
	}
	if (effect.replicateIndex !== index)
		throw new TypeError("Current live replicate admission order drifted");
	const execution = startCurrentLiveReplicateExecution(authority, effect);
	const executor = createD44LiveExecutor({
		repositoryRoot,
		materializationRoot: join(CURRENT_LIVE_PRIVATE_ROOT, ".workspaces", `replicate-${index}`),
		baselineCommit: D44_D45_BASELINE_COMMIT,
		bearerToken: credential.bearerToken,
		fetchImpl: async (request, init) => {
			providerCalls += 1;
			return await globalThis.fetch(request, init);
		},
	});
	const replicate = await runD65ReplicateMeasurement({
		executor,
		injectedNoNetwork: false,
		replicateExecution: execution,
		onProgress(progress) {
			process.stderr.write(
				`${JSON.stringify({ kind: "graph-progress", replicateIndex: index, ...progress })}\n`,
			);
		},
	});
	if (replicate.disposition === "partial-failure") {
		admitCurrentLivePartialReplicateResult(
			authority,
			execution,
			replicate.partialEvidence,
			replicate.retryWaitElapsedMs,
		);
		measurement = Object.freeze({
			disposition: "partial-failure" as const,
			partialEvidence: snapshotCurrentLivePartialCampaignEvidence(authority),
		});
		break;
	}
	admitCurrentLiveReplicateResult(
		authority,
		execution,
		replicate.evidence,
		replicate.retryWaitElapsedMs,
	);
}
if (measurement === null) {
	if (takeCurrentLiveAdmittedReplicate(authority) !== null)
		throw new TypeError(
			"Current live campaign admitted beyond its frozen four-replicate continuation",
		);
	measurement = Object.freeze({
		disposition: "success" as const,
		evidence: snapshotCurrentLiveCampaignEvidence(authority),
	});
}

const bundle = constructCurrentLiveCampaignBundle({
	claim,
	preclaim,
	currentKeyAdmission,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistCurrentLiveCampaignBundle({
	privateRoot: CURRENT_LIVE_PRIVATE_ROOT,
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest,
		qualificationArtifactDigest: CURRENT_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: CURRENT_QUALIFICATION_DIGEST,
		pricingObservationDigest: pricing.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
		claimDigest: claim.claimDigest,
		currentKeyCalls,
		currentKeyRemainingMicrousd: currentKeyAdmission.remainingMicrousd,
		providerCalls,
		bundleDigest: bundle.bundleDigest,
		graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null,
		partialGraphEvidenceDigest: bundle.partialGraphEvidence?.evidenceDigest ?? null,
		frozenGatePassed: bundle.graphEvidence?.frozenGatePassed ?? false,
		causalAttribution: bundle.causalAttribution,
		efficacyClaim: bundle.efficacyClaim,
		persistence,
	})}\n`,
);
