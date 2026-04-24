/**
 * HTTP error builder — companion to {@link ./adapters.ts}'s `fromHTTP` /
 * `fromHTTPStream` / `toHTTP`. Pure, zero-dep function that turns a failed
 * `Response` into an `Error` exposing the `{status, headers, message}` shape
 * that `HttpErrorLike` consumers (rate-limit parsers, retry predicates,
 * observability layers) expect.
 *
 * Universal tier — safe for browser and Node. No Node-only imports.
 */

/**
 * Construct an `Error` carrying `status` + `headers` fields from a non-ok
 * `Response`. Reads the body with `resp.text()` for diagnostic context; a
 * body read failure is swallowed (empty string) so the returned error always
 * reflects the original status/statusText at minimum.
 *
 * @param resp - The offending `Response` object.
 * @param provider - Optional prefix (e.g. `"Anthropic"`, `"openai"`) used in
 *   the error message. Defaults to `"HTTP"`.
 * @returns An `Error` whose `message` is `"${provider} API <status>: <statusText>[ — body]"`,
 *   with `status: number` and `headers: Headers` attached.
 *
 * @category extra
 */
export async function makeHttpError(resp: Response, provider?: string): Promise<Error> {
	let body: string;
	try {
		body = await resp.text();
	} catch {
		body = "";
	}
	const prefix = provider ?? "HTTP";
	const err = new Error(
		`${prefix} API ${resp.status}: ${resp.statusText}${body ? ` — ${body}` : ""}`,
	) as Error & {
		status: number;
		headers: Headers;
	};
	err.status = resp.status;
	err.headers = resp.headers;
	return err;
}
