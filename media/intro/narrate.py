#!/usr/bin/env python3
"""narrate.py ― 台本 → Kokoro(jf_alpha)で声 → 声の長さに合わせて場面の時間軸を伸ばす →
src/scenes-timed/*.html(build.mjs が読む)・index.html・assets/mix.wav(声+効果音+BGM)を作る。
使い方: VENV_PY narrate.py   (VENV_PY = ~/dev/propagate/_wt/adnavi-explainer/.venv/bin/python。numpy/soundfile/kokoro_onnx 入り)"""
import re, os, json, subprocess, sys, glob
import numpy as np, soundfile as sf
ROOT=os.path.dirname(os.path.abspath(__file__)); os.chdir(ROOT)
PY=sys.executable
SPEED='1.16'; PAD=0.45; LEAD=0.1
SR=48000

# 場面: (id, 旧の尺, アンカー[(旧時刻, 台本 or None)])  None = 字幕が消える点(その区間は伸ばさない)
SC=[
 ('hook',8,[(0.6,'リーズ API の入力検証を zod にして、と頼んだ。あとは、トランスクリプトが流れていく。'),(3.2,None),
            (3.5,'でも、今どのファイルを触っていて、どの行が変わって、何に効くのかは、ここからは読めない。'),(7.6,None)]),
 ('reveal',7,[(0.3,'同じ作業を、右に計器盤を付けて見直す。'),(2.4,None),
              (2.8,'コックピット。左の Claude Code は素のまま。設定は無い。まだ何も触っていないので、計器は空。'),(6.6,None)]),
 ('first',10,[(0.6,'まず Bash。コマンドと、その出力が、そのまま本文に入る。終了コードが印になる。'),(3.8,None),
              (5.0,'次に Write。流れるところは後でゆっくり見る。確定した画面を、上から読む。'),(9.6,None)]),
 ('deps',30,[(0.4,'一段目。今触っているファイル。ターン中は三角が点滅する。右に、外へ公開している名前、エクスポート。'),(6.0,None),
             (6.4,'二段目、インポート。このファイルが使っているもの。モジュールはディレクトリ二段、パッケージは薄い色。'),(11.4,None),
             (11.8,'プラスは、このセッションで増えた依存。zod を足したのは AI で、私は頼んでいない。足した瞬間に、ここで分かる。'),(17.6,None),
             (18.0,'三段目、ディペンデンツ。このファイルを使っているファイルの数と場所。変更の影響範囲。誰も使っていなければ、エントリポイントか未参照、と出る。'),(25.0,None),
             (25.4,'route から使われている。だから次に AI が route を触るのは、読める。'),(29.6,None)]),
 ('body',26,[(0.4,'罫の下。意図の行は、モデルが今書いている文章の一行目。何のために、が常に見える。'),(5.0,None),
             (5.4,'見出し。ファイル、変更位置に一番近い宣言名、時刻。右端は、見えていない行数。'),(10.4,None),
             (10.8,'本文は、確定したら本当の差分。Write でも Edit でも、前後のテキストから行差分を取るので、変わった行と前後二行だけ。'),(16.6,None),
             (17.0,'結果の行。増えた行と減った行。その右に、編集した直後に裏で回したチェック。型チェック、関連テスト、リント。所要時間つき。回せるものが無いプロジェクトなら、チェック、とだけ出る。'),(25.6,None)]),
 ('stream',36,[(0.4,'AI が次の編集を始めた。書かれている最中のコードが、行番号つきで流れる。最後の行だけ明るい。見出しは、ストリーミング中、何行、と数える。'),(7.0,None),
               (7.4,'確定した。見出しに、ルーティング、と付いた。構造に効く変更の種類は六つ。スキーマ、依存関係、ルーティング、環境変数、設定、新規。入口を触った、と一目で分かる。'),(15.6,None),
               (16.0,'結果。型チェックは通った。テストは、落ちた。一行目、ゾッドエラー。トランスクリプトの Update の行には、何も出ていない。'),(22.6,None),
               (23.0,'差分が長ければ、ジェイとケーでスクロール。見出しの矢印が、見えていない行数。'),(28.0,None),
               (28.4,'AI は自分で直しにいく。セーフパースに変えて、緑。'),(33.6,None)]),
 ('history',28,[(0.4,'下の三行が履歴。新しいものが上。一行の読み方は、印、時刻、ツール名、ファイル、宣言名、増減。印は、通った、落ちた、実行中、回せない。三角は今映しているもの。リバート済みなら、戻る矢印。'),(11.0,None),
                (11.4,'行を押すと、その時の画面に戻る。落ちた時の本文と、結果と、依存。'),(16.0,None),
                (16.4,'もう一つ前も。'),(18.6,None),
                (19.0,'見ている間に新しい変更が来ても、画面は動かない。罫に、上に一件、とだけ出る。'),(25.6,None)]),
 ('agent',14,[(0.4,'エルで最新へ。来ていたのは、サブエージェントが書いた変更。'),(5.4,None),
              (5.8,'サブエージェントの変更も同じように流れて、見出しと履歴に矢印が付く。並列で動いていれば、今まさに書いているものが映る。意図の行は、本体の文章だけ。'),(13.0,None)]),
 ('ops',30,[(0.4,'操作は二つ。オーで、今映している変更を VS Code で開く。プロジェクトのフォルダをワークスペースとして開き、その中でファイルを変更位置の行に。WSL なら、Windows 側の VS Code がリモートで開く。'),(9.0,None),
            (9.4,'アールは、直前の変更を戻す。三秒以内に二回。プロンプトから、大なり リバート、と打っても同じ。'),(14.4,None),
            (14.8,'戻したことは Claude にも伝わる。意図的な判断、別の方法が要るか人に聞く、と。決めるのは人。'),(20.6,None),
            (21.0,'止めるのは Claude Code 自身のエスケープ。キーはペインがキーボードを持っている間だけ効く。スラッシュ コックピットと打つか、ペインをクリック。'),(27.6,None)]),
 ('colors',16,[(0.4,'色の規則は四つ。今、はアクセント一色。三角と、ストリーミング中の見出し。状態は、緑、赤、黄。層は四つの色相で、モジュール名だけ。入口は青、ロジックは青緑、データは紫、それ以外は灰。あとは本文色と薄色の二段。'),(15.4,None)]),
 ('end',8,[(0.6,'AI に書かせても、何が起きているか分かる。自分のコードのまま。計器は四つ、操作は二つ。プラグイン インストール、コックピット。'),(8.0,None)]),
]
FILES={re.sub(r'^\d+-','',os.path.basename(f))[:-5]:f for f in glob.glob('src/scenes/*.html')}

