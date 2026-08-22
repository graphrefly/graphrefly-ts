import { constants } from "node:fs";
import { chmod, link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D55_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD55Implementation,
} from "./d55-provider-boundary-implementation-manifest.js";
import {
	runD55InjectedNoNetworkQualification,
	validateD55PersistedQualification,
} from "./d55-provider-boundary-qualification.js";

const GENERATION_REF = "current-graph-native-provider-boundary-2026-08-21-d55-v13" as const;

async function persist(directory: string, value: unknown) {
	if (!isAbsolute(directory)) throw new TypeError("D55 qualification directory must be absolute");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const target = join(directory, `${GENERATION_REF}.json`);
	const temporary = `${target}.tmp-${process.pid}`;
	const bytes = strictJsonCodec.encode(value);
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(
			temporary,
			constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
			0o600,
		);
		await handle.writeFile(bytes);
		await handle.sync();
		await handle.close();
		handle = null;
		await link(temporary, target);
		await rm(temporary);
		const root = await open(dirname(target), constants.O_RDONLY);
		try {
			await root.sync();
		} finally {
			await root.close();
		}
	} catch (error) {
		await handle?.close().catch(() => undefined);
		await rm(temporary, { force: true });
		throw error;
	}
	const artifactDigest = empiricalSha256(bytes);
	const reopened = await readFile(target);
	if (
		empiricalSha256(reopened) !== artifactDigest ||
		empiricalStrictJsonDigest(
			validateD55PersistedQualification(
				strictJsonCodec.decode(reopened),
				D55_IMPLEMENTATION_MANIFEST_DIGEST,
			),
		) !== empiricalStrictJsonDigest(value)
	)
		throw new TypeError("D55 committed qualification artifact failed replay");
	return Object.freeze({
		generationRef: GENERATION_REF,
		artifactPath: target,
		artifactDigest,
		receiptDigest: empiricalStrictJsonDigest({ generationRef: GENERATION_REF, artifactDigest }),
	});
}

const directory = resolve(
	process.argv[2] ??
		join(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/current-graph-native-d55-qualified-v13",
		),
);
if ((await measureD55Implementation()) !== D55_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D55 implementation manifest drifted before qualification");
const qualification = await runD55InjectedNoNetworkQualification();
const bundleMaterial = Object.freeze({
	schemaVersion: "graphrefly-ts.d55.persisted-qualification.v2" as const,
	implementationManifestDigest: D55_IMPLEMENTATION_MANIFEST_DIGEST,
	qualification,
});
const bundle = validateD55PersistedQualification(
	Object.freeze({
		...bundleMaterial,
		bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
	}),
	D55_IMPLEMENTATION_MANIFEST_DIGEST,
);
console.log(JSON.stringify(await persist(directory, bundle), null, 2));
