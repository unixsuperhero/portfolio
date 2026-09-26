import { isItemType } from "./constants.ts";
import { parseTags } from "./text.ts";
import type { Portfolio, PortfolioItemFilter } from "./types.ts";

export function normalizePortfolioFilter(value: unknown): PortfolioItemFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const input = value as Partial<Record<keyof PortfolioItemFilter, unknown>>;
  const filter: PortfolioItemFilter = {};
  if (typeof input.q === "string" && input.q.trim()) filter.q = input.q.trim();
  if (input.contents === true) filter.contents = true;
  if (input.pinned === true) filter.pinned = true;
  if (input.starred === true) filter.starred = true;
  if (isItemType(input.type)) filter.type = input.type;
  if (typeof input.tag === "number" && Number.isInteger(input.tag) && input.tag > 0) filter.tag = input.tag;
  if (typeof input.tagName === "string" && input.tagName.trim()) filter.tagName = input.tagName.trim();
  if (typeof input.category === "number" && Number.isInteger(input.category) && input.category > 0) filter.category = input.category;
  return filter;
}

export const normalizePortfolioTags = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((tag): tag is string => typeof tag === "string").map(tag => tag.trim()).filter(Boolean))]
    : parseTags(value);

export const hasPortfolioItemScope = (portfolio: Pick<Portfolio, "tags" | "item_filter">): boolean =>
  portfolio.tags.length > 0
  || Object.entries(portfolio.item_filter).some(([key, value]) => key !== "contents" && value !== undefined && value !== false && value !== "");
