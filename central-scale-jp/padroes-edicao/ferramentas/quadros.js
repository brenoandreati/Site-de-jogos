// Desenha os elementos quadro a quadro (30 fps) com fundo transparente.
const { chromium } = require('playwright');const fs=require('fs');const path=require('path');
const [html,evf,dir]=process.argv.slice(2);const ev=JSON.parse(fs.readFileSync(evf,'utf8'));fs.mkdirSync(dir,{recursive:true});
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve(html));await p.evaluate(()=>document.fonts.ready);
console.log('fonte Montserrat:',await p.evaluate(()=>document.fonts.check('800 60px Montserrat')));
await p.evaluate(e=>setup(e),ev);
const n=Math.ceil(ev.total*30);let last='',lastF='';
for(let f=0;f<n;f++){const k=await p.evaluate(t=>render(t),f/30);const fn=path.join(dir,String(f).padStart(5,'0')+'.png');
 if(k===last){fs.copyFileSync(lastF,fn);}else{await p.screenshot({path:fn,omitBackground:true});last=k;lastF=fn;}}
console.log('quadros',n);await b.close();})();
