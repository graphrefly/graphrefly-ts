import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

await import("./build-local-untrusted-js-runner.mjs");

const root = resolve(import.meta.dirname, "..");
const runnerDirectory = resolve(root, "packages/ts/runners/local-untrusted-js");
const imageTag = "localhost/graphrefly/local-untrusted-js-runner:d667-v0";
const built = spawnSync(
	"podman",
	[
		"build",
		"--no-cache",
		"--timestamp",
		"0",
		"--tag",
		imageTag,
		"--file",
		resolve(runnerDirectory, "Containerfile"),
		runnerDirectory,
	],
	{ encoding: "utf8", stdio: ["ignore", "inherit", "inherit"] },
);
if (built.error !== undefined) throw built.error;
if (built.status !== 0)
	throw new Error(`Podman runner image build failed (${built.status ?? "signal"}).`);
const inspected = spawnSync("podman", ["image", "inspect", imageTag, "--format", "{{.Digest}}"], {
	encoding: "utf8",
	stdio: ["ignore", "pipe", "inherit"],
});
if (inspected.error !== undefined) throw inspected.error;
if (inspected.status !== 0) throw new Error("Podman runner image inspection failed.");
const digest = inspected.stdout.trim();
if (!/^sha256:[a-f0-9]{64}$/.test(digest))
	throw new Error("Podman runner image did not expose one immutable digest.");
process.stdout.write(`${imageTag.slice(0, imageTag.lastIndexOf(":"))}@${digest}\n`);
