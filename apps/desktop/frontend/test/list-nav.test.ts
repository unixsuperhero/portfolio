import { describe, expect, test } from "bun:test";
import { moveIndex, navIntent, shouldOpenPalette, type KeyLike, type NavContext } from "../src/lib/list-nav";

const key = (value: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key: value, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...mods });
const idle: NavContext = { editable: false, interactive: false, blocked: false };

describe("list key intents", () => {
  test("maps the five list keys", () => {
    expect(["j", "k", "Enter", " ", "."].map(value => navIntent(key(value), idle))).toEqual(["down", "up", "open", "select", "actions"]);
  });

  test("leaves typing alone inside a text field", () => {
    const typing = { ...idle, editable: true };
    expect(["j", "k", "Enter", " ", "."].map(value => navIntent(key(value), typing))).toEqual([null, null, null, null, null]);
  });

  test("lets a focused control keep Enter and Space, but still moves with j and k", () => {
    const onButton = { ...idle, interactive: true };
    expect(["j", "k", "Enter", " ", "."].map(value => navIntent(key(value), onButton))).toEqual(["down", "up", null, null, "actions"]);
  });

  test("ignores keys while a palette, modal, or terminal owns the keyboard", () => {
    expect(navIntent(key("j"), { ...idle, blocked: true })).toBeNull();
  });

  test("ignores modified keys", () => {
    expect(navIntent(key("j", { metaKey: true }), idle)).toBeNull();
    expect(navIntent(key("k", { ctrlKey: true }), idle)).toBeNull();
    expect(navIntent(key("J", { shiftKey: true }), idle)).toBeNull();
  });
});

describe("row movement", () => {
  test("starts on the first row from either direction", () => {
    expect(moveIndex(-1, 5, 1)).toBe(0);
    expect(moveIndex(-1, 5, -1)).toBe(0);
  });

  test("stops at both ends", () => {
    expect(moveIndex(4, 5, 1)).toBe(4);
    expect(moveIndex(0, 5, -1)).toBe(0);
    expect(moveIndex(2, 5, 1)).toBe(3);
  });

  test("has nowhere to go in an empty list", () => {
    expect(moveIndex(-1, 0, 1)).toBe(-1);
  });
});

describe("palette shortcut", () => {
  const free = { inPalette: false, editable: false, modalOpen: false };

  test("Cmd+K opens from a search or filter field", () => {
    expect(shouldOpenPalette(key("k", { metaKey: true }), { ...free, editable: true })).toBe(true);
  });

  test("Ctrl+K stays the native kill-line inside a field", () => {
    expect(shouldOpenPalette(key("k", { ctrlKey: true }), { ...free, editable: true })).toBe(false);
    expect(shouldOpenPalette(key("k", { ctrlKey: true }), free)).toBe(true);
  });

  test("does not reopen inside the palette or over a modal", () => {
    expect(shouldOpenPalette(key("k", { metaKey: true }), { ...free, inPalette: true })).toBe(false);
    expect(shouldOpenPalette(key("k", { metaKey: true }), { ...free, modalOpen: true })).toBe(false);
  });
});
