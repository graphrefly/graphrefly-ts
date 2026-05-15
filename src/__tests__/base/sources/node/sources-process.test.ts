/**
 * Tests for `fromSpawn` and `runProcess` — Node-only child-process reactive sources.
 *
 * Covers:
 *   - happy path: runProcess stdout + exit code 0
 *   - stderr capture + non-zero exit code
 *   - spawn error (ENOENT) → ERROR message
 *   - fromSpawn discriminated stream: stdout events then exit event
 *   - abort via opts.signal → SIGTERM, COMPLETE within timeout
 *   - producer teardown kills subprocess (marker-file approach)
 *   - large stdout buffering (regression for exit vs close)
 *   - concurrent subscribers share a single subprocess (multicast)
 */

import { existsSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { COMPLETE, DATA, ERROR } from "@graphrefly/pure-ts/core/messages.js";
import { describe, expect, it } from "vitest";
import { fromSpawn, runProcess } from "../../extra/sources-process.js";

// ---------------------------------------------------------------------------
// Helper: collect all messages until COMPLETE or ERROR, with timeout.
// ---------------------------------------------------------------------------
type AnyMsg = [number, unknown];

async function collectUntilDone<_T>(
	node: ReturnType<typeof fromSpawn> | ReturnType<typeof runProcess>,
	timeoutMs = 5000,
): Promise<AnyMsg[]> {
	const collected: AnyMsg[] = [];
	return new Promise((resolve, reject) => {
		let resolved = false;
		// no-op default — replaced before any synchronous terminal can fire
		let unsub = (): void => {};
		const timer = setTimeout(() => {
			if (resolved) return;
			resolved = true;
			unsub();
			reject(
				new Error(
					`collectUntilDone: no COMPLETE/ERROR within ${timeoutMs}ms — possible subprocess leak`,
				),
			);
		}, timeoutMs);
		const finish = (action: () => void): void => {
			if (resolved) return;
			resolved = true;
			clearTimeout(timer);
			unsub();
			action();
		};
		unsub = node.subscribe((batch) => {
			for (const m of batch) {
				collected.push(m as AnyMsg);
				if (m[0] === COMPLETE) {
					finish(() => resolve(collected));
					return;
				}
				if (m[0] === ERROR) {
					finish(() => resolve(collected));
					return;
				}
			}
		});
	});
}

// ---------------------------------------------------------------------------
// runProcess — happy path
// ---------------------------------------------------------------------------

describe("runProcess — happy path", () => {
	it("emits stdout, exitCode 0, signal null", async () => {
		const n = runProcess("node", ["-e", "process.stdout.write('hi')"]);
		const msgs = await collectUntilDone(n);

		const dataMsg = msgs.find((m) => m[0] === DATA);
		expect(dataMsg).toBeDefined();
		const result = dataMsg![1] as {
			stdout: string;
			stderr: string;
			exitCode: number | null;
			signal: NodeJS.Signals | null;
		};
		expect(result.stdout).toBe("hi");
		expect(result.stderr).toBe("");
		expect(result.exitCode).toBe(0);
		expect(result.signal).toBeNull();

		expect(msgs.some((m) => m[0] === COMPLETE)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// runProcess — stderr capture + non-zero exit
// ---------------------------------------------------------------------------

describe("runProcess — stderr capture", () => {
	it("captures stderr and non-zero exit code", async () => {
		const n = runProcess("node", ["-e", "process.stderr.write('warn'); process.exit(2)"]);
		const msgs = await collectUntilDone(n);

		const dataMsg = msgs.find((m) => m[0] === DATA);
		expect(dataMsg).toBeDefined();
		const result = dataMsg![1] as {
			stdout: string;
			stderr: string;
			exitCode: number | null;
			signal: NodeJS.Signals | null;
		};
		expect(result.stderr).toBe("warn");
		expect(result.exitCode).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// fromSpawn — spawn error (ENOENT)
// ---------------------------------------------------------------------------

describe("fromSpawn — spawn error", () => {
	it("emits ERROR when command does not exist", async () => {
		const n = fromSpawn("definitely-not-a-real-command-xyz-abc-123", []);
		const msgs = await collectUntilDone(n);

		const errMsg = msgs.find((m) => m[0] === ERROR);
		expect(errMsg).toBeDefined();
		// The error should be a Node.js spawn error (ENOENT)
		expect(errMsg![1]).toBeInstanceOf(Error);
	});
});

// ---------------------------------------------------------------------------
// fromSpawn — discriminated stream
// ---------------------------------------------------------------------------

describe("fromSpawn — discriminated stream", () => {
	it("emits stdout events then exit event with code 0", async () => {
		const n = fromSpawn("node", ["-e", "process.stdout.write('hello'); process.exit(0)"]);
		const msgs = await collectUntilDone(n);

		const dataMsgs = msgs.filter((m) => m[0] === DATA);
		const stdoutEvents = dataMsgs.filter((m) => (m[1] as { kind: string }).kind === "stdout");
		const exitEvents = dataMsgs.filter((m) => (m[1] as { kind: string }).kind === "exit");

		expect(stdoutEvents.length).toBeGreaterThanOrEqual(1);
		expect(exitEvents).toHaveLength(1);
		const exit = exitEvents[0]![1] as {
			kind: string;
			code: number | null;
			signal: NodeJS.Signals | null;
		};
		expect(exit.code).toBe(0);
		expect(exit.signal).toBeNull();
		// stdout must come before exit in the message sequence
		const stdoutIdx = msgs.findIndex(
			(m) => m[0] === DATA && (m[1] as { kind: string }).kind === "stdout",
		);
		const exitIdx = msgs.findIndex(
			(m) => m[0] === DATA && (m[1] as { kind: string }).kind === "exit",
		);
		expect(stdoutIdx).toBeLessThan(exitIdx);
	});
});

// ---------------------------------------------------------------------------
// Abort via opts.signal (macOS/Linux only — Windows signal behavior differs)
// ---------------------------------------------------------------------------

describe("runProcess — abort via opts.signal", () => {
	it("SIGTERM kills the subprocess when signal is aborted (non-Windows)", {
		skip: process.platform === "win32",
	}, async () => {
		const ac = new AbortController();
		const n = runProcess("node", ["-e", "setTimeout(() => {}, 60000)"], {
			signal: ac.signal,
		});

		// Start collecting but don't await immediately — we want to abort.
		const collectPromise = collectUntilDone(n, 3000);

		// Give the process time to start, then abort.
		await new Promise((r) => setTimeout(r, 50));
		ac.abort();

		const msgs = await collectPromise;

		// After abort, Node's child_process sends SIGTERM and emits an error
		// (AbortError) before the process exits — OR the process gets SIGTERM
		// and emits exit with signal "SIGTERM". Either shape is acceptable.
		const hasError = msgs.some((m) => m[0] === ERROR);
		const hasExitWithSignal = msgs.some(
			(m) =>
				m[0] === DATA &&
				(m[1] as { kind?: string; signal?: string }).kind === "exit" &&
				(m[1] as { signal?: string }).signal != null,
		);
		// One of the two terminal paths must have fired
		expect(hasError || hasExitWithSignal).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// P7 — Producer teardown kills subprocess (marker-file approach)
// ---------------------------------------------------------------------------

describe("fromSpawn — producer teardown", () => {
	it("kills subprocess on unsubscribe (verified via marker file absence)", {
		skip: process.platform === "win32",
	}, async () => {
		const markerPath = join(
			tmpdir(),
			`graphrefly-spawn-test-${Date.now()}-${Math.random().toString(36).slice(2)}.marker`,
		);
		// Cleanup if a previous run leaked.
		if (existsSync(markerPath)) unlinkSync(markerPath);
		try {
			// Child writes the marker file 200ms after spawn — long enough for us
			// to unsub before it fires.
			const node = fromSpawn("node", [
				"-e",
				`setTimeout(() => { require("fs").writeFileSync(${JSON.stringify(markerPath)}, "x"); }, 200)`,
			]);
			const unsub = node.subscribe(() => {});
			// Give spawn ~50ms to actually start, then unsub.
			await new Promise((r) => setTimeout(r, 50));
			unsub();
			// Wait long enough for the timer to fire IF SIGTERM didn't kill the child.
			await new Promise((r) => setTimeout(r, 400));
			expect(existsSync(markerPath)).toBe(false);
		} finally {
			if (existsSync(markerPath)) unlinkSync(markerPath);
		}
	});
});

// ---------------------------------------------------------------------------
// P10a — runProcess large stdout + immediate exit (regression for P1 exit→close)
// ---------------------------------------------------------------------------

describe("runProcess — large stdout buffering", () => {
	it("captures all stdout across multiple pipe-buffer chunks (regression for exit vs close)", async () => {
		// 200 KB > pipe buffer (64 KB on Linux/macOS) → data arrives in multiple
		// chunks. Child writes all data then exits via the write callback to
		// ensure the OS drains the pipe before exit. The `exit` event fires
		// before all `data` events are delivered; `close` waits for drain.
		// The old `exit`-based implementation would only capture the first chunk.
		const n = runProcess("node", [
			"-e",
			"const buf = Buffer.alloc(200 * 1024, 97); process.stdout.write(buf, () => process.exit(0));",
		]);
		const msgs = await collectUntilDone(n, 10000);
		const dataMsg = msgs.find((m) => m[0] === DATA);
		expect(dataMsg).toBeDefined();
		const result = dataMsg![1] as { stdout: string; stderr: string; exitCode: number | null };
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBe(200 * 1024);
		expect(result.stdout[0]).toBe("a");
		expect(result.stdout[result.stdout.length - 1]).toBe("a");
	});
});

// ---------------------------------------------------------------------------
// P11 — Concurrent subscribers share a single subprocess (multicast)
// ---------------------------------------------------------------------------
//
// `fromSpawn` returns a node backed by a single `producer` activation.
// The subprocess is spawned once when the FIRST subscriber connects; all
// subsequent subscribers are added to the shared sinks set and receive
// the same events from that one subprocess. Unsubscribing the last subscriber
// tears down the subprocess.

describe("fromSpawn — concurrent subscribers (multicast)", () => {
	it("two subscribers see the same events from a single subprocess spawn", async () => {
		const n = fromSpawn("node", ["-e", "process.stdout.write('shared'); process.exit(0)"]);

		const results1: AnyMsg[] = [];
		const results2: AnyMsg[] = [];

		const done1 = new Promise<void>((resolve) => {
			let unsub = (): void => {};
			unsub = n.subscribe((batch) => {
				for (const m of batch) {
					results1.push(m as AnyMsg);
					if (m[0] === COMPLETE || m[0] === ERROR) {
						unsub();
						resolve();
						return;
					}
				}
			});
		});

		const done2 = new Promise<void>((resolve) => {
			let unsub = (): void => {};
			unsub = n.subscribe((batch) => {
				for (const m of batch) {
					results2.push(m as AnyMsg);
					if (m[0] === COMPLETE || m[0] === ERROR) {
						unsub();
						resolve();
						return;
					}
				}
			});
		});

		await Promise.all([done1, done2]);

		// Both subscribers must have received at least one DATA and a COMPLETE.
		expect(results1.some((m) => m[0] === COMPLETE)).toBe(true);
		expect(results2.some((m) => m[0] === COMPLETE)).toBe(true);

		// Both must see the exit event (one spawn, shared stream).
		const exitEvents1 = results1.filter(
			(m) => m[0] === DATA && (m[1] as { kind: string }).kind === "exit",
		);
		const exitEvents2 = results2.filter(
			(m) => m[0] === DATA && (m[1] as { kind: string }).kind === "exit",
		);
		expect(exitEvents1).toHaveLength(1);
		expect(exitEvents2).toHaveLength(1);
	});
});
