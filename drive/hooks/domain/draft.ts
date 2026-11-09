// ストリーミング中のツール入力(途中までの JSON)から、file_path と書かれつつあるコードを取り出す。

/** JSON 文字列の中身を、閉じ引用符か末尾まで復号する。途中で切れたエスケープは捨てる。 */
export function decodePartialJsonString(raw: string): { text: string; isClosed: boolean } {
  let out = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!
    if (ch === '"') return { text: out, isClosed: true }
    if (ch !== '\\') {
      out += ch
      continue
    }
    const esc = raw[i + 1]
    if (esc === undefined) break
    i++
    switch (esc) {
      case 'n': out += '\n'; break
      case 't': out += '\t'; break
      case 'r': out += '\r'; break
      case 'b': out += '\b'; break
      case 'f': out += '\f'; break
      case '"': out += '"'; break
      case '\\': out += '\\'; break
      case '/': out += '/'; break
      case 'u': {
        const hex = raw.slice(i + 1, i + 5)
        if (hex.length < 4) return { text: out, isClosed: false }
        out += String.fromCharCode(parseInt(hex, 16))
        i += 4
        break
      }
      default: out += esc
    }
  }
  return { text: out, isClosed: false }
}

function fieldStart(json: string, key: string): number {
  const m = json.match(new RegExp(`"${key}"\\s*:\\s*"`))
  return m && m.index !== undefined ? m.index + m[0].length : -1
}

export type DraftExtract = {
  path: string | null // 閉じていれば確定
  text: string | null // new_string か content か command(途中まで)
  field: 'new_string' | 'content' | 'command' | null
}

/** Edit の new_string、Write の content、Bash の command を、書かれている途中の状態で取り出す。 */
export function extractDraft(json: string): DraftExtract {
  let path: string | null = null
  const p = fieldStart(json, 'file_path')
  if (p >= 0) {
    const d = decodePartialJsonString(json.slice(p))
    if (d.isClosed) path = d.text
  }
  for (const field of ['new_string', 'content', 'command'] as const) {
    const at = fieldStart(json, field)
    if (at >= 0) {
      const d = decodePartialJsonString(json.slice(at))
      return { path, text: d.text, field }
    }
  }
  return { path, text: null, field: null }
}

/** 末尾 rows 行。 */
export function tailLines(text: string, rows: number): string[] {
  const lines = text.split('\n')
  return lines.slice(Math.max(0, lines.length - rows))
}
