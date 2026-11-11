"""Vídeo já cortado: a partir da transcrição e das marcas do plano, monta cortes contínuos
(sem tirar nada) divididos nas trocas de pergunta, e o plano completo com tempos de legenda.
Uso: plano_editado.py marcas.json transcricao.json duracao cortes.json plano.json"""
import json,sys
M=json.load(open(sys.argv[1]));T=json.load(open(sys.argv[2]));dur=float(sys.argv[3]);W=[w for s in T for w in s['palavras']]
norm=lambda s:s.lower().strip('.,?!:;')
def w_at(txt,depois=0):
    for w in W:
        if w[0]>=depois-0.01 and norm(w[2])==norm(txt):return w
    raise SystemExit(f'não achei "{txt}" depois de {depois}')
F=lambda t:round(round(t*30)/30,4)
marcas=[];t=0;perg=[]
for p in M['perguntas']:
    wq=w_at(p['q'],t);qf=next(w for w in W if w[0]>=wq[0] and '?' in w[2]);wa=w_at(p['a'],qf[1]);marcas.append((wq,wa));t=wa[1]
    leg=[];d=wa[0]
    for txt,ancora in p.get('leg',[]):
        w=w_at(ancora,d);leg.append([txt,w[0]]);d=w[0]+0.01
    perg.append({'ops':p['ops'],'r':p['r'],**({'leg':leg} if leg else {})})
cta=w_at(M['cta'],marcas[-1][1][1])
fim_ant=lambda w:max([x[1] for x in W if x[1]<=w[0]+0.01] or [0])
corte=lambda w:F((fim_ant(w)+w[0])/2)
pts=[0.0];papeis=[('abertura','abertura')]
for i,(wq,wa) in enumerate(marcas):
    pts.append(corte(wq));papeis.append((i,'pergunta'));pts.append(corte(wa));papeis.append((i,'resposta'))
pts.append(corte(cta));papeis.append(('cta','cta'));pts.append(F(dur-0.02))
clipes=[]
for k,(b,p) in enumerate(papeis):
    q=round((pts[k+1]-pts[k])*30);clipes.append({'ini':pts[k],'fim':round(pts[k]+q/30,4),'bloco':b,'papel':p,'quadros':q,'out':pts[k]})
json.dump({'clipes':clipes,'total':round(sum(c['quadros'] for c in clipes)/30,4)},open(sys.argv[4],'w'),indent=1)
json.dump({'id':M['id'],'formato':M['formato'],'tema':M['tema'],'perguntas':perg,'fecho':M['fecho']},open(sys.argv[5],'w'),ensure_ascii=False,indent=1)
print('clipes',len(clipes),'total',round(sum(c['quadros'] for c in clipes)/30,2))
for (wq,wa),p in zip(marcas,M['perguntas']):print(f"  {wq[0]:6.2f} {p['ops']} -> resposta {wa[0]:.2f} ({wa[2]})")
