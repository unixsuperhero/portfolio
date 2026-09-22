/** A small route table entry: method, path regex (named capture groups become params), and handler. */
export interface Route {
  method: string;
  pattern: RegExp;
  handler: (request: Request, params: Record<string, string>) => Promise<Response>;
}

export const json = (data: unknown, status = 200): Response => Response.json(data, { status });
export const error = (status: number, message: string): Response => Response.json({ error: message }, { status });
export const notFound = (): Response => error(404, "not found");

/** Parses a JSON body; an empty body is {}. Throws with a 422-friendly message on bad JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    throw new Error("invalid JSON body");
  }
}

export const num = (value: string | null): number | undefined => (value === null || value === "" ? undefined : Number(value));
export const bool = (value: string | null): boolean => value === "1" || value === "true";

/** Builds a URL pattern like "/api/items/:id" into a RegExp with named groups. */
export function compile(path: string): RegExp {
  const source = path.replace(/:[A-Za-z0-9_]+/g, name => `(?<${name.slice(1)}>[^/]+)`);
  return new RegExp(`^${source}$`);
}
