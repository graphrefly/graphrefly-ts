/** R-naming@1: local names cannot masquerade as addresses in a mounted graph. */
export function assertLocalName(name: string | undefined): void {
	if (name?.includes("::")) throw new Error("name must not contain '::'");
	if (name?.startsWith(":") || name?.endsWith(":"))
		throw new Error("name must not start or end with ':'");
}
