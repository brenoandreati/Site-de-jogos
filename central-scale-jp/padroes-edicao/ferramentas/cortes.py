"""Plano (trechos em segundos do bruto) -> clipes que nunca cortam palavra.
Cada trecho vai do começo da 1a palavra ao fim da última (pela transcrição), com folga,
limitada pelas palavras vizinhas que não entram. Só tira silêncio longo (> 0,6 s) de dentro."""
import json,sys,wave,numpy as np
plano=json.load(open(sys.argv[1]));wav=sys.argv[2];palavras=[p for s in json.load(open(sys.argv[4]))[sys.argv[5]] for p in s['palavras']]
w=wave.open(wav);sr=w.getframerate();a=np.frombuffer(w.readframes(w.getnframes()),dtype=np.int16).astype(np.float32)/32768
hop=int(sr*0.01);n=len(a)//hop
db=20*np.log10(np.sqrt(np.mean(a[:n*hop].reshape(n,hop)**2,axis=1))+1e-9);piso=np.percentile(db,10);lim=-55
PRE,POS,GAP=0.15,0.22,0.45
def trecho(t0,t1):
    dentro=[p for p in palavras if p[0]>=t0-0.1 and p[1]<=t1+0.1]
    ini=min([t0]+[p[0] for p in dentro]);fim=max([t1]+[p[1] for p in dentro])
    antes=[p[1] for p in palavras if p[1]<=ini-0.05 and p not in dentro];depois=[p[0] for p in palavras if p[0]>=fim+0.05 and p not in dentro]
    a0=max(ini-PRE,(max(antes)+0.03) if antes else 0);a1=min(fim+POS,(min(depois)-0.03) if depois else fim+POS)
    # silêncio longo dentro do trecho (fora das palavras) vira corte
    cortes=[[a0,a1]]
    i0,i1=int(a0*100),int(a1*100);quiet=db[i0:i1]<lim;k=0
    out=[];s=a0;run=None
    for j,q in enumerate(quiet):
        t=(i0+j)/100
        if q and run is None:run=t
        if (not q or j==len(quiet)-1) and run is not None:
            if t-run>GAP:
                out.append([s,run+0.18]);s=t-0.12
            run=None
    out.append([s,a1]);return [c for c in out if c[1]-c[0]>0.15]
clipes=[]
def add(span,bloco,papel):
    for c in trecho(*span):clipes.append({"ini":round(c[0],3),"fim":round(c[1],3),"bloco":bloco,"papel":papel})
add(plano["abertura"],"abertura","abertura")
for i,p in enumerate(plano["perguntas"]):
    add(p["q"],i,"pergunta");add(p["a"],i,"resposta")
add(plano["cta"],"cta","cta")
# trechos vizinhos no bruto: encontram-se no meio da pausa, sem repetir fala
for k in range(1,len(clipes)):
    p,c=clipes[k-1],clipes[k]
    if p["ini"]<c["ini"]<p["fim"]:
        ult=[w for w in palavras if w[1]<=c["ini"]+0.25 and w[0]>=p["ini"]];prox=[w for w in palavras if w[0]>=p["fim"]-0.3 and w[0]<=c["fim"]]
        a=max([w[1] for w in palavras if w[1]<=(p["fim"]+c["ini"])/2+0.05] or [c["ini"]]);b=min([w[0] for w in palavras if w[0]>=a-0.01] or [p["fim"]])
        m=round((a+b)/2,3) if b>a else round((p["fim"]+c["ini"])/2,3)
        p["fim"]=m;c["ini"]=m
# duração de cada clipe em quadros inteiros (30 fps): som e imagem com a mesma duração
t=0
for c in clipes:
    q=max(1,round((c["fim"]-c["ini"])*30));c["quadros"]=q;c["fim"]=round(c["ini"]+q/30,4);c["out"]=round(t,4);t+=q/30
json.dump({"clipes":clipes,"total":round(t,3)},open(sys.argv[3],"w"),indent=1)
print(f"{len(clipes)} clipes, {t:.1f} s")
for c in clipes:print(f"  {c['bloco']!s:9} {c['papel']:9} {c['ini']:6.2f}-{c['fim']:6.2f}")