# 1) 声
lines=[]
for sid,dur,anc in SC:
    for i,(t0,txt) in enumerate(anc):
        if txt: lines.append(dict(id=f'{sid}_{i:02d}',tts=txt))
json.dump(lines,open('_lines.json','w'),ensure_ascii=False,indent=0)
subprocess.run(['timeout','900',PY,'tools/synth.py','_lines.json','_vo',SPEED],check=True)
VD={l['id']:sf.info(f"_vo/{l['id']}.wav").duration for l in lines}

# 2) 時間軸の写像(区間ごと・伸ばすだけ)
def build_map(anc,end,sid):
    times=[a[0] for a in anc]+[end]; pts=[(0.0,0.0),(times[0],times[0])]; cur=times[0]
    for i,(t0,txt) in enumerate(anc):
        old=times[i+1]-t0; need=(VD[f'{sid}_{i:02d}']+LEAD+PAD) if txt else 0
        cur+=max(old,need); pts.append((times[i+1],cur))
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    def m(t):
        if t>=xs[-1]: return t+(ys[-1]-xs[-1])
        return float(np.interp(t,xs,ys))
    return m, ys[-1]
NUM=r'(\d+(?:\.\d+)?)'
P1=re.compile(r'\b(words|unwords|show|hide|rise|pop|swapIn|swapOut|press|flip|keys|unkeys|typeIn|pick|swapTo|label|unlabel|scrollTo|unfocusRows)\(("[^"]*"|\[[^\]]*\]),\s*'+NUM)
P2=re.compile(r'\bblink\(("[^"]*"|\[[^\]]*\]),\s*'+NUM+r',\s*'+NUM)
P3=re.compile(r'(tl\.(?:to|fromTo|set)\((?:[^()]|\([^()]*\))*?\},\s*)'+NUM+r'(\))')
P4=re.compile(r'(\bfocusRows\("[^"]*",\s*\[[^\]]*\],\s*)'+NUM)
def fmt(x): return ('%.3f'%x).rstrip('0').rstrip('.') or '0'
NEW={}; cur=0.0; VOICE=[]
os.makedirs('src/scenes-timed',exist_ok=True)
for f in glob.glob('src/scenes-timed/*.html'): os.remove(f)
for sid,dur,anc in SC:
    m,new_end=build_map(anc,dur,sid); new_end=round(new_end,2)
    src=open(FILES[sid],encoding='utf-8').read(); markup,script=src.split('<!--SCRIPT-->')
    markup=re.sub(r'(class="stage clip" data-start="0" data-duration=")[\d.]+(")',lambda g:g.group(1)+fmt(new_end)+g.group(2),markup,count=1)
    out=[]
    for ln in script.split('\n'):
        ln=P1.sub(lambda g:f'{g.group(1)}({g.group(2)},{fmt(m(float(g.group(3))))}',ln)
        ln=P2.sub(lambda g:f'blink({g.group(1)},{fmt(m(float(g.group(2))))},{fmt(m(float(g.group(3))))}',ln)
        ln=P3.sub(lambda g:g.group(1)+fmt(m(float(g.group(2))))+g.group(3),ln)
        ln=P4.sub(lambda g:g.group(1)+fmt(m(float(g.group(2)))),ln)
        out.append(ln)
    open(f'src/scenes-timed/{os.path.basename(FILES[sid])}','w',encoding='utf-8').write(markup+'<!--SCRIPT-->'+'\n'.join(out))
    NEW[sid]=dict(start=round(cur,2),dur=new_end,map=m)
    for i,(t0,txt) in enumerate(anc):
        if txt: VOICE.append((f'{sid}_{i:02d}',round(cur+m(t0)+LEAD,3)))
    print(f'{sid:7s} {dur:5.1f} -> {new_end:6.2f}  start {cur:7.2f}',flush=True); cur=round(cur+new_end,2)
