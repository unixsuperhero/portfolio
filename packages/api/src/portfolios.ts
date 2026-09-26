import { normalizePortfolioFilter, normalizePortfolioTags } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { error, json, notFound, readJson } from "./http.ts";

export async function listPortfoliosRoute(ctx: Ctx): Promise<Response> {
  return json({ portfolios: ctx.store.portfolios.listPortfolios() });
}

export async function createPortfolioRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = await readJson(request);
  try {
    const id = ctx.store.portfolios.createPortfolio(String(body.name ?? ""), String(body.description ?? ""), normalizePortfolioTags(body.tags), normalizePortfolioFilter(body.item_filter));
    return json({ id }, 201);
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function getPortfolioRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const portfolio = ctx.store.portfolios.getPortfolio(Number(params.id));
  if (!portfolio) return notFound();
  return json(ctx.store.portfolios.portfolioView(portfolio));
}

export async function patchPortfolioRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const body = await readJson(request);
  try {
    const ok = ctx.store.portfolios.updatePortfolio(id, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
      tags: body.tags === undefined ? undefined : normalizePortfolioTags(body.tags),
      item_filter: body.item_filter === undefined ? undefined : normalizePortfolioFilter(body.item_filter),
    });
    return ok ? json({ ok: true }) : notFound();
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function deletePortfolioRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return json({ ok: ctx.store.portfolios.deletePortfolio(Number(params.id)) });
}

export async function createCardRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const portfolioId = Number(params.id);
  if (!ctx.store.portfolios.getPortfolio(portfolioId)) return notFound();
  const body = await readJson(request);
  try {
    return json({ id: ctx.store.portfolios.createCard(portfolioId, body) }, 201);
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function updateCardRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const body = await readJson(request);
  try {
    return ctx.store.portfolios.updateCard(id, body) ? json({ ok: true }) : notFound();
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function deleteCardRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return json({ ok: ctx.store.portfolios.deleteCard(Number(params.id)) });
}

export async function moveCardRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const card = ctx.store.portfolios.getCard(Number(params.id));
  if (!card) return notFound();
  const body = await readJson(request);
  const direction = body.direction === "left" ? "left" : "right";
  return json({ ok: ctx.store.portfolios.moveCard(card, direction) });
}
