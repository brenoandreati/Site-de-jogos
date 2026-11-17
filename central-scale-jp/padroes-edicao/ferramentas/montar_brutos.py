"""Junta pedaços escolhidos dos brutos num vídeo só (1080x1920, 30 fps), com corte preciso.
Uso: montar_brutos.py pasta_raw spec.json saida.mp4
spec: {"partes": [["IMG_6846", ini, fim], ...]}  (segundos do arquivo bruto)
Grava também saida.mp4.cortes (onde cada pedaço começa no vídeo novo), usado pelo jcut."""
import json,sys,subprocess,os,glob,tempfile,shutil
import numpy as np
raw,spec,sai=sys.argv[1],sys.argv[2],sys.argv[3];P=json.load(open(spec))['partes']
_cache={}
def nivel(f):
    if f not in _cache:
        pcm=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',f,'-vn','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
        a=np.frombuffer(pcm,dtype=np.int16).astype(np.float32)/32768;n=len(a)//160
        db=20*np.log10(np.sqrt((a[:n*160].reshape(n,160)**2).mean(axis=1))+1e-9)
        _cache[f]=(db,np.percentile(db,95)-26)
    return _cache[f]
def refinar(f,a,b,modo):
    """acha o começo e o fim reais da fala pelo volume (janelas de 10 ms): começa 60 ms antes da primeira sílaba
    e termina 90 ms depois da última, sem pegar a fala vizinha (para no primeiro silêncio de 60 ms)"""
    db,lim=nivel(f);fala=db>lim;N=len(fala);i=lambda t:max(0,min(N-1,int(round(t*100))))
    if 'a' not in modo:
        k=i(a-0.25)
        while k<i(a+0.15) and fala[k]:   # ainda é a palavra anterior: espera o silêncio
            k+=1
        while k<i(a+0.6) and not fala[k]:k+=1
        a=max(0,k/100-0.06)
    if 'b' not in modo:
        k=i(b-0.12);sil=0
        while k<i(b+0.35):
            sil=sil+1 if not fala[k] else 0
            if sil>=6:break
            k+=1
        b=min(N/100,(k-sil+1)/100+0.09)
    return a,b
tmp=tempfile.mkdtemp(prefix='mb_',dir=os.path.dirname(os.path.abspath(sai)));lst=[];cortes=[];t=0.0
for i,pt in enumerate(P):
    n,a,b=pt[:3];modo=pt[3] if len(pt)>3 else ''   # modo 'a' ou 'b': mantém aquele tempo exato
    f=glob.glob(f'{raw}/*/{n}.*')[0];a,b=refinar(f,a,b,modo);d=b-a;fr=round(d*30);print(f'  {n} {a:.2f}-{b:.2f}')
    o=f'{tmp}/p{i:03d}.mp4';lst.append(o)
    subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-ss',f'{a:.3f}','-i',f,'-t',f'{fr/30:.4f}',
      '-vf','setpts=PTS-STARTPTS,scale=1080:1920:flags=lanczos,setsar=1,fps=30','-af',f'asetpts=PTS-STARTPTS,aresample=48000,afade=t=in:d=0.012,afade=t=out:st={max(0,fr/30-0.012):.4f}:d=0.012',
      '-ac','2','-c:v','libx264','-crf','14','-preset','fast','-pix_fmt','yuv420p','-c:a','pcm_s16le','-frames:v',str(fr),'-f','mov',o.replace('.mp4','.mov')],check=True)
    lst[-1]=o.replace('.mp4','.mov')
    if i>0:cortes.append(round(t,4))
    t+=fr/30
open(f'{tmp}/l.txt','w').write(''.join(f"file '{x}'\n" for x in lst))
subprocess.run(['ffmpeg','-nostdin','-v','error','-y','-f','concat','-safe','0','-i',f'{tmp}/l.txt','-c:v','copy','-c:a','aac','-b:a','256k',sai],check=True)
open(sai+'.cortes','w').write(','.join(str(c) for c in cortes))
shutil.rmtree(tmp);print(f'{len(P)} pedaços, {t:.2f}s, cortes: {cortes}')
