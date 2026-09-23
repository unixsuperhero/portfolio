import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function MarkdownContent({ text }: { text: string }) {
  return <div className="note-render"><Markdown remarkPlugins={[remarkGfm]} skipHtml>{text}</Markdown></div>;
}
