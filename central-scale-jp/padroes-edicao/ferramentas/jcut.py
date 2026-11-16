"""J-Cut num vídeo já cortado (manual de edição, págs. 10 a 12).
Em cada corte entre takes:
  - tira o silêncio do fim do take anterior e do começo do próximo (mede pelo volume do áudio);
  - o áudio do próximo take entra SOBRE o fim do anterior (sobreposição de X s, com fade);
  - a imagem do take anterior continua por D s depois que a fala nova começa, e só então troca.
Uso: jcut.py entrada.mp4 saida.mp4 [cortes em s separados por vírgula | auto]"""
import subprocess,sys,json,numpy as np
ent,sai=sys.argv[1],sys.argv[2];FPS=30;X=0.03;D=0.22;F=0.20;PAD_FIM=0.10;PAD_INI=0.04
dur=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',ent],capture_output=True,text=True).stdout)
def detectar():
    raw=subprocess.run(['ffmpeg','-v','error','-i',ent,'-vf','scale=180:320,format=gray','-an','-f','rawvideo','-pix_fmt','gray','-'],capture_output=True).stdout
    d=np.frombuffer(raw,dtype=np.uint8).reshape(-1,320,180).astype(np.float32)
    df=np.abs(np.diff(d,axis=0)).mean(axis=(1,2));med=np.median(df)
    lim=max(6,4*med);c=[]
    for i,v in enumerate(df):
        viz=[df[j] for j in (i-2,i-1,i+1,i+2) if 0<=j<len(df)]
        # corte de verdade: um pico isolado (câmera mexendo dá vários quadros seguidos de diferença alta)
        if v>lim and v>2.5*max(viz):c.append((i+1)/FPS)
    # descarta grupos de picos muito próximos (movimento, não troca de take)
    return [round(t,4) for k,t in enumerate(c) if (k==0 or t-c[k-1]>0.6) and (k==len(c)-1 or c[k+1]-t>0.6)]
cortes=detectar() if len(sys.argv)<4 or sys.argv[3]=='auto' else [float(x) for x in sys.argv[3].split(',')]
# volume em janelas de 10 ms
pcm=subprocess.run(['ffmpeg','-v','error','-i',ent,'-vn','-ac','1','-ar','16000','-f','s16le','-'],capture_output=True).stdout
a=np.frombuffer(pcm,dtype=np.int16).astype(np.float32)/32768;J=160;n=len(a)//J
db=20*np.log10(np.sqrt((a[:n*J].reshape(n,J)**2).mean(axis=1))+1e-9);lim=np.percentile(db,95)-28  # 28 dB abaixo da fala
fala=db>lim
def primeira_fala(t0,t1):
    i0,i1=int(t0*100),int(t1*100);idx=np.where(fala[i0:i1])[0];return (i0+idx[0])/100 if len(idx) else t0
def ultima_fala(t0,t1):
    i0,i1=int(t0*100),int(t1*100);idx=np.where(fala[i0:i1])[0];return (i0+idx[-1]+1)/100 if len(idx) else t1
bordas=[0.0]+cortes+[dur];seg=[]
for k in range(len(bordas)-1):
    s0,s1=bordas[k],bordas[k+1]
    ha=max(s0,primeira_fala(s0,s1)-PAD_INI) if k>0 else s0
    ta=min(s1,ultima_fala(s0,s1)+PAD_FIM) if k<len(bordas)-2 else min(s1,ultima_fala(s0,s1)+0.5)
    seg.append([s0,s1,ha,ta])
# linha do tempo de saída
S=[0.0];Dk=[]
for k in range(len(seg)-1):
    s0,s1,ha,ta=seg[k];S.append(S[k]+(ta-ha)-X);Dk.append(min(D,(s1-ta)+X))
