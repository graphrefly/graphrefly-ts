/** Explicit offline-only preparation; no execution/provider mode. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

assert.equal(process.argv.length, 2, "No execution mode accepted");
const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dest = join(root, "docs/design/causal-comparison-preparation");
mkdirSync(dest, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), "b121-memory-"));
const hash = (v) => createHash("sha256").update(v).digest("hex");
const save = (name, value) => {
	const path = join(dest, name);
	writeFileSync(path, JSON.stringify(value, null, "\t") + "\n");
	const formatted = spawnSync(join(root, "node_modules/.bin/biome"), ["format", "--write", path], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(formatted.status, 0, formatted.stderr);
};
try {
	for (const variant of ["base", "equivalent"]) {
		const outfile = join(scratch, variant + ".mjs");
		const edits = [];
		const targets =
			variant === "base"
				? []
				: [
						{
							path: "examples/spending-alerts/causal-numeric.ts",
							from: "rounded(delta * delta * (n - 1n), n * d, 0, true)",
							to: "rounded(delta * delta * n - delta * delta, n * d, 0, true)",
						},
						{
							path: "scripts/fixtures/spending-numeric-plain.ts",
							from: "delta * delta * (n - 1n)",
							to: "delta * delta * n - delta * delta",
						},
					];
		const meta = await build({
			absWorkingDir: root,
			entryPoints: ["scripts/fixtures/spending-comparison-capture.ts"],
			bundle: true,
			platform: "node",
			format: "esm",
			target: "node22",
			outfile,
			metafile: true,
			plugins: [
				{
					name: "bound-numerical-edit",
					setup(b) {
						b.onLoad({ filter: /\.ts$/ }, (args) => {
							const path = relative(root, args.path),
								edit = targets.find((t) => t.path === path);
							if (!edit) return;
							const raw = readFileSync(args.path, "utf8");
							assert.equal(raw.split(edit.from).length - 1, 1, "unique actual source edit");
							const contents = raw.replace(edit.from, edit.to);
							edits.push({ ...edit, loadedSha256: hash(contents) });
							return { contents, loader: "ts" };
						});
					},
				},
			],
		});
		assert.equal(edits.length, targets.length);
		const sources = Object.keys(meta.metafile.inputs)
			.sort()
			.map((path) => ({
				path,
				sha256: hash(readFileSync(join(root, path))),
				...(edits.find((e) => e.path === path)
					? { loadedSha256: edits.find((e) => e.path === path).loadedSha256 }
					: {}),
			}));
		const binding = {
			packRef: { kind: "offline-pack", id: "comparison" },
			sourceDigest: "sha256:" + hash(JSON.stringify(sources)),
			runtimeDigest: "sha256:" + hash(readFileSync(outfile)),
			destinationRef: { kind: "offline-inbox", id: "no-io" },
			compositionEpoch: 1,
			hostEpoch: 1,
			runRef: "comparison-memory",
			evidenceMode: "fixture-observations",
		};
		const r = spawnSync(
			process.execPath,
			[outfile, JSON.stringify(binding), ...(variant === "equivalent" ? ["C2"] : [])],
			{ cwd: scratch, encoding: "utf8", timeout: 60000, maxBuffer: 32 * 1024 * 1024 },
		);
		assert.equal(r.status, 0, r.stderr);
		const observation = JSON.parse(r.stdout);
		assert.equal(observation.results.length, variant === "base" ? 4 : 2);
		if (variant === "equivalent")
			for (const result of observation.results) {
				const entry = result.snapshots.find((s) => s.label === "writer-entry-before-transport");
				assert.ok(entry);
				assert.equal(entry.writes, 0);
				assert.equal(entry.host.inFlight, 1);
			}
		const name = variant === "base" ? "memory-checkpoints.json" : "equivalent-checkpoints.json";
		save(name, observation);
		save(variant === "base" ? "capture-binding.json" : "equivalent-binding.json", {
			node: process.version,
			launcherSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
			nodeExecutableSha256: hash(readFileSync(process.execPath)),
			sources,
			edits,
			binding,
			bundleSha256: hash(readFileSync(outfile)),
			captureSha256: hash(r.stdout),
			storedCaptureSha256: hash(readFileSync(join(dest, name))),
			realInboxIO: 0,
			participantRuns: 0,
		});
	}
	console.log(JSON.stringify({ passed: true, arms: 6, realInboxIO: 0, participantRuns: 0 }));
} finally {
	rmSync(scratch, { recursive: true, force: true });
}
