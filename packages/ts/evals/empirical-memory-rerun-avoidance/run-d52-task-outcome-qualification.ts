import { constants } from "node:fs";
import { chmod, link, mkdir, open, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D52_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD52Implementation,
} from "./d52-task-outcome-implementation-manifest.js";
import { runD52FullInjectedNoNetworkQualification } from "./d52-task-outcome-qualification.js";

const GENERATION_REF = "current-graph-native-task-outcome-2026-08-21-d52-v2" as const;

async function persist(directory: string, value: unknown) {
	if (!isAbsolute(directory)) throw new TypeError("D52 qualification directory must be absolute");
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
	return Object.freeze({
		generationRef: GENERATION_REF,
		artifactPath: target,
		artifactDigest: empiricalSha256(bytes),
		receiptDigest: empiricalStrictJsonDigest({
			generationRef: GENERATION_REF,
			artifactDigest: empiricalSha256(bytes),
		}),
	});
}

const directory = resolve(
	process.argv[2] ??
		join(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/current-graph-native-d52-qualified",
		),
);
if ((await measureD52Implementation()) !== D52_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D52 implementation manifest drifted before qualification");
const qualification = await runD52FullInjectedNoNetworkQualification();
const bundleMaterial = {
	schemaVersion: "graphrefly-ts.d52.persisted-qualification.v1" as const,
	implementationManifestDigest: D52_IMPLEMENTATION_MANIFEST_DIGEST,
	qualification,
};
const bundle = Object.freeze({
	...bundleMaterial,
	bundleDigest: empiricalStrictJsonDigest(bundleMaterial),
});
console.log(JSON.stringify(await persist(directory, bundle), null, 2));
