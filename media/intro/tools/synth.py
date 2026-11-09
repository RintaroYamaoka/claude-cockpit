#!/usr/bin/env python3
"""使い方: synth.py <lines.json> <out_dir> [speed]   lines.json = [{"id":..., "tts":...}, ...]。同じ文の wav があれば作らない。"""
import sys, json, os, re, hashlib
sys.path.insert(0,os.path.dirname(__file__))
import numpy as np, soundfile as sf
import kokoro_onnx
from g2p import phon
M=os.path.expanduser('~/.cache/hyperframes/tts/models/kokoro-v1.0.onnx')
V=os.path.expanduser('~/.cache/hyperframes/tts/voices/voices-v1.0.bin')
lines=json.load(open(sys.argv[1])); out=sys.argv[2]; speed=float(sys.argv[3]) if len(sys.argv)>3 else 1.0
os.makedirs(out,exist_ok=True)
model=kokoro_onnx.Kokoro(M,V)
for l in lines:
    h=hashlib.sha1((l['tts']+str(speed)).encode()).hexdigest()[:10]
    wav=f"{out}/{l['id']}.wav"; stamp=f"{wav}.{h}"
    if os.path.exists(stamp) and os.path.exists(wav): continue
    p=phon(l['tts'])
    parts=[p] if len(p)<400 else re.split(r'(?<=[,.])\s*',p)
    a=[]
    for q in parts:
        if not q.strip(): continue
        s,sr=model.create(q,voice='jf_alpha',speed=speed,lang='ja',is_phonemes=True)
        a.append(s)
    s=np.concatenate(a); sf.write(wav,s,sr)
    for f in os.listdir(out):
        if f.startswith(l['id']+'.wav.'): os.remove(f'{out}/{f}')
    open(stamp,'w').close()
    print(l['id'],round(len(s)/sr,2),flush=True)
