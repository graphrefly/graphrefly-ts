// Shared paragraph filter — used by both the chapter (to drive `paragraphs`
// state) and the PaperPane component (to render the same paragraph list).
// Kept in one place so the two views never drift.
//
// Rejects:
//   - paragraphs shorter than 80 chars (likely nav, headers, captions)
//   - paragraphs where >40% of chars sit inside markdown link syntax
//   - bullet/list-only blocks (TOCs, language lists)
//   - quote/code blocks with no normal prose

export function splitContentParagraphs(body: string): readonly string[] {
	return body
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(isContentParagraph);
}

export function isContentParagraph(p: string): boolean {
	if (p.length < 80) return false;
	const linkChars = (p.match(/\[[^\]]+\]\([^)]+\)/g) ?? []).join("").length;
	if (linkChars / p.length > 0.4) return false;
	const lines = p.split(/\n/);
	if (lines.length > 1) {
		const bulletLines = lines.filter((l) => /^\s*[*\-+\d]+[.\s]/.test(l)).length;
		if (bulletLines / lines.length > 0.6) return false;
	}
	if (/^\s*[>`]/.test(p) && !/[a-z]\s+[a-z]+\s+[a-z]/.test(p.toLowerCase())) return false;
	return true;
}
