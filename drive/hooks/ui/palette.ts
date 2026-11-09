// 色の規則は 4 つだけ。
//   「今」はアクセント 1 色(テーマの claude)。カーソル・ストリーミング・今触っているファイル。
//   状態は意味色 3 つ(テーマの success / error / warning)。✓✗、+/−、終了コード、リバート済み。
//   層は 4 色相、モジュール名だけに塗る。入口 = 青、ロジック = 青緑、データ = 紫、それ以外 = 灰。
//   それ以外は本文色と薄色(dimColor)の 2 段。
// テーマのキーを使うので、ユーザーのライト / ダークに追従する。

export const NOW = 'claude'
export const OK = 'success'
export const FAIL = 'error'
export const WARN = 'warning'

const ENTRY = '#5b9cf6' // 入口:app src pages api routes components ui
const LOGIC = '#2cb8a6' // ロジック:lib core hooks utils shared packages services domain
const DATA = '#a97cf0' // データ:prisma db database migrations supabase drizzle schema models
const OTHER = '#8b93a1' // それ以外(root 直下、scripts、infra、test、docs、パッケージ)

const LAYER: Record<string, string> = {
  app: ENTRY, src: ENTRY, pages: ENTRY, api: ENTRY, routes: ENTRY, components: ENTRY, ui: ENTRY,
  lib: LOGIC, core: LOGIC, hooks: LOGIC, utils: LOGIC, shared: LOGIC, packages: LOGIC, services: LOGIC, domain: LOGIC,
  prisma: DATA, db: DATA, database: DATA, migrations: DATA, supabase: DATA, drizzle: DATA, schema: DATA, models: DATA,
}

/** 層の色。rel は外部ルートの label を剥がした相対パス、またはモジュール名(`app/api`)。 */
export function layerColor(rel: string): string {
  const top = rel.split('/')[0] ?? ''
  return LAYER[top] ?? OTHER
}

export function moduleColor(module: string): string {
  return layerColor(module)
}
