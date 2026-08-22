import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, sameBytes } from "./canonical.js";
import { createD44LiveExecutor, D44_D45_BASELINE_COMMIT } from "./d44-d45-live-composition.js";
import {
	admitD44D45FreshZeroByok,
	type D44D45CredentialV1,
	readD44D45FreshPricing,
} from "./d44-d45-live-gates.js";
import {
	type D46BoundedInspectionAuthorityV1,
	lowerD46ProviderEffect,
	readD46ToolArguments,
} from "./d46-bounded-inspection-authority.js";
import { runD46BoundedInspectionMeasurement } from "./d46-bounded-inspection-composition.js";
import {
	D55_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD55Implementation,
} from "./d55-provider-boundary-implementation-manifest.js";
import { validateD55PersistedQualification } from "./d55-provider-boundary-qualification.js";
import {
	acquireD59DispatchClaim,
	composeD59Preclaim,
	constructD59LiveBundle,
	consumeD59DispatchClaim,
	D59_LIVE_GENERATION_REF,
	D59_LIVE_PRIVATE_ROOT,
	persistD59LiveBundle,
	prepareD59PrivateRoot,
} from "./d59-semantic-correction-live-gates.js";
import {
	D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD59LiveImplementation,
} from "./d59-semantic-correction-live-implementation-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const D55_BASELINE_COMMIT = "f7a511983e22f332769bd7cb453b8869c352747c";
const D55_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:35be33ce82a1d0c2c77c1a94fa2de1be57c19eba550d60ab99d785bc93ee53ed";
const D55_QUALIFICATION_DIGEST =
	"sha256:2127cf1580dd7f81e33c279ec1aa9c0ede8179d8f901090ff8f60bfe09209597";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const credentialPath = join(operatorRoot, "openrouter.env");
const zeroByokPath = join(operatorRoot, "d59-fresh-zero-byok-browser-attestation.v1.json");
const qualificationPath = join(
	operatorRoot,
	"current-graph-native-d55-qualified-v12",
	"current-graph-native-provider-boundary-2026-08-21-d55-v12.json",
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
						`D59 git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
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
			throw new TypeError("D59 private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D59 private input changed during read");
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
		if (token !== null) throw new TypeError("D59 credential contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D59 credential is unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-21.d45.v1" as const,
	});
}

function validateD55QualificationArtifact(bytes: Uint8Array): void {
	const decoded = validateD55PersistedQualification(
		strictJsonCodec.decode(bytes),
		D55_IMPLEMENTATION_MANIFEST_DIGEST,
	) as {
		readonly qualification: {
			readonly qualificationDigest: string;
			readonly exactSixArmsCompleted: boolean;
			readonly providerNetworkCalls: number;
			readonly credentialReads: number;
			readonly dispatchClaims: number;
		};
	};
	if (
		decoded.qualification.qualificationDigest !== D55_QUALIFICATION_DIGEST ||
		decoded.qualification.exactSixArmsCompleted !== true ||
		decoded.qualification.providerNetworkCalls !== 0 ||
		decoded.qualification.credentialReads !== 0 ||
		decoded.qualification.dispatchClaims !== 0
	)
		throw new TypeError("D59 D55 qualification gate failed");
}

async function assertGenerationAbsent(): Promise<void> {
	const path = join(D59_LIVE_PRIVATE_ROOT, D59_LIVE_GENERATION_REF);
	await lstat(path).then(
		() => {
			throw new TypeError("D59 live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareD59PrivateRoot(D59_LIVE_PRIVATE_ROOT);
if ((await measureD55Implementation()) !== D55_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D59 D55 implementation manifest drifted");
const liveImplementationManifestDigest = await measureD59LiveImplementation();
if (liveImplementationManifestDigest !== D59_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D59 live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
await runGit(["merge-base", "--is-ancestor", D55_BASELINE_COMMIT, implementationCommit]);
const implementationPaths = [
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-graph-harness-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-graph-tool-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-mechanical-chat-adapter.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d55-provider-boundary-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d55-provider-boundary-qualification.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d59-semantic-correction-live-gates.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d59-semantic-correction-live-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/run-d59-semantic-correction-live.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("D59 live implementation worktree drifted");
await assertGenerationAbsent();
const qualificationBytes = await readPrivate(qualificationPath, 16 * 1_048_576);
if (empiricalSha256(qualificationBytes) !== D55_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D59 qualification artifact drifted");
validateD55QualificationArtifact(qualificationBytes);
const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD59Preclaim({ pricing, zeroByok, credential });
const claim = await acquireD59DispatchClaim({
	privateRoot: D59_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D55_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D55_QUALIFICATION_DIGEST,
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
const executionAuthority = await consumeD59DispatchClaim({ claim, currentKeyAdmission });
let providerCalls = 0;
const executor = createD44LiveExecutor({
	repositoryRoot,
	materializationRoot: join(D59_LIVE_PRIVATE_ROOT, ".workspaces"),
	baselineCommit: D44_D45_BASELINE_COMMIT,
	bearerToken: credential.bearerToken,
	fetchImpl: async (request, init) => {
		providerCalls += 1;
		return await globalThis.fetch(request, init);
	},
	authorityAccess: {
		lowerProviderEffect: (authority, effect) =>
			lowerD46ProviderEffect(authority as D46BoundedInspectionAuthorityV1, effect),
		readToolArguments: (authority, effect) =>
			readD46ToolArguments(authority as D46BoundedInspectionAuthorityV1, effect),
	},
});
const measurement = await runD46BoundedInspectionMeasurement({
	executor,
	injectedNoNetwork: false,
});
if (measurement.providerCalls !== providerCalls)
	throw new TypeError("D59 provider call accounting drifted");
const bundle = constructD59LiveBundle({
	authority: executionAuthority,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D55_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D55_QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistD59LiveBundle({ privateRoot: D59_LIVE_PRIVATE_ROOT, bundle });
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest: liveImplementationManifestDigest,
		qualificationArtifactDigest: D55_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D55_QUALIFICATION_DIGEST,
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
