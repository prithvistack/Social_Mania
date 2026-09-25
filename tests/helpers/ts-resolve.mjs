/**
 * Lets `node --test` load the app's TypeScript sources unchanged.
 *
 * Application code uses idiomatic extensionless imports ("./quota") and the
 * "@/..." alias, both of which Next resolves at build time. Node's ESM
 * resolver does neither, so this hook fills the gap for tests only — no
 * bundler, no build step, no compromise in the source itself.
 */
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve as resolvePath } from "node:path";

// path.resolve drops the trailing slash, so it is added back explicitly —
// without it "@/config/x" resolves to ".../srcconfig/x".
const SRC =
  pathToFileURL(resolvePath(dirname(fileURLToPath(import.meta.url)), "../../src")).href + "/";

const CANDIDATES = [".ts", ".tsx", "/index.ts", "/index.tsx", ".js"];
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/;

function firstExisting(baseHref) {
  for (const ext of CANDIDATES) {
    const candidate = baseHref + ext;
    if (existsSync(fileURLToPath(candidate))) return candidate;
  }
  return null;
}

registerHooks({
  resolve(specifier, context, nextResolve) {
    // "@/lib/quota" -> <repo>/src/lib/quota
    if (specifier.startsWith("@/")) {
      const base = SRC + specifier.slice(2);
      const found = firstExisting(base) ?? base;
      return nextResolve(found, context);
    }

    if (specifier.startsWith(".") && !HAS_EXTENSION.test(specifier)) {
      const parent = context.parentURL;
      // Only our own TypeScript. Dependencies resolve their own relative
      // requires, and rewriting those into file:// URLs breaks CommonJS.
      if (parent && !parent.includes("/node_modules/")) {
        const found = firstExisting(new URL(specifier, parent).href);
        if (found) return nextResolve(found, context);
      }
    }

    return nextResolve(specifier, context);
  },
});
