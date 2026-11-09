// 純粋なロジックの単体テスト。claude plugin test ./cockpit で回す。
import { expect, test } from 'claude-code/testing'

import { analyze, dependentsOf, addedEdgesBetween, moduleOf, parseExports, parseImports, resolveImport } from '../hooks/domain/deps'
import { decodePartialJsonString, extractDraft, tailLines } from '../hooks/domain/draft'
import { hunkFromEdit, hunkFromWrite, lineDiff, structureKindOf, symbolNear, windowHunk } from '../hooks/domain/edits'
import { absolutize, isOutside, labelFor, projectDirOf, relativize, shortenHome } from '../hooks/domain/paths'
import { parseHeredocWrites, resolveShellPath, summarizeCommand, tailOutput } from '../hooks/domain/shell'

const ws = [{ dir: '/home/u/dev/_wt/pa', label: 'pa' }]

test('パス:root の中・外部ルート・どちらでもない', async () => {
  expect(relativize('/home/u/proj', ws, '/home/u/proj/app/x.ts')).toBe('app/x.ts')
  expect(relativize('/home/u/proj', ws, '/home/u/dev/_wt/pa/lib/y.ts')).toBe('pa/lib/y.ts')
  expect(relativize('/home/u/proj', ws, '/home/u/other/z.ts')).toBe('~/other/z.ts')
  expect(isOutside('/home/u/proj', ws, '/home/u/dev/_wt/pa/a')).toBe(false)
  expect(isOutside('/home/u/proj', ws, '/tmp/a')).toBe(true)
  expect(labelFor('/x/pa', ws)).toBe('x/pa')
  expect(projectDirOf('/home/u/proj', ws, '/home/u/dev/_wt/pa/lib/y.ts')).toBe('/home/u/dev/_wt/pa')
  expect(absolutize('/home/u/proj', ws, 'pa/lib/y.ts')).toBe('/home/u/dev/_wt/pa/lib/y.ts')
  expect(shortenHome('/home/u/a/b')).toBe('~/a/b')
})

test('行差分:共通の前後を剥がし、途中の共通行は文脈として残す', async () => {
  const d = lineDiff(['a', 'b', 'c', 'd'], ['a', 'x', 'c', 'd', 'e'])
  expect(d.map(l => l.op + l.text)).toEqual([' a', '-b', '+x', ' c', ' d', '+e'])
  expect(lineDiff([], ['a']).map(l => l.op)).toEqual(['+'])
  expect(lineDiff(['a'], ['a']).map(l => l.op)).toEqual([' '])
})

test('ハンク:Edit から行番号と宣言名、Write は本当の差分、窓切り', async () => {
  const src = 'export async function POST(req: Request) {\n  const body = await req.json()\n  return body\n}\n'
  const h = hunkFromEdit(src, 'const body = await req.json()', 'const body = Schema.parse(\n  await req.json())')
  expect(h.symbol).toBe('POST')
  expect(h.diff.split('\n')[0]).toBe('@@ -2,1 +2,2 @@')
  expect(h).toMatchObject({ plus: 2, minus: 1 })
  // 30 行の置換で 1 行しか違わなければ、その 1 行と前後 2 行の文脈だけ
  const big = Array.from({ length: 30 }, (_, i) => `l${i}`)
  const one = hunkFromEdit(big.join('\n'), big.join('\n'), big.map(l => (l === 'l10' ? 'L10' : l)).join('\n'))
  expect(one.diff.split('\n')).toEqual(['@@ -9,5 +9,5 @@', ' l8', ' l9', '-l10', '+L10', ' l11', ' l12'])
  expect(one).toMatchObject({ plus: 1, minus: 1 })
  // Write:新規は全部追加、既存はその差分
  expect(hunkFromWrite(null, 'a\nb\nc').diff).toBe('@@ -0,0 +1,3 @@\n+a\n+b\n+c')
  expect(hunkFromWrite('a\nb\nc', 'a\nB\nc').diff).toBe('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c')
  // 窓切り:見出しは文脈行も数える
  const w = windowHunk(one.diff, 2, 2)
  expect(w).toMatchObject({ above: 2, below: 2 })
  expect(w.diff).toBe('@@ -11,1 +11,1 @@\n-l10\n+L10')
  expect(symbolNear('const f = () => {\n  x\n', 20)).toBe('f')
  // 制御構文は宣言ではない:if の中を変更しても、その上の関数名が出る
  const ctl = 'export function handler(req) {\n  if (req.ok) {\n    return 1\n  }\n'
  expect(symbolNear(ctl, ctl.indexOf('return'))).toBe('handler')
  expect(symbolNear('  while (x) {\n    y\n', 18)).toBe(null)
})

