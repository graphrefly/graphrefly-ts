import { randomBytes, randomInt } from "node:crypto";
import { constants } from "node:fs";
import { chmod, link, mkdir, open, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	createRootEvalTaskManifest,
	type RootEvalTaskManifest,
	type RootEvalTaskManifestSlot,
	readRootEvalTaskManifest,
	rootEvalDevelopmentOrdinal,
} from "./root-eval-task.js";

function manifestDirectory(): string {
	return resolve(
		process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY ??
			resolve(
				import.meta.dirname,
				"../.private/empirical-memory-rerun-avoidance/d145-task-manifests",
			),
	);
}

function shuffledVariantOrder(): readonly number[] {
	const order = [0, 1, 2, 3, 4];
	for (let index = order.length - 1; index > 0; index -= 1) {
		const swap = randomInt(index + 1);
		[order[index], order[swap]] = [order[swap]!, order[index]!];
	}
	return Object.freeze(order);
}

export async function ensureRootEvalDevelopmentTaskManifest(
	slot: RootEvalTaskManifestSlot,
): Promise<RootEvalTaskManifest> {
	if (rootEvalDevelopmentOrdinal(slot) === null)
		throw new TypeError("confirmatory task manifest must be pre-sealed, never generated on demand");
	try {
		return readRootEvalTaskManifest(slot);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	const directory = manifestDirectory();
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const manifest = createRootEvalTaskManifest({
		slot,
		variantOrder: shuffledVariantOrder(),
		coordinateSuffix: randomBytes(24).toString("hex"),
	});
	const target = resolve(directory, `${slot}.json`);
	const stage = `${target}.stage-${process.pid}-${randomBytes(12).toString("hex")}`;
	const handle = await open(
		stage,
		constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
		0o600,
	);
	try {
		await handle.writeFile(strictJsonCodec.encode(manifest));
		await handle.sync();
	} finally {
		await handle.close();
	}
	try {
		await link(stage, target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
	} finally {
		await rm(stage, { force: true });
	}
	return readRootEvalTaskManifest(slot);
}
