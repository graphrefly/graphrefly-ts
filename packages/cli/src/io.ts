/**
 * Stdin / file / stdout utilities for CLI commands.
 *
 * Each CLI command is stateless — state flows through snapshot files or
 * piped JSON. These helpers centralize reading JSON from `-` (stdin) or
 * a file path, and writing output in one of the supported formats.
 *
 * @module
 */

import { readFileSync } from "node:fs";

export type OutputFormat = "json" | "pretty";

/**
 * Read a JSON payload from a file path or `"-"` for stdin. Unknown path
 * throws with a clear message. Invalid JSON surfaces the parse error
 * with the file location.
 */
export function readJson(pathOrDash: string): unknown {
	const text = pathOrDash === "-" ? readStdinSync() : readFileSync(pathOrDash, "utf8");
	try {
		return JSON.parse(text);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		throw new Error(
			`failed to parse JSON from ${pathOrDash === "-" ? "stdin" : pathOrDash}: ${message}`,
		);
	}
}

function readStdinSync(): string {
	// Reject TTY input early — readFileSync(0) on an interactive terminal
	// blocks until Ctrl-D with no prompt, which looks like a hang. Piped
	// or redirected stdin is the supported shape.
	if (process.stdin.isTTY) {
		throw new Error(
			"stdin requested (`-`) but stdin is a TTY — pipe or redirect input, e.g. `cat spec.json | graphrefly …`",
		);
	}
	// readFileSync on /dev/stdin is POSIX; on Windows Node accepts fd 0
	// via the same shim. If it fails, surface the error rather than
	// fall back to an async iterator that won't terminate under sync
	// `readFileSync`'s blocking semantics.
	return readFileSync(0, "utf8");
}

/** Write a result payload to stdout in the requested format. */
export function writeOutput(value: unknown, format: OutputFormat): void {
	if (typeof value === "string") {
		const text = format === "json" ? JSON.stringify(value) : value;
		process.stdout.write(text);
		// Terminate the line if the rendered text doesn't already end
		// with a newline. `JSON.stringify(value)` always wraps the string
		// in quotes, so it never ends in "\n" unless the last character
		// was a "\n" before stringification (which would render as \\n).
		if (!text.endsWith("\n")) process.stdout.write("\n");
		return;
	}
	const text = format === "pretty" ? JSON.stringify(value, null, 2) : JSON.stringify(value);
	process.stdout.write(`${text}\n`);
}
