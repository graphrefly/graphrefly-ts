import { constants } from "node:fs";
import { chmod, mkdir, mkdtemp, open, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest, strictSnapshot } from "./canonical.js";
import {
	createD44LiveExecutor,
	D44_BUGGY_ADMISSION_BLOCK,
	D44_D45_BASELINE_COMMIT,
	D44_D45_LIVE_REVISION,
	D44_FIXED_ADMISSION_BLOCK,
	d44LiveCompositionDigest,
	runD44D45Measurement,
} from "./d44-d45-live-composition.js";
import {
	type D45CanonicalEvidenceV1,
	validateD45CanonicalEvidence,
} from "./d45-graph-tool-authority.js";
import { D45_WRITABLE_PATH } from "./d45-graph-tool-qualification.js";
import {
	D45_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD45Implementation,
} from "./d45-implementation-manifest.js";

export const D44_D45_QUALIFICATION_SCHEMA = "graphrefly-ts.d44.d45-live-qualification.v1" as const;
export const D44_D45_QUALIFICATION_BUNDLE_SCHEMA =
	"graphrefly-ts.d44.d45-live-qualification-bundle.v1" as const;
export const D44_D45_QUALIFICATION_GENERATION_REF =
	"current-graph-native-live-composition-2026-08-21-d45-v1" as const;

export interface D44D45LiveQualificationBundleV1 {
	readonly schemaVersion: typeof D44_D45_QUALIFICATION_BUNDLE_SCHEMA;
	readonly evidence: D45CanonicalEvidenceV1;
	readonly qualification: Readonly<{
		readonly schemaVersion: typeof D44_D45_QUALIFICATION_SCHEMA;
		readonly decisionRef: "graphrefly-ts:D45";
		readonly d45BaselineCommit: typeof D44_D45_BASELINE_COMMIT;
		readonly d45ImplementationManifestDigest: string;
		readonly compositionRevision: typeof D44_D45_LIVE_REVISION;
		readonly compositionDigest: string;
		readonly evidenceDigest: string;
		readonly exactSixArmsCompleted: true;
		readonly evaluableArms: 6;
		readonly proposalToolBijection: true;
		readonly providerCalls: number;
		readonly providerNetworkCalls: 0;
		readonly credentialReads: 0;
		readonly dispatchClaims: 0;
		readonly fallbackOrSwitchCalls: 0;
		readonly maxActiveEffects: 1;
		readonly historicalRuntimeDependencies: 0;
		readonly causalAttribution: "undetermined";
		readonly efficacyClaim: "none";
		readonly qualificationDigest: string;
	}>;
	readonly bundleDigest: string;
}

export interface D44D45QualificationReceiptV1 {
	readonly generationRef: typeof D44_D45_QUALIFICATION_GENERATION_REF;
	readonly bundleArtifactDigest: string;
	readonly commitArtifactDigest: string;
	readonly receiptDigest: string;
}

function injectedProviderResponse(body: RequestInit["body"]): Response {
	if (typeof body !== "string") throw new TypeError("D44 qualification expected strict JSON wire");
	const request = JSON.parse(body) as {
		readonly tool_choice: Readonly<{ readonly function: Readonly<{ readonly name: string }> }>;
		readonly tools: readonly [
			Readonly<{
				readonly function: Readonly<{
					readonly parameters: Readonly<{
						readonly properties: Readonly<{
							readonly path: Readonly<{ readonly enum: readonly string[] }>;
						}>;
					}>;
				}>;
			}>,
		];
	};
	const name = request.tool_choice.function.name;
	const calls =
		name === "read_file"
			? [
					{
						function: {
							name: "read_file",
							arguments: JSON.stringify({
								path: request.tools[0].function.parameters.properties.path.enum[0],
							}),
						},
					},
				]
			: [
					{
						function: {
							name: "replace_exact",
							arguments: JSON.stringify({
								path: D45_WRITABLE_PATH,
								oldText: D44_BUGGY_ADMISSION_BLOCK,
								newText: D44_FIXED_ADMISSION_BLOCK,
							}),
						},
					},
				];
	return new Response(
		JSON.stringify({
			choices: [{ finish_reason: "tool_calls", message: { role: "assistant", tool_calls: calls } }],
			usage: {
				prompt_tokens: 1_000,
				completion_tokens: 100,
				prompt_tokens_details: { cached_tokens: 0 },
			},
		}),
		{ status: 200, headers: { "content-type": "application/json" } },
	);
}

