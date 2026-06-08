import { describe, expect, it } from "vitest";
import { toHttp } from "../adapters/index.js";
import { EnvironmentDrivers, type HttpRequest, type HttpResponse } from "../graph/environment.js";
import { graph } from "../graph/graph.js";

describe("environment outbound adapters (D130/D132)", () => {
	it("routes outbound HTTP attempts and results through graph-visible nodes", () => {
		const calls: Array<{
			request: HttpRequest;
			callback: (result: { ok: true; value: HttpResponse } | { ok: false; error: unknown }) => void;
		}> = [];
		const http = {
			request(
				request: HttpRequest,
				callback: (
					result: { ok: true; value: HttpResponse } | { ok: false; error: unknown },
				) => void,
			) {
				calls.push({ request, callback });
				return () => {};
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ http }) });
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const events: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.events.subscribe((msg) => events.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([["DATA", "alpha"]]);
		expect(calls.map((call) => call.request)).toEqual([
			{ method: "POST", url: "/events", body: "alpha" },
		]);
		calls[0]?.callback({
			ok: true,
			value: { status: 202, headers: [], body: new Uint8Array([1]) },
		});

		expect(events).toContainEqual(["DATA", { kind: "attempt", value: "alpha", attempt: 1 }]);
		expect(events).toContainEqual([
			"DATA",
			{
				kind: "sent",
				value: "alpha",
				attempt: 1,
				result: { status: 202, headers: [], body: new Uint8Array([1]) },
			},
		]);
		expect(statuses.at(-1)).toEqual([
			"DATA",
			{ state: "succeeded", inFlight: 0, attempt: 1, sent: 1, failed: 0 },
		]);
		const snap = g.describe();
		expect(snap.edges).toContainEqual({ from: "source", to: "egress" });
		expect(snap.edges).toContainEqual({ from: "egress", to: "egress/status" });
	});

	it("closes the status ledger when a send capability is missing", () => {
		const g = graph();
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const events: unknown[] = [];
		const statuses: unknown[] = [];
		bundle.events.subscribe((msg) => events.push(msg));
		bundle.status.subscribe((msg) => statuses.push(msg));

		source.down([["DATA", "alpha"]]);

		expect(events).toContainEqual(["DATA", { kind: "attempt", value: "alpha", attempt: 1 }]);
		expect(events).toContainEqual([
			"DATA",
			{
				kind: "exhausted",
				value: "alpha",
				attempt: 1,
				error: "egress: missing environment driver capability",
			},
		]);
		expect(statuses).toContainEqual([
			"DATA",
			{ state: "exhausted", inFlight: 0, attempt: 1, sent: 0, failed: 1 },
		]);
	});

	it("does not retain cancel handles after a synchronous driver callback completes", () => {
		let canceled = 0;
		const http = {
			request(
				_request: HttpRequest,
				callback: (
					result: { ok: true; value: HttpResponse } | { ok: false; error: unknown },
				) => void,
			) {
				callback({ ok: true, value: { status: 204, headers: [] } });
				return () => {
					canceled++;
				};
			},
		};
		const g = graph({ environment: new EnvironmentDrivers({ http }) });
		const source = g.node<string>([], null, { name: "source" });
		const bundle = toHttp(g, source, (value) => ({ method: "POST", url: "/events", body: value }), {
			name: "egress",
		});
		const unsubscribe = bundle.events.subscribe(() => {});

		source.down([["DATA", "alpha"]]);
		unsubscribe();

		expect(canceled).toBe(0);
	});
});
