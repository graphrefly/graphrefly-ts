import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sameBytes } from "./canonical.js";
import { createD44LiveExecutor, D44_D45_BASELINE_COMMIT } from "./d44-d45-live-composition.js";
import {
	admitD44D45FreshZeroByok,
	type D44D45CredentialV1,
	readD44D45FreshPricing,
} from "./d44-d45-live-gates.js";
import { runD65ReplicateMeasurement } from "./d65-replicate-measurement.js";
import { D65_REPLICATE_COUNT } from "./d65-replicated-campaign-authority.js";
import { verifyD65PrivateD64Baseline } from "./d65-replicated-campaign-qualification.js";
import {
	D66_IMPLEMENTATION_MANIFEST_DIGEST,
	D66_QUALIFICATION_ARTIFACT_DIGEST,
	D66_QUALIFICATION_DIGEST,
	measureD66Implementation,
} from "./d66-implementation-manifest.js";
import { runD66RetryIdentityQualification } from "./d66-retry-identity-qualification.js";
import {
	admitD67LivePartialReplicateResult,
	admitD67LiveReplicateResult,
	createD67LiveGraphCampaignAuthority,
	snapshotD67LiveCampaignEvidence,
	snapshotD67LivePartialCampaignEvidence,
	startD67LiveReplicateExecution,
	takeD67LiveAdmittedReplicate,
} from "./d67-live-campaign-authority.js";
import {
	constructD67LiveCampaignBundle,
	persistD67LiveCampaignBundle,
} from "./d67-live-campaign-bundle.js";
import {
	acquireD67LiveDispatchClaim,
	composeD67LivePreclaim,
	consumeD67LiveDispatchClaim,
	D67_LIVE_GENERATION_REF,
	D67_LIVE_PRIVATE_ROOT,
	prepareD67LivePrivateRoot,
} from "./d67-live-campaign-claim.js";
import { runD67LiveInjectedNoNetworkQualification } from "./d67-live-campaign-qualification.js";
import {
	D67_LIVE_EXECUTION_MANIFEST_DIGEST,
	measureD67LiveExecution,
} from "./d67-live-execution-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const credentialPath = join(operatorRoot, "openrouter.env");
const zeroByokPath = join(operatorRoot, "d67-fresh-zero-byok-browser-attestation.v1.json");
const baselinePath = join(
	operatorRoot,
	"current-graph-native-d64-live",
	"current-graph-native-live-2026-08-22-d64-v1",
	"bundle.v1.json",
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
						`D67 git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
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
			throw new TypeError("D67 private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D67 private input changed during read");
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
		if (token !== null) throw new TypeError("D67 credential file contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D67 credential was unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2",
		credentialBindingRevision: "2026-08-21.d45.v1",
	});
}

async function assertGenerationAbsent(): Promise<void> {
	const generationPath = join(D67_LIVE_PRIVATE_ROOT, D67_LIVE_GENERATION_REF);
	await lstat(generationPath).then(
		() => {
			throw new TypeError("D67 live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareD67LivePrivateRoot(D67_LIVE_PRIVATE_ROOT);
const implementationManifestDigest = await measureD67LiveExecution();
if (implementationManifestDigest !== D67_LIVE_EXECUTION_MANIFEST_DIGEST)
	throw new TypeError("D67 live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
const implementationPaths = [
	"packages/ts/evals/empirical-memory-rerun-avoidance/d67-live-campaign-claim.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d65-live-campaign-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d67-live-campaign-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d67-live-campaign-bundle.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d67-live-campaign-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d67-live-execution-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/run-d67-live-campaign.ts",
	"packages/ts/src/__tests__/solutions-agentic-memory-work-item-rerun-avoidance.d67-live-campaign.test.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("D67 live implementation worktree drifted");
await assertGenerationAbsent();
await verifyD65PrivateD64Baseline(baselinePath);
if ((await measureD66Implementation()) !== D66_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D67 inherited D66 implementation drifted");
const d66Qualification = runD66RetryIdentityQualification();
if (
	d66Qualification.qualificationDigest !== D66_QUALIFICATION_DIGEST ||
	d66Qualification.artifactDigest !== D66_QUALIFICATION_ARTIFACT_DIGEST
)
	throw new TypeError("D67 D66 qualification coordinates drifted");
const liveQualification = await runD67LiveInjectedNoNetworkQualification();
if (
	liveQualification.d66QualificationDigest !== D66_QUALIFICATION_DIGEST ||
	liveQualification.providerNetworkCalls !== 0 ||
	!liveQualification.liveCapabilityReplayRejected ||
	!liveQualification.forgedLiveCapabilityRejected ||
	!liveQualification.partialCampaignEvidenceQualified
)
	throw new TypeError("D67 injected live qualification drifted");

const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD67LivePreclaim({ pricing, zeroByok, credential });
const claim = await acquireD67LiveDispatchClaim({
	privateRoot: D67_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D66_QUALIFICATION_DIGEST,
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
const liveCapability = await consumeD67LiveDispatchClaim({ claim, currentKeyAdmission });
const authority = createD67LiveGraphCampaignAuthority({ liveCampaignCapability: liveCapability });
let providerCalls = 0;
let measurement:
	| Readonly<{
			disposition: "success";
			evidence: ReturnType<typeof snapshotD67LiveCampaignEvidence>;
	  }>
	| Readonly<{
			disposition: "partial-failure";
			partialEvidence: ReturnType<typeof snapshotD67LivePartialCampaignEvidence>;
	  }>
	| null = null;

for (let index = 2; index <= D65_REPLICATE_COUNT; index += 1) {
	const effect = takeD67LiveAdmittedReplicate(authority);
	if (effect === null) {
		measurement = Object.freeze({
			disposition: "partial-failure" as const,
			partialEvidence: snapshotD67LivePartialCampaignEvidence(authority),
		});
		break;
	}
	if (effect.replicateIndex !== index)
		throw new TypeError("D67 live replicate admission order drifted");
	const execution = startD67LiveReplicateExecution(authority, effect);
	const executor = createD44LiveExecutor({
		repositoryRoot,
		materializationRoot: join(D67_LIVE_PRIVATE_ROOT, ".workspaces", `replicate-${index}`),
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
	});
	if (replicate.disposition === "partial-failure") {
		admitD67LivePartialReplicateResult(
			authority,
			execution,
			replicate.partialEvidence,
			replicate.retryWaitElapsedMs,
		);
		measurement = Object.freeze({
			disposition: "partial-failure" as const,
			partialEvidence: snapshotD67LivePartialCampaignEvidence(authority),
		});
		break;
	}
	admitD67LiveReplicateResult(
		authority,
		execution,
		replicate.evidence,
		replicate.retryWaitElapsedMs,
	);
}
if (measurement === null) {
	if (takeD67LiveAdmittedReplicate(authority) !== null)
		throw new TypeError("D67 live campaign admitted beyond its frozen four-replicate continuation");
	measurement = Object.freeze({
		disposition: "success" as const,
		evidence: snapshotD67LiveCampaignEvidence(authority),
	});
}

const bundle = constructD67LiveCampaignBundle({
	claim,
	preclaim,
	currentKeyAdmission,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D66_QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistD67LiveCampaignBundle({
	privateRoot: D67_LIVE_PRIVATE_ROOT,
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest,
		qualificationArtifactDigest: D66_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D66_QUALIFICATION_DIGEST,
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
