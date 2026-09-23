import type { ReminderCreateInput } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { bool, error, json, notFound, num, readJson } from "./http.ts";

export async function listRemindersRoute(ctx: Ctx, request: Request): Promise<Response> {
  const all = bool(new URL(request.url).searchParams.get("all"));
  return json({ reminders: ctx.store.reminders.listReminderViews({ all }) });
}

export async function createReminderRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = (await readJson(request)) as unknown as ReminderCreateInput;
  try {
    return json({ id: ctx.store.reminders.createReminder(body) }, 201);
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function getReminderRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const reminder = ctx.store.reminders.getReminder(Number(params.id));
  if (!reminder) return notFound();
  return json(ctx.store.reminders.reminderView(reminder));
}

export async function patchReminderRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const body = (await readJson(request)) as unknown as Partial<ReminderCreateInput>;
  try {
    return ctx.store.reminders.updateReminder(Number(params.id), body) ? json({ ok: true }) : notFound();
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function deleteReminderRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return ctx.store.reminders.deleteReminder(Number(params.id)) ? json({ ok: true }) : notFound();
}

export async function completeReminderRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const body = await readJson(request);
  const reminder = ctx.store.reminders.completeReminder(Number(params.id), body.on as string | undefined);
  return reminder ? json(reminder) : notFound();
}

export async function uncompleteReminderRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const body = await readJson(request);
  const reminder = ctx.store.reminders.uncompleteReminder(Number(params.id), body.on as string | undefined);
  return reminder ? json(reminder) : notFound();
}

export async function dueRemindersRoute(ctx: Ctx, request: Request): Promise<Response> {
  const minutes = num(new URL(request.url).searchParams.get("minutes")) ?? 60;
  return json({ due: ctx.store.reminders.dueReminders({ minutes }) });
}

export async function todayRemindersRoute(ctx: Ctx): Promise<Response> {
  return json({ reminders: ctx.store.reminders.todayReminders() });
}
