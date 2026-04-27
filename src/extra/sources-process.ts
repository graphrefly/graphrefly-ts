/**
 * Child-process reactive sources — Node-only.
 *
 * Isolated from `./sources.ts` so bundlers targeting the browser can import
 * browser-safe sources without pulling in `node:child_process`.
 *
 * Access via `@graphrefly/graphrefly/extra/node`, which re-exports this module.
 *
 * @module
 */

import { type SpawnOptions, spawn } from "node:child_process";
import { COMPLETE, DATA, ERROR, type Messages } from "../core/messages.js";
import type { Node } from "../core/node.js";
import { producer } from "../core/sugar.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * SpawnEvent — discriminated stream emitted by {@link fromSpawn}.
 *
 * @category extra
 */
export type SpawnEvent =
	| { kind: "stdout"; chunk: Buffer }
	| { kind: "stderr"; chunk: Buffer }
	| { kind: "exit"; code: number | null; signal: NodeJS.Signals | null };

/** Options for {@link fromSpawn}. Mirrors `child_process.SpawnOptions`. */
export interface FromSpawnOptions {
	cwd?: string;
	env?: NodeJS.ProcessEnv;
	shell?: boolean | string;
	/**
	 * Optional caller-owned AbortSignal. When fired, the subprocess is sent
	 * SIGTERM (per `child_process.spawn` signal semantics). The producer's own
	 * teardown also sends SIGTERM regardless of caller signal — so `switchMap`
	 * supersede in `actuatorExecutor` cancels in-flight subprocesses without
	 * the caller wiring extra signals.
	 */
	signal?: AbortSignal;
	/** Extra args forwarded to spawn — e.g. stdio configuration. */
	stdio?: "pipe" | readonly ("pipe" | "ignore" | "inherit")[];
}

// ---------------------------------------------------------------------------
// fromSpawn
// ---------------------------------------------------------------------------

/**
 * Spawn `cmd args` as a child process and stream stdout/stderr/exit as a
 * single discriminated `SpawnEvent` stream.
 *
 * Lifecycle:
 * - Stdout/stderr chunks emit as `DATA { kind: "stdout"|"stderr", chunk }`.
 * - Process exit emits one final `DATA { kind: "exit", code, signal }` then
 *   `COMPLETE`.
 * - Spawn-error (ENOENT, EPERM, …) emits `ERROR`.
 * - Producer teardown sends `SIGTERM` to the subprocess if it is still alive.
 *
 * **Multicast semantics:** `fromSpawn` returns a node backed by a single
 * `producer` activation — the subprocess is spawned once when the first
 * subscriber connects, and all subsequent subscribers share the same event
 * stream. Unsubscribing the last subscriber tears down the subprocess.
 *
 * @example
 * ```ts
 * import { fromSpawn } from "@graphrefly/graphrefly/extra/node";
 *
 * const stream = fromSpawn("git", ["log", "--oneline"]);
 * stream.subscribe((msgs) => {
 *   for (const [type, value] of msgs) {
 *     if (type === DATA) console.log(value);
 *   }
 * });
 * ```
 *
 * @category extra
 */
export function fromSpawn(
	cmd: string,
	args: readonly string[],
	opts?: FromSpawnOptions,
): Node<SpawnEvent> {
	return producer<SpawnEvent>(
		(actions) => {
			const child = spawn(cmd, args as string[], {
				cwd: opts?.cwd,
				env: opts?.env,
				shell: opts?.shell,
				signal: opts?.signal,
				stdio: (opts?.stdio as SpawnOptions["stdio"]) ?? "pipe",
			});

			let alive = true;
			let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;

			child.stdout?.on("data", (chunk: Buffer) => {
				if (!alive) return;
				actions.down([[DATA, { kind: "stdout", chunk }]] satisfies Messages);
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				if (!alive) return;
				actions.down([[DATA, { kind: "stderr", chunk }]] satisfies Messages);
			});

			child.on("error", (err) => {
				if (!alive) return;
				alive = false;
				actions.down([[ERROR, err]] satisfies Messages);
			});

			child.on("exit", (code, signal) => {
				// Capture exit info, but defer terminal emission to "close" — by which
				// time all stdout/stderr "data" events have been delivered.
				if (exitInfo == null) exitInfo = { code, signal: signal as NodeJS.Signals | null };
			});

			child.on("close", () => {
				if (!alive) return;
				alive = false;
				const info = exitInfo ?? { code: null, signal: null };
				actions.down([
					[DATA, { kind: "exit", code: info.code, signal: info.signal }],
					[COMPLETE],
				] satisfies Messages);
			});

			return () => {
				if (alive) {
					alive = false;
					child.stdout?.removeAllListeners();
					child.stderr?.removeAllListeners();
					child.removeAllListeners("error");
					child.removeAllListeners("exit");
					child.removeAllListeners("close");
					try {
						child.kill("SIGTERM");
					} catch {
						// already dead — ignore
					}
				}
			};
		},
		{ name: "from_spawn" },
	);
}

