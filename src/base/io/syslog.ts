/**
 * Syslog (RFC 5424) IO — `fromSyslog` registrar-based source plus
 * `parseSyslog` helper for the line format. The caller owns the UDP/TCP
 * socket; the adapter only wires the `emit` triad.
 */

import type { Node } from "@graphrefly/pure-ts/core";
import { wallClockNs } from "@graphrefly/pure-ts/core";
import {
	type EmitTriad,
	type ExternalRegister,
	externalProducer,
} from "../composition/external-register.js";
import type { ExtraOpts } from "./_internal.js";

/** Parsed syslog message (RFC 5424). */
export type SyslogMessage = {
	facility: number;
	severity: number;
	timestamp: string;
	hostname: string;
	appName: string;
	procId: string;
	msgId: string;
	message: string;
	timestampNs: number;
};

/** Registration callback for syslog receiver. Alias of {@link ExternalRegister} over {@link EmitTriad}. */
export type SyslogRegister = ExternalRegister<EmitTriad<SyslogMessage>>;

/** Options for {@link fromSyslog}. */
export type FromSyslogOptions = ExtraOpts & {};

/**
 * RFC 5424 syslog receiver as a reactive source.
 *
 * The caller owns the UDP/TCP socket. `fromSyslog` receives a `register` callback
 * that wires socket data events to the `emit` handler with parsed syslog messages.
 *
 * @param register - Wires socket to emit/error/complete handlers.
 * @param opts - Optional producer options.
 * @returns `Node<SyslogMessage>` — one `DATA` per syslog message.
 *
 * @example
 * ```ts
 * import dgram from "node:dgram";
 * import { fromSyslog, parseSyslog } from "@graphrefly/graphrefly-ts";
 *
 * const server = dgram.createSocket("udp4");
 * const syslog$ = fromSyslog(({ emit, error }) => {
 *   server.on("message", (buf) => {
 *     try { emit(parseSyslog(buf.toString())); }
 *     catch (e) { error(e); }
 *   });
 *   server.bind(514);
 *   return () => server.close();
 * });
 * ```
 *
 * @category extra
 */
export function fromSyslog(
	register: SyslogRegister,
	opts?: FromSyslogOptions,
): Node<SyslogMessage> {
	return externalProducer<SyslogMessage>(register, opts);
}

/**
 * Parses a raw RFC 5424 syslog line into a structured {@link SyslogMessage}.
 *
 * Format: `<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID MSG`
 *
 * @category extra
 */
export function parseSyslog(raw: string): SyslogMessage {
	const match = raw.match(/^<(\d{1,3})>\d?\s*(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)/s);
	if (!match) {
		const nowNs = wallClockNs();
		return {
			facility: 1,
			severity: 6,
			timestamp: new Date(Math.floor(nowNs / 1_000_000)).toISOString(),
			hostname: "-",
			appName: "-",
			procId: "-",
			msgId: "-",
			message: raw.trim(),
			timestampNs: nowNs,
		};
	}
	const pri = Number(match[1]);
	return {
		facility: pri >> 3,
		severity: pri & 7,
		timestamp: match[2],
		hostname: match[3],
		appName: match[4],
		procId: match[5],
		msgId: match[6],
		message: (match[7] ?? "").trim(),
		timestampNs: wallClockNs(),
	};
}
