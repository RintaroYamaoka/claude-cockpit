// 変更の表現:前後のテキストから unified diff のハンクを組み、構造に影響する変更の種類を判定する。
import type { Change, FileChange, StructureKind } from '../../types'

export const isFileChange = (c: Change): c is FileChange => c.tool !== 'Bash'

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

// ---- 宣言名

/** 変更位置より上で最も近い宣言の名前。関数・クラス・型、変数、メソッド(`name(...) {`)。 */
const DECLARATIONS = [
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|class|interface|type|enum|def|fn|func|struct|impl|trait|mod)\s+([A-Za-z_$][\w$]*)/,
  /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=/,
  /^\s*(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{\s*$/,
]

/** メソッドの形(`xxx (...) {`)に見えるが宣言ではない制御構文。 */
const NOT_A_SYMBOL = new Set(['if', 'for', 'while', 'switch', 'catch', 'with', 'return', 'else', 'do', 'try', 'await', 'yield', 'typeof', 'match', 'elif', 'except', 'function', 'constructor'])

export function symbolNear(content: string, index: number): string | null {
  const lines = content.slice(0, Math.max(0, index)).split('\n')
  for (let i = lines.length - 1; i >= 0 && i >= lines.length - 400; i--) {
    const line = lines[i] ?? ''
    for (const re of DECLARATIONS) {
      const name = line.match(re)?.[1]
      if (name && !NOT_A_SYMBOL.has(name)) return name
    }
  }
  return null
}

export function lineOfIndex(content: string, index: number): number {
  let n = 1
  for (let i = 0; i < index && i < content.length; i++) if (content.charCodeAt(i) === 10) n++
  return n
}

// ---- 行差分

export type DiffLine = { op: ' ' | '-' | '+'; text: string }

const DP_LIMIT = 4_000_000 // LCS の表の上限(これを超える大きさは「全部置換」で出す)

/** LCS で行の差分を取る(共通の前後は先に剥がす)。大きすぎれば全削除 + 全追加。 */
export function lineDiff(a: readonly string[], b: readonly string[]): DiffLine[] {
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const ma = a.slice(head, a.length - tail)
  const mb = b.slice(head, b.length - tail)
  const out: DiffLine[] = a.slice(0, head).map(text => ({ op: ' ', text }))
  if (ma.length * mb.length > DP_LIMIT) {
    out.push(...ma.map(text => ({ op: '-' as const, text })), ...mb.map(text => ({ op: '+' as const, text })))
  } else {
    // dp[i][j] = ma[i..] と mb[j..] の LCS の長さ
    const w = mb.length + 1
    const dp = new Uint32Array((ma.length + 1) * w)
    for (let i = ma.length - 1; i >= 0; i--) {
      for (let j = mb.length - 1; j >= 0; j--) {
        dp[i * w + j] = ma[i] === mb[j] ? dp[(i + 1) * w + j + 1]! + 1 : Math.max(dp[(i + 1) * w + j]!, dp[i * w + j + 1]!)
      }
    }
    let i = 0
    let j = 0
    while (i < ma.length || j < mb.length) {
      if (i < ma.length && j < mb.length && ma[i] === mb[j]) {
        out.push({ op: ' ', text: ma[i]! })
        i++
        j++
      } else if (i < ma.length && (j >= mb.length || dp[(i + 1) * w + j]! >= dp[i * w + j + 1]!)) {
        out.push({ op: '-', text: ma[i]! }) // 同点なら削除を先に(- の下に + が並ぶ、読み慣れた形)
        i++
      } else {
        out.push({ op: '+', text: mb[j]! })
        j++
      }
    }
  }
  out.push(...a.slice(a.length - tail).map(text => ({ op: ' ' as const, text })))
  return out
}

// ---- ハンク

export type Hunk = { diff: string; plus: number; minus: number; symbol: string | null }

const CONTEXT = 2 // 変わった所の前後に残す共通行
const MAX_BODY = 1000 // ハンク本体の行数の上限(超えた分は `\ … n 行省略`)

/**
 * 行差分から 1 ハンク。先頭と末尾の共通行は CONTEXT 行だけ残す(途中の共通行はそのまま)。
 * startLine は a の 1 行目の行番号。
 */
export function hunkFromDiff(lines: readonly DiffLine[], startLine: number, symbol: string | null): Hunk {
  let first = lines.findIndex(l => l.op !== ' ')
  if (first < 0) first = lines.length
  let last = lines.length - 1
  while (last >= 0 && lines[last]!.op === ' ') last--
  const from = Math.max(0, first - CONTEXT)
  const to = Math.min(lines.length, last + 1 + CONTEXT)
  const kept = lines.slice(from, to)
  const oldStart = startLine + from
  const newStart = oldStart
  const oldCount = kept.filter(l => l.op !== '+').length
  const newCount = kept.filter(l => l.op !== '-').length
  const plus = kept.filter(l => l.op === '+').length
  const minus = kept.filter(l => l.op === '-').length
  const header = `@@ -${oldCount === 0 ? 0 : oldStart},${oldCount} +${newCount === 0 ? 0 : newStart},${newCount} @@`
  const body = kept.slice(0, MAX_BODY).map(l => `${l.op}${l.text}`)
  if (kept.length > MAX_BODY) body.push(`\\ … ${kept.length - MAX_BODY} 行省略`)
  return { diff: [header, ...body].join('\n'), plus, minus, symbol }
}

/** Edit の old / new から 1 ハンク。content(編集前のファイル)が無ければ行番号は 1 から、宣言名は無し。 */
export function hunkFromEdit(content: string | null, before: string, after: string): Hunk {
  const index = content ? content.indexOf(before) : -1
  const start = index >= 0 && content ? lineOfIndex(content, index) : 1
  const symbol = content && index >= 0 ? symbolNear(content, index) : null
  return hunkFromDiff(lineDiff(before === '' ? [] : before.split('\n'), after === '' ? [] : after.split('\n')), start, symbol)
}

/** Write の前後から 1 ハンク。before が null なら新規(全部追加)。 */
export function hunkFromWrite(before: string | null, content: string): Hunk {
  return hunkFromDiff(lineDiff(before === null ? [] : before.split('\n'), content.split('\n')), 1, null)
}

/** スクロール表示用:本体の offset 行目から rows 行を切り出し、@@ の数を合わせ直す。above / below は見えていない行数。 */
export function windowHunk(diff: string, offset: number, rows: number): { diff: string; above: number; below: number; total: number } {
  const lines = diff.split('\n')
  const header = lines[0] ?? ''
  const body = lines.slice(1)
  const start = Math.max(0, Math.min(offset, Math.max(0, body.length - rows)))
  const kept = body.slice(start, start + rows)
  const m = header.match(/^@@ -(\d+),\d+ \+(\d+),\d+ @@/)
  const isOld = (l: string) => l.startsWith('-') || l.startsWith(' ')
  const isNew = (l: string) => l.startsWith('+') || l.startsWith(' ')
  const skipped = body.slice(0, start)
  const a = Number(m?.[1] ?? '1') + skipped.filter(isOld).length
  const b = Number(m?.[2] ?? '1') + skipped.filter(isNew).length
  return {
    diff: [`@@ -${a},${kept.filter(isOld).length} +${b},${kept.filter(isNew).length} @@`, ...kept].join('\n'),
    above: start,
    below: Math.max(0, body.length - start - kept.length),
    total: body.length,
  }
}
