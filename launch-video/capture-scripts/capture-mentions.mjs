import { chromium } from 'playwright'; import fs from 'fs';
const out=process.argv[2]; const Z=1; fs.rmSync(out,{recursive:true,force:true}); fs.mkdirSync(out,{recursive:true});
const b=await chromium.launch(); const ctx=await b.newContext({viewport:{width:1024,height:576},deviceScaleFactor:1.875}); const p=await ctx.newPage();
await p.addInitScript((Z)=>{window.__Z=Z;document.addEventListener('DOMContentLoaded',()=>{});
 const mk=()=>{if(document.getElementById('__cur'))return;const d=document.createElement('div');d.id='__cur';d.style.cssText='position:fixed;z-index:2147483647;width:22px;height:22px;border-radius:50%;background:rgba(20,60,220,.35);border:2px solid #1438dc;pointer-events:none;left:-50px;top:-50px;transform:translate(-50%,-50%)';document.documentElement.appendChild(d);
 addEventListener('mousemove',e=>{d.style.left=(e.clientX/window.__Z)+'px';d.style.top=(e.clientY/window.__Z)+'px'},true);};
 document.addEventListener('DOMContentLoaded',mk);setInterval(mk,300);},Z);
let n=0; const frames=[];
async function snap(k=1){ await p.waitForTimeout(40); await p.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))); const f=out+'/f'+String(n).padStart(5,'0')+'.jpg'; await p.screenshot({path:f,type:'jpeg',quality:94}); for(let i=0;i<k;i++)frames.push(n); n++; }
async function hold(sec){ await p.waitForTimeout(500); await snap(Math.round(sec*30)); }
async function scrollTo(target,sec){ const y0=await p.evaluate(()=>window.scrollY); const N=Math.round(sec*30); for(let i=1;i<=N;i++){const e=(1-Math.cos(Math.PI*i/N))/2; await p.evaluate(y=>window.scrollTo(0,y),y0+(target-y0)*e); await snap(1);} }
async function moveTo(x,y,sec){ const N=Math.round(sec*30); const x0=mx,y0=my; for(let i=1;i<=N;i++){const e=(1-Math.cos(Math.PI*i/N))/2; await p.mouse.move(x0+(x-x0)*e,y0+(y-y0)*e); await snap(1);} mx=x;my=y; }
let mx=900,my=700;
await p.goto('https://company-evidence-index-production.up.railway.app/',{waitUntil:'networkidle'}); await p.mouse.move(mx,my);
await p.waitForTimeout(800);
const link=p.getByRole('link',{name:'Mentions'}).first(); const lb=await link.boundingBox();
await moveTo(lb.x+lb.width/2,lb.y+lb.height/2,0.8); await link.click(); await p.waitForTimeout(1500); await hold(1.8);
const ytop=await p.evaluate(()=>{const e=[...document.querySelectorAll('*')].find(x=>/^MICROSOFT CORP/.test(x.textContent.trim())&&x.children.length<4&&x.getBoundingClientRect().height<80);return e.getBoundingClientRect().top+window.scrollY});
await scrollTo(ytop-120,1.6); await hold(2.4);
const claim=p.locator('a.detail-source',{hasText:/Azure guided/}).first();
const cy=await claim.evaluate(e=>e.getBoundingClientRect().top+window.scrollY);
await scrollTo(cy-460,1.8); await hold(1.2);
const cb=await claim.boundingBox(); await moveTo(cb.x+cb.width*.4,cb.y+cb.height/2,0.9); await hold(2.4);
fs.writeFileSync(out+'/frames.txt',frames.map(i=>`file 'f${String(i).padStart(5,'0')}.jpg'\nduration 0.03333`).join('\n')+`\nfile 'f${String(frames[frames.length-1]).padStart(5,'0')}.jpg'\n`);
console.log(frames.length/30); await b.close();
