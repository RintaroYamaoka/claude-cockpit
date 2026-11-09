// repo を走査して、依存解析の対象になるソースファイルの一覧を作る。
import type { EngineInterface } from 'claude-code'

const SKIP = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'out', '.turbo', '.vercel', 'coverage',
  '.cache', '__pycache__', '.venv', 'venv', 'target', '.idea', '.vscode', '.DS_Store',
  '.pnpm-store', '.svelte-kit', '.nuxt', '.output', '.parcel-cache', 'vendor', '.mypy_cache',
  '.pytest_cache', '.ruff_cache', '.gradle', '.terraform', 'tmp', '.tmp', '.wrangler',
])

const MAX_DEPTH = 8
const MAX_FILES = 6000

type Fs = Pick<EngineInterface, 'fs'>

async function gitignoreNames($: Fs, root: string): Promise<Set<string>> {
  const names = new Set<string>()
  try {
    if (!(await $.fs.exists(`${root}/.gitignore`))) return names
    const text = await $.fs.read(`${root}/.gitignore`)
    for (const raw of text.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#') || line.startsWith('!') || /[*?[\]]/.test(line)) continue
      const name = line.replace(/^\//, '').replace(/\/$/, '')
      if (name && !name.includes('/')) names.add(name)
    }
  } catch {
    // 読めなければ既定の除外だけ
  }
  return names
}

/** root 配下のファイルを相対パスで列挙する(prefix を付けると `label/…`)。 */
export async function listFiles($: Fs, root: string, prefix = ''): Promise<string[]> {
  const skip = new Set([...SKIP, ...(await gitignoreNames($, root))])
  const out: string[] = []
  const walk = async (dir: string, rel: string, depth: number): Promise<void> => {
    if (out.length >= MAX_FILES || depth > MAX_DEPTH) return
    let entries
    try {
      entries = await $.fs.list(dir)
    } catch {
      return
    }
    for (const e of entries) {
      if (skip.has(e.name) || e.isLink) continue
      const path = rel ? `${rel}/${e.name}` : e.name
      if (e.kind === 'dir') await walk(`${dir}/${e.name}`, path, depth + 1)
      else if (e.kind === 'file') out.push(prefix ? `${prefix}/${path}` : path)
      if (out.length >= MAX_FILES) return
    }
  }
  await walk(root, '', 0)
  return out
}
