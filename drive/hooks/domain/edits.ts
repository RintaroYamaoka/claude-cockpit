// 変更の表現:Edit / Write の入力から unified diff のハンクを組み、構造に影響する変更の種類を判定する。
import type { StructureKind } from '../../types'

/** パスから構造の変更の種類を判定する。該当しなければ null。 */
const RULES: Array<[RegExp, StructureKind]> = [
  [/(^|\/)(prisma\/.*\.prisma|.*\.sql|migrations?\/|schema\.(ts|js|graphql|gql|json))/i, 'schema'],
  [/(^|\/)(drizzle\/|supabase\/migrations)/i, 'schema'],
  [/(^|\/)(package\.json|pnpm-lock\.yaml|package-lock\.json|yarn\.lock|requirements.*\.txt|pyproject\.toml|Cargo\.toml|go\.mod|Gemfile)$/i, 'deps'],
  [/(^|\/)(app\/.*\/route\.(ts|js)|pages\/api\/|routes?\/|.*router.*\.(ts|js|py|go|rs)|middleware\.(ts|js)|proxy\.(ts|js))/i, 'route'],
  [/(^|\/)\.env(\..*)?$/i, 'env'],
  [/(^|\/)(next\.config\.|vite\.config\.|tsconfig.*\.json|vercel\.(json|ts)|tailwind\.config\.|eslint\.config\.|\.eslintrc|turbo\.json|docker-compose|Dockerfile|wrangler\.toml)/i, 'config'],
]

export function structureKindOf(rel: string): StructureKind | null {
  for (const [re, kind] of RULES) if (re.test(rel)) return kind
  return null
}

export const KIND_LABEL: Record<StructureKind, string> = {
  schema: 'スキーマ',
  deps: '依存関係',
  route: 'ルーティング',
  env: '環境変数',
  config: '設定',
  new: '新規',
}

/** 変更位置より上で最も近い宣言の名前。 */
const DECLARATIONS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|def|fn|func|struct|impl|trait|mod)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\(|function|[A-Za-z_$][\w$]*\s*=>)/,
  /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
]

export function symbolNear(content: string, index: number): string | null {
  const lines = content.slice(0, Math.max(0, index)).split('\n')
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 400; i--) {
    const line = lines[i] ?? ''
    for (const re of DECLARATIONS) {
      const m = line.match(re)
      if (m?.[1]) return m[1]
    }
  }
  return null
}

export function lineOfIndex(content: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) n++
  return n
}

export type Hunk = { diff: string; lines: number; symbol: string | null }

/** Edit の old / new から 1 ハンク。content が無ければ行番号は 1 から。 */
export function hunkFromEdit(content: string | null, before: string, after: string): Hunk {
  const index = content ? content.indexOf(before) : -1
  const start = index >= 0 && content ? lineOfIndex(content, index) : 1
  const oldLines = before === '' ? [] : before.split('\n')
  const newLines = after === '' ? [] : after.split('\n')
  const header = `@@ -${start},${oldLines.length} +${start},${newLines.length} @@`
  const body = [...oldLines.map(l => `-${l}`), ...newLines.map(l => `+${l}`)]
  return { diff: [header, ...body].join('\n'), lines: body.length + 1, symbol: content && index >= 0 ? symbolNear(content, index) : null }
}

/** Write の内容から 1 ハンク(先頭 max 行だけ)。 */
export function hunkFromWrite(content: string, isNew: boolean, max = 24): Hunk {
  const all = content.split('\n')
  const shown = all.slice(0, max)
  const header = isNew ? `@@ -0,0 +1,${shown.length} @@` : `@@ -1,${shown.length} +1,${shown.length} @@`
  const body = shown.map(l => `+${l}`)
  if (all.length > max) body.push(`+… ${all.length - max} 行省略`)
  return { diff: [header, ...body].join('\n'), lines: body.length + 1, symbol: null }
}

/** スクロール表示用:本体の offset 行目から rows 行を切り出し、@@ の数を合わせ直す。above / below は見えていない行数。 */
export function windowHunk(diff: string, offset: number, rows: number): { diff: string; above: number; below: number; total: number } {
  const lines = diff.split('\n')
  const header = lines[0] ?? ''
  const body = lines.slice(1)
  const start = Math.max(0, Math.min(offset, Math.max(0, body.length - rows)))
  const kept = body.slice(start, start + rows)
  const m = header.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/)
  const minus = kept.filter(l => l.startsWith('-')).length
  const plus = kept.filter(l => l.startsWith('+')).length
  const a = Number(m?.[1] ?? '1') + body.slice(0, start).filter(l => !l.startsWith('+')).length
  const b = Number(m?.[2] ?? '1') + body.slice(0, start).filter(l => !l.startsWith('-')).length
  return { diff: [`@@ -${a},${minus} +${b},${plus} @@`, ...kept].join('\n'), above: start, below: Math.max(0, body.length - start - kept.length), total: body.length }
}

/** ハンクの追加・削除行数。 */
export function countLines(diff: string): { plus: number; minus: number } {
  const body = diff.split('\n').slice(1)
  return { plus: body.filter(l => l.startsWith('+')).length, minus: body.filter(l => l.startsWith('-')).length }
}
