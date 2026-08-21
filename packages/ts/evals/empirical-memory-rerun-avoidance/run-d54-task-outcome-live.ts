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
	type D46QualificationBundleV1,
	validateD46QualificationBundle,
} from "./d46-bounded-inspection-qualification.js";
import {
	D52_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD52Implementation,
} from "./d52-task-outcome-implementation-manifest.js";
import {
	acquireD54DispatchClaim,
	composeD54Preclaim,
	constructD54LiveBundle,
	consumeD54DispatchClaim,
	D54_LIVE_GENERATION_REF,
	D54_LIVE_PRIVATE_ROOT,
	persistD54LiveBundle,
	prepareD54PrivateRoot,
} from "./d54-task-outcome-live-gates.js";
import {
	D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD54LiveImplementation,
} from "./d54-task-outcome-live-implementation-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const D52_BASELINE_COMMIT = "55f2b1fba1b216712f5d1c277221307d0650c219";
const D52_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:42807837b60f5ed4f6385d5df3f9d979d03b539cd3b5555ca238ef30e76b2d9d";
const D52_QUALIFICATION_DIGEST =
	"sha256:a41f43ea26e539f7f45910959e20e676e2fe2f3adc3410b82c6358664b996b1f";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const credentialPath = join(operatorRoot, "openrouter.env");
const zeroByokPath = join(operatorRoot, "d54-fresh-zero-byok-browser-attestation.v1.json");
const qualificationPath = join(
	operatorRoot,
	"current-graph-native-d52-qualified-v6",
	"current-graph-native-task-outcome-2026-08-21-d52-v2.json",
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
						`D54 git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
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
			throw new TypeError("D54 private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D54 private input changed during read");
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
		if (token !== null) throw new TypeError("D54 credential contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D54 credential is unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-21.d45.v1" as const,
	});
}

function validateD52QualificationArtifact(bytes: Uint8Array): void {
	const decoded = strictJsonCodec.decode(bytes) as {
		readonly schemaVersion?: unknown;
		readonly implementationManifestDigest?: unknown;
		readonly qualification?: {
			readonly schemaVersion?: unknown;
			readonly taskOutcome?: {
				readonly qualification?: { readonly qualificationDigest?: unknown };
			};
			readonly fullSixArm?: D46QualificationBundleV1;
		};
	};
	if (
		decoded.schemaVersion !== "graphrefly-ts.d52.persisted-qualification.v1" ||
		decoded.implementationManifestDigest !== D52_IMPLEMENTATION_MANIFEST_DIGEST ||
		decoded.qualification?.schemaVersion !== "graphrefly-ts.d52.full-qualification-bundle.v1" ||
		decoded.qualification.taskOutcome?.qualification?.qualificationDigest !==
			D52_QUALIFICATION_DIGEST ||
		decoded.qualification.fullSixArm === undefined
	)
		throw new TypeError("D54 D52 qualification coordinates drifted");
	const full = validateD46QualificationBundle(decoded.qualification.fullSixArm);
	if (
		full.qualification.exactSixArmsCompleted !== true ||
		full.qualification.evaluableArms !== 6 ||
		full.qualification.providerNetworkCalls !== 0 ||
		full.qualification.credentialReads !== 0 ||
		full.qualification.dispatchClaims !== 0
	)
		throw new TypeError("D54 D52 full qualification gate failed");
}

async function assertGenerationAbsent(): Promise<void> {
	const path = join(D54_LIVE_PRIVATE_ROOT, D54_LIVE_GENERATION_REF);
	await lstat(path).then(
		() => {
			throw new TypeError("D54 live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareD54PrivateRoot(D54_LIVE_PRIVATE_ROOT);
if ((await measureD52Implementation()) !== D52_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D54 D52 implementation manifest drifted");
const liveImplementationManifestDigest = await measureD54LiveImplementation();
if (liveImplementationManifestDigest !== D54_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D54 live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
await runGit(["merge-base", "--is-ancestor", D52_BASELINE_COMMIT, implementationCommit]);
const implementationPaths = [
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-model-harness-policy.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d43-graph-harness-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-graph-tool-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d45-mechanical-chat-adapter.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d52-task-outcome-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d54-task-outcome-live-gates.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d54-task-outcome-live-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/run-d54-task-outcome-live.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("D54 live implementation worktree drifted");
await assertGenerationAbsent();
const qualificationBytes = await readPrivate(qualificationPath, 16 * 1_048_576);
if (empiricalSha256(qualificationBytes) !== D52_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D54 qualification artifact drifted");
validateD52QualificationArtifact(qualificationBytes);
const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD54Preclaim({ pricing, zeroByok, credential });
const claim = await acquireD54DispatchClaim({
	privateRoot: D54_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D52_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D52_QUALIFICATION_DIGEST,
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
const executionAuthority = await consumeD54DispatchClaim({ claim, currentKeyAdmission });
let providerCalls = 0;
const executor = createD44LiveExecutor({
	repositoryRoot,
	materializationRoot: join(D54_LIVE_PRIVATE_ROOT, ".workspaces"),
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
	throw new TypeError("D54 provider call accounting drifted");
const bundle = constructD54LiveBundle({
	authority: executionAuthority,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D52_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D52_QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistD54LiveBundle({ privateRoot: D54_LIVE_PRIVATE_ROOT, bundle });
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest: liveImplementationManifestDigest,
		qualificationArtifactDigest: D52_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D52_QUALIFICATION_DIGEST,
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
