import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

const capture = resolve("archive/evals/causal-event-clock-repair-v1/capture");
const script = resolve("scripts/replay-causal-event-clock.mjs");
test("offline replay preserves capture, rejects symlink escape and never overwrites output", () => {
	const temp = mkdtempSync(join(tmpdir(), "clock-replay-path-"));
	const before = Object.fromEntries(
		readdirSync(capture).map((n) => [n, readFileSync(join(capture, n)).toString("base64")]),
	);
	try {
		const alias = join(temp, "capture-alias");
		symlinkSync(capture, alias, "dir");
		assert.throws(
			() =>
				execFileSync(process.execPath, [script, capture, join(alias, "unapproved-output")], {
					stdio: "pipe",
				}),
			/outside capture/,
		);
		const output = join(temp, "replay");
		execFileSync(process.execPath, [script, capture, output], { stdio: "pipe" });
		const replay = readFileSync(join(output, "replay.json"));
		assert.equal(JSON.parse(readFileSync(join(output, "correlation.json"))).status, "calibrated");
		assert.throws(
			() => execFileSync(process.execPath, [script, capture, output], { stdio: "pipe" }),
			/fresh replay output/,
		);
		assert.deepEqual(readFileSync(join(output, "replay.json")), replay);
		assert.deepEqual(
			Object.fromEntries(
				readdirSync(capture).map((n) => [n, readFileSync(join(capture, n)).toString("base64")]),
			),
			before,
		);
	} finally {
		rmSync(temp, { recursive: true, force: true });
	}
});
