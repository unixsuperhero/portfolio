import { stat } from "node:fs/promises";
import { documentTitle, isDocumentPath, isHtmlPath } from "@portfolio/core";

export interface ScannedDocument {
  sourcePath: string;
  content: string;
  title: string;
  html: boolean;
}

/** Every .md/.markdown/.html file in a directory (its whole tree when recursive), read and titled. */
export async function scanDirectory(path: string, recursive: boolean): Promise<Map<string, ScannedDocument>> {
  const info = await stat(path);
  if (!info.isDirectory()) throw new Error("Path is not a directory.");
  const paths: string[] = [];
  const glob = new Bun.Glob(recursive ? "**/*" : "*");
  for await (const file of glob.scan({ cwd: path, absolute: true, onlyFiles: true })) if (isDocumentPath(file)) paths.push(file);
  paths.sort();
  const documents = new Map<string, ScannedDocument>();
  for (const sourcePath of paths) {
    const content = await Bun.file(sourcePath).text();
    documents.set(sourcePath, { sourcePath, content, title: documentTitle(content, sourcePath), html: isHtmlPath(sourcePath) });
  }
  return documents;
}
