import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { chmod, lstat, mkdir, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, record, sameBytes } from "./canonical.js";
import { validateCurrentGraphLiveQualificationBundle as validateD6Qualification } from "./d6-current-pre-live-qualification.js";
import {
	CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST,
	measureCurrentGraphLiveImplementation,
} from "./d8-current-implementation-manifest.js";
import {
	persistCurrentGraphLiveBundle,
	persistCurrentGraphLivePreexecutionFailure,
	runCurrentGraphLiveMeasurement,
	validateCurrentGraphLiveBundle,
} from "./d8-current-live.js";
import {
	acquireCurrentGraphLiveDispatchClaim,
	CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	consumeCurrentGraphLiveDispatchClaim,
} from "./d8-current-live-claim.js";
import {
	CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
	CURRENT_GRAPH_LIVE_D6_IMPLEMENTATION_MANIFEST_DIGEST,
	CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST,
	CURRENT_GRAPH_LIVE_D6_QUALIFICATION_BUNDLE_DIGEST,
	CURRENT_GRAPH_LIVE_D6_QUALIFICATION_DIGEST,
	CURRENT_GRAPH_LIVE_GENERATION_REF,
} from "./d8-current-live-coordinates.js";
import {
	admitCurrentGraphLiveZeroByok,
	composeCurrentGraphLivePreclaim,
	readCurrentGraphLiveOfficialPricing,
} from "./d8-current-live-preflight.js";
import { createCurrentGraphOpenRouterExecutor } from "./d8-current-openrouter-adapter.js";
import {
	CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	validateCurrentGraphLiveQualificationBundle as validateD8Qualification,
} from "./d8-current-pre-live-qualification.js";
import { createOpenRouterCurrentKeySpendAdmissionCapability } from "./openrouter-current-key-spend-admission.js";

const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateOperatorRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialPath = join(privateOperatorRoot, "openrouter.env");
const zeroByokPath = join(privateOperatorRoot, "d8-fresh-zero-byok-browser-attestation.v1.json");
const d6QualificationBundlePath = join(
	privateOperatorRoot,
	"current-graph-native-d6/current-graph-native-live-no-network-qualification-2026-08-14-d6-v2/artifacts/bundle.v1.json",
);
const d8QualificationBundlePath = join(
	CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
	CURRENT_GRAPH_LIVE_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);
const liveGenerationRoot = join(CURRENT_GRAPH_LIVE_PRIVATE_ROOT, CURRENT_GRAPH_LIVE_GENERATION_REF);
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
						`D8 live gate failed (${command} ${args.join(" ")}): ${Buffer.concat(stderr).toString("utf8").slice(0, 4_096)}`,
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
			throw new TypeError(`D8 live private artifact identity is invalid: ${path}`);
		const first = new Uint8Array(await handle.readFile());
		const secondHandle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const secondStat = await secondHandle.stat();
			const second = new Uint8Array(await secondHandle.readFile());
			if (secondStat.dev !== stat.dev || secondStat.ino !== stat.ino || !sameBytes(first, second))
				throw new TypeError(`D8 live private artifact changed while read: ${path}`);
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
			throw new TypeError(`D8 live ${label} already exists`);
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
		if (token !== null) throw new TypeError("D8 live credential file contains duplicates");
		const raw = (match[1] ?? "").trim();
		token =
			(raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))
				? raw.slice(1, -1)
				: raw;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D8 live credential is unavailable");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