TOTAL=round(cur,2); print('TOTAL',TOTAL,round(TOTAL/60,2),'min')

# 3) 効果音:press → key、pop → pop、大きな遷移に whoosh(旧時刻)
WHOOSH={'reveal':[0.5,1.3],'first':[7.4],'stream':[7.4,29.2],'history':[12.95,17.2],'ops':[2.0,8.2],'end':[0.3]}
CLICK={'history':[12.8,17.05]}
SFX=[]
for sid,dur,anc in SC:
    src=open(FILES[sid],encoding='utf-8').read().split('<!--SCRIPT-->')[1]; m=NEW[sid]['map']; st=NEW[sid]['start']
    for g in re.finditer(r'\bpress\(("[^"]*"),\s*'+NUM,src): SFX.append(('assets/audio/key.mp3',st+m(float(g.group(2))),.45))
    for g in re.finditer(r'\bpop\(("[^"]*"),\s*'+NUM,src): SFX.append(('assets/audio/pop.mp3',st+m(float(g.group(2))),.4))
    for t in WHOOSH.get(sid,[]): SFX.append(('assets/audio/whoosh.mp3',st+m(t),.5))
    for t in CLICK.get(sid,[]): SFX.append(('assets/audio/key.mp3',st+m(t),.6))
json.dump([dict(src=a,at=round(t,3),vol=v) for a,t,v in sorted(SFX,key=lambda x:x[1])],open('_sfx.json','w'),indent=0)
print('sfx',len(SFX))

