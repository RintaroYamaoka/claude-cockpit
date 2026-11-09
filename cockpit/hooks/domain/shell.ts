// Bash コマンドの読み取り:ヒアドキュメントでのファイル書き込みを検出し、表示用に短くする。

export type HeredocWrite = { path: string; content: string; isAppend: boolean }

// `cat > path <<EOF … EOF`:1 = > or >>、3 = path、5 = 終端語、6 = 本文
const REDIRECT_FIRST = /cat\s*(>>?)\s*(["']?)([^\s"'<>|;&]+)\2\s*<<-?\s*(["']?)(\w+)\4[^\n]*\n([\s\S]*?)\n\s*\5(?=\n|$)/g
// `cat <<EOF > path … EOF`:2 = 終端語、3 = > or >>、5 = path、6 = 本文
const MARKER_FIRST = /cat\s*<<-?\s*(["']?)(\w+)\1\s*(>>?)\s*(["']?)([^\s"'<>|;&]+)\4[^\n]*\n([\s\S]*?)\n\s*\2(?=\n|$)/g

/**
 * `cat > path <<'EOF' … EOF`(`>>` は追記、`<<-` も可。`cat <<EOF > path` の順でも)を全部拾う。
 * tee や他のコマンドでの書き込みは対象外。パスは与えられたまま(相対なら呼び出し側が cwd を足す)。
 */
export function parseHeredocWrites(command: string): HeredocWrite[] {
  const found: Array<HeredocWrite & { at: number }> = []
  for (const m of command.matchAll(REDIRECT_FIRST)) found.push({ path: m[3]!, content: m[6]!, isAppend: m[1] === '>>', at: m.index ?? 0 })
  for (const m of command.matchAll(MARKER_FIRST)) found.push({ path: m[5]!, content: m[6]!, isAppend: m[3] === '>>', at: m.index ?? 0 })
  return found.sort((x, y) => x.at - y.at).map(({ at: _, ...w }) => w)
}

/** 先頭の 1 コマンド分を短く(`cd x && ` などの前置きを飛ばし、改行で切る)。 */
export function summarizeCommand(command: string, width: number): string {
  const first = command
    .split('\n')
    .map(l => l.trim())
    .find(l => l && !l.startsWith('#')) ?? ''
  const stripped = first.replace(/^(cd\s+\S+\s*(&&|;)\s*)+/, '').replace(/^set\s+-e;\s*/, '')
  const text = stripped || first
  return text.length <= width ? text : `${text.slice(0, Math.max(4, width - 1))}…`
}

/** 出力の末尾 rows 行(空行を除く)。 */
export function tailOutput(text: string, rows: number): string[] {
  const lines = text.split('\n').filter(l => l.trim().length > 0)
  return lines.slice(Math.max(0, lines.length - rows))
}

/** 相対パスを cwd に対して解決する(`~` と絶対パスはそのまま)。 */
export function resolveShellPath(path: string, cwd: string, home: string): string {
  if (path.startsWith('/')) return path
  if (path.startsWith('~/')) return `${home}/${path.slice(2)}`
  if (path.startsWith('$HOME/')) return `${home}/${path.slice(6)}`
  return `${cwd}/${path.replace(/^\.\//, '')}`
}
