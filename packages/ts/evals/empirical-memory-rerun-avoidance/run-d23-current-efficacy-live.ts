import { execFile as execFileCallback } from "node:child_process";
import { chmod, lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256 } from "./canonical.js";
import {
	admitD23D22Baseline,
	type D23LiveBundleV1,
	persistD23LiveBundle,
	persistD23PreexecutionFailure,
	runD23LiveMeasurement,
} from "./d23-current-efficacy-live.js";
import {
	acquireD23DispatchClaim,
	consumeD23DispatchClaim,
	D23_PRIVATE_ROOT,
	type D23ExecutionAuthorityV1,
	readD23CurrentKeyAdmission,
} from "./d23-current-efficacy-live-claim.js";
import {
	D23_BASELINE_COMMIT,
	D23_D22_ARTIFACT_DIGEST,
} from "./d23-current-efficacy-live-coordinates.js";
import {
	D23_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD23Implementation,
} from "./d23-current-efficacy-live-implementation-manifest.js";
import {
	admitD23ZeroByok,
	composeD23Preclaim,
	type D23CredentialV1,
	readD23OfficialPricing,
} from "./d23-current-efficacy-live-preflight.js";
import { validateD23QualificationBundle } from "./d23-current-efficacy-live-qualification.js";

const execFile = promisify(execFileCallback);
const repositoryRoot = resolve(import.meta.dirname, "../../../..");
const privateEvidenceRoot = resolve(
	import.meta.dirname,
	"../.private/empirical-memory-rerun-avoidance",
);
const credentialFile = join(privateEvidenceRoot, "openrouter.env");
const zeroByokFile = join(privateEvidenceRoot, "d23-fresh-zero-byok-browser-attestation.v1.json");
const d22ArtifactFile = join(
	privateEvidenceRoot,
	"current-graph-native-d22/current-graph-native-efficacy-real-provider-no-network-2026-08-16-d22-v2/artifacts/bundle.v1.json",
);
const d23QualificationFile = join(
	D23_PRIVATE_ROOT,
	"current-graph-native-efficacy-live-no-network-2026-08-16-d23-v3/artifacts/bundle.v1.json",
);

async function readPrivateFile(path: string, maximumBytes: number): Promise<Uint8Array> {
	const canonical = await realpath(path);
	if (canonical !== path) throw new TypeError("D23 private live file is not canonical");
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
		throw new TypeError("D23 private live file ownership is invalid");
	return new Uint8Array(await readFile(path));
}

async function assertImplementation(): Promise<string> {
	const measured = await measureD23Implementation(repositoryRoot);
	if (measured !== D23_IMPLEMENTATION_MANIFEST_DIGEST)
		throw new TypeError("D23 live implementation manifest drifted");
	await execFile("/usr/bin/git", ["merge-base", "--is-ancestor", D23_BASELINE_COMMIT, "HEAD"], {
		cwd: repositoryRoot,
	});
	const { stdout } = await execFile(
		"/usr/bin/git",
		["status", "--porcelain=v1", "--untracked-files=no"],
		{ cwd: repositoryRoot, encoding: "utf8" },
	);
	if (stdout.length !== 0) throw new TypeError("D23 live tracked worktree is not clean");
	return measured;
}

function loadCredential(bytes: Uint8Array): D23CredentialV1 {
	const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	let token: string | null = null;
	for (const rawLine of text.split(/\r?\n/u)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const separator = line.indexOf("=");
		if (separator < 1) throw new TypeError("D23 credential file syntax is invalid");
		const key = line.slice(0, separator).trim();
		let value = line.slice(separator + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		)
			value = value.slice(1, -1);
		if (key !== "OPENROUTER_API_KEY" || token !== null)
			throw new TypeError("D23 credential file contains unexpected keys");
		token = value;
	}
	if (token === null || token.length < 16 || token.length > 4_096)
		throw new TypeError("D23 credential is absent or outside its bound");
	return Object.freeze({
		bearerToken: token,
		credentialBindingRef: "openrouter.local-eval-2" as const,
		credentialBindingRevision: "2026-08-14.v1" as const,
	});
}

