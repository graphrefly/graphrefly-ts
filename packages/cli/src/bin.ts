#!/usr/bin/env node
/**
 * `graphrefly` binary.
 *
 * Server operators who need a custom catalog should import `dispatch`
 * from `@graphrefly/cli` and pass `{ catalog }` — the default binary
 * ships with an empty catalog (state-only + passthrough specs work out
 * of the box; custom fn names require an operator-provided entry).
 */

import { dispatch, parseArgv } from "./dispatch.js";

const argv = parseArgv(process.argv.slice(2));
dispatch(argv)
	.then((code) => {
		// Set exitCode rather than calling process.exit() so Node can
		// drain pending stdout/stderr writes before exiting. Piping
		// `graphrefly describe ... > out.json` through `process.exit`
		// truncates the file on fast hosts; the explicit drain below
		// plus exitCode avoids that.
		process.exitCode = code;
		if (process.stdout.writableLength === 0 && process.stderr.writableLength === 0) {
			return;
		}
		// Flush both streams, then let the loop exit naturally with
		// the configured exitCode.
		const drain = (stream: NodeJS.WriteStream): Promise<void> =>
			new Promise((resolve) => {
				if (stream.writableLength === 0) resolve();
				else stream.once("drain", () => resolve());
			});
		Promise.all([drain(process.stdout), drain(process.stderr)]).catch(() => {
			// Swallow drain errors — the exitCode is already set.
		});
	})
	.catch((err) => {
		console.error("graphrefly: fatal", err);
		process.exit(1);
	});
