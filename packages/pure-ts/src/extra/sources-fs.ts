/**
 * Filesystem-watching source. Isolated from `./sources.ts` so bundlers
 * targeting the browser can import browser-safe sources (`fromTimer`,
 * `fromRaf`, etc.) without pulling in `node:fs`/`node:path`.
 */

import { existsSync, statSync, watch } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { wallClockNs } from "../core/clock.js";
import { DATA, ERROR, type Message } from "../core/messages.js";
import { type Node, type NodeOptions, node } from "../core/node.js";
import { globToRegExp, matchesAnyPattern } from "./sources.js";

type ExtraOpts = Omit<NodeOptions<unknown>, "describeKind">;

function sourceOpts<T = unknown>(opts?: ExtraOpts): NodeOptions<T> {
	return { describeKind: "producer", ...opts } as NodeOptions<T>;
}

export type FSEventType = "change" | "rename" | "create" | "delete";
export type FSEvent = {
	type: FSEventType;
	path: string;
	root: string;
	relative_path: string;
	src_path?: string;
	dest_path?: string;
	timestamp_ns: number;
};

export type FromFSWatchOptions = ExtraOpts & {
	recursive?: boolean;
	debounce?: number;
	include?: string[];
	exclude?: string[];
};

/**
 * Watches filesystem paths and emits debounced change events.
 *
 * On startup the node scans existing files and emits a `create` event for
 * each match, giving subscribers a complete initial snapshot. Events that
 * arrive from `fs.watch` during the scan are buffered and flushed once the
 * scan completes, so no changes are silently dropped during OS watcher
 * activation.
 *
 * Uses `fs.watch` only (no polling fallback). Teardown closes all watchers.
 *
 * @category extra
 */
