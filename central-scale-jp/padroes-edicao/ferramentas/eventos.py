"""Converte o plano + cortes em eventos no tempo de saída (para os elementos e os ticks)."""
import json,sys
pl=json.load(open(sys.argv[1]));co=json.load(open(sys.argv[2]));cl=co['clipes']
def out(ts):
    for c in cl:
        if c['ini']-0.05<=ts<=c['fim']+0.05:return c['out']+max(0,ts-c['ini'])
    best=min(cl,key=lambda c:abs(c['ini']-ts));return best['out']
def bloco(b):
    cs=[c for c in cl if str(c['bloco'])==str(b)];return cs
ab=bloco('abertura');abfim=ab[-1]['out']+ab[-1]['fim']-ab[-1]['ini']
blocos=[];legs=[];ticks=[]
ps=pl['perguntas']
for i,p in enumerate(ps):
    cs=bloco(i);ini=cs[0]['out'];nxt=bloco(i+1) if i+1<len(ps) else bloco('cta');fim=nxt[0]['out']
    resp=[c for c in cs if c['papel']=='resposta'][0];marca=resp['out']+0.06
    blocos.append({'i':i,'tipo':'q','ini':ini,'fim':fim,'ops':p['ops'],'r':p['r'],'marca':marca});ticks.append(marca)
    if p.get('leg'):
        L=p['leg']
        for k,(txt,ts) in enumerate(L):
            a=out(ts);b=out(L[k+1][1]) if k+1<len(L) else fim-0.05
            legs.append({'txt':txt,'ini':round(a,3),'fim':round(b,3)})
cta=bloco('cta');blocos.append({'i':'f','tipo':'fecho','ini':cta[0]['out'],'fim':co['total']+1})
ev={'formato':pl['formato'],'tema':pl['tema'],'fecho':pl['fecho'],'abertura':{'fim':abfim},'blocos':blocos,'legendas':legs,'ticks':ticks,'total':co['total']}
json.dump(ev,open(sys.argv[3],'w'),ensure_ascii=False,indent=1);print('eventos ok',len(blocos),'blocos',len(legs),'legendas')
