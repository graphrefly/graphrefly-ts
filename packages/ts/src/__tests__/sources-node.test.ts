import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toProcess } from "../adapters/index.js";
import type { Message } from "../index.js";
import { EnvironmentDrivers, fromProcess, graph } from "../index.js";
import {
	type FSEvent,
	fromFSWatch,
	fromGitPoll,
	fromSpawn,
	type GitEvent,
	nodeProcessDriver,
	type ProcessResult,
	runProcess,
	type SpawnEvent,
} from "../sources/node.js";

const dirs: string[] = [];

beforeEach(() => {
	vi.useRealTimers();
});

afterEach(() => {
	vi.useRealTimers();
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const data = <T = FSEvent>(msgs: Message[]): T[] =>
	msgs.filter((m) => m[0] === "DATA").map((m) => (m as ["DATA", T])[1]);

async function waitFor(predicate: () => boolean, attempts = 200): Promise<void> {
	for (let i = 0; i < attempts; i += 1) {
		if (predicate()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(predicate()).toBe(true);
}

describe("node-only filesystem sources", () => {
	it("fromFSWatch is an inspectable node-only source factory with explicit initial scan", async () => {
		const dir = mkdtempSync(join(tmpdir(), "graphrefly-fs-"));
		dirs.push(dir);
		writeFileSync(join(dir, "a.txt"), "a");
		writeFileSync(join(dir, "skip.log"), "skip");
		const g = graph();
		const watched = g.initNode(
			fromFSWatch(dir, { debounceMs: 0, include: ["*.txt"], initialScan: true }),
			[],
			{ name: "fs" },
		);
		const msgs: Message[] = [];
		const unsubscribe = watched.subscribe((msg) => msgs.push(msg));

		await waitFor(() => data(msgs).length === 1);
		unsubscribe();

		const event = data(msgs)[0];
		expect(event.type).toBe("create");
		expect(event.path.endsWith("/a.txt")).toBe(true);
		expect(event.relativePath).toBe("a.txt");
		expect(g.describe().nodes.find((node) => node.id === "fs")?.factory).toBe("fromFSWatch");
	});

	it("fromFSWatch rejects an empty path list before constructing an operator", () => {
		expect(() => fromFSWatch([])).toThrow(RangeError);
	});
});

describe("node-only process sources", () => {
	it("fromSpawn streams stdout/stderr and completes with an exit event", async () => {
		const n = graph().initNode(
			fromSpawn(process.execPath, [
				"-e",
				"process.stdout.write('out'); process.stderr.write('err');",
			]),
			[],
		);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		await waitFor(() => msgs.some((msg) => msg[0] === "COMPLETE"));

		const events = data<SpawnEvent>(msgs);
		expect(
			events.some((event) => event.kind === "stdout" && event.chunk.toString() === "out"),
		).toBe(true);
		expect(
			events.some((event) => event.kind === "stderr" && event.chunk.toString() === "err"),
		).toBe(true);
		expect(events.at(-1)).toEqual({ kind: "exit", code: 0, signal: null });
	});

	it("runProcess emits aggregate output once", async () => {
		const n = graph().initNode(
			runProcess(process.execPath, [
				"-e",
				"process.stdout.write('out'); process.stderr.write('err');",
			]),
			[],
		);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		await waitFor(() => msgs.some((msg) => msg[0] === "COMPLETE"));

		expect(data<ProcessResult>(msgs)).toEqual([
			{ stdout: "out", stderr: "err", exitCode: 0, signal: null },
		]);
	});

	it("nodeProcessDriver backs graph-local fromProcess sources", async () => {
		const g = graph({
			environment: EnvironmentDrivers.empty().withProcess(nodeProcessDriver()),
		});
		const n = g.initNode(
			fromProcess(process.execPath, [
				"-e",
				"process.stdout.write('driver-out'); process.stderr.write('driver-err');",
			]),
			[],
			{ name: "driver_process" },
		);
		const msgs: Message[] = [];
		n.subscribe((msg) => msgs.push(msg));

		await waitFor(() => msgs.some((msg) => msg[0] === "COMPLETE"));

		expect(data<ProcessResult>(msgs)).toEqual([
			{ stdout: "driver-out", stderr: "driver-err", exitCode: 0, signal: null },
		]);
		expect(g.describe().nodes.find((node) => node.id === "driver_process")?.factory).toBe(
			"fromProcess",
		);
	});

	it("nodeProcessDriver backs graph-visible toProcess outbound bundles", async () => {
		const g = graph({
			environment: EnvironmentDrivers.empty().withProcess(nodeProcessDriver()),
		});
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toProcess(
			g,
			source,
			(value) => ({
				program: process.execPath,
				args: ["-e", `process.stdout.write(${JSON.stringify(value)});`],
			}),
			{ name: "egress_process" },
		);
		const events: Message[] = [];
		const statuses: Message[] = [];
		bundle.events.subscribe((msg) => events.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([["DATA", "adapter-out"]]);
		await waitFor(() =>
			events.some(
				(msg) =>
					msg[0] === "DATA" &&
					(msg[1] as { kind?: string }).kind === "sent" &&
					((msg[1] as { result?: ProcessResult }).result?.stdout ?? "") === "adapter-out",
			),
		);

		expect(events).toContainEqual(["DATA", { kind: "attempt", value: "adapter-out", attempt: 1 }]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{ state: "succeeded", inFlight: 0, attempt: 1, sent: 1, failed: 0 },
		]);
		expect(g.describe().edges).toContainEqual({ from: "source", to: "egress_process" });
		expect(g.describe().edges).toContainEqual({
			from: "egress_process",
			to: "egress_process/status",
		});
	});

	it("nodeProcessDriver closes stdin for stdin-draining commands", async () => {
		const driver = nodeProcessDriver();
		let result:
			| { readonly ok: true; readonly value: ProcessResult }
			| { readonly ok: false; readonly error: unknown }
			| undefined;
		const cancel = driver.run(
			{
				program: process.execPath,
				args: [
					"-e",
					[
						"let stdin = '';",
						"process.stdin.setEncoding('utf8');",
						"process.stdin.on('data', (chunk) => { stdin += chunk; });",
						"process.stdin.on('end', () => process.stdout.write('stdin-ended:' + stdin.length));",
						"process.stdin.resume();",
					].join(""),
				],
			},
			(r) => {
				result = r;
			},
		);

		await waitFor(() => result !== undefined);
		cancel();

		expect(result).toEqual({
			ok: true,
			value: { stdout: "stdin-ended:0", stderr: "", exitCode: 0, signal: null },
		});
	});

	it("nodeProcessDriver reports ERROR when captured output exceeds maxBufferBytes", async () => {
		const driver = nodeProcessDriver({ killGraceMs: 20, maxBufferBytes: 3 });
		let result:
			| { readonly ok: true; readonly value: ProcessResult }
			| { readonly ok: false; readonly error: unknown }
			| undefined;
		const cancel = driver.run(
			{
				program: process.execPath,
				args: ["-e", "process.stdout.write('abcdef'); setInterval(() => {}, 1000);"],
			},
			(r) => {
				result = r;
			},
		);

		await waitFor(() => result !== undefined);
		cancel();

		expect(result?.ok).toBe(false);
		expect(String(result && !result.ok ? result.error : "")).toContain("maxBufferBytes");
	});

	it("nodeProcessDriver cancellation terminates a long-running child", async () => {
		const dir = mkdtempSync(join(tmpdir(), "graphrefly-driver-process-"));
		dirs.push(dir);
		const ready = join(dir, "ready.txt");
		const marker = join(dir, "alive.txt");
		const script = [
			"process.on('SIGTERM', () => {});",
			`require('node:fs').writeFileSync(${JSON.stringify(ready)}, 'ready');`,
			`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 200);`,
			"setInterval(() => {}, 1000);",
		].join("");
		const driver = nodeProcessDriver({ killGraceMs: 20 });
		const cancel = driver.run({ program: process.execPath, args: ["-e", script] }, () => {
			throw new Error("canceled process should not callback");
		});

		await waitFor(() => existsSync(ready));
		cancel();
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(existsSync(marker)).toBe(false);
	});

	it("fromSpawn escalates teardown when a child ignores SIGTERM", async () => {
		const dir = mkdtempSync(join(tmpdir(), "graphrefly-spawn-"));
		dirs.push(dir);
		const marker = join(dir, "alive.txt");
		const script = [
			"process.stdout.write('ready');",
			"process.on('SIGTERM', () => {});",
			`setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'alive'), 200);`,
			"setInterval(() => {}, 1000);",
		].join("");
		const n = graph().initNode(
			fromSpawn(process.execPath, ["-e", script], { killGraceMs: 20 }),
			[],
		);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));

		await waitFor(() =>
			data<SpawnEvent>(msgs).some(
				(event) => event.kind === "stdout" && event.chunk.toString() === "ready",
			),
		);
		unsubscribe();
		await new Promise((resolve) => setTimeout(resolve, 300));

		expect(existsSync(marker)).toBe(false);
	});
});

function git(dir: string, args: readonly string[]): void {
	execFileSync("git", [...args], { cwd: dir, stdio: "ignore" });
}

describe("node-only git sources", () => {
	it("fromGitPoll records the first poll as baseline and emits later commits", async () => {
		const dir = mkdtempSync(join(tmpdir(), "graphrefly-git-"));
		dirs.push(dir);
		git(dir, ["init"]);
		git(dir, ["config", "core.fsmonitor", "false"]);
		git(dir, ["config", "user.email", "test@example.com"]);
		git(dir, ["config", "user.name", "GraphReFly Test"]);
		writeFileSync(join(dir, "a.txt"), "a");
		git(dir, ["add", "a.txt"]);
		git(dir, ["commit", "-m", "initial"]);

		const n = graph().initNode(
			fromGitPoll(dir, { pollMs: 50, include: ["*.txt"], exclude: ["skip*"] }),
			[],
		);
		const msgs: Message[] = [];
		const unsubscribe = n.subscribe((msg) => msgs.push(msg));
		try {
			expect(data<GitEvent>(msgs)).toEqual([]);

			writeFileSync(join(dir, " spaced .txt"), "b");
			writeFileSync(join(dir, "skip.log"), "skip");
			git(dir, ["add", "--", " spaced .txt", "skip.log"]);
			git(dir, ["commit", "-m", "second"]);

			await waitFor(() => data<GitEvent>(msgs).length === 1, 800);
		} finally {
			unsubscribe();
		}

		const event = data<GitEvent>(msgs)[0];
		expect(event.hook).toBe("post-commit");
		expect(event.files).toEqual([" spaced .txt"]);
		expect(event.message).toBe("second");
		expect(event.author).toBe("GraphReFly Test");
		expect(typeof event.timestamp_ns).toBe("string");
	}, 10_000);
});
