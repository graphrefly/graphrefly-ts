import { randomBytes, randomInt } from "node:crypto";
import { chmod, mkdir, open } from "node:fs/promises";
import { resolve } from "node:path";
import { strictJsonCodec } from "../../src/json/codec.js";
import { createRootEvalTaskManifest, type RootEvalTaskManifestSlot } from "./root-eval-task.js";

const directory = resolve(
	process.env.GRAPHREFLY_ROOT_EVAL_TASK_MANIFEST_DIRECTORY ??
		resolve(
			import.meta.dirname,
			"../.private/empirical-memory-rerun-avoidance/d145-task-manifests",
		),
);

function shuffledVariantOrder(): readonly number[] {
	const order = [0, 1, 2, 3, 4];
	for (let index = order.length - 1; index > 0; index -= 1) {
		const swap = randomInt(index + 1);
		[order[index], order[swap]] = [order[swap]!, order[index]!];
	}
	return Object.freeze(order);
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