async function offlinePreflight() {
	if (process.version !== "v24.18.0") throw new TypeError("D8 live Node toolchain drifted");
	await mkdir(CURRENT_GRAPH_LIVE_PRIVATE_ROOT, { recursive: true, mode: 0o700 });
	await chmod(CURRENT_GRAPH_LIVE_PRIVATE_ROOT, 0o700);
	if ((await realpath(CURRENT_GRAPH_LIVE_PRIVATE_ROOT)) !== CURRENT_GRAPH_LIVE_PRIVATE_ROOT)
		throw new TypeError("D8 live private root is not canonical");
	const implementationManifestDigest = await measureCurrentGraphLiveImplementation(repositoryRoot);
	if (implementationManifestDigest !== CURRENT_GRAPH_LIVE_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D8 live implementation manifest drifted");
	const status = await runCommand("/usr/bin/git", [
		"status",
		"--porcelain=v1",
		"--untracked-files=no",
	]);
	if (status.trim() !== "") throw new TypeError("D8 live tracked worktree is dirty");
	await runCommand("/usr/bin/git", [
		"merge-base",
		"--is-ancestor",
		CURRENT_GRAPH_LIVE_BASELINE_COMMIT,
		"HEAD",
	]);
	const d6QualificationBundleBytes = await boundedPrivateFile(
		d6QualificationBundlePath,
		MAX_ARTIFACT_BYTES,
	);
	if (
		empiricalSha256(d6QualificationBundleBytes) !==
		CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST
	)
		throw new TypeError("D8 live D6 qualification artifact drifted");
	const d6Qualification = validateD6Qualification(
		strictJsonCodec.decode(d6QualificationBundleBytes),
	);
	if (
		d6Qualification.bundleDigest !== CURRENT_GRAPH_LIVE_D6_QUALIFICATION_BUNDLE_DIGEST ||
		d6Qualification.qualification.qualificationDigest !==
			CURRENT_GRAPH_LIVE_D6_QUALIFICATION_DIGEST ||
		d6Qualification.qualification.implementationManifestDigest !==
			CURRENT_GRAPH_LIVE_D6_IMPLEMENTATION_MANIFEST_DIGEST ||
		d6Qualification.qualification.providerAttempts !== 13 ||
		d6Qualification.qualification.retryWaits !== 1 ||
		d6Qualification.qualification.maxActiveTransport !== 1 ||
		d6Qualification.qualification.fullSixArmIntegrationPassed !== true ||
		d6Qualification.qualification.retryRequestIdentityPassed !== true ||
		d6Qualification.qualification.publicSemanticValidationPassed !== true ||
		d6Qualification.qualification.hiddenVerifierPassed !== true ||
		d6Qualification.qualification.cleanupPassed !== true ||
		d6Qualification.qualification.providerNetworkCalls !== 0 ||
		d6Qualification.qualification.workspaceResidueCount !== 0
	)
		throw new TypeError("D8 live D6 qualification projection drifted");
	const d8QualificationBytes = await boundedPrivateFile(
		d8QualificationBundlePath,
		MAX_ARTIFACT_BYTES,
	);
	const qualification = validateD8Qualification(strictJsonCodec.decode(d8QualificationBytes));
	if (
		qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
		qualification.qualification.providerAttempts !== 13 ||
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
		throw new TypeError("D8 live D8 qualification projection drifted");
	await assertAbsent(liveGenerationRoot, "generation");
	return Object.freeze({
		implementationManifestDigest,
		qualification,
		qualificationArtifactDigest: empiricalSha256(d8QualificationBytes),
	});
}

const offline = await offlinePreflight();
const pricing = await readCurrentGraphLiveOfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
});
const credential = await loadCredential();
const zeroByokBytes = await boundedPrivateFile(zeroByokPath, 16_384);
const zeroByok = admitCurrentGraphLiveZeroByok({
	bytes: zeroByokBytes,
	credential,
	nowMs: Date.now(),
});
const preclaim = composeCurrentGraphLivePreclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
});
const claim = await acquireCurrentGraphLiveDispatchClaim({
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
	const persistence = await persistCurrentGraphLivePreexecutionFailure({
		privateRoot: CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
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
	const executionAuthority = await consumeCurrentGraphLiveDispatchClaim({
		claim,
		currentKeyAdmission: currentKey,
	});
	const executor = createCurrentGraphOpenRouterExecutor({
		repositoryRoot,
		materializationRoot: join(CURRENT_GRAPH_LIVE_PRIVATE_ROOT, ".workspaces"),
		credential,
		fetchImpl: async (request, init) => {
			providerCalls += 1;
			return await globalThis.fetch(request, init);
		},
	});
	const constructedBundle = await runCurrentGraphLiveMeasurement({
		executionAuthority,
		executionClass: "live-provider",
		executor,
		implementationManifestDigest: offline.implementationManifestDigest,
		d6QualificationArtifactDigest: CURRENT_GRAPH_LIVE_D6_QUALIFICATION_ARTIFACT_DIGEST,
		pricingObservationDigest: pricing.observationDigest,
		zeroByokObservationDigest: zeroByok.observationDigest,
	});
	const bundle = validateCurrentGraphLiveBundle(constructedBundle);
	const persistence = await persistCurrentGraphLiveBundle({
		privateRoot: CURRENT_GRAPH_LIVE_PRIVATE_ROOT,
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
