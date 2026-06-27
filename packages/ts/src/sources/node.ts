/**
 * Node-only source factories. Import from `@graphrefly/ts/sources/node`; the universal
 * `@graphrefly/ts/sources` barrel stays browser-safe.
 */

import { execFileSync, type SpawnOptions, spawn } from "node:child_process";
import { type Dirent, existsSync, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import type { Ctx } from "../ctx/types.js";
import type {
	DriverResult,
	ProcessResult as EnvironmentProcessResult,
	LocalProcessDriver,
	ProcessCommand,
} from "../graph/environment.js";
import type { Operator } from "../graph/operators.js";
import { errorPayload } from "../protocol/messages.js";

export type FSEventType = "change" | "rename" | "create" | "delete";

export interface FSEvent {
	readonly type: FSEventType;
	readonly path: string;
	readonly root: string;
	readonly relativePath: string;
}

export interface FromFSWatchOptions {
	/** Use Node's recursive fs.watch mode where the host platform supports it. Default: false. */
	readonly recursive?: boolean;
	/** Coalesce events per path for this many milliseconds. Default: 100. */
	readonly debounceMs?: number;
	/** Emit create events for existing files after watcher registration. Default: false. */
	readonly initialScan?: boolean | "files";
	/** Include glob patterns matched against absolute and relative slash-normalized paths. */
	readonly include?: readonly string[];
	/** Exclude glob patterns matched against absolute and relative slash-normalized paths. */
	readonly exclude?: readonly string[];
	/** AbortSignal aborts the source to ERROR and closes all watchers. */
	readonly signal?: AbortSignal;
}

export type SpawnEvent =
	| { readonly kind: "stdout"; readonly chunk: Buffer }
	| { readonly kind: "stderr"; readonly chunk: Buffer }
	| { readonly kind: "exit"; readonly code: number | null; readonly signal: NodeJS.Signals | null };

export interface FromSpawnOptions {
	readonly cwd?: string;
	readonly env?: NodeJS.ProcessEnv;
	readonly shell?: boolean | string;
	readonly signal?: AbortSignal;
	readonly stdio?: "pipe" | readonly ("pipe" | "ignore" | "inherit")[];
	/** Milliseconds after teardown SIGTERM before sending SIGKILL. Default: 1000. */
	readonly killGraceMs?: number;
}

/**
 * Node-only process driver options for D130/D131 EnvironmentDrivers.
 *
 * These knobs configure host child-process behavior at the driver boundary only; they do not
 * change graph wave, tier, or message semantics.
 */
export interface NodeProcessDriverOptions {
	/** Milliseconds after cancellation SIGTERM before sending SIGKILL. Default: 1000. */
	readonly killGraceMs?: number;
	/** Maximum captured stdout + stderr bytes before terminating with ERROR. Default: 16 MiB. */
	readonly maxBufferBytes?: number;
	/** Optional shell mode passed to Node's child_process.spawn. Default: false. */
	readonly shell?: boolean | string;
}

export interface ProcessResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number | null;
	readonly signal: NodeJS.Signals | null;
}

export type GitHookType = "post-commit" | "post-merge" | "post-checkout" | "post-rewrite";

export interface GitEvent {
	readonly hook: GitHookType;
	readonly commit: string;
	readonly files: readonly string[];
	readonly message: string;
	readonly author: string;
	readonly timestamp_ns: string;
}

export interface FromGitHookOptions {
	readonly pollMs?: number;
	readonly include?: readonly string[];
	readonly exclude?: readonly string[];
	readonly maxConsecutiveErrors?: number;
	readonly signal?: AbortSignal;
}

function source<T>(
	factory: string,
	setup: (ctx: Ctx) => undefined | (() => void),
): Operator<never, T> {
	return {
		factory,
		body: (ctx) => {
			const cleanup = setup(ctx);
			if (typeof cleanup === "function") ctx.onDeactivation(cleanup);
		},
	};
}

function normalizePath(path: string): string {
	return path.replaceAll("\\", "/");
}

