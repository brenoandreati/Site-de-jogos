"""Leva a transcrição original para o tempo do vídeo com J-Cut: mesmo texto (onde as marcas foram ancoradas), tempos do vídeo novo.
Uso: mapear.py original.trans.json jcut.trans.json saida.json"""
import json,sys,difflib,unicodedata,re
O=json.load(open(sys.argv[1]));J=json.load(open(sys.argv[2]))
def n(s):
    s=unicodedata.normalize('NFD',s.lower());return re.sub(r'[^a-z0-9]','',''.join(c for c in s if not unicodedata.combining(c)))
wo=[w for s in O for w in s['palavras']];wj=[w for s in J for w in s['palavras']]
m={}
for a,b,k in difflib.SequenceMatcher(None,[n(w[2]) for w in wo],[n(w[2]) for w in wj],autojunk=False).get_matching_blocks():
    for i in range(k):m[a+i]=b+i
idx=sorted(m)
def novo(i,t):
    if i in m:return None
    # desloca pelo par casado mais próximo
    import bisect;p=bisect.bisect_left(idx,i);c=[x for x in (idx[p-1] if p>0 else None,idx[p] if p<len(idx) else None) if x is not None]
    r=min(c,key=lambda x:abs(x-i));return t+(wj[m[r]][0]-wo[r][0])
saida=[];k=0
for s in O:
    P=[]
    for w in s['palavras']:
        if k in m:a,b=wj[m[k]][0],wj[m[k]][1]
        else:d=novo(k,0);a,b=w[0]+d,w[1]+d
        P.append([round(a,2),round(max(b,a+0.03),2),w[2]]);k+=1
    if P:saida.append({'ini':P[0][0],'fim':P[-1][1],'texto':s['texto'],'palavras':P})
# mantém a ordem dos tempos
u=-1
for s in saida:
    for p in s['palavras']:
        if p[0]<u:p[0]=u
        if p[1]<p[0]+0.03:p[1]=round(p[0]+0.03,2)
        u=p[0]
json.dump(saida,open(sys.argv[3],'w'),ensure_ascii=False)
print(f'{len(m)}/{len(wo)} palavras casadas')
