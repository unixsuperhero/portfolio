// Ambient declarations for array/string methods newer than this project's
// tsconfig `lib` (ES2020): `Array.prototype.at` (ES2022), `String.prototype.replaceAll`
// (ES2021), and `Array.prototype.toSorted` (ES2023). All three are implemented by every
// runtime this app ships to (Bun, and the WKWebView/Chromium the Wails webview embeds);
// this file only restores their types so the vendored ghostty/** code, written against
// t3code's ES2023 lib, type-checks here without being rewritten to avoid them.

export {};

declare global {
  interface Array<T> {
    at(index: number): T | undefined;
    toSorted(compareFn?: (a: T, b: T) => number): T[];
  }

  interface ReadonlyArray<T> {
    at(index: number): T | undefined;
    toSorted(compareFn?: (a: T, b: T) => number): T[];
  }

  interface String {
    replaceAll(searchValue: string | RegExp, replaceValue: string): string;
    replaceAll(searchValue: string | RegExp, replacer: (substring: string, ...args: unknown[]) => string): string;
  }
}
