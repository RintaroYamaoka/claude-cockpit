"""日本語 → Kokoro の音素。読みは OpenJTalk(漢字・数の読みが正確)、音素の形は misaki の cutlet(Kokoro が学習した形)。"""
import re, pyopenjtalk
from misaki import ja
_c=ja.JAG2P()
PUNCT={'、':',','。':'.','？':'?','！':'!',',':',','.':'.','?':'?','!':'!'}
def kana(text):
    out=[]
    for w in pyopenjtalk.run_frontend(text):
        s=w['string']; p=w['pron'].replace('’','')
        if s in PUNCT: out.append(('p',s)); continue
        if w['mora_size']>0:
            # アクセント句の続き(chain_flag)と長音はくっつける。切れ目を入れると間が空く
            if out and out[-1][0]=='w' and (w.get('chain_flag')==1 or p.startswith('ー')):
                out[-1]=('w',out[-1][1]+p)
            else: out.append(('w',p))
    r=''
    for k,v in out:
        r+= v if k=='p' else (' ' if r and r[-1] not in '、。？！' else '')+v
    return r.strip()
def phon(text):
    return _c(kana(text))[0].strip()
if __name__=='__main__':
    import sys
    for s in sys.argv[1:]:
        print(kana(s)); print(phon(s))
