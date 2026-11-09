GOAL:    見終わった人が「右に 1 枚の計器盤。流れるコード・差分、依存、チェック、履歴。o と r」を言えて、install の 1 行を打つ
OUTPUT:  HyperFrames, 1920 x 1080, 30 fps
TIME:    約 70 s x 30(ナレーションの長さで narrate.py が伸ばす)。BPM なし。字幕は日本語 1 行 ≤ 24 字 + 英語 1 行
LOOK:    地 #e9e6df(質感なし)。墨 #1b1b1f。字幕の強調 #c2410c 一色
         端末窓:x120 y72 w1680 h760 r14、bg #1e1e2e、影 0 24px 60px rgba(0,0,0,.28)、タイトルバー 40px(#11111b)
         窓の中:JetBrains Mono 20px / 行 30px(24 行)。左 = Claude Code の transcript 924px(55%)、縦罫 1px #45475a、右 = cockpit 755px(45%。実物の上限と同じ。60 列 − 右余白 2 = 58 列、pane.tsx の fit で切り詰める)
         cockpit の色の規則(palette.ts のまま):「今」#d97757(▶・ストリーミング中・▸)/ 状態 ✓ #a6e3a1 ✗ #f38ba8 警告 #f9e2af /
         層 app #5b9cf6・lib #2cb8a6・db #a97cf0・他 #8b93a1 / それ以外は本文 #cdd6f4 と薄 #7f849c
         字幕:Noto Sans JP 700 46px x120 y884 左寄せ。英語:Noto Sans JP 500 26px y960 #4a4a52。キー chip:JetBrains Mono 34px 右寄せ y892
OBJECTS: 端末窓(3 点+タイトル「leads-api — claude」)/ transcript の行(⏺ ⎿ ✻ > と点滅カーソル)/ cockpit の段:
         r0-2 依存 3 行(▶ file  exports / imports / dependents)・r3 ┄・r4 ▶ 意図・r5 見出し・r6-15 本文 10 行・r16 └ 結果・r17 ┄・r18-20 履歴 3 行・r21 ┄・r22 操作
         diff(- 赤 + 緑 @@ 薄)/ 行番号付きのストリーミング行(最後の 1 行だけ本文色)/ チェックの印 ⏳ ✓ ✗ / 履歴の ▸ ✓ ✗ ↶ / トースト(VS Code で開きました…)
MOTION:  入り expo.out 0.5 s、窓の分割 power2.inOut 0.6 s、出 power3.in 0.25 s、字幕 blur 8→0 0.2 s で語ごと 0.07 s、
         タイプ 1 行 0.09 s(ストリーミングは行単位)、印の着地 back.out(1.6) 0.35 s、履歴の選択は背景 #313244 を 0.15 s
SHOTS:   hook 7 / reveal 6 / stream 9 / deps 8 / checks 10 / history 9 / ops 9 / end 7(旧尺。1 scene = 1 計器、枠は共通)
BANNED:  黒い虚空に小さな要素 / グロー / 紫青グラデ / 全部フェードイン / 3 枚カード / 箇条書き / 角ラベル・HUD / 動き続けるタイトル / 毎シーン同じ入り /
         作った UI(cockpit の段と文言は pane.tsx の描画そのもの。VS Code は窓を描かず、cockpit の実際のトーストだけ)
QA:      f0 に transcript と「3 additions and 1 removal」/ reveal の最後で左右の分割と cockpit の 4 段の枠 / stream の中ほどで行番号付きの行が増えている /
         deps で `zod+` の + が緑 / checks の中ほどで ✗ テスト と ZodError、最後で ✓ ✓ / history で ▸ が Write の行に移り見出しに「履歴」/
         ops で chip `o` → トースト、`r r` → 見出し「リバート済み」と履歴の ↶ / end に install の 1 行、最後 3 s hold
