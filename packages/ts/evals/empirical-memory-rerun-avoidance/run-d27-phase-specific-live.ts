import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD27D26Baseline,
	type D27LiveBundleV1,
	persistD27LiveBundle,
	persistD27PreexecutionFailure,
	runD27LiveMeasurement,
} from "./d27-phase-specific-live.js";
import {
	acquireD27DispatchClaim,
	consumeD27DispatchClaim,
	D27_PRIVATE_ROOT,
	type D27ExecutionAuthorityV1,
	readD27CurrentKeyAdmission,
} from "./d27-phase-specific-live-claim.js";
import {
	D27_BASELINE_COMMIT,
	D27_D26_ARTIFACT_DIGEST,
	D27_QUALIFICATION_GENERATION_REF,
} from "./d27-phase-specific-live-coordinates.js";
import {
	D27_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD27Implementation,
} from "./d27-phase-specific-live-implementation-manifest.js";
import {
	admitD27ZeroByok,
	composeD27Preclaim,
	type D27CredentialV1,
	readD27OfficialPricing,
} from "./d27-phase-specific-live-preflight.js";
import { validateD27QualificationBundle } from "./d27-phase-specific-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d27-fresh-zero-byok-browser-attestation.v1.json");
const d26ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d26/current-graph-native-phase-specific-real-provider-no-network-2026-08-17-d26-v2/artifacts/bundle.v1.json",
);
const d27QualificationFile = join(
	D27_PRIVATE_ROOT,
	D27_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);

async function readPrivateFile(path: string, maximumBytes: number): Promise<Uint8Array> {
	const canonical = await realpath(path);
	if (canonical !== path) throw new TypeError("D27 private live file is not canonical");
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		(metadata.mode & 0o777) !== 0o600 ||
		metadata.nlink !== 1 ||
		metadata.size < 1 ||
		metadata.size > maximumBytes ||
		(process.getuid !== undefined && metadata.uid !== process.getuid())
	)
		throw new TypeError("D27 private live file ownership is invalid");
	return new Uint8Array(await readFile(path));
}

async function assertImplementation(): Promise<string> {
	const measured = await measureD27Implementation(repositoryRoot);
	if (measured !== D27_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D27 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D27_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D27 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D27CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D27 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D27 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D27 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d26Bytes = await readPrivateFile(d26ArtifactFile, 8_388_608);
if (empiricalSha256(d26Bytes) !== D27_D26_ARTIFACT_DIGEST)
	throw new TypeError("D27 live D26 artifact drifted");
const baseline = admitD27D26Baseline(d26Bytes);
const qualificationBytes = await readPrivateFile(d27QualificationFile, 8_388_608);
const qualification = validateD27QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "consumed-d26-artifact" ||
	qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.providerNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D27 live qualification projection drifted");

const pricing = await readD27OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: AbortSignal.timeout(30_000),
});
const credential = loadCredential(await readPrivateFile(credentialFile, 8_192));
const nowMs = Date.now();
const zeroByok = admitD27ZeroByok({
	bytes: await readPrivateFile(zeroByokFile, 65_536),
	credential,
	nowMs,
});
const preclaim = composeD27Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
if ((await assertImplementation()) !== implementationManifestDigest)
	throw new TypeError("D27 live implementation drifted before claim");
const claim = await acquireD27DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: qualification.qualification.qualificationDigest,
});

let executionAuthority: D27ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD27CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD27DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	await persistD27PreexecutionFailure({
		privateRoot: await realpath(D27_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "current-key-admission",
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d27-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D27LiveBundleV1;
try {
	bundle = await runD27LiveMeasurement({
		executionAuthority,
		baseline,
		credential,
		repositoryRoot,
		materializationRoot,
		implementationManifestDigest,
		now: () => performance.now(),
		sleep: (milliseconds) =>
			new Promise<void>((resolvePromise) => setTimeout(resolvePromise, milliseconds)),
	});
} catch (error) {
	await rm(materializationRoot, { recursive: true, force: true }).catch(() => undefined);
	await persistD27PreexecutionFailure({
		privateRoot: await realpath(D27_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "execution-construction",
	});
	throw error;
}
await rm(materializationRoot, { recursive: true, force: true }).catch(() => undefined);
const persistence = await persistD27LiveBundle({
	privateRoot: await realpath(D27_PRIVATE_ROOT),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({ decisionRef: bundle.decisionRef, disposition: bundle.disposition, bundleDigest: bundle.bundleDigest, graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null, partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null, gateDigest: bundle.gate.gateDigest, gatePassed: bundle.gate.passed, causalAttribution: bundle.causalAttribution, efficacyClaim: bundle.efficacyClaim, persistenceDigest: persistence.receiptDigest })}\n`,
);
