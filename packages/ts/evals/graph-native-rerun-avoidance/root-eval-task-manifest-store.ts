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
	rootEvalTaskManifestDirectory,
	rootEvalVariantOrderSupportsIrrelevantControls,
} from "./root-eval-task.js";

function shuffledVariantOrder(slot: RootEvalTaskManifestSlot): readonly number[] {
	for (let attempt = 0; attempt < 128; attempt += 1) {
		const order = [0, 1, 2, 3, 4];
		for (let index = order.length - 1; index > 0; index -= 1) {
			const swap = randomInt(index + 1);
			[order[index], order[swap]] = [order[swap]!, order[index]!];
		}
		if (rootEvalVariantOrderSupportsIrrelevantControls(order, slot)) return Object.freeze(order);
	}
	throw new TypeError("root eval could not generate incompatible irrelevant controls");
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
	const directory = rootEvalTaskManifestDirectory();
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const manifest = createRootEvalTaskManifest({
		slot,
		variantOrder: shuffledVariantOrder(slot),
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
