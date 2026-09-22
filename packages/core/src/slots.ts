import { isAbsolute, resolve } from "./posix.ts";
import { isPathType } from "./constants.ts";
import { expandPath } from "./paths.ts";
import type { ResolvedSlot, Slot } from "./types.ts";

/** existsSync without a top-level node:fs import, so the module bundles for the browser (where it answers false). */
const nodeExists = (path: string): boolean => {
  if (!(globalThis as { process?: { versions?: unknown } }).process?.versions) return false;
  return (require("node:fs") as typeof import("node:fs")).existsSync(path);
};

/** One slot per line: `name | file or dir | path`. Throws with the offending line. */
export function parseSlots(value: string): Slot[] {
  const slots = value.split("\n").map(line => line.trim()).filter(Boolean).map(line => {
    const [name, kind, path] = line.split("|").map(part => part.trim());
    if (!name || !isPathType(kind) || !path) throw new Error(`slot "${line}" must read: name | file or dir | path`);
    return { name, kind, path } as Slot;
  });
  if (new Set(slots.map(slot => slot.name.toLowerCase())).size !== slots.length) throw new Error("slot names must be unique");
  return slots;
}

export const formatSlots = (slots: Slot[]): string => slots.map(slot => `${slot.name} | ${slot.kind} | ${slot.path}`).join("\n");

export interface ResolveSlotsOptions {
  /** The member's own path; relative slot paths hang off it. */
  memberPath?: string | null;
  /** Per-member overrides: { slotName: path }. */
  overrides?: Record<string, string>;
  home?: string;
  exists?: (path: string) => boolean;
}

/**
 * Resolves a category's slots for one member. A relative slot path is inside
 * the member's own path; an absolute or ~/ path stands alone; an override wins.
 * Path is null when a relative slot has no member path to hang off.
 */
export function resolveSlots(slots: Slot[], options: ResolveSlotsOptions = {}): (ResolvedSlot | (Omit<ResolvedSlot, "path"> & { path: null }))[] {
  const overrides = options.overrides ?? {};
  const exists = options.exists ?? nodeExists;
  return slots.map(slot => {
    const override = overrides[slot.name];
    const expanded = expandPath(override || slot.path, options.home);
    const path = isAbsolute(expanded) ? resolve(expanded) : options.memberPath ? resolve(options.memberPath, expanded) : null;
    return { ...slot, path, overridden: Boolean(override), exists: Boolean(path) && exists(path as string) } as ResolvedSlot;
  });
}
