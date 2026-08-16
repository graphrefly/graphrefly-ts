import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, record, sameBytes } from "./canonical.js";
import {
	admitCurrentGraphLiveZeroByok as admitD10CurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim as composeD10CurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing as readD10CurrentGraphLiveOfficialPricing,
} from "./d8-current-live-preflight.js";
import { createCurrentGraphOpenRouterExecutor } from "./d8-current-openrouter-adapter.js";
import { validateD9QualificationBundle } from "./d9-current-pre-live-qualification.js";
import {
	D10_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD10Implementation,
} from "./d10-current-implementation-manifest.js";
import {
	persistD10CurrentGraphLiveBundle,
	persistD10CurrentGraphLivePreexecutionFailure,
	runD10CurrentGraphLiveMeasurement,
	validateD10CurrentGraphLiveBundle,
} from "./d10-current-live.js";
import {
	acquireD10CurrentGraphLiveDispatchClaim,
	consumeD10CurrentGraphLiveDispatchClaim,
	D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
} from "./d10-current-live-claim.js";
import {
	D10_CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
	D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
	D10_D9_IMPLEMENTATION_MANIFEST_DIGEST,
	D10_D9_QUALIFICATION_ARTIFACT_DIGEST,
	D10_D9_QUALIFICATION_BUNDLE_DIGEST,
	D10_D9_QUALIFICATION_DIGEST,
} from "./d10-current-live-coordinates.js";
import {
	D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	validateD10CurrentGraphLiveQualificationBundle as validateD10Qualification,
} from "./d10-current-pre-live-qualification.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialPath = join(privateOperatorRoot, "openrouter.env");
const zeroByokPath = join(privateOperatorRoot, "d10-fresh-zero-byok-browser-attestation.v1.json");
const d9QualificationBundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d9/current-graph-native-provider-rejection-no-network-2026-08-15-d9-v1/artifacts/bundle.v1.json",
);
const d10QualificationBundlePath = join(
	D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	D10_CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);
const liveGenerationRoot = join(
	D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	D10_CURRENT_GRAPH_LIVE_GENERATION_REF,
);
const MAX_ARTIFACT_BYTES = 4_194_304;

async function runCommand(command: string, args: readonly string[]): Promise<string> {
	return await new Promise((resolvePromise, reject) => {
		const child = spawn(command, [...args], {
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
				if (bytes > 16 * 1_048_576) child.kill("SIGKILL");
				target.push(chunk);
			});
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0)
				reject(
					new TypeError(
						`D10 live gate failed (${command} ${args.join(" ")}): ${Buffer.concat(stderr).toString("utf8").slice(0, 4_096)}`,
					),
				);
			else resolvePromise(Buffer.concat(stdout).toString("utf8"));
		});
	});
}

async function boundedPrivateFile(path: string, maxBytes: number): Promise<Uint8Array> {
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
			throw new TypeError(`D10 live private artifact identity is invalid: ${path}`);
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError(`D10 live private artifact changed while read: ${path}`);
		} finally {
			await secondHandle.close();
		}
		return first;
	} finally {
		await handle.close();
	}
}

async function assertAbsent(path: string, label: string): Promise<void> {
	await lstat(path).then(
		() => {
			throw new TypeError(`D10 live ${label} already exists`);
		},
		(error: unknown) => {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
		},
	);
}

