import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { Nodes } from "mdast";

const parser = unified().use(remarkParse).use(remarkGfm);

function text(node: Nodes): string {
  if (node.type === "text" || node.type === "inlineCode") return node.value;
  if (node.type === "image") return node.alt ?? "";
  if (node.type === "break") return " ";
  return "children" in node ? node.children.map(text).join("") : "";
}

export function taskLabel(value: string): string {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

export function markdownTasks(markdown: string) {
  const tasks: { offset: number; checked: boolean; label: string }[] = [];
  const visit = (node: Nodes) => {
    if (node.type === "listItem" && typeof node.checked === "boolean") {
      const start = node.position?.start.offset;
      if (start !== undefined) {
        const marker = /^(?:[-+*]|\d+[.)])[\t ]+\[([ xX])\]/.exec(markdown.slice(start));
        const paragraph = node.children[0];
        if (marker && paragraph) tasks.push({ offset: start + marker[0].length - 2, checked: node.checked, label: taskLabel(text(paragraph)) });
      }
    }
    if ("children" in node) node.children.forEach(visit);
  };
  visit(parser.parse(markdown));
  return tasks;
}

export function setMarkdownTask(markdown: string, offset: number, checked: boolean): string {
  if (!markdownTasks(markdown).some(task => task.offset === offset)) throw new Error("This checklist no longer matches the Markdown source. Reload before saving.");
  return markdown.slice(0, offset) + (checked ? "x" : " ") + markdown.slice(offset + 1);
}
