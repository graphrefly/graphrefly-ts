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
	D46_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD46Implementation,
} from "./d46-bounded-inspection-implementation-manifest.js";
import {
	type D46QualificationBundleV1,
	validateD46QualificationBundle,
} from "./d46-bounded-inspection-qualification.js";
import {
	acquireD49DispatchClaim,
	composeD49Preclaim,
	constructD49LiveBundle,
	consumeD49DispatchClaim,
	D49_LIVE_GENERATION_REF,
	D49_LIVE_PRIVATE_ROOT,
	persistD49LiveBundle,
	prepareD49PrivateRoot,
} from "./d49-deadline-live-gates.js";
import {
	D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD49LiveImplementation,
} from "./d49-deadline-live-implementation-manifest.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const D48_BASELINE_COMMIT = "d0958365ac309c283bc25d485ea64a299c7c911f";
const D48_QUALIFICATION_ARTIFACT_DIGEST =
	"sha256:e641976cb66ac74af95c90fd7469354d18008ac88546d8587c5f942923427448";
const D48_QUALIFICATION_DIGEST =
	"sha256:47f794dbe9c85c379f80645e9dfed9a9200a0181a80d3b73b9d42e462e37718a";
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const operatorRoot = resolve(import.meta.dirname, "../.private/empirical-memory-rerun-avoidance");
const credentialPath = join(operatorRoot, "openrouter.env");
const zeroByokPath = join(operatorRoot, "d49-fresh-zero-byok-browser-attestation.v1.json");
const qualificationPath = join(
	operatorRoot,
	"current-graph-native-d48-qualified",
	"current-graph-native-bounded-inspection-deadline-2026-08-21-d48-v1.json",
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
						`D49 git gate failed: ${Buffer.concat(stderr).toString("utf8").slice(0, 2_048)}`,
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
			throw new TypeError("D49 private input identity failed");
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError("D49 private input changed during read");
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
		if (token !== null) throw new TypeError("D49 credential contains duplicate keys");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D49 credential is unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-21.d45.v1" as const,
	});
}

async function assertGenerationAbsent(): Promise<void> {
	const path = join(D49_LIVE_PRIVATE_ROOT, D49_LIVE_GENERATION_REF);
	await lstat(path).then(
		() => {
			throw new TypeError("D49 live generation already exists");
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

await prepareD49PrivateRoot(D49_LIVE_PRIVATE_ROOT);
if ((await measureD46Implementation()) !== D46_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D49 D48 implementation manifest drifted");
const liveImplementationManifestDigest = await measureD49LiveImplementation();
if (liveImplementationManifestDigest !== D49_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D49 live implementation manifest drifted");
const implementationCommit = await runGit(["rev-parse", "HEAD"]);
await runGit(["merge-base", "--is-ancestor", D48_BASELINE_COMMIT, implementationCommit]);
const implementationPaths = [
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d44-d45-live-gates.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-authority.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-composition.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d46-bounded-inspection-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d49-deadline-live-gates.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/d49-deadline-live-implementation-manifest.ts",
	"packages/ts/evals/empirical-memory-rerun-avoidance/run-d49-deadline-live.ts",
];
if ((await runGit(["status", "--porcelain=v1", "--", ...implementationPaths])) !== "")
	throw new TypeError("D49 live implementation worktree drifted");
await assertGenerationAbsent();
const qualificationBytes = await readPrivate(qualificationPath, 16 * 1_048_576);
if (empiricalSha256(qualificationBytes) !== D48_QUALIFICATION_ARTIFACT_DIGEST)
	throw new TypeError("D49 qualification artifact drifted");
const qualification = validateD46QualificationBundle(
	strictJsonCodec.decode(qualificationBytes) as D46QualificationBundleV1,
);
if (qualification.qualification.qualificationDigest !== D48_QUALIFICATION_DIGEST)
	throw new TypeError("D49 qualification coordinates drifted");
const credential = parseCredential(await readPrivate(credentialPath, 16_384));
const pricing = await readD44D45FreshPricing({ fetchImpl: globalThis.fetch, nowMs: Date.now() });
const zeroByok = admitD44D45FreshZeroByok({
	bytes: await readPrivate(zeroByokPath, 16_384),
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD49Preclaim({ pricing, zeroByok, credential });
const claim = await acquireD49DispatchClaim({
	privateRoot: D49_LIVE_PRIVATE_ROOT,
	preclaim,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D48_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D48_QUALIFICATION_DIGEST,
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
const executionAuthority = await consumeD49DispatchClaim({ claim, currentKeyAdmission });
let providerCalls = 0;
const executor = createD44LiveExecutor({
	repositoryRoot,
	materializationRoot: join(D49_LIVE_PRIVATE_ROOT, ".workspaces"),
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
	throw new TypeError("D49 provider call accounting drifted");
const bundle = constructD49LiveBundle({
	authority: executionAuthority,
	pricing,
	zeroByok,
	implementationCommit,
	implementationManifestDigest: liveImplementationManifestDigest,
	qualificationArtifactDigest: D48_QUALIFICATION_ARTIFACT_DIGEST,
	qualificationDigest: D48_QUALIFICATION_DIGEST,
	providerCalls,
	measurement,
});
const persistence = await persistD49LiveBundle({ privateRoot: D49_LIVE_PRIVATE_ROOT, bundle });
process.stdout.write(
	`${JSON.stringify({
		disposition: bundle.disposition,
		implementationCommit,
		implementationManifestDigest: liveImplementationManifestDigest,
		qualificationArtifactDigest: D48_QUALIFICATION_ARTIFACT_DIGEST,
		qualificationDigest: D48_QUALIFICATION_DIGEST,
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
