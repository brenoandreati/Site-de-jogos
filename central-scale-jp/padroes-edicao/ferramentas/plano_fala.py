"""Padrão fala direta (vídeo já cortado): marcas + transcrição -> cortes.json (blocos de zoom) e eventos.json
(título, cartões, legenda em frases, CTA, ticks). Uso: plano_fala.py marcas.json transcricao.json duracao cortes.json eventos.json"""
import json,sys,re,unicodedata
M=json.load(open(sys.argv[1]));T=json.load(open(sys.argv[2]));dur=float(sys.argv[3])
PULAR=[tuple(x) for x in M.get('pular',[])]
dentro=lambda t:any(a<=t<=b for a,b in PULAR)
W=[w for s in T for w in s['palavras'] if not dentro(w[0])]
def norm(s):return unicodedata.normalize('NFC',s).lower().strip('.,?!:;')
def w_at(txt,depois=0):
    for w in W:
        if w[0]>=depois-0.01 and norm(w[2])==norm(txt):return w
    raise SystemExit(f'não achei "{txt}" depois de {depois}')
F=lambda t:round(round(t*30)/30,4)
fim_ant=lambda w:max([x[1] for x in W if x[1]<=w[0]+0.01] or [0])
corte=lambda w:F((fim_ant(w)+w[0])/2) if w[0]>0.05 else 0.0
# ---- blocos (troca de zoom) -> clipes contínuos
pts=[0.0];d=0
for a in M['blocos'][1:]:
    w=w_at(a,d);pts.append(corte(w));d=w[1]
pts.append(F(dur-0.02))
clipes=[];o=0.0
for k in range(len(pts)-1):
    pedacos=[(pts[k],pts[k+1])]
    for a,z in PULAR:
        novo=[]
        for x,y in pedacos:
            if z<=x or a>=y:novo.append((x,y));continue
            if a>x:novo.append((x,F(a)))
            if z<y:novo.append((F(z),y))
        pedacos=novo
    for x,y in pedacos:
        q=round((y-x)*30)
        if q<=0:continue
        clipes.append({'ini':x,'fim':round(x+q/30,4),'bloco':k,'papel':'fala','quadros':q,'out':round(o,4)});o+=q/30
total=round(o,4)
def out(ts):
    for c in clipes:
        if c['ini']-0.05<=ts<=c['fim']+0.05:return round(c['out']+max(0,ts-c['ini']),3)
    return min(clipes,key=lambda c:abs(c['ini']-ts))['out']
# ---- título
ab=M['abertura'];tf=out(w_at(ab['ate'])[1]+0.3) if ab.get('ate') else 2.8
abertura={'rotulo':ab['rotulo'],'titulo':ab['titulo'],'fim':tf}
# ---- cartões
cards=[];ticks=[];ocultos=[];d=0
for c in M.get('cartoes',[]):
    w0=w_at(c['de'],d);d=max(w0[1],w0[0]+0.03);ini=out(max(0,w0[0]-0.1));e=dict(c);e['ini']=ini;dd=w0[0]
    its=[]
    for it in c.get('itens',[]):
        wi=w_at(it[1],dd);dd=wi[0]+0.01;x={'t':it[0],'ini':out(wi[0]-0.05)}
        if len(it)>2:x['sub']=it[2]
        its.append(x);ticks.append(x['ini'])
    if its:e['itens']=its
    for chave in ('rodape','pill'):
        if c.get(chave):wr=w_at(c[chave][1],dd);e[chave]={'t':c[chave][0],'ini':out(wr[0]-0.05)};ticks.append(e[chave]['ini'])
    if c.get('ate')=='fim' or not c.get('ate'):e['fim']=total+1
    else:wa=w_at(c['ate'],dd);e['fim']=out(max(0,wa[0]-0.12))
    if c['tipo']=='prompt':  # o texto vai sendo digitado enquanto ele fala
        wz=w_at(c['digita_ate'],dd) if c.get('digita_ate') else None
        e['dig_ini']=ini+0.35;e['dig_fim']=out(wz[1]) if wz else e['fim']-0.6
    if c['tipo'] in ('cta',):ticks.append(ini)
    if c.get('ocultar_legenda'):ocultos.append((ini,e['fim']))
    for k in ('de','ate','digita_ate'):e.pop(k,None)
    cards.append(e)
# ---- legenda em frases curtas (até 2 linhas), com destaques em dourado
TROCA={norm(k):v for k,v in M.get('trocas',{}).items()}
DEST=sorted(M.get('destaques',[]),key=len,reverse=True)
def txt(ws):
    s=''
    for w in ws:
        t=w[2]
        if norm(w[2]) in TROCA:  # mantém a pontuação original
            m=re.search(r'[.,?!:;]+$',w[2]);t=TROCA[norm(w[2])]+(m.group(0) if m else '')
        s+=(t if t.startswith('-') or not s else ' '+t)
    return s
# frases: corta no ponto e na vírgula; junta pedaços curtos; divide o que passa de ~42 letras em partes parecidas
claus=[];cur=[]
for w in W:
    cur.append(w)
    if re.search(r'[.?!,]$',w[2]):claus.append(cur);cur=[]
if cur:claus.append(cur)
junt=[]
for c in claus:
    fimfrase=bool(junt) and bool(re.search(r'[.?!]$',junt[-1][-1][2]))
    if junt and not fimfrase and len(txt(junt[-1]+c))<=34:junt[-1]=junt[-1]+c
    elif junt and not fimfrase and len(txt(c))<10 and len(txt(junt[-1]+c))<=46:junt[-1]=junt[-1]+c
    else:junt.append(c)
chunks=[]
for c in junt:
    L=len(txt(c))
    if L<=42:chunks.append(c);continue
    k=-(-L//38);alvo=L/k;parte=[]
    for n,w in enumerate(c):
        parte.append(w)
        resto=c[n+1:]
        if len(txt(parte))>=alvo-3 and resto and len(txt(resto))>=10 and len(chunks)<10**6:chunks.append(parte);parte=[]
    if parte:chunks.append(parte)
legs=[]
for k,ch in enumerate(chunks):
    a=out(ch[0][0]-0.05);b=out(chunks[k+1][0][0]-0.05) if k+1<len(chunks) else min(total,out(ch[-1][1]+0.6))
    if any(x<=a<y-0.1 for x,y in ocultos):continue
    for x,y in ocultos:
        if a<x<b:b=x
    t=txt(ch)
    for de_,para in M.get('trocas_texto',{}).items():t=t.replace(de_,para)
    html=t
    for p in DEST:
        i=html.lower().find(p.lower())
        if i>=0 and '<b>' not in html[max(0,i-3):i+len(p)]:html=html[:i]+'<b>'+html[i:i+len(p)]+'</b>'+html[i+len(p):]
    legs.append({'txt':html,'ini':a,'fim':round(b,3)})
json.dump({'clipes':clipes,'total':total},open(sys.argv[4],'w'),indent=1)
ev={'abertura':abertura,'cartoes':cards,'legendas':legs,'ticks':sorted(set(round(t,3) for t in ticks)),'total':total}
json.dump(ev,open(sys.argv[5],'w'),ensure_ascii=False,indent=1)
print('clipes',len(clipes),'total',total,'cartões',len(cards),'legendas',len(legs))
for c in cards:print(f"  {c['tipo']:7s} {c['ini']:6.2f}-{min(c['fim'],total):6.2f} {c.get('titulo','')} {[i['t'] for i in c.get('itens',[])]}")
for l in legs:print(f"    {l['ini']:6.2f} {l['txt']}")