export async function runD44D45InjectedNoNetworkQualification(input?: {
	readonly repositoryRoot?: string;
}): Promise<D44D45LiveQualificationBundleV1> {
	const repositoryRoot = resolve(input?.repositoryRoot ?? join(import.meta.dirname, "../../../.."));
	const materializationRoot = await mkdtemp(join(tmpdir(), "graphrefly-d44-d45-qualification-"));
	let providerCalls = 0;
	try {
		const executor = createD44LiveExecutor({
			repositoryRoot,
			materializationRoot,
			baselineCommit: D44_D45_BASELINE_COMMIT,
			bearerToken: "injected-no-network",
			fetchImpl: async (_url, init) => {
				providerCalls += 1;
				return injectedProviderResponse(init?.body);
			},
		});
		const measurement = await runD44D45Measurement({ executor, injectedNoNetwork: true });
		if (measurement.disposition !== "success")
			throw new TypeError("D44 injected composition did not produce canonical success");
		const evidence = validateD45CanonicalEvidence(measurement.evidence);
		if (
			!evidence.exactSixArmsCompleted ||
			evidence.lifecycle.arms.length !== 6 ||
			evidence.lifecycle.arms.some((arm) => !arm.evaluable) ||
			!evidence.proposalToolBijection ||
			measurement.providerCalls !== providerCalls ||
			providerCalls < 30
		)
			throw new TypeError("D44 injected six-arm composition invariants failed");
		const measuredD45Manifest = await measureD45Implementation();
		if (measuredD45Manifest !== D45_IMPLEMENTATION_MANIFEST_DIGEST)
			throw new TypeError("D44 D45 implementation baseline drifted");
		const compositionDigest = d44LiveCompositionDigest({
			d45Commit: D44_D45_BASELINE_COMMIT,
			d45QualificationArtifactDigest:
				"sha256:349b43839b169b1fa2c3a4389440a2bda8cc5e99c908b5ab02fd7abf37df06e2",
			d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
		});
		const qualificationMaterial = strictSnapshot({
			schemaVersion: D44_D45_QUALIFICATION_SCHEMA,
			decisionRef: "graphrefly-ts:D45" as const,
			d45BaselineCommit: D44_D45_BASELINE_COMMIT,
			d45ImplementationManifestDigest: D45_IMPLEMENTATION_MANIFEST_DIGEST,
			compositionRevision: D44_D45_LIVE_REVISION,
			compositionDigest,
			evidenceDigest: evidence.evidenceDigest,
			exactSixArmsCompleted: true as const,
			evaluableArms: 6 as const,
			proposalToolBijection: true as const,
			providerCalls,
			providerNetworkCalls: 0 as const,
			credentialReads: 0 as const,
			dispatchClaims: 0 as const,
			fallbackOrSwitchCalls: 0 as const,
			maxActiveEffects: 1 as const,
			historicalRuntimeDependencies: 0 as const,
			causalAttribution: "undetermined" as const,
			efficacyClaim: "none" as const,
		});
		const qualification = Object.freeze({
			...qualificationMaterial,
			qualificationDigest: empiricalStrictJsonDigest(qualificationMaterial),
		});
		const bundleMaterial = strictSnapshot({
			schemaVersion: D44_D45_QUALIFICATION_BUNDLE_SCHEMA,
			evidence,
			qualification,
		});
		return Object.freeze({
			...bundleMaterial,
			bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
		}) as D44D45LiveQualificationBundleV1;
	} finally {
		await rm(materializationRoot, { recursive: true, force: true });
	}
}

export function validateD44D45QualificationBundle(
	value: D44D45LiveQualificationBundleV1,
): D44D45LiveQualificationBundleV1 {
	const evidence = validateD45CanonicalEvidence(value.evidence);
	const { qualificationDigest: _qualificationDigest, ...qualificationMaterial } =
		value.qualification;
	if (
		value.schemaVersion !== D44_D45_QUALIFICATION_BUNDLE_SCHEMA ||
		value.qualification.schemaVersion !== D44_D45_QUALIFICATION_SCHEMA ||
		value.qualification.evidenceDigest !== evidence.evidenceDigest ||
		value.qualification.qualificationDigest !==
			empiricalStrictJsonDigest(strictSnapshot(qualificationMaterial)) ||
		value.bundleDigest !==
			empiricalStrictJsonDigest(
				strictSnapshot({
					schemaVersion: value.schemaVersion,
					evidence,
					qualification: value.qualification,
				}),
			)
	)
		throw new TypeError("D44 qualification bundle failed canonical replay");
	return value;
}

export async function persistD44D45Qualification(input: {
	readonly directory: string;
	readonly bundle: D44D45LiveQualificationBundleV1;
}): Promise<D44D45QualificationReceiptV1> {
	if (!isAbsolute(input.directory)) throw new TypeError("D44 qualification path must be absolute");
	const bundle = validateD44D45QualificationBundle(input.bundle);
	await mkdir(input.directory, { recursive: true, mode: 0o700 });
	await chmod(input.directory, 0o700);
	const target = join(input.directory, `${D44_D45_QUALIFICATION_GENERATION_REF}.json`);
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	const bytes = strictJsonCodec.encode(bundle);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = null;
		await rename(temp, target);
		const root = await open(dirname(target), constants.O_RDONLY);
		try {
			await root.sync();
		} finally {
			await root.close();
		}
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(temp, { force: true });
		throw error;
	}
	const artifact = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
	let committed: Uint8Array;
	try {
		committed = await artifact.readFile();
	} finally {
		await artifact.close();
	}
	if (empiricalSha256(committed) !== empiricalSha256(bytes))
		throw new TypeError("D44 qualification persistence drifted");
	const receiptMaterial = strictSnapshot({
		generationRef: D44_D45_QUALIFICATION_GENERATION_REF,
		bundleArtifactDigest: empiricalSha256(bytes),
		commitArtifactDigest: empiricalSha256(committed),
	});
	return Object.freeze({
		...receiptMaterial,
		receiptDigest: empiricalStrictJsonDigest(receiptMaterial),
	});
}