# 4) ミックス:声 −16 dBFS RMS / BGM −20 dBFS・声の下で −55 % / 効果音
N=int((TOTAL+1)*SR)
def load(path):
    tmp=f'_vo/_{os.path.basename(path)}.wav'
    if not os.path.exists(tmp): subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-i',path,'-ac','1','-ar',str(SR),tmp],check=True)
    x,_=sf.read(tmp,dtype='float32'); return x
def place(buf,x,t,g=1.0):
    i=int(t*SR); x=x[:max(0,N-i)]; buf[i:i+len(x)]+=x*g
voice=np.zeros(N,dtype='float32')
for vid,t in VOICE:
    v,sr=sf.read(f'_vo/{vid}.wav',dtype='float32')
    if v.ndim>1: v=v.mean(axis=1)
    m_=int(len(v)*SR/sr); v=np.interp(np.linspace(0,len(v)-1,m_),np.arange(len(v)),v).astype('float32')
    place(voice,v,t)
voice*=10**(-16/20)/max(1e-6,float(np.sqrt(np.mean(voice[np.abs(voice)>1e-3]**2))))
fx=np.zeros(N,dtype='float32')
for s,t,v in SFX: place(fx,load(s),t,v)
mus=load('assets/audio/drift-minimal-podcastac-ccby.mp3'); fade=4*SR
w=np.ones(len(mus),dtype='float32'); w[:fade]=np.linspace(0,1,fade); w[-fade:]=np.linspace(1,0,fade)
bed=np.zeros(N,dtype='float32'); i=0
while i<N:
    a=(mus*w)[:max(0,N-i)]; bed[i:i+len(a)]+=a; i+=len(mus)-fade
bed*=10**(-20/20)/max(1e-6,float(np.sqrt(np.mean(bed**2))))
hop=SR//10; env=np.array([float(np.abs(voice[p:p+hop]).max())>.01 for p in range(0,N,hop)],dtype='float32')
env=np.convolve(env,np.ones(5)/5,'same'); duck=np.interp(np.arange(N),np.arange(len(env))*hop,1-.55*env).astype('float32')
end=int(TOTAL*SR); f_=np.ones(N,dtype='float32'); f_[end-2*SR:end]=np.linspace(1,0,2*SR); f_[end:]=0
mix=voice+bed*duck*f_*.7+fx
pk=float(np.abs(mix).max()); mix=mix*min(1,.89/pk)
sf.write('assets/mix.wav',mix[:end],SR,subtype='PCM_16'); print('mix.wav peak',round(pk,3))

# 5) index.html
hosts='\n'.join(f'      <div id="{sid}" data-composition-id="{sid}" data-composition-src="compositions/{sid}.html" data-start="{NEW[sid]["start"]}" data-duration="{NEW[sid]["dur"]}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>' for sid,_,_ in SC)
head=open('index.html',encoding='utf-8').read().split('<div id="root"')[0]
open('index.html','w',encoding='utf-8').write(head+f'''<div id="root" data-composition-id="main" data-start="0" data-duration="{TOTAL}" data-width="1920" data-height="1080" data-fps="30">
      <div id="bg"></div>
{hosts}
      <audio id="mix" src="assets/mix.wav" data-start="0" data-duration="{TOTAL}" data-track-index="3" data-volume="1"></audio>
    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({{ paused: true }});
    </script>
  </body>
</html>
''')
json.dump(dict(total=TOTAL,scenes={s:dict(start=NEW[s]['start'],dur=NEW[s]['dur']) for s,_,_ in SC},voice=VOICE),open('_timing.json','w'),ensure_ascii=False,indent=1)
print('index.html written')
