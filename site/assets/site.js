/* Progressive enhancements; native content and navigation work without JS. */
(()=>{
'use strict';
const root=document.documentElement,dark=matchMedia('(prefers-color-scheme: dark)'),mobile=matchMedia('(max-width: 900px)'),theme=document.querySelector('[data-theme-toggle]');
try{const saved=localStorage.getItem('parchimatch-theme');if(['dark','light'].includes(saved))root.dataset.theme=saved}catch{}
const current=()=>root.dataset.theme||(dark.matches?'dark':'light');
function label(){if(!theme)return;const on=current()==='dark',text=`Switch to ${on?'light':'dark'} theme`;theme.setAttribute('aria-label',text);theme.title=text;theme.setAttribute('aria-pressed',on)}
if(theme){theme.hidden=false;theme.onclick=()=>{root.dataset.theme=current()==='dark'?'light':'dark';try{localStorage.setItem('parchimatch-theme',root.dataset.theme)}catch{}label()};dark.addEventListener('change',label);label()}
function fold(){document.querySelectorAll('[data-fold]').forEach(el=>el.open=!mobile.matches)}
fold();mobile.addEventListener('change',fold);
const menu=document.querySelector('.nav-menu');
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mobile.matches&&menu.open){menu.open=false;menu.querySelector('summary').focus()}});
const status=document.querySelector('[data-copy-status]');
document.querySelectorAll('[data-copy]').forEach(button=>{button.hidden=false;button.onclick=async()=>{const code=button.closest('.code-block')?.querySelector('code');if(!code)return;let copied=false;try{await navigator.clipboard.writeText(code.textContent);copied=true}catch{const range=document.createRange(),selection=getSelection();range.selectNodeContents(code);selection.removeAllRanges();selection.addRange(range);try{copied=document.execCommand('copy')}catch{}if(copied)selection.removeAllRanges()}if(status)status.textContent=copied?'Command copied.':'Copy was unavailable. The command is selected; copy it with your keyboard.';button.textContent=copied?'Copied':'Select & copy';setTimeout(()=>button.textContent='Copy',1800)}});
const replay=document.querySelector('[data-replay]'),ledger=document.querySelector('[data-demo]'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
if(replay&&ledger){ledger.querySelectorAll('.demo-row').forEach((row,i)=>row.style.setProperty('--row-index',i));function motion(){replay.hidden=reduced.matches;if(reduced.matches)ledger.classList.remove('is-replaying')}replay.onclick=()=>{if(reduced.matches)return;ledger.classList.remove('is-replaying');requestAnimationFrame(()=>requestAnimationFrame(()=>ledger.classList.add('is-replaying')))};reduced.addEventListener('change',motion);motion()}
const video=document.querySelector('[data-demo-video]'),note=document.querySelector('[data-video-note]');
if(video&&note)video.addEventListener('error',()=>note.textContent='The demo recording has not been added yet. The order preview above is an HTML demonstration using synthetic data.');
})();
