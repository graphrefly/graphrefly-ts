import { constants } from "node:fs";
import { chmod, link, mkdir, open, readFile, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { empiricalSha256, empiricalStrictJsonDigest } from "./canonical.js";
import {
	D61_IMPLEMENTATION_MANIFEST_DIGEST,
	measureD61Implementation,
} from "./d61-implementation-manifest.js";
import {
	runD61InjectedNoNetworkQualification,
	validateD61QualificationBundle,
} from "./d61-semantic-recovery-qualification.js";

export const D61_QUALIFICATION_GENERATION_REF =
	"current-graph-native-semantic-recovery-2026-08-21-d61-v8" as const;

async function persist(directory: string, value: unknown) {
	if (!isAbsolute(directory)) throw new TypeError("D61 qualification directory must be absolute");
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const target = join(directory, `${D61_QUALIFICATION_GENERATION_REF}.json`);
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
	const reopened = await readFile(target);
	const artifactDigest = empiricalSha256(reopened);
	const replay = validateD61QualificationBundle(strictJsonCodec.decode(reopened) as never);
	if (empiricalStrictJsonDigest(replay) !== empiricalStrictJsonDigest(value))
		throw new TypeError("D61 persisted qualification failed canonical replay");
	return Object.freeze({
		generationRef: D61_QUALIFICATION_GENERATION_REF,
		artifactPath: target,
		artifactDigest,
		qualificationDigest: replay.qualification.qualificationDigest,
		bundleDigest: replay.bundleDigest,
		receiptDigest: empiricalStrictJsonDigest({
			generationRef: D61_QUALIFICATION_GENERATION_REF,
			artifactDigest,
		}),
	});
}

const directory = resolve(
	process.argv[2] ??
		join(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/current-graph-native-d61-qualified-v8",
		),
);
if ((await measureD61Implementation()) !== D61_IMPLEMENTATION_MANIFEST_DIGEST)
	throw new TypeError("D61 implementation manifest drifted before qualification");
console.log(
	JSON.stringify(await persist(directory, await runD61InjectedNoNetworkQualification()), null, 2),
);
