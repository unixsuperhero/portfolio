// Vendored from ~/proj/t3code/apps/web/src/lib/utils.ts (isMacPlatform only).
// Copied here so ghostty/surface.ts does not depend on the t3code app shell.

export function isMacPlatform(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}