test('構造の変更の種類', async () => {
  expect(structureKindOf('prisma/schema.prisma')).toBe('schema')
  expect(structureKindOf('app/api/x/route.ts')).toBe('route')
  expect(structureKindOf('package.json')).toBe('deps')
  expect(structureKindOf('.env.local')).toBe('env')
  expect(structureKindOf('next.config.ts')).toBe('config')
  expect(structureKindOf('lib/a.ts')).toBe(null)
})

test('ストリーミング中の JSON から file_path と本文を取り出す', async () => {
  const json = JSON.stringify({ file_path: '/p/a.ts', old_string: 'x', new_string: 'line1\nline2' })
  expect(extractDraft(json.slice(0, 30))).toEqual({ path: '/p/a.ts', text: null, field: null })
  const mid = extractDraft(json.slice(0, 55))
  expect(mid.field).toBe('new_string')
  expect(mid.text).toBe('l')
  expect(extractDraft(json).text).toBe('line1\nline2')
  expect(extractDraft(JSON.stringify({ command: 'ls -la' })).field).toBe('command')
  expect(decodePartialJsonString('abc\\u00e9\\u00').text).toBe('abcé')
  expect(decodePartialJsonString('x\\').text).toBe('x')
  expect(tailLines('a\nb\nc', 2)).toEqual(['b', 'c'])
})

test('依存:import の解決、exports、dependents、増えた辺', async () => {
  const files = new Set(['app/api/route.ts', 'lib/validation.ts', 'lib/db.ts', 'lib/index.ts', 'src/util/x.ts'])
  const a = analyze('app/api/route.ts', "import { z } from 'zod'\nimport { S } from '../../lib/validation'\nimport db from '@/lib/db'\nimport * as lib from '../../lib'\nexport const GET = () => 1\nexport { helper as h }\nexport default GET\n", files)
  expect(a.imports).toEqual(['lib/validation.ts', 'lib/db.ts', 'lib/index.ts'])
  expect(a.packages).toEqual(['zod'])
  expect(a.exports).toEqual(['GET', 'h', 'default'])
  expect(resolveImport('./util/x.js', 'src/index.ts', files, 'ts')).toBe('src/util/x.ts')
  expect(resolveImport('next/server', 'app/x.ts', files, 'ts')).toBe(null)
  expect(parseImports('from .mod import f\nimport os.path', 'py')).toEqual(['.mod', 'os.path'])
  expect(parseExports('def f():\n    pass\nclass Foo:\n    pass\ndef _p():\n    pass', 'py')).toEqual(['f', 'Foo'])
  const b = analyze('lib/validation.ts', "import { z } from 'zod'\nexport const S = 1", files)
  expect(dependentsOf({ [a.rel]: a, [b.rel]: b }, 'lib/validation.ts')).toEqual(['app/api/route.ts'])
  expect(addedEdgesBetween(undefined, b)).toEqual(['lib/validation.ts→zod'])
  expect(addedEdgesBetween(b, { ...b, packages: ['zod', 'valibot'] })).toEqual(['lib/validation.ts→valibot'])
  expect(moduleOf('app/api/leads/route.ts')).toBe('app/api')
  expect(moduleOf('package.json')).toBe('(root)')
})

test('Bash:ヒアドキュメントの書き込み(両方の順)、要約、出力の末尾、パスの解決', async () => {
  const cmd = "cd /x && cat > hooks/a.ts <<'EOF'\nexport const a = 1\nEOF\ncat >> notes.md <<EOF\nmore\nEOF\ncat <<'EOF' > b.txt\nbee\nEOF\necho done"
  expect(parseHeredocWrites(cmd)).toEqual([
    { path: 'hooks/a.ts', content: 'export const a = 1', isAppend: false },
    { path: 'notes.md', content: 'more', isAppend: true },
    { path: 'b.txt', content: 'bee', isAppend: false },
  ])
  expect(summarizeCommand('cd /x && npm test -- --watch', 80)).toBe('npm test -- --watch')
  expect(summarizeCommand('# comment\nls -la\npwd', 80)).toBe('ls -la')
  expect(tailOutput('a\n\nb\nc', 2)).toEqual(['b', 'c'])
  expect(resolveShellPath('x/y.ts', '/cwd', '/home/u')).toBe('/cwd/x/y.ts')
  expect(resolveShellPath('~/z', '/cwd', '/home/u')).toBe('/home/u/z')
  expect(resolveShellPath('/abs', '/cwd', '/home/u')).toBe('/abs')
})
