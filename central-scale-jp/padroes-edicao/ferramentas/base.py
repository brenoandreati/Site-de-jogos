"""Renderiza a base: cada clipe cortado do bruto, em 1080x1920 30 fps, com zoom do bloco e cor; depois concatena."""
import json,sys,subprocess,os
cor=json.load(open(sys.argv[1]));src=sys.argv[2];out=sys.argv[3];tmp=out+'.parts';os.makedirs(tmp,exist_ok=True)
cl=cor['clipes']
# blocos: início e duração no tempo de saída
blocos={}
for c in cl:
    b=str(c['bloco']);d=c['fim']-c['ini']
    if b not in blocos:blocos[b]=[c['out'],0]
    blocos[b][1]=c['out']+d-blocos[b][0]
ordem=list(dict.fromkeys(str(c['bloco']) for c in cl))
lista=[]
for k,c in enumerate(cl):
    b=str(c['bloco']);base=1.0 if ordem.index(b)%2==0 else 1.08
    ini,dur=blocos[b];off=c['out']-ini
    z=f"{base}*(1+0.04*({off:.3f}+in/30)/{dur:.3f})"
    vf=(f"fps=30,zoompan=z='{z}':x='(iw-iw/zoom)/2':y='(ih-ih/zoom)*0.38':d=1:s=1080x1920:fps=30,"
        "eq=contrast=1.05:brightness=0.005:saturation=1.03,colorbalance=rm=0.015:bm=-0.015,format=yuv420p")
    f=f"{tmp}/{k:03d}.mp4";lista.append(f)
    q=c['quadros'];dur=q/30
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f"{c['ini']:.4f}",'-t',f"{dur+0.2:.4f}",'-i',src,'-vf',vf,'-frames:v',str(q),
        '-af',f'aresample=48000,apad,atrim=0:{dur:.6f}','-c:v','libx264','-preset','medium','-crf','14','-c:a','pcm_s16le','-ar','48000','-ac','2',
        f.replace('.mp4','.mov')],check=True)
    print('clipe',k,flush=True)
open(tmp+'/lista.txt','w').write(''.join(f"file '{os.path.abspath(f.replace('.mp4','.mov'))}'\n" for f in lista))
subprocess.run(['ffmpeg','-v','error','-y','-f','concat','-safe','0','-i',tmp+'/lista.txt','-c','copy',out],check=True)
print('ok',out)