async function loadCredential() {
	const bytes = await boundedPrivateFile(credentialPath, 16_384);
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const line of text.split(/\r?\n/u)) {
		const match = /^OPENROUTER_API_KEY=(.*)$/u.exec(line);
		if (match === null) continue;
		if (token !== null) throw new TypeError("D10 live credential file contains duplicates");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D10 live credential is unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

async function offlinePreflight() {
	if (process.version !== "v24.18.0") throw new TypeError("D10 live Node toolchain drifted");
	await mkdir(D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
	await chmod(D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT, 0o700);
	if ((await realpath(D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT)) !== D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT)
		throw new TypeError("D10 live private root is not canonical");
	const implementationManifestDigest = await measureD10Implementation(repositoryRoot);
	if (implementationManifestDigest !== D10_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D10 live implementation manifest drifted");
	const status = await runCommand("/usr/bin/git", [
		"status",
		"--porcelain=v1",
		"--untracked-files=no",
	]);
	if (status.trim() !== "") throw new TypeError("D10 live tracked worktree is dirty");
	await runCommand("/usr/bin/git", [
		"merge-base",
		"--is-ancestor",
		D10_CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
		"HEAD",
	]);
	const d9QualificationBundleBytes = await boundedPrivateFile(
		d9QualificationBundlePath,
		MAX_ARTIFACT_BYTES,
	);
	if (empiricalSha256(d9QualificationBundleBytes) !== D10_D9_QUALIFICATION_ARTIFACT_DIGEST)
		throw new TypeError("D10 live D9 qualification artifact drifted");
	const d9Qualification = validateD9QualificationBundle(
		strictJsonCodec.decode(d9QualificationBundleBytes),
	);
	if (
		d9Qualification.bundleDigest !== D10_D9_QUALIFICATION_BUNDLE_DIGEST ||
		d9Qualification.qualification.qualificationDigest !== D10_D9_QUALIFICATION_DIGEST ||
		d9Qualification.qualification.implementationManifestDigest !==
			D10_D9_IMPLEMENTATION_MANIFEST_DIGEST
	)
		throw new TypeError("D10 live D9 qualification projection drifted");
	const d10QualificationBytes = await boundedPrivateFile(
		d10QualificationBundlePath,
		MAX_ARTIFACT_BYTES,
	);
	const qualification = validateD10Qualification(strictJsonCodec.decode(d10QualificationBytes));
	if (
		qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
		qualification.qualification.baselineBasis !== "exact-d9-artifact" ||
		qualification.qualification.providerAttempts !== 12 ||
		qualification.qualification.providerRejectionCount !== 1 ||
		qualification.qualification.conservativeRejectionAccountingPassed !== true ||
		qualification.qualification.rejectionCleanupAndNextArmPassed !== true ||
		qualification.qualification.retryWaits !== 1 ||
		qualification.qualification.maxActiveTransport !== 1 ||
		qualification.qualification.fullSixArmIntegrationPassed !== true ||
		qualification.qualification.retryRequestIdentityPassed !== true ||
		qualification.qualification.publicSemanticValidationPassed !== true ||
		qualification.qualification.hiddenVerifierPassed !== true ||
		qualification.qualification.cleanupPassed !== true ||
		qualification.qualification.providerNetworkCalls !== 0 ||
		qualification.qualification.workspaceResidueCount !== 0
	)
		throw new TypeError("D10 live D10 qualification projection drifted");
	await assertAbsent(liveGenerationRoot, "generation");
	return Object.freeze({
		implementationManifestDigest,
		qualification,
		qualificationArtifactDigest: empiricalSha256(d10QualificationBytes),
	});
}

const offline = await offlinePreflight();
const pricing = await readD10CurrentGraphLiveOfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
});
const credential = await loadCredential();
const zeroByokBytes = await boundedPrivateFile(zeroByokPath, 16_384);
const zeroByok = admitD10CurrentGraphLiveZeroByok({
	bytes: zeroByokBytes,
	credential,
	nowMs: Date.now(),
});
const preclaim = composeD10CurrentGraphLivePreclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
});
const claim = await acquireD10CurrentGraphLiveDispatchClaim({
	preclaim,
	implementationManifestDigest: offline.implementationManifestDigest,
	qualificationArtifactDigest: offline.qualificationArtifactDigest,
	qualificationDigest: offline.qualification.qualification.qualificationDigest,
});
let currentKeyCalls = 0;
let providerCalls = 0;
let currentKey: Awaited<
	ReturnType<ReturnType<typeof createOpenRouterCurrentKeySpendAdmissionCapability>["read"]>
> | null = null;
try {
	currentKey = await createOpenRouterCurrentKeySpendAdmissionCapability({
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
} catch {
	const persistence = await persistD10CurrentGraphLivePreexecutionFailure({
		privateRoot: D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
		claim,
		implementationManifestDigest: offline.implementationManifestDigest,
		pricingObservationDigest: pricing.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
	});
	process.stdout.write(
		`${JSON.stringify({
			disposition: "partial-failure",
			failurePhase: "current-key-admission",
			currentKeyCalls,
			providerCalls,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
			persistence,
		})}\n`,
	);
	process.exitCode = 1;
}
if (currentKey !== null) {
	const executionAuthority = await consumeD10CurrentGraphLiveDispatchClaim({
		claim,
		currentKeyAdmission: currentKey,
	});
	const executor = createCurrentGraphOpenRouterExecutor({
		repositoryRoot,
		materializationRoot: join(D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT, ".workspaces"),
		credential,
		fetchImpl: async (request, init) => {
			providerCalls += 1;
			return await globalThis.fetch(request, init);
		},
	});
	const constructedBundle = await runD10CurrentGraphLiveMeasurement({
		executionAuthority,
		executionClass: "live-provider",
		executor,
		implementationManifestDigest: offline.implementationManifestDigest,
		d9QualificationArtifactDigest: D10_D9_QUALIFICATION_ARTIFACT_DIGEST,
		pricingObservationDigest: pricing.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
	});
	const bundle = validateD10CurrentGraphLiveBundle(constructedBundle);
	const persistence = await persistD10CurrentGraphLiveBundle({
		privateRoot: D10_CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
		bundle: constructedBundle,
	});
	process.stdout.write(
		`${JSON.stringify({
			disposition: bundle.disposition,
			currentKeyCalls,
			providerCalls,
			qualificationArtifactDigest: offline.qualificationArtifactDigest,
			bundleDigest: bundle.bundleDigest,
			graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null,
			partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null,
			generationDigest:
				bundle.generation === null
					? null
					: record(bundle.generation, "current.live.output.generation").generationDigest,
			causalAttribution: "undetermined",
			efficacyClaim: "none",
			persistence,
		})}\n`,
	);
}
