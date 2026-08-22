import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, sameBytes } from "./canonical.js";
import {
	createD44LiveExecutor,
	D44_D45_BASELINE_COMMIT,
	runD44D45Measurement,
} from "./d44-d45-live-composition.js";
import {
	acquireD44D45DispatchClaim,
	admitD44D45FreshZeroByok,
	composeD44D45Preclaim,
	constructD44D45LiveBundle,
	consumeD44D45DispatchClaim,
	D44_D45_LIVE_GENERATION_REF,
	D44_D45_LIVE_PRIVATE_ROOT,
	type D44D45CredentialV1,
	persistD44D45LiveBundle,
	prepareD44D45PrivateRoot,
	readD44D45FreshPricing,
} from "./d44-d45-live-gates.js";
import {
	D63_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD63Implementation,
} from "./d63-implementation-manifest.js";
import { validateD63QualificationBundle } from "./d63-withheld-semantic-qualification.js";
import {
	D64_LIVE_EXECUTION_MANIFEST_DIGEST,
	D64_QUALIFICATION_ARTIFACT_DIGEST,
	D64_QUALIFICATION_DIGEST,
	measureD64LiveExecution,
} from "./d64-live-execution-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const credentialPath = join(operatorRoot, "openrouter.env");
const zeroByokPath = join(operatorRoot, "d44-d45-zero-byok-2026-08-21.v1.json");
const qualificationPath = join(
	operatorRoot,
	"current-graph-native-d63-qualified-v2/current-graph-native-withheld-semantic-2026-08-22-d63-v2.json",
);
const QUALIFICATION_ARTIFACT_DIGEST = D64_QUALIFICATION_ARTIFACT_DIGEST;
const QUALIFICATION_DIGEST = D64_QUALIFICATION_DIGEST;

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
						`D44 git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
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
			throw new TypeError("D44 private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D44 private input changed during read");
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
		if (token !== null) throw new TypeError("D44 credential file contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D44 credential was unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2",
		credentialBindingRevision: "2026-08-21.d45.v1",
	});
}

async function assertGenerationAbsent(): Promise<void> {
	const path = join(D44_D45_LIVE_PRIVATE_ROOT, D44_D45_LIVE_GENERATION_REF);
	await lstat(path).then(
		() => {
			throw new TypeError("D44 live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareD44D45PrivateRoot(D44_D45_LIVE_PRIVATE_ROOT);
if ((await measureD63Implementation()) !== D63_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D44 qualified D63 implementation closure drifted");
const implementationManifestDigest = await measureD64LiveExecution();
if (implementationManifestDigest !== D64_LIVE_EXECUTION_MANIFEST_DIGEST)
	throw new TypeError("D44 live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
await runGit(["merge-base", "--is-ancestor", D44_D45_BASELINE_COMMIT, implementationCommit]);
const implementationPaths = [
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-graph-harness-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-graph-tool-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-mechanical-chat-adapter.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-graph-tool-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-gates.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d55-provider-boundary-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d61-public-semantic-scenarios.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d61-public-semantic-bundle-entry.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d61-semantic-recovery-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d61-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d63-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d63-withheld-semantic-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d64-live-execution-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/run-d44-d45-live.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("D44 live implementation worktree drifted");
await assertGenerationAbsent();
const qualificationBytes = await readPrivate(qualificationPath, 16 * 1_048_576);
if (empiricalSha256(qualificationBytes) !== QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D44 qualification artifact drifted");
const qualification = validateD63QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (qualification.qualification.qualificationDigest !== QUALIFICATION_DIGEST)
	throw new TypeError("D44 qualification digest drifted");
const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD44D45Preclaim({ pricing, zeroByok, credential });
const claim = await acquireD44D45DispatchClaim({
	privateRoot: D44_D45_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: QUALIFICATION_DIGEST,
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
const executionAuthority = await consumeD44D45DispatchClaim({ claim, currentKeyAdmission });
let providerCalls = 0;
const executor = createD44LiveExecutor({
	repositoryRoot,
	materializationRoot: join(D44_D45_LIVE_PRIVATE_ROOT, ".workspaces"),
	baselineCommit: D44_D45_BASELINE_COMMIT,
	bearerToken: credential.bearerToken,
	fetchImpl: async (request, init) => {
		providerCalls += 1;
		return await globalThis.fetch(request, init);
	},
});
const measurement = await runD44D45Measurement({ executor, injectedNoNetwork: false });
const bundle = constructD44D45LiveBundle({
	authority: executionAuthority,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest,
	qualificationArtifactDigest: QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistD44D45LiveBundle({
	privateRoot: D44_D45_LIVE_PRIVATE_ROOT,
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest,
		qualificationArtifactDigest: QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: QUALIFICATION_DIGEST,
		pricingObservationDigest: pricing.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
		claimDigest: claim.claimDigest,
		currentKeyCalls,
		currentKeyRemainingMicrousd: executionAuthority.currentKeyAdmission.remainingMicrousd,
		providerCalls,
		bundleDigest: bundle.bundleDigest,
		graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null,
		partialGraphEvidenceDigest: bundle.partialGraphEvidence?.evidenceDigest ?? null,
		causalAttribution: bundle.causalAttribution,
		efficacyClaim: bundle.efficacyClaim,
		persistence,
	})}\n`,
);
