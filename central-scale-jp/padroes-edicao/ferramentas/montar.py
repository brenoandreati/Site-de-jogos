"""Junta base + quadros + ticks, com som a -14 LUFS. Uso: montar.py nome saida.mp4"""
import json,subprocess,sys
n,saida=sys.argv[1],sys.argv[2]
ev=json.load(open(f'{n}.eventos.json'));ticks=ev['ticks']
inputs=['-i',f'{n}.base.mov','-framerate','30','-i',f'{n}.quadros/%05d.png']
for _ in ticks:inputs+=['-i','tick.wav']
fc='[0:v][1:v]overlay=0:0:format=auto,format=yuv420p[v];[0:a]loudnorm=I=-14:TP=-1.5:LRA=9,aresample=48000[voz];'
tl=[]
for k,t in enumerate(ticks):
    ms=int(t*1000);fc+=f'[{k+2}:a]adelay={ms}|{ms},volume=0.35[t{k}];';tl.append(f'[t{k}]')
fc+='[voz]'+''.join(tl)+f'amix=inputs={len(ticks)+1}:normalize=0:duration=first[a]'
subprocess.run(['ffmpeg','-v','error','-y',*inputs,'-filter_complex',fc,'-map','[v]','-map','[a]','-c:v','libx264','-preset','slow','-crf','18','-profile:v','high','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart','-t',str(ev['total']),saida],check=True)
print('ok',saida)
