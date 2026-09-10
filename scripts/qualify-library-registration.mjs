import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const out = path.resolve(process.argv[2] ?? "archive/evals/library-registration-v1/mutations");
mkdirSync(out, { recursive: true });
const sha = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const nodeFile = "packages/ts/src/node/runtime-accessors.ts";
const owned = "packages/ts/src/node/owned-acquisition.ts";
const messaging = "packages/ts/src/messaging/internal.ts";
const mutants = [
	{
		id: "forged-node",
		file: nodeFile,
		before: "const record = registrations.get(node);",
		after:
			"const record = registrations.get(node) ?? registrations.get(Object.getPrototypeOf(node));",
		all: true,
	},
	{
		id: "retain-closed-access",
		file: nodeFile,
		before: 'registrations.set(node, { kind: "retired" });',
		after: "void node;",
	},
	{
		id: "omit-handle-cleanup",
		file: owned,
		before: "a.dispatcher!.unregister(a.handle);",
		after: "void a.handle;",
	},
	{
		id: "omit-slot-cleanup",
		file: owned,
		before: "a.core!.releaseSlot(a.slot);",
		after: "void a.slot;",
	},
	{
		id: "miss-partial-slot",
		file: "packages/ts/src/node/core.ts",
		before: "acquisition.slot = id;",
		after: "void id;",
	},
	{
		id: "close-before-hooks",
		file: "packages/ts/src/node/node-lifecycle-runtime.ts",
		before: "const releaseErrors: RuntimeReleaseFailure[] = [];",
		after: "closeNodeRegistration(node); const releaseErrors: RuntimeReleaseFailure[] = [];",
	},
	{
		id: "stale-deferred-snapshot",
		file: messaging,
		before: "const apply = (add: boolean, deferred: boolean) => {",
		after: "const captured = nextDeps(true); const apply = (add: boolean, deferred: boolean) => {",
		second: ["const next = nextDeps(add);", "const next = add ? captured : nextDeps(false);"],
	},
	{
		id: "omit-adapter-operation-deferral",
		file: messaging,
		before:
			"if (!deferAfterBatchForTarget(busCommands, () => apply(add, true))) apply(add, false);",
		after: "apply(add, false);",
	},
	{
		id: "duplicate-second-lease",
		file: messaging,
		before: "if (add ? present : !ownsBinding || !present) return;",
		after:
			"if (add && present) { ownsBinding = true; return; } if (!add && (!ownsBinding || !present)) return;",
	},
	{
		id: "premature-remove-closure",
		file: messaging,
		before: "const request = (add: boolean) => {",
		after: "const request = (add: boolean) => { if (!add) ownsBinding = false;",
	},
	{
		id: "ignore-batch-cancellation",
		file: "packages/ts/src/batch/batch.ts",
		before: "if (owner.committed) fn();",
		after: "fn();",
		second: ["}, owner);", "});"],
	},
];
function replaceOne(source, before, after, all = false) {
	const count = source.split(before).length - 1;
	assert.ok(all ? count > 0 : count === 1, `mutation anchor count ${count}: ${before}`);
	return all ? source.replaceAll(before, after) : source.replace(before, after);
}
const results = [];
for (const mutant of [null, ...mutants]) {
	const id = mutant?.id ?? "baseline";
	const changed = new Map();
	const built = await build({
		absWorkingDir: root,
		entryPoints: ["scripts/fixtures/library-registration-probe.ts"],
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
		metafile: true,
		plugins: mutant
			? [
					{
						name: "runtime-source-mutation",
						setup(b) {
							b.onLoad({ filter: /\.ts$/ }, async (args) => {
								if (path.relative(root, args.path) !== mutant.file) return;
								let source = replaceOne(
									readFileSync(args.path, "utf8"),
									mutant.before,
									mutant.after,
									mutant.all,
								);
								if (mutant.second) source = replaceOne(source, ...mutant.second);
								changed.set(mutant.file, source);
								return { contents: source, loader: "ts" };
							});
						},
					},
				]
			: [],
	});
	const bundle = built.outputFiles[0].text;
	writeFileSync(path.join(out, `${id}.mjs`), bundle);
	const loaded = await import(`file://${path.join(out, `${id}.mjs`)}`); // load success is separate from assertion detection
	let status = "survived";
	let detail;
	try {
		detail = loaded.probe();
		if (!mutant) status = "pass";
	} catch (error) {
		status = error instanceof assert.AssertionError ? "detected" : "runtime-error";
		detail = { name: error.name, message: error.message, stack: error.stack };
	}
	const row = {
		id,
		status,
		detail,
		bundleDigest: sha(bundle),
		sources: Object.keys(built.metafile.inputs)
			.filter((f) => !f.startsWith("<"))
			.sort()
			.map((file) => ({ file, digest: sha(changed.get(file) ?? readFileSync(file)) })),
	};
	results.push(row);
	writeFileSync(
		path.join(out, "results.json"),
		JSON.stringify({ node: process.version, results }, null, 2) + "\n",
	);
	console.log(`${id}: ${status}`);
	assert.equal(status, mutant ? "detected" : "pass", `qualification failed: ${id}`);
}