function escapeRegExp(value: string): string {
	return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

function globToRegExp(pattern: string): RegExp {
	let out = "^";
	for (let i = 0; i < pattern.length; i += 1) {
		const ch = pattern[i];
		if (ch === "*") {
			if (pattern[i + 1] === "*") {
				out += ".*";
				i += 1;
			} else {
				out += "[^/]*";
			}
		} else {
			out += escapeRegExp(ch);
		}
	}
	return new RegExp(`${out}$`);
}

function matchesAny(value: string, patterns: readonly RegExp[]): boolean {
	return patterns.some((pattern) => pattern.test(value));
}

function timestampNsNow(): string {
	return (BigInt(Date.now()) * 1_000_000n).toString();
}

function validatePositiveFinite(name: string, value: number): void {
	if (!Number.isFinite(value) || value <= 0) {
		throw new RangeError(`${name} must be a positive finite number`);
	}
}

function validateNonNegativeFinite(name: string, value: number): void {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative finite number`);
	}
}

function eventTypeFor(eventType: "rename" | "change", path: string): FSEventType {
	if (eventType === "change") return "change";
	try {
		return existsSync(path) ? "create" : "delete";
	} catch {
		return "rename";
	}
}

function scanFiles(
	root: string,
	recursive: boolean,
	isExcluded: (abs: string, rel: string) => boolean,
): readonly string[] {
	const resolved = resolvePath(root);
	try {
		const st = statSync(resolved);
		if (st.isFile()) return [resolved];
		if (!st.isDirectory()) return [];
	} catch {
		return [];
	}

	const out: string[] = [];
	function walk(dir: string): void {
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const abs = join(dir, entry.name);
			const rel = relative(resolved, abs);
			if (entry.isFile()) {
				out.push(abs);
			} else if (recursive && entry.isDirectory() && !isExcluded(abs, rel)) {
				walk(abs);
			}
		}
	}
	walk(resolved);
	return out;
}

/**
 * fromFSWatch: Node.js filesystem watcher source.
 *
 * External fs callbacks are a source boundary (R-no-raw-async): events enter the graph only via
 * `ctx.down`, and cleanup is tied to node deactivation through `ctx.onDeactivation`.
 */
export function fromFSWatch(
	paths: string | readonly string[],
	opts: FromFSWatchOptions = {},
): Operator<never, FSEvent> {
	const list = (Array.isArray(paths) ? paths : [paths]).map((path) => resolvePath(path));
	if (list.length === 0) throw new RangeError("fromFSWatch: paths must not be empty");
	const {
		recursive = false,
		debounceMs = 100,
		initialScan = false,
		include,
		exclude = ["**/node_modules/**", "**/.git/**", "**/dist/**"],
		signal,
	} = opts;
	if (!Number.isFinite(debounceMs) || debounceMs < 0) {
		throw new RangeError("fromFSWatch: debounceMs must be a non-negative finite number");
	}
	const includePatterns = (include ?? []).map(globToRegExp);
	const excludePatterns = exclude.map(globToRegExp);

	const accepts = (abs: string, rel: string): boolean => {
		const normalized = normalizePath(abs);
		const relNormalized = normalizePath(rel);
		const included =
			includePatterns.length === 0 ||
			matchesAny(normalized, includePatterns) ||
			matchesAny(relNormalized, includePatterns);
		if (!included) return false;
		return !isExcluded(normalized, relNormalized);
	};
	const isExcluded = (abs: string, rel: string): boolean => {
		const normalized = normalizePath(abs);
		const relNormalized = normalizePath(rel);
		return (
			matchesAny(normalized, excludePatterns) ||
			matchesAny(relNormalized, excludePatterns) ||
			matchesAny(`${normalized}/`, excludePatterns) ||
			(relNormalized !== "" && matchesAny(`${relNormalized}/`, excludePatterns))
		);
	};

	return source<FSEvent>("fromFSWatch", (ctx) => {
		let stopped = false;
		let terminal = false;
		let ready = initialScan === false;
		let generation = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const watchers: FSWatcher[] = [];
		const pending = new Map<string, FSEvent>();
		const buffered = new Map<string, FSEvent>();

		const close = () => {
			for (const watcher of watchers.splice(0)) watcher.close();
		};
		const cleanup = () => {
			stopped = true;
			generation += 1;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			signal?.removeEventListener("abort", onAbort);
			close();
			pending.clear();
			buffered.clear();
		};
		const emitError = (err: unknown) => {
			if (terminal) return;
			terminal = true;
			cleanup();
			ctx.down([["ERROR", errorPayload(err)]]);
		};
		function onAbort() {
			emitError(signal?.reason);
		}
		const flush = (token: number) => {
			timer = undefined;
			if (stopped || terminal || token !== generation || pending.size === 0) return;
			const msgs = [...pending.values()].map((event): ["DATA", FSEvent] => ["DATA", event]);
			pending.clear();
			ctx.down(msgs);
		};
		const schedule = () => {
			if (timer !== undefined) clearTimeout(timer);
			const token = generation;
			if (debounceMs === 0) flush(token);
			else timer = setTimeout(() => flush(token), debounceMs);
		};
		const enqueue = (event: FSEvent) => {
			if (!ready) {
				buffered.set(event.path, event);
				return;
			}
			pending.set(event.path, event);
			schedule();
		};
		const eventFor = (
			basePath: string,
			eventType: "rename" | "change",
			fileName: string | Buffer | null,
		): FSEvent | undefined => {
			const root = normalizePath(resolvePath(basePath));
			const abs = normalizePath(fileName == null ? root : resolvePath(basePath, String(fileName)));
			const rel = normalizePath(fileName == null ? "" : relative(root, abs));
			if (!accepts(abs, rel)) return undefined;
			return {
				type: eventTypeFor(eventType, abs),
				path: abs,
				root,
				relativePath: rel,
			};
		};

		if (signal?.aborted) {
			onAbort();
			return cleanup;
		}
		signal?.addEventListener("abort", onAbort, { once: true });

		try {
			for (const basePath of list) {
				const watcher = watch(basePath, { recursive }, (eventType, fileName) => {
					if (stopped || terminal) return;
					const event = eventFor(basePath, eventType, fileName);
					if (event !== undefined) enqueue(event);
				});
				watcher.on("error", emitError);
				watchers.push(watcher);
			}
		} catch (err) {
			emitError(err);
			return cleanup;
		}

		if (initialScan !== false) {
			try {
				for (const basePath of list) {
					const root = normalizePath(resolvePath(basePath));
					let relRoot = root;
					try {
						if (statSync(basePath).isFile()) relRoot = dirname(root);
					} catch {
						relRoot = root;
					}
					for (const absPath of scanFiles(basePath, recursive, isExcluded)) {
						if (stopped || terminal) return cleanup;
						const abs = normalizePath(absPath);
						const rel = normalizePath(relative(relRoot, abs));
						if (!accepts(abs, rel)) continue;
						pending.set(abs, {
							type: "create",
							path: abs,
							root,
							relativePath: rel,
						});
					}
				}
				ready = true;
				for (const [key, event] of buffered) pending.set(key, event);
				buffered.clear();
				if (pending.size > 0) schedule();
			} catch (err) {
				emitError(err);
			}
		}

		return cleanup;
	});
}

export function fromSpawn(
	cmd: string,
	args: readonly string[] = [],
	opts: FromSpawnOptions = {},
): Operator<never, SpawnEvent> {
	if (typeof cmd !== "string" || cmd.length === 0) {
		throw new TypeError("fromSpawn: cmd must be a non-empty string");
	}
	const killGraceMs = opts.killGraceMs ?? 1000;
	validateNonNegativeFinite("fromSpawn: killGraceMs", killGraceMs);
	return source<SpawnEvent>("fromSpawn", (ctx) => {
		let alive = true;
		let terminal = false;
		let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		let child: ReturnType<typeof spawn>;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const clearKillTimer = () => {
			if (killTimer !== undefined) clearTimeout(killTimer);
			killTimer = undefined;
		};
		const stop = () => {
			alive = false;
			child?.stdout?.removeAllListeners("data");
			child?.stderr?.removeAllListeners("data");
			if (!terminal) {
				try {
					child?.kill("SIGTERM");
				} catch {
					// Process may already have exited.
				}
				killTimer = setTimeout(() => {
					if (!terminal) {
						try {
							child?.kill("SIGKILL");
						} catch {
							// Process may already have exited.
						}
					}
				}, killGraceMs);
				killTimer.unref?.();
			}
		};
		try {
			child = spawn(cmd, [...args], {
				cwd: opts.cwd,
				env: opts.env,
				shell: opts.shell,
				signal: opts.signal,
				stdio: (opts.stdio as SpawnOptions["stdio"]) ?? "pipe",
			});
		} catch (err) {
			terminal = true;
			ctx.down([["ERROR", errorPayload(err)]]);
			return () => undefined;
		}
		child.stdout?.on("data", (chunk: Buffer) => {
			if (alive) ctx.down([["DATA", { kind: "stdout", chunk }]]);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (alive) ctx.down([["DATA", { kind: "stderr", chunk }]]);
		});
		child.on("error", (err) => {
			if (!alive || terminal) return;
			terminal = true;
			alive = false;
			ctx.down([["ERROR", errorPayload(err)]]);
		});
		child.on("exit", (code, signal) => {
			exitInfo = { code, signal: signal as NodeJS.Signals | null };
		});
		child.on("close", () => {
			clearKillTimer();
			if (!alive || terminal) return;
			terminal = true;
			alive = false;
			const info = exitInfo ?? { code: null, signal: null };
			ctx.down([["DATA", { kind: "exit", code: info.code, signal: info.signal }], ["COMPLETE"]]);
		});
		return stop;
	});
}

/**
 * Node.js process EnvironmentDriver for D130/D131 adapters.
 *
 * Import this from `@graphrefly/ts/sources/node` and install it with
 * `EnvironmentDrivers.empty().withProcess(nodeProcessDriver())`. The child process is an
 * adapter-boundary side effect; graph nodes only observe ordinary ProcessResult DATA or ERROR.
 */
export function nodeProcessDriver(opts: NodeProcessDriverOptions = {}): LocalProcessDriver {
	const killGraceMs = opts.killGraceMs ?? 1000;
	const maxBufferBytes = opts.maxBufferBytes ?? 16 * 1024 * 1024;
	validateNonNegativeFinite("nodeProcessDriver: killGraceMs", killGraceMs);
	validateNonNegativeFinite("nodeProcessDriver: maxBufferBytes", maxBufferBytes);
	return {
		run(command, callback) {
			return runNodeProcessCommand(command, callback, {
				killGraceMs,
				maxBufferBytes,
				shell: opts.shell,
			});
		},
	};
}

export function runProcess(
	cmd: string,
	args: readonly string[] = [],
	opts: FromSpawnOptions = {},
): Operator<never, ProcessResult> {
	if (typeof cmd !== "string" || cmd.length === 0) {
		throw new TypeError("runProcess: cmd must be a non-empty string");
	}
	const killGraceMs = opts.killGraceMs ?? 1000;
	validateNonNegativeFinite("runProcess: killGraceMs", killGraceMs);
	return source<ProcessResult>("runProcess", (ctx) => {
		let alive = true;
		let terminal = false;
		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | undefined;
		let child: ReturnType<typeof spawn>;
		let killTimer: ReturnType<typeof setTimeout> | undefined;
		const clearKillTimer = () => {
			if (killTimer !== undefined) clearTimeout(killTimer);
			killTimer = undefined;
		};
		const stop = () => {
			alive = false;
			child?.stdout?.removeAllListeners("data");
			child?.stderr?.removeAllListeners("data");
			if (!terminal) {
				try {
					child?.kill("SIGTERM");
				} catch {
					// Process may already have exited.
				}
				killTimer = setTimeout(() => {
					if (!terminal) {
						try {
							child?.kill("SIGKILL");
						} catch {
							// Process may already have exited.
						}
					}
				}, killGraceMs);
				killTimer.unref?.();
			}
		};
		try {
			child = spawn(cmd, [...args], {
				cwd: opts.cwd,
				env: opts.env,
				shell: opts.shell,
				signal: opts.signal,
				stdio: (opts.stdio as SpawnOptions["stdio"]) ?? "pipe",
			});
		} catch (err) {
			terminal = true;
			ctx.down([["ERROR", errorPayload(err)]]);
			return () => undefined;
		}
		child.stdout?.on("data", (chunk: Buffer) => {
			if (alive) stdoutChunks.push(chunk);
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			if (alive) stderrChunks.push(chunk);
		});
		child.on("error", (err) => {
			if (!alive || terminal) return;
			terminal = true;
			alive = false;
			ctx.down([["ERROR", errorPayload(err)]]);
		});
		child.on("exit", (code, signal) => {
			exitInfo = { code, signal: signal as NodeJS.Signals | null };
		});
		child.on("close", () => {
			clearKillTimer();
			if (!alive || terminal) return;
			terminal = true;
			alive = false;
			const info = exitInfo ?? { code: null, signal: null };
			ctx.down([
				[
					"DATA",
					{
						stdout: Buffer.concat(stdoutChunks).toString("utf8"),
						stderr: Buffer.concat(stderrChunks).toString("utf8"),
						exitCode: info.code,
						signal: info.signal,
					},
				],
				["COMPLETE"],
			]);
		});
		return stop;
	});
}

function runNodeProcessCommand(
	command: ProcessCommand,
	callback: (result: DriverResult<EnvironmentProcessResult>) => void,
	opts: {
		readonly killGraceMs: number;
		readonly maxBufferBytes: number;
		readonly shell?: boolean | string;
	},
): () => void {
	if (typeof command.program !== "string" || command.program.length === 0) {
		callback({
			ok: false,
			error: new TypeError("nodeProcessDriver: program must be a non-empty string"),
		});
		return () => undefined;
	}
	let alive = true;
	let terminal = false;
	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];
	let bufferedBytes = 0;
	let exitInfo: { code: number | null; signal: string | null } | undefined;
	let child: ReturnType<typeof spawn>;
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const clearKillTimer = () => {
		if (killTimer !== undefined) clearTimeout(killTimer);
		killTimer = undefined;
	};
	const stop = () => {
		if (!alive) return;
		alive = false;
		child?.stdout?.removeAllListeners("data");
		child?.stderr?.removeAllListeners("data");
		if (!terminal) {
			try {
				child?.kill("SIGTERM");
			} catch {
				// Process may already have exited.
			}
			killTimer = setTimeout(() => {
				if (!terminal) {
					try {
						child?.kill("SIGKILL");
					} catch {
						// Process may already have exited.
					}
				}
			}, opts.killGraceMs);
			killTimer.unref?.();
		}
	};
	try {
		child = spawn(command.program, [...command.args], {
			cwd: command.cwd,
			env: command.env === undefined ? undefined : Object.fromEntries(command.env),
			shell: opts.shell,
			stdio: ["ignore", "pipe", "pipe"],
		});
	} catch (err) {
		terminal = true;
		callback({ ok: false, error: err });
		return () => undefined;
	}
	const fail = (error: unknown) => {
		clearKillTimer();
		if (!alive || terminal) return;
		terminal = true;
		alive = false;
		child.stdout?.removeAllListeners("data");
		child.stderr?.removeAllListeners("data");
		try {
			child.kill("SIGTERM");
		} catch {
			// Process may already have exited.
		}
		killTimer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {
				// Process may already have exited.
			}
		}, opts.killGraceMs);
		killTimer.unref?.();
		callback({ ok: false, error });
	};
	const pushOutput = (chunks: Buffer[], chunk: Buffer) => {
		if (!alive) return;
		bufferedBytes += chunk.byteLength;
		if (bufferedBytes > opts.maxBufferBytes) {
			fail(
				new RangeError(
					`nodeProcessDriver: stdout/stderr exceeded maxBufferBytes (${opts.maxBufferBytes})`,
				),
			);
			return;
		}
		chunks.push(chunk);
	};
	child.stdout?.on("data", (chunk: Buffer) => {
		pushOutput(stdoutChunks, chunk);
	});
	child.stderr?.on("data", (chunk: Buffer) => {
		pushOutput(stderrChunks, chunk);
	});
	child.on("error", (err) => {
		clearKillTimer();
		if (!alive || terminal) return;
		terminal = true;
		alive = false;
		callback({ ok: false, error: err });
	});
	child.on("exit", (code, signal) => {
		exitInfo = { code, signal };
	});
	child.on("close", () => {
		clearKillTimer();
		if (!alive || terminal) return;
		terminal = true;
		alive = false;
		const info = exitInfo ?? { code: null, signal: null };
		callback({
			ok: true,
			value: {
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				exitCode: info.code,
				signal: info.signal,
			},
		});
	});
	return stop;
}

interface GitPollResult {
	readonly head: string;
	readonly files: readonly string[];
	readonly message: string;
	readonly author: string;
}

function stripFinalLineBreak(value: string): string {
	return value.replace(/\r?\n$/, "");
}

function gitText(repoPath: string, args: readonly string[]): string {
	return stripFinalLineBreak(execFileSync("git", ["-C", repoPath, ...args], { encoding: "utf8" }));
}

function gitPathList(repoPath: string, args: readonly string[]): readonly string[] {
	const out = execFileSync("git", ["-C", repoPath, ...args, "-z"]) as Buffer;
	const text = out.toString("utf8");
	if (text.length === 0) return [];
	return text.split("\0").filter((part) => part.length > 0);
}

function readGitHead(
	repoPath: string,
	previousHead: string | undefined,
): GitPollResult | undefined {
	const head = gitText(repoPath, ["rev-parse", "HEAD"]);
	if (head.length === 0 || head === previousHead) return undefined;
	const files =
		previousHead === undefined
			? []
			: gitPathList(repoPath, ["diff", "--name-only", `${previousHead}..${head}`]);
	return {
		head,
		files,
		message: gitText(repoPath, ["log", "-1", "--format=%s", head]),
		author: gitText(repoPath, ["log", "-1", "--format=%an", head]),
	};
}

export function fromGitHook(
	repoPath: string,
	opts: FromGitHookOptions = {},
): Operator<never, GitEvent> {
	const { pollMs = 5000, include, exclude, maxConsecutiveErrors = 1, signal } = opts;
	validatePositiveFinite("fromGitHook: pollMs", pollMs);
	if (!Number.isFinite(maxConsecutiveErrors) && maxConsecutiveErrors !== Infinity) {
		throw new RangeError("fromGitHook: maxConsecutiveErrors must be finite or Infinity");
	}
	if (maxConsecutiveErrors <= 0) {
		throw new RangeError("fromGitHook: maxConsecutiveErrors must be positive");
	}
	const resolvedRepoPath = resolvePath(repoPath);
	const includePatterns = (include ?? []).map(globToRegExp);
	const excludePatterns = (exclude ?? []).map(globToRegExp);
	const accepts = (file: string): boolean => {
		const normalized = normalizePath(file);
		const included = includePatterns.length === 0 || matchesAny(normalized, includePatterns);
		return included && !matchesAny(normalized, excludePatterns);
	};

	return source<GitEvent>("fromGitHook", (ctx) => {
		let done = false;
		let lastSeen: string | undefined;
		let consecutiveErrors = 0;
		let intervalId: ReturnType<typeof setInterval> | undefined;
		const cleanup = () => {
			done = true;
			if (intervalId !== undefined) clearInterval(intervalId);
			intervalId = undefined;
			signal?.removeEventListener("abort", onAbort);
		};
		const fail = (err: unknown) => {
			if (done) return;
			cleanup();
			ctx.down([["ERROR", errorPayload(err)]]);
		};
		const onAbort = () => fail(signal?.reason);
		const poll = () => {
			if (done) return;
			try {
				const result = readGitHead(resolvedRepoPath, lastSeen);
				consecutiveErrors = 0;
				if (result === undefined) return;
				const isBaseline = lastSeen === undefined;
				lastSeen = result.head;
				if (isBaseline) return;
				ctx.down([
					[
						"DATA",
						{
							hook: "post-commit",
							commit: result.head,
							files: result.files.filter(accepts),
							message: result.message,
							author: result.author,
							timestamp_ns: timestampNsNow(),
						},
					],
				]);
			} catch (err) {
				consecutiveErrors += 1;
				if (consecutiveErrors >= maxConsecutiveErrors) fail(err);
			}
		};
		if (signal?.aborted) {
			onAbort();
			return cleanup;
		}
		signal?.addEventListener("abort", onAbort, { once: true });
		poll();
		if (!done) intervalId = setInterval(poll, pollMs);
		return cleanup;
	});
}
