// 文字列の整形。
export function fit(text: string, width: number): string {
  const w = Math.max(4, width)
  return text.length <= w ? text : `${text.slice(0, w - 1)}…`
}

export function clock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function isPulseOn(tick: number): boolean {
  return Math.floor((tick || Date.now()) / 600) % 2 === 0
}
