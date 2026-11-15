"""Mede se o cartão do topo cobre o rosto: para cada 0,5 s, a borda de baixo do cartão (quadros PNG)
contra o topo do rosto (detector de rosto na base). Uso: rosto.py nome [nome...]"""
import cv2,json,sys,os,numpy as np
fc=cv2.CascadeClassifier(cv2.data.haarcascades+'haarcascade_frontalface_default.xml')
for n in sys.argv[1:]:
    ev=json.load(open(n+'.eventos.json'));sp=ev.get('split',[])
    cap=cv2.VideoCapture(n+'.base.mov');N=int(cap.get(cv2.CAP_PROP_FRAME_COUNT));ruins=[];tot=0;pior=0
    for f in range(0,N,15):
        t=f/30
        if any(a<=t<b for a,b in sp):continue
        png=f'{n}.quadros/{f:05d}.png'
        if not os.path.exists(png):continue
        a=cv2.imread(png,cv2.IMREAD_UNCHANGED)[:1560,100:980,3]
        rows=np.where((a>200).sum(axis=1)>300)[0]
        if not len(rows):continue
        fundo=rows.max();tot+=1
        cap.set(cv2.CAP_PROP_POS_FRAMES,f);ok,img=cap.read()
        if not ok:continue
        g=cv2.cvtColor(cv2.resize(img,(540,960)),cv2.COLOR_BGR2GRAY)
        fs=fc.detectMultiScale(g,1.1,6,minSize=(60,60))
        if not len(fs):continue
        x,y,w,h=max(fs,key=lambda r:r[2]*r[3]);y*=2;h*=2
        meio=set(range(int(y+0.15*h),int(y+0.85*h)));cob=len(meio.intersection(rows.tolist()))/max(1,len(meio))  # fração da área do rosto (testa ao queixo) atrás do cartão
        if cob>0.2:ruins.append(round(t,1));pior=max(pior,cob)
    print(f'{n:12s} quadros com cartão: {tot:3d}  cobrindo o rosto: {len(ruins):3d}  pior: {pior:.0%}  tempos: {ruins[:12]}',flush=True)
