// A tiny, dependency-free Markdown-ish renderer for NoteCard: headings, unordered lists,
// links, inline code, fenced code blocks, and paragraphs. Not a full Markdown parser —
// just enough for short dashboard notes.

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(text: string): string {
  let html = escapeHtml(text);
  html = html.replace(/`([^`]+)`/g, "<code>$1</code>");
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  return html;
}

export function renderMarkdown(source: string): string {
  const lines = (source ?? "").split("\n");
  const out: string[] = [];
  let inList = false;
  let inCode = false;

  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCode) { out.push("</pre>"); inCode = false; } else { closeList(); out.push("<pre>"); inCode = true; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(line)); continue; }

    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }

    const item = line.match(/^\s*[-*]\s+(.*)$/);
    if (item) {
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(item[1])}</li>`);
      continue;
    }

    closeList();
    if (line.trim() === "") { out.push(""); continue; }
    out.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  if (inCode) out.push("</pre>");
  return out.join("\n");
}