const implementationManifestDigest = await assertImplementation();
const d22Bytes = await readPrivateFile(d22ArtifactFile, 4_194_304);
if (empiricalSha256(d22Bytes) !== D23_D22_ARTIFACT_DIGEST)
	throw new TypeError("D23 live D22 artifact drifted");
const baseline = admitD23D22Baseline(d22Bytes);
const qualificationBytes = await readPrivateFile(d23QualificationFile, 8_388_608);
const qualification = validateD23QualificationBundle(strictJsonCodec.decode(qualificationBytes));
if (
	qualification.baselineBasis !== "consumed-d22-artifact" ||
	qualification.qualification.implementationManifestDigest !== implementationManifestDigest ||
	qualification.qualification.providerNetworkCalls !== 0 ||
	qualification.qualification.liveGateEvaluated !== false ||
	qualification.qualification.efficacyClaim !== "none"
)
	throw new TypeError("D23 live qualification projection drifted");

const pricing = await readD23OfficialPricing({
	fetch: globalThis.fetch,
	nowMs: () => Date.now(),
	signal: AbortSignal.timeout(30_000),
});
const credential = loadCredential(await readPrivateFile(credentialFile, 8_192));
const nowMs = Date.now();
const zeroByok = admitD23ZeroByok({
	bytes: await readPrivateFile(zeroByokFile, 65_536),
	credential,
	nowMs,
});
const preclaim = composeD23Preclaim({
	pricingObservation: pricing,
	zeroByokObservation: zeroByok,
	credential,
	nowMs,
});
if ((await assertImplementation()) !== implementationManifestDigest)
	throw new TypeError("D23 live implementation drifted before claim");
const claim = await acquireD23DispatchClaim({
	preclaim,
	nowMs,
	implementationManifestDigest,
	qualificationArtifactDigest: empiricalSha256(qualificationBytes),
	qualificationDigest: String(qualification.qualification.qualificationDigest),
});

let executionAuthority: D23ExecutionAuthorityV1;
try {
	const currentKeyAdmission = await readD23CurrentKeyAdmission({
		claim,
		credential,
		fetch: globalThis.fetch,
		signal: AbortSignal.timeout(30_000),
	});
	executionAuthority = await consumeD23DispatchClaim({ claim, currentKeyAdmission });
} catch (error) {
	await persistD23PreexecutionFailure({
		privateRoot: await realpath(D23_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "current-key-admission",
	});
	throw error;
}

const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d23-live-"));
await chmod(materializationRoot, 0o700);
let bundle: D23LiveBundleV1;
try {
	bundle = await runD23LiveMeasurement({
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
	await persistD23PreexecutionFailure({
		privateRoot: await realpath(D23_PRIVATE_ROOT),
		claim,
		implementationManifestDigest,
		failurePhase: "execution-construction",
	});
	throw error;
}
await rm(materializationRoot, { recursive: true, force: true }).catch(() => undefined);
const persistence = await persistD23LiveBundle({
	privateRoot: await realpath(D23_PRIVATE_ROOT),
	bundle,
});
process.stdout.write(
	`${JSON.stringify({
		decisionRef: bundle.decisionRef,
		disposition: bundle.disposition,
		bundleDigest: bundle.bundleDigest,
		graphEvidenceDigest: bundle.graphEvidence?.evidenceDigest ?? null,
		partialGraphDigest: bundle.partialGraphEvidence?.partialGraphDigest ?? null,
		gateDigest: bundle.gate.gateDigest,
		gatePassed: bundle.gate.passed,
		causalAttribution: bundle.causalAttribution,
		efficacyClaim: bundle.efficacyClaim,
		persistenceDigest: persistence.persistenceDigest,
	})}\n`,
);
