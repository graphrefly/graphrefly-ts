// Browser stub for `node:path`. Same rationale as node-fs-stub.ts.
const identity = (...parts: string[]) => parts.join("/");
export const resolve = identity;
export const join = identity;
export const dirname = (p: string) => p.replace(/\/[^/]*$/, "");
export const basename = (p: string) => p.replace(/^.*\//, "");
export const extname = (p: string) => {
	const i = p.lastIndexOf(".");
	return i >= 0 ? p.slice(i) : "";
};
export const sep = "/";
export default { resolve, join, dirname, basename, extname, sep };