V=[0.0]+[S[k+1]+Dk[k] for k in range(len(seg)-1)]+[S[-1]+(seg[-1][3]-seg[-1][2])]
q=lambda t:round(t*FPS)/FPS
import tempfile,os
tmp=tempfile.mkdtemp(prefix='jcut_',dir=os.path.dirname(os.path.abspath(sai)));vl=[];al=[]
Fk=[0.0]+[min(F,Dk[k]) for k in range(len(seg)-1)]  # fusão na troca de take, enquanto a fala nova já começou
Fk=[0.0]+[max(4,round(f*FPS))/FPS for f in Fk[1:]]  # pelo menos 4 quadros: o xfade do ffmpeg encerra o vídeo com fusão de 1 quadro
for k,(s0,s1,ha,ta) in enumerate(seg):
    v0=max(0,ha+(V[k]-Fk[k]-S[k]));fr=round((V[k+1]-V[k]+Fk[k])*FPS)
    vf=f'{tmp}/v{k:02d}.mp4';vl.append(vf)
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{q(v0):.4f}','-i',ent,'-an','-vf',f'fps={FPS}','-frames:v',str(fr),'-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p',vf],check=True)
    ln=ta-ha;fo=X if k<len(seg)-1 else 0.05;fi=0.02 if k>0 else 0
    af=f'{tmp}/a{k:02d}.wav';al.append((af,S[k]))
    filt=(f"afade=t=in:d={fi:.3f}," if fi>0 else '')+f"afade=t=out:st={max(0,ln-fo):.4f}:d={fo:.3f}"
    subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{ha:.4f}','-t',f'{ln:.4f}','-i',ent,'-vn','-af',filt,'-ar','48000','-ac','2',af],check=True)
tot=sum(round((V[k+1]-V[k])*FPS) for k in range(len(seg)))/FPS
ins=[];fc='';cur='[0:v]'
FR=[round((V[k+1]-V[k]+Fk[k])*FPS) for k in range(len(seg))];FF=[round(f*FPS) for f in Fk]
for v in vl:ins+=['-i',v]
acc=FR[0]  # quadros já montados (conta exata, sem arredondar em segundos)
for k in range(1,len(vl)):
    fc+=f"{cur}[{k}:v]xfade=transition=fade:duration={FF[k]/FPS:.4f}:offset={(acc-FF[k])/FPS:.4f}[x{k}];";acc+=FR[k]-FF[k]
    cur=f'[x{k}]'
if len(vl)==1:import shutil as _s;_s.copy(vl[0],f'{tmp}/video.mp4')
else:subprocess.run(['ffmpeg','-v','error','-y',*ins,'-filter_complex',fc.rstrip(';').rsplit('[',1)[0]+'[v]','-map','[v]','-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p','-r',str(FPS),'-frames:v',str(round(tot*FPS)),f'{tmp}/video.mp4'],check=True)
# áudio: soma as falas, cada uma na sua posição (as sobreposições formam o J-Cut)
SR=48000;mix=np.zeros((int((tot+1)*SR),2),dtype=np.float32)
for af,st in al:
    raw=subprocess.run(['ffmpeg','-v','error','-i',af,'-f','f32le','-ac','2','-ar',str(SR),'-'],capture_output=True).stdout
    x=np.frombuffer(raw,dtype=np.float32).reshape(-1,2);p=int(round(st*SR));mix[p:p+len(x)]+=x[:max(0,len(mix)-p)]
mix=np.clip(mix[:int(tot*SR)],-1,1);open(f'{tmp}/audio.raw','wb').write(mix.astype(np.float32).tobytes())
subprocess.run(['ffmpeg','-v','error','-y','-i',f'{tmp}/video.mp4','-f','f32le','-ar',str(SR),'-ac','2','-i',f'{tmp}/audio.raw','-map','0:v','-map','1:a','-c:v','copy','-c:a','aac','-b:a','256k','-shortest',sai],check=True)
import shutil;shutil.rmtree(tmp)
print(json.dumps({'cortes':cortes,'antes':round(dur,2),'depois':round(tot,2),'ganho':round(dur-tot,2),
  'por_corte':[{'corte':bordas[k+1],'silencio_tirado':round((seg[k][1]-seg[k][3])+(seg[k+1][2]-seg[k+1][0]),2),'imagem_atrasada':round(Dk[k],2)} for k in range(len(seg)-1)]},ensure_ascii=False,indent=1))
