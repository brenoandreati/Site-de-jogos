"""Transforma o plano (trechos em segundos do bruto) em clipes ajustados pela energia do áudio."""
import json,sys,wave,numpy as np
plano=json.load(open(sys.argv[1]));wav=sys.argv[2]
w=wave.open(wav);sr=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
hop=int(sr*0.01);n=len(a)//hop
rms=np.sqrt(np.mean(a[:n*hop].reshape(n,hop)**2,axis=1))+1e-9;db=20*np.log10(rms)
piso=np.percentile(db,10);lim=max(piso+14,-45)
def voz(t0,t1,gap=0.30):
    i0,i1=int(t0*100),int(t1*100);v=db[i0:i1]>lim;reg=[];ini=None
    for k,on in enumerate(v):
        if on and ini is None:ini=k
        if not on and ini is not None:reg.append([ini,k]);ini=None
    if ini is not None:reg.append([ini,len(v)])
    m=[]
    for r in reg:
        if m and (r[0]-m[-1][1])/100<gap:m[-1][1]=r[1]
        else:m.append(r)
    m=[r for r in m if (r[1]-r[0])>=6]
    return [[max(t0-0.04,(i0+r[0])/100-0.07),min(t1+0.06,(i0+r[1])/100+0.10)] for r in m] or [[t0,t1]]
clipes=[]
def add(span,bloco,papel):
    cs=voz(*span);cs[-1][1]=max(cs[-1][1],span[1]-0.02)
    for c in cs:clipes.append({"ini":round(c[0],3),"fim":round(c[1],3),"bloco":bloco,"papel":papel})
add(plano["abertura"],"abertura","abertura")
for i,p in enumerate(plano["perguntas"]):
    add(p["q"],i,"pergunta");add(p["a"],i,"resposta")
add(plano["cta"],"cta","cta")
t=0
for c in clipes:
    c["out"]=round(t,3);t+=c["fim"]-c["ini"]
json.dump({"clipes":clipes,"total":round(t,3),"limiar_db":round(float(lim),1)},open(sys.argv[3],"w"),indent=1)
print(f"{len(clipes)} clipes, {t:.1f} s, limiar {lim:.1f} dB")
for c in clipes:print(f"  {c['bloco']!s:9} {c['papel']:9} {c['ini']:6.2f}-{c['fim']:6.2f} ({c['fim']-c['ini']:.2f}s) -> {c['out']:.2f}")