export function fromFSWatch(paths: string | string[], opts?: FromFSWatchOptions): Node<FSEvent> {
	const list = Array.isArray(paths) ? paths : [paths];
	if (list.length === 0) {
		throw new RangeError("fromFSWatch expects at least one path");
	}
	const { recursive = true, debounce = 100, include, exclude, ...rest } = opts ?? {};
	const includePatterns = include?.map(globToRegExp) ?? [];
	const excludePatterns = (exclude ?? ["**/node_modules/**", "**/.git/**", "**/dist/**"]).map(
		globToRegExp,
	);

	/** Returns true if `relForMatch` + `normalized` pass include/exclude. */
	function matchesFilters(normalized: string, relForMatch: string): boolean {
		const included =
			includePatterns.length === 0 ||
			matchesAnyPattern(normalized, includePatterns) ||
			matchesAnyPattern(relForMatch, includePatterns);
		if (!included) return false;
		return !(
			matchesAnyPattern(normalized, excludePatterns) ||
			matchesAnyPattern(relForMatch, excludePatterns)
		);
	}

	return node<FSEvent>((_data, a) => {
		const pending = new Map<string, FSEvent>();
		const buffered = new Map<string, FSEvent>();
		const watchers: ReturnType<typeof watch>[] = [];
		let stopped = false;
		let terminalEmitted = false;
		let generation = 0;
		let ready = false;

		const closeWatchers = () => {
			for (const watcher of watchers.splice(0)) watcher.close();
		};
		const emitError = (err: unknown) => {
			if (terminalEmitted) return;
			terminalEmitted = true;
			stopped = true;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			pending.clear();
			buffered.clear();
			closeWatchers();
			a.down([[ERROR, err]]);
		};
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = (token: number) => {
			timer = undefined;
			if (stopped || terminalEmitted) return;
			if (pending.size === 0) return;
			const batchMessages: Message[] = [];
			for (const evt of pending.values()) batchMessages.push([DATA, evt]);
			pending.clear();
			if (stopped || terminalEmitted || token !== generation) return;
			a.down(batchMessages);
		};

		/** Transition to ready — move buffered events into the debounce queue. */
		const becomeReady = () => {
			if (ready) return;
			ready = true;
			if (stopped || terminalEmitted) return;
			for (const [k, v] of buffered) pending.set(k, v);
			buffered.clear();
			if (pending.size > 0) {
				if (timer !== undefined) clearTimeout(timer);
				const token = generation;
				timer = setTimeout(() => flush(token), debounce);
			}
		};

		const onWatchEvent = (
			basePath: string,
			eventType: "rename" | "change",
			fileName: string | Buffer | null,
		) => {
			if (stopped || terminalEmitted) return;
			if (fileName == null) return;
			const rel = String(fileName).replaceAll("\\", "/");
			const abs = resolvePath(basePath, String(fileName));
			const normalized = abs.replaceAll("\\", "/");
			const root = resolvePath(basePath).replaceAll("\\", "/");
			const relForMatch = rel.startsWith("./") ? rel.slice(2) : rel;
			if (!matchesFilters(normalized, relForMatch)) return;

			let kind: FSEventType = "change";
			if (eventType === "rename") {
				try {
					kind = existsSync(normalized) ? "create" : "delete";
				} catch {
					kind = "rename";
				}
			}
			const evt: FSEvent = {
				type: kind,
				path: normalized,
				root,
				relative_path: relForMatch,
				timestamp_ns: wallClockNs(),
			};

			if (!ready) {
				buffered.set(normalized, evt);
				return;
			}

			pending.set(normalized, evt);
			if (timer !== undefined) clearTimeout(timer);
			const token = generation;
			timer = setTimeout(() => flush(token), debounce);
		};

		// --- Phase 1: register watchers synchronously ---
		try {
			for (const basePath of list) {
				const watcher = watch(basePath, { recursive }, (eventType, fileName) =>
					onWatchEvent(basePath, eventType, fileName),
				);
				watcher.on("error", (err) => emitError(err));
				watchers.push(watcher);
			}
		} catch (err) {
			emitError(err);
			return () => {};
		}

		// --- Phase 2: async init (scan existing files, then become ready) ---
		// The scan serves two purposes:
		// 1. Emits `create` events for all pre-existing matching files.
		// 2. Covers the OS watcher activation window — by the time readdir
		//    finishes, fs.watch has had time to become live. Any events that
		//    arrive during the scan are buffered and flushed on becomeReady().
		// F1 /qa (2026-05-12): inner try/catch guards the scan IIFE so
		// a throw from a.down() (e.g. downstream node throwing
		// synchronously) surfaces as ERROR rather than an unhandled
		// rejection. Using inner try/catch (not .catch() on the
		// promise) to avoid microtask-scheduling changes that affect
		// FSEvents timing in tests.
		(async () => {
			try {
				if (stopped || terminalEmitted) return;

				const scanMessages: Message[] = [];
				for (const basePath of list) {
					try {
						const resolved = resolvePath(basePath);
						let isDir: boolean;
						try {
							isDir = statSync(resolved).isDirectory();
						} catch {
							isDir = false;
						}
						if (!isDir) continue;
						const entries = await readdir(resolved, { recursive });
						for (const entry of entries) {
							if (stopped || terminalEmitted) return;
							const rel = String(entry).replaceAll("\\", "/");
							const abs = join(resolved, String(entry));
							const normalized = abs.replaceAll("\\", "/");
							const relForMatch = rel.startsWith("./") ? rel.slice(2) : rel;
							if (!matchesFilters(normalized, relForMatch)) continue;
							try {
								if (!statSync(abs).isFile()) continue;
							} catch {
								continue;
							}
							scanMessages.push([
								DATA,
								{
									type: "create" as FSEventType,
									path: normalized,
									root: resolved.replaceAll("\\", "/"),
									relative_path: relForMatch,
									timestamp_ns: wallClockNs(),
								},
							]);
						}
					} catch {
						// readdir failed (permission, path gone) — skip silently.
					}
				}
				if (stopped || terminalEmitted) return;
				if (scanMessages.length > 0) a.down(scanMessages);

				becomeReady();
			} catch (err) {
				if (!stopped && !terminalEmitted) emitError(err);
			}
		})();

		return () => {
			stopped = true;
			generation += 1;
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			closeWatchers();
			pending.clear();
			buffered.clear();
		};
	}, sourceOpts(rest));
}
