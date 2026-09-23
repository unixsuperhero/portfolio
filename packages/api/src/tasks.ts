import type { TaskInput } from "@portfolio/core";
import type { Ctx } from "./context.ts";
import { bool, error, json, notFound, readJson } from "./http.ts";

export async function listTasksRoute(ctx: Ctx, request: Request): Promise<Response> {
  const all = bool(new URL(request.url).searchParams.get("all"));
  return json({ tasks: ctx.store.tasks.listTaskViews({ all }) });
}

export async function createTaskRoute(ctx: Ctx, request: Request): Promise<Response> {
  const body = (await readJson(request)) as unknown as TaskInput;
  try {
    return json({ id: ctx.store.tasks.createTask(body) }, 201);
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function getTaskRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  const task = ctx.store.tasks.getTask(Number(params.id));
  if (!task) return notFound();
  return json({ ...ctx.store.tasks.taskView(task), history: ctx.store.tasks.listCompletions(task.id) });
}

export async function patchTaskRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  const body = (await readJson(request)) as unknown as Partial<TaskInput> & { active?: boolean };
  try {
    return ctx.store.tasks.updateTask(id, body) ? json({ ok: true }) : notFound();
  } catch (err) {
    return error(422, (err as Error).message);
  }
}

export async function deleteTaskRoute(ctx: Ctx, _request: Request, params: Record<string, string>): Promise<Response> {
  return json({ ok: ctx.store.tasks.deleteTask(Number(params.id)) });
}

export async function completeTaskRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  if (!ctx.store.tasks.getTask(id)) return notFound();
  const body = await readJson(request);
  return json(ctx.store.tasks.completeTask(id, body.on as string | undefined));
}

export async function uncompleteTaskRoute(ctx: Ctx, request: Request, params: Record<string, string>): Promise<Response> {
  const id = Number(params.id);
  if (!ctx.store.tasks.getTask(id)) return notFound();
  const body = await readJson(request);
  return json(ctx.store.tasks.uncompleteTask(id, body.on as string | undefined));
}

