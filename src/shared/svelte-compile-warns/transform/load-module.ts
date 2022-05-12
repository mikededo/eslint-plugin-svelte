import type { AST } from "svelte-eslint-parser"
import Module from "module"
import path from "path"
import type { RuleContext } from "../../../types"
const cache = new WeakMap<AST.SvelteProgram, Record<string, unknown>>()
const cache4b = new Map<string, unknown>()
/**
 * Load module
 */
export function loadModule<R>(context: RuleContext, name: string): R | null {
  const key = context.getSourceCode().ast
  let modules = cache.get(key)
  if (!modules) {
    modules = {}
    cache.set(key, modules)
  }
  const mod = modules[name] || cache4b.get(name)
  if (mod) return mod as R
  try {
    const createRequire: (filename: string) => (modName: string) => unknown =
      // Added in v12.2.0
      Module.createRequire ||
      // Added in v10.12.0, but deprecated in v12.2.0.
      // @ts-expect-error -- old type
      Module.createRequireFromPath

    const cwd = context.getCwd?.() ?? process.cwd()
    const relativeTo = path.join(cwd, "__placeholder__.js")
    return (modules[name] = createRequire(relativeTo)(name) as R)
  } catch {
    return null
  }
}

/**  Load modules for browser */
export async function loadModulesForBrowser(): Promise<void> {
  const [sass, typescript] = await Promise.all([
    import("sass"),
    import("typescript"),
  ])
  cache4b.set("sass", sass)
  cache4b.set("typescript", typescript)
}
