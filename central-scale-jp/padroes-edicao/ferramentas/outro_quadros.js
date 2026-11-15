const {chromium}=require('playwright');const fs=require('fs');const path=require('path');
const [dir,dur,...amostra]=process.argv.slice(2);fs.mkdirSync(dir,{recursive:true});
(async()=>{const b=await chromium.launch();const p=await b.newPage({viewport:{width:1080,height:1920}});
await p.goto('file://'+path.resolve('outro.html'));await p.evaluate(()=>document.fonts.ready);
console.log('Anton:',await p.evaluate(()=>document.fonts.check('300px Anton')));await p.evaluate(()=>setup());
const ts=amostra.length?amostra.map(Number):[...Array(Math.round(+dur*30)).keys()].map(f=>f/30);
for(const [i,t] of ts.entries()){await p.evaluate(t=>render(t),t);await p.screenshot({path:path.join(dir,String(i).padStart(5,'0')+'.png')});}
await b.close();})();
