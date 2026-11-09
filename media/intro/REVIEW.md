# REVIEW ― cockpit 紹介動画(2026-11-09)

## 作った判断
- 採用した筋は A「書く → 見る」(STORYLINES.md)。1 人の作業(leads API の入力検証を zod に)を最初から最後まで追い、計器が 1 つずつ点く。B(計器盤の比喩)と C(r だけ)は作っていない。
- cockpit のペインは pane.tsx の行配分と文言をそのまま描いた(空の状態の文言、`▌ルーティング`、`↑0 ↓4`、`l: 最新へ`、トースト、リバート時に Claude へ送る文まで)。作った UI は無い。VS Code は窓を描かず、cockpit が実際に出すトーストだけ。
- 巻き戻しの装置:hook で transcript に「2 additions and 5 removals」が流れた後、reveal で行を消して窓を割り、同じ作業をもう一度、計器付きで見せる。
- 尺は 92 s。当初の見積り(20〜30 s)より長いが、4 つの計器と 2 つの操作を全部見せる「紹介 + 使い方」として 1 本にまとめた。
- 音:Kokoro jf_alpha の日本語ナレーション(speed 1.12)。字幕は日本語 46px + 英語 26px。BGM は Drift – Minimal(PodcastAC, CC BY)を −20 dB、声の下で −55 %。効果音は key(押下)/ pop(印の着地)/ whoosh(窓の分割・確定・履歴の切替・終わり)。

## 測ったこと / 見ただけのこと
- `hyperframes check`:エラー 0。残した警告:`text_below_floor`(端末の文字 22px < 28px。端末のモックなので固定。スマホ向けではない)、`line_unread`(結果行の variant 切替を 0.07 s と誤計測。フレームでは数秒出ている)、`canvas_overflow`(checks の ┄ 罫。行は overflow hidden で見た目は収まっている)、`contrast`(薄色 #7f849c on #1e1e2e。実際の端末の dim と同じ)。
- 見た:8 拍のフレーム、全継ぎ目の ±0.2 s シート。継ぎ目は全部同じ枠なので飛びは無い。history → ops の継ぎ目だけ状態が飛んでいたので、ops の頭に `l`(最新へ)の押下を足した。
- 音は測っただけで聞いていない(mix.wav peak 0.837、声 −16 dBFS RMS)。

## 弱いところ
- deps の拍:ラベル 3 枚が右端に積まれるだけで、動きが少ない。時間があれば imports → dependents の順に行が点く演出に。
- end:左の列を文字カードにしたが、ペインが右に残るだけで「払い」が弱い。
- ナレーションの「ブイエスコード」「セーフパース」は Kokoro の読みに合わせたカタカナ。聞いて不自然なら台本(narrate.py の SC)を直して再生成。

## 作り直し方
media/intro/README.md を参照。
