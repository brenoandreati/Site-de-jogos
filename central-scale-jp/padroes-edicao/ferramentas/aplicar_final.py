"""Põe a finalização Scale no fim de um vídeo editado, com transição suave (0,35 s).
Uso: aplicar_final.py entrada.mp4 saida.mp4 [outro.mov]"""
import subprocess,sys,json
ent,sai=sys.argv[1],sys.argv[2];out=sys.argv[3] if len(sys.argv)>3 else '../outro_scale.mov'
d=float(subprocess.run(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',ent],capture_output=True,text=True).stdout)
X=0.35;off=max(0,d-X)
fc=(f"[0:v]fps=30,format=yuv420p,setsar=1[a];[1:v]fps=30,format=yuv420p,setsar=1[b];[a][b]xfade=transition=fade:duration={X}:offset={off:.3f}[v];"
    f"[0:a]aresample=48000[x];[1:a]aresample=48000[y];[x][y]acrossfade=d={X}:c1=tri:c2=tri[au]")
subprocess.run(['ffmpeg','-v','error','-y','-i',ent,'-i',out,'-filter_complex',fc,'-map','[v]','-map','[au]','-c:v','libx264','-preset','slow','-crf','18','-profile:v','high','-pix_fmt','yuv420p','-r','30','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',sai],check=True)
print('ok',sai)
