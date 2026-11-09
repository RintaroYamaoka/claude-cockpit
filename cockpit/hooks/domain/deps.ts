// 依存グラフ:import / export を正規表現で読み、ファイル → ファイル(repo 内)と ファイル → パッケージの辺にする。
import type { EngineInterface } from 'claude-code'

import type { DepNode } from '../../types'
import { dirname, extensionOf } from './paths'

export const CODE_EXTENSIONS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts', 'py'])

export function isCodeFile(rel: string): boolean {
  return CODE_EXTENSIONS.has(extensionOf(rel)) && !/\.d\.ts$/.test(rel)
}

/** import の指定子(相対パスやパッケージ名)。 */
export function parseImports(text: string, ext: string): string[] {
  const out = new Set<string>()
  if (ext === 'py') {
    for (const m of text.matchAll(/^\s*from\s+([\w.]+)\s+import\b/gm)) out.add(m[1]!)
    for (const m of text.matchAll(/^\s*import\s+([\w.]+)/gm)) out.add(m[1]!)
    return [...out]
  }
  for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\s+(?:type\s+)?[^'"`;]*?\s*from\s*['"]([^'"]+)['"]/g)) out.add(m[1]!)
  for (const m of text.matchAll(/(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)) out.add(m[1]!)
  for (const m of text.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]!)
  for (const m of text.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.add(m[1]!)
  return [...out]
}

/** export している名前。 */
export function parseExports(text: string, ext: string): string[] {
  const out: string[] = []
  if (ext === 'py') {
    for (const m of text.matchAll(/^(?:async\s+)?(?:def|class)\s+([A-Za-z]\w*)/gm)) out.push(m[1]!)
    return unique(out).slice(0, 40)
  }
  for (const m of text.matchAll(/^\s*export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm)) out.push(m[1]!)
  for (const m of text.matchAll(/^\s*export\s*\{([^}]+)\}/gm)) {
    for (const part of m[1]!.split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.push(name)
    }
  }
  if (/^\s*export\s+default\b/m.test(text) && !out.includes('default')) out.push('default')
  return unique(out).slice(0, 40)
}

function unique(list: string[]): string[] {
  return [...new Set(list)]
}

function normalize(path: string): string {
  const parts: string[] = []
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.mts', '.d.ts', '/index.ts', '/index.tsx', '/index.js', '.py', '/__init__.py']

/** 指定子を repo 内のファイルに解決する。できなければ null(外部)。 */
export function resolveImport(spec: string, fromRel: string, files: ReadonlySet<string>, ext: string): string | null {
  if (ext === 'py') {
    const asPath = spec.replace(/^\.+/, m => '../'.repeat(Math.max(0, m.length - 1))).replace(/\./g, '/')
    const bases = spec.startsWith('.') ? [normalize(`${dirname(fromRel)}/${asPath}`)] : [asPath, `src/${asPath}`]
    for (const b of bases) for (const e of ['.py', '/__init__.py']) if (files.has(b + e)) return b + e
    return null
  }
  let base: string | null = null
  if (spec.startsWith('.')) base = normalize(`${dirname(fromRel)}/${spec}`)
  else if (spec.startsWith('@/') || spec.startsWith('~/')) base = spec.slice(2)
  else return null
  for (const c of [base, `src/${base}`]) {
    const stripped = c.replace(/\.js$/, '')
    for (const e of RESOLVE_SUFFIXES) {
      if (files.has(c + e)) return c + e
      if (stripped !== c && files.has(stripped + e)) return stripped + e
    }
  }
  return null
}

/** 外部パッケージの名前(scoped は 2 段)。 */
export function packageOf(spec: string): string {
  if (spec.startsWith('node:')) return spec
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0] ?? spec
}

/** モジュール = ディレクトリ 2 段(`app/api`)。root 直下のファイルは `(root)`。 */
export function moduleOf(rel: string): string {
  const parts = rel.split('/')
  if (parts.length <= 1) return '(root)'
  if (parts.length === 2) return parts[0]!
  return `${parts[0]}/${parts[1]}`
}

export function analyze(rel: string, text: string, files: ReadonlySet<string>): DepNode {
  const ext = extensionOf(rel)
  const imports: string[] = []
  const packages: string[] = []
  for (const spec of parseImports(text, ext)) {
    const target = resolveImport(spec, rel, files, ext)
    if (target) imports.push(target)
    else if (!spec.startsWith('.')) packages.push(packageOf(spec))
  }
  return { rel, imports: unique(imports), packages: unique(packages), exports: parseExports(text, ext) }
}

/** 一覧のソースを読んで解析する。onBatch で途中経過を渡す(描画を止めないため)。 */
export async function scanDeps(
  $: Pick<EngineInterface, 'fs'>,
  list: readonly string[],
  absolutePathOf: (rel: string) => string,
  knownFiles: ReadonlySet<string>,
  onBatch: (nodes: DepNode[]) => Promise<void>,
): Promise<void> {
  let batch: DepNode[] = []
  for (const rel of list) {
    try {
      const text = await $.fs.read(absolutePathOf(rel))
      if (text.length <= 300_000) batch.push(analyze(rel, text, knownFiles))
    } catch {
      // 読めないものは飛ばす
    }
    if (batch.length >= 60) {
      await onBatch(batch)
      batch = []
    }
  }
  if (batch.length) await onBatch(batch)
}

export const edgeKey = (from: string, to: string): string => `${from}→${to}`

/** このファイルを import しているファイル(dependents)。 */
export function dependentsOf(deps: Readonly<Record<string, DepNode>>, rel: string): string[] {
  const out: string[] = []
  for (const node of Object.values(deps)) if (node.imports.includes(rel)) out.push(node.rel)
  return out
}

/** 2 つの解析結果の間で増えた辺のキー。 */
export function addedEdgesBetween(prev: DepNode | undefined, next: DepNode): string[] {
  const out: string[] = []
  for (const t of next.imports) if (!prev || !prev.imports.includes(t)) out.push(edgeKey(next.rel, t))
  for (const p of next.packages) if (!prev || !prev.packages.includes(p)) out.push(edgeKey(next.rel, p))
  return out
}
