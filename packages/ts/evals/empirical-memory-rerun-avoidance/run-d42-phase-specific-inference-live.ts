import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD42D41Baseline,
	type D42LiveBundleV1,
	persistD42LiveBundle,
	persistD42PreexecutionFailure,
	runD42LiveMeasurement,
} from "./d42-phase-specific-inference-live.js";
import {
	acquireD42DispatchClaim,
	consumeD42DispatchClaim,
	D42_PRIVATE_ROOT,
	type D42ExecutionAuthorityV1,
	issueD42CurrentKeyFailureAuthority,
	issueD42ExecutionBoundaryFailureAuthority,
	issueD42PostCurrentKeyFailureAuthority,
	readD42CurrentKeyAdmission,
} from "./d42-phase-specific-inference-live-claim.js";
import {
	D42_BASELINE_COMMIT,
	D42_D41_ARTIFACT_DIGEST,
	D42_LIVE_APPROVAL_REVISION,
	D42_QUALIFICATION_GENERATION_REF,
} from "./d42-phase-specific-inference-live-coordinates.js";
import {
	D42_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD42Implementation,
} from "./d42-phase-specific-inference-live-implementation-manifest.js";
import {
	admitD42ZeroByok,
	composeD42Preclaim,
	type D42CredentialV1,
	readD42OfficialPricing,
} from "./d42-phase-specific-inference-live-preflight.js";
import { validateD42QualificationBundle } from "./d42-phase-specific-inference-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d42-fresh-zero-byok-browser-attestation.v1.json");
const d41ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d41/current-graph-native-phase-specific-inference-no-network-2026-08-20-d41-v1/artifacts/bundle.v1.json",
);
const qualificationFile = join(
	D42_PRIVATE_ROOT,
	D42_QUALIFICATION_GENERATION_REF,
	"artifacts/bundle.v1.json",
);

async function readPrivateFile(path: string, maximumBytes: number): Promise<Uint8Array> {
	if ((await realpath(path)) !== path)
		throw new TypeError("D42 private live file is not canonical");
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
		throw new TypeError("D42 private live file ownership is invalid");
	return new Uint8Array(await readFile(path));
}

async function assertImplementation(): Promise<string> {
	const measured = await measureD42Implementation(repositoryRoot);
	if (measured !== D42_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D42 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D42_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D42 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D42CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D42 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D42 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D42 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d41Bytes = await readPrivateFile(d41ArtifactFile, 8_388_608);
if (empiricalSha256(d41Bytes) !== D42_D41_ARTIFACT_DIGEST)
	throw new TypeError("D42 live D41 baseline artifact drifted");
const baseline = admitD42D41Baseline(d41Bytes);
const qualificationBytes = await readPrivateFile(qualificationFile, 16_777_216);
const qualification = validateD42QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "consumed-d41-artifact" ||
	qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.providerNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D42 live qualification projection drifted");
if (D42_LIVE_APPROVAL_REVISION === null) throw new TypeError("D42 live authority is unavailable");

const pricing = await readD42OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: AbortSignal.timeout(30_000),
});
const credential = loadCredential(await readPrivateFile(credentialFile, 8_192));
const nowMs = Date.now();
const zeroByok = admitD42ZeroByok({
	bytes: await readPrivateFile(zeroByokFile, 65_536),
	credential,
	nowMs,
});
const preclaim = composeD42Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
if ((await assertImplementation()) !== implementationManifestDigest)
	throw new TypeError("D42 live implementation drifted before claim");
const claim = await acquireD42DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: qualification.qualification.qualificationDigest,
});

let executionAuthority: D42ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD42CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD42DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	const failureAuthority = await issueD42CurrentKeyFailureAuthority(claim);
	await persistD42PreexecutionFailure({
		privateRoot: await realpath(D42_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}

try {
	if ((await assertImplementation()) !== implementationManifestDigest)
		throw new TypeError("D42 live implementation drifted after current-key admission");
} catch (error) {
	const failureAuthority = await issueD42PostCurrentKeyFailureAuthority(executionAuthority);
	await persistD42PreexecutionFailure({
		privateRoot: await realpath(D42_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d42-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D42LiveBundleV1;
try {
	bundle = await runD42LiveMeasurement({
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
	const failureAuthority = await issueD42ExecutionBoundaryFailureAuthority(executionAuthority);
	await persistD42PreexecutionFailure({
		privateRoot: await realpath(D42_PRIVATE_ROOT),
		failureAuthority,
		implementationManifestDigest,
	});
	throw error;
}
const persistence = await persistD42LiveBundle({
	privateRoot: await realpath(D42_PRIVATE_ROOT),
	bundle,
});
const outerCleanupDisposition = await rm(materializationRoot, {
	recursive: true,
	force: true,
}).then(
	() => "completed" as const,
	() => "failed-after-canonical-persistence" as const,
);
process.stdout.write(
	`${JSON.stringify({ decisionRef: bundle.decisionRef, disposition: bundle.disposition, bundleDigest: bundle.bundleDigest, graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null, partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null, gateDigest: bundle.gate.gateDigest, gatePassed: bundle.gate.passed, causalAttribution: bundle.causalAttribution, efficacyClaim: bundle.efficacyClaim, persistenceDigest: persistence.receiptDigest, outerCleanupDisposition })}\n`,
);