// ---------------------------------------------------------------------------
// runProcess
// ---------------------------------------------------------------------------

/**
 * Run `cmd args` to completion and emit one DATA with aggregated output.
 *
 * Convenience over {@link fromSpawn} for the "wait for the process to finish,
 * capture stdout/stderr as strings, get exit code" case.
 *
 * Aggregation policy: stdout and stderr are concatenated as `Buffer`s and
 * decoded as utf-8 once at exit, so multi-byte sequences split across chunks
 * are handled correctly. Actuators that need byte-exact stdout should use
 * `fromSpawn` directly.
 *
 * @example
 * ```ts
 * import { runProcess } from "@graphrefly/graphrefly/extra/node";
 *
 * const result = runProcess("git", ["rev-parse", "HEAD"]);
 * result.subscribe((msgs) => {
 *   for (const [type, value] of msgs) {
 *     if (type === DATA) console.log(value.stdout.trim());
 *   }
 * });
 * ```
 *
 * @category extra
 */
export function runProcess(
	cmd: string,
	args: readonly string[],
	opts?: FromSpawnOptions,
): Node<{
	stdout: string;
	stderr: string;
	exitCode: number | null;
	signal: NodeJS.Signals | null;
}> {
	type Result = {
		stdout: string;
		stderr: string;
		exitCode: number | null;
		signal: NodeJS.Signals | null;
	};
	return producer<Result>(
		(actions) => {
			const child = spawn(cmd, args as string[], {
				cwd: opts?.cwd,
				env: opts?.env,
				shell: opts?.shell,
				signal: opts?.signal,
				stdio: (opts?.stdio as SpawnOptions["stdio"]) ?? "pipe",
			});

			let alive = true;
			const stdoutChunks: Buffer[] = [];
			const stderrChunks: Buffer[] = [];
			let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null;

			child.stdout?.on("data", (chunk: Buffer) => {
				if (!alive) return;
				stdoutChunks.push(chunk);
			});

			child.stderr?.on("data", (chunk: Buffer) => {
				if (!alive) return;
				stderrChunks.push(chunk);
			});

			child.on("error", (err) => {
				if (!alive) return;
				alive = false;
				actions.down([[ERROR, err]] satisfies Messages);
			});

			child.on("exit", (code, signal) => {
				// Capture exit info, but defer terminal emission to "close" — by which
				// time all stdout/stderr "data" events have been delivered.
				if (exitInfo == null) exitInfo = { code, signal: signal as NodeJS.Signals | null };
			});

			child.on("close", () => {
				if (!alive) return;
				alive = false;
				const info = exitInfo ?? { code: null, signal: null };
				const stdout = Buffer.concat(stdoutChunks).toString("utf8");
				const stderr = Buffer.concat(stderrChunks).toString("utf8");
				actions.down([
					[
						DATA,
						{
							stdout,
							stderr,
							exitCode: info.code,
							signal: info.signal,
						},
					],
					[COMPLETE],
				] satisfies Messages);
			});

			return () => {
				if (alive) {
					alive = false;
					child.stdout?.removeAllListeners();
					child.stderr?.removeAllListeners();
					child.removeAllListeners("error");
					child.removeAllListeners("exit");
					child.removeAllListeners("close");
					try {
						child.kill("SIGTERM");
					} catch {
						// already dead — ignore
					}
				}
			};
		},
		{ name: "run_process" },
	);
}
