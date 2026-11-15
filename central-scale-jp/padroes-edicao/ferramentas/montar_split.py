"""Como montar.py, mas nos trechos de tela dividida o vídeo do JP desce para a metade de baixo
(recorte de 1080x960 no rosto), enquanto a ilustração ocupa a metade de cima (vem nos quadros).
Uso: montar_split.py nome saida.mp4 [y_do_recorte]"""
import json,subprocess,sys
n,saida=sys.argv[1],sys.argv[2];cy=int(sys.argv[3]) if len(sys.argv)>3 else 380
ev=json.load(open(f'{n}.eventos.json'));ticks=ev['ticks'];sp=ev.get('split',[])
inputs=['-i',f'{n}.base.mov','-framerate','30','-i',f'{n}.quadros/%05d.png']
for _ in ticks:inputs+=['-i','tick.wav']
fc='[0:v]split=2[full][cp];[cp]crop=1080:960:0:%d[low];'%cy
cur='[full]'
for k,(a,b) in enumerate(sp):
    D=0.45  # entra de baixo e sai pra baixo, com a mesma curva da ilustração
    y=(f"if(lt(t,{a}+{D}),960+960*pow(1-(t-{a})/{D},3),if(gt(t,{b}-{D}),960+960*pow((t-({b}-{D}))/{D},3),960))")
    fc+=f"{'[low]' if k==0 else '[low%d]'%k}" if False else ''
    src='[low]' if len(sp)==1 else f'[l{k}]'
    if len(sp)>1 and k==0:fc=fc.replace('[low];','[low];[low]split=%d%s;'%(len(sp),''.join(f'[l{i}]' for i in range(len(sp)))))
    fc+=f"{cur}{src}overlay=x=0:y='{y}':eval=frame:enable='between(t,{a},{b})'[s{k}];";cur=f'[s{k}]'
fc+=f'{cur}[1:v]overlay=0:0:format=auto,format=yuv420p[v];[0:a]loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[voz];'
tl=[]
for k,t in enumerate(ticks):
    ms=int(t*1000);fc+=f'[{k+2}:a]adelay={ms}|{ms},volume=0.35[t{k}];';tl.append(f'[t{k}]')
fc+='[voz]'+''.join(tl)+f'amix=inputs={len(ticks)+1}:normalize=0:duration=first[a]'
subprocess.run(['ffmpeg','-v','error','-y',*inputs,'-filter_complex',fc,'-map','[v]','-map','[a]','-c:v','libx264','-preset','slow','-crf','18','-profile:v','high','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-t',str(ev['total']),saida],check=True)
print('ok',saida)
