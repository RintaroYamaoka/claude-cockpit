# cockpit 紹介動画(HyperFrames)

`../../README.md` に載せる動画のソース。HTML を 1 フレームずつ描いて動画にする(HyperFrames)。

```
node src/gen.mjs                                  # src/scenes/*.html(各 scene の markup + GSAP script)を生成
<venv>/bin/python narrate.py                      # 台本 → 声(Kokoro jf_alpha)→ 声の長さに場面を伸ばす → src/scenes-timed, index.html, assets/mix.wav
SCENES=src/scenes-timed node build.mjs            # compositions/*.html(chrome.css + lib.js を inline)
npx hyperframes@0.9.26 check --json
npx hyperframes@0.9.26 render --output out/cockpit-intro.mp4
```

- `<venv>` は kokoro_onnx / pyopenjtalk / misaki / soundfile / numpy の入った Python(Herdr 動画と同じ `adnavi-explainer/.venv`)。モデルは `~/.cache/hyperframes/tts/`。
- 台本と場面の尺は `narrate.py` の `SC`。字幕と画面の中身は `src/gen.mjs`。見た目の数字は `SPEC.md`。
- ペインの描き方は `cockpit/hooks/ui/pane.tsx` の行配分(依存 3・罫・意図・見出し・本文 10・結果・罫・履歴 3・罫・操作)をそのまま。文言を変えたら動画も直す。
- 音源:Drift – Minimal / PodcastAC(CC BY)、効果音 3 つ(`assets/audio/`)。
