import { randomBytes, randomInt } from "node:crypto";
import { chmod, link, lstat, mkdir, open, rename, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import {
	createRootEvalTaskManifest,
	type RootEvalTaskManifestSlot,
	readRootEvalTaskManifest,
	rootEvalVariantOrderSupportsIrrelevantControls,
} from "./root-eval-task.js";

const directory = resolve(
	process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY ??
		resolve(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/d145-task-manifests",
		),
);

function shuffledVariantOrder(): readonly number[] {
	for (let attempt = 0; attempt < 128; attempt += 1) {
		const order = [0, 1, 2, 3, 4];
		for (let index = order.length - 1; index > 0; index -= 1) {
			const swap = randomInt(index + 1);
			[order[index], order[swap]] = [order[swap]!, order[index]!];
		}
		if (rootEvalVariantOrderSupportsIrrelevantControls(order)) return Object.freeze(order);
	}
	throw new TypeError("root eval could not generate incompatible irrelevant controls");
}

async function writeExclusive(path: string, bytes: Uint8Array): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(bytes);
		await handle.sync();
	} finally {
		await handle.close();
	}
	await chmod(path, 0o600);
}

async function resealConfirmatory(): Promise<void> {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const target = resolve(directory, "confirmatory.json");
	const invalidated = resolve(directory, "confirmatory.invalidated-v4-d150.json");
	const existing = await lstat(target);
	if (!existing.isFile() || (existing.mode & 0o077) !== 0)
		throw new TypeError("root eval prior confirmatory manifest must be a mode-0600 regular file");
	const manifest = createRootEvalTaskManifest({
		slot: "confirmatory",
		variantOrder: shuffledVariantOrder(),
		coordinateSuffix: randomBytes(24).toString("hex"),
	});
	const stage = resolve(
		directory,
		`confirmatory.stage-${process.pid}-${randomBytes(12).toString("hex")}.json`,
	);
	await writeExclusive(stage, strictJsonCodec.encode(manifest));
	try {
		await link(target, invalidated);
		await rename(stage, target);
	} finally {
		await rm(stage, { force: true });
	}
	const sealed = readRootEvalTaskManifest("confirmatory");
	if (sealed.manifestDigest !== manifest.manifestDigest)
		throw new TypeError("root eval replacement confirmatory seal drifted");
	process.stdout.write(
		`${JSON.stringify({
			slot: sealed.slot,
			taskSetRef: sealed.taskSetRef,
			manifestDigest: sealed.manifestDigest,
			invalidatedPath: invalidated,
		})}\n`,
	);
}

if (process.argv.slice(2).includes("--reseal-confirmatory")) await resealConfirmatory();
else {
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);

	const receipts: Array<{
		readonly slot: RootEvalTaskManifestSlot;
		readonly taskSetRef: string;
		readonly manifestDigest: string;
	}> = [];
	for (const slot of ["development-1", "development-2", "confirmatory"] as const) {
		const manifest = createRootEvalTaskManifest({
			slot,
			variantOrder: shuffledVariantOrder(),
			coordinateSuffix: randomBytes(24).toString("hex"),
		});
		await writeExclusive(resolve(directory, `${slot}.json`), strictJsonCodec.encode(manifest));
		receipts.push(
			Object.freeze({
				slot,
				taskSetRef: manifest.taskSetRef,
				manifestDigest: manifest.manifestDigest,
			}),
		);
	}

	process.stdout.write(`${JSON.stringify({ directory, receipts })}\n`);
}
