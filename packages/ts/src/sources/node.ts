/**
 * Node-only source factories. Import from `@graphrefly/ts/sources/node`; the universal
 * `@graphrefly/ts/sources` barrel stays browser-safe.
 */

import { type Dirent, existsSync, type FSWatcher, readdirSync, statSync, watch } from "node:fs";
import { dirname, join, relative, resolve as resolvePath } from "node:path";
import type { Ctx } from "../ctx/types.js";
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
