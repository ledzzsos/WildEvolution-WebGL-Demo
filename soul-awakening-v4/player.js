'use strict';
// V4: load and decode the single locked/selected result while on the opening screen.
// The button performs NO loading; it starts the continuous native MP4 immediately.
// Never preload all possible species. Sample dropdown is review-only.
const $=id=>document.getElementById(id);
const video=$('common-video'),layer=$('animal-layer'),ctx=layer.getContext('2d');
const idle=$('idle-poster'),portrait=$('result-picture'),audio=$('selected-audio');
const wake=$('wake'),skip=$('skip'),enter=$('enter'),selector=$('sample');
const status=$('status'),tier=$('tier'),beast=$('beast-name');
const params=new URLSearchParams(location.search);
const file=name=>'output/'+name;
let manifest,choice,phase='loading',runId=0,muted=false,prepared=new Map();
let lastFrame=-1,raf=0,portraitPromise,prepareBegin=0,lastPrepareMs=0,lateFrames=0;
let backgroundObjectUrl=null,audioObjectUrl=null;
const setStatus=t=>{if(status.textContent!==t)status.textContent=t;};
const state=s=>{phase=s;$('stage').dataset.phase=s;};
const clear=()=>ctx.clearRect(0,0,layer.width,layer.height);
function image(url){
  const im=new Image();im.decoding='async';im.src=url;
  return im.decode().then(()=>im);
}
function closeBitmaps(){
  for(const item of prepared.values()){
    if(typeof item.close==='function')item.close();
  }
  prepared.clear();
}
async function prepareSheet(index,token){
  const entry=choice.sheets[index];
  if(!entry)throw Error('不存在图集 '+index);
  const response=await fetch(file(entry.file),{cache:'force-cache'});
  if(!response.ok)throw Error('下载失败：'+entry.file);
  const blob=await response.blob();
  // Bitmap decode may happen on an off-main-thread browser worker.
  let bitmap;
  if(typeof createImageBitmap==='function'){
    bitmap=await createImageBitmap(blob);
  }else{
    const objectUrl=URL.createObjectURL(blob);
    try{bitmap=await image(objectUrl);}finally{URL.revokeObjectURL(objectUrl);}
  }
  if(token!==runId){
    if(typeof bitmap.close==='function')bitmap.close();
    return;
  }
  prepared.set(index,bitmap);
  const ready=prepared.size,needed=choice.sheets.length;
  $('prepare-progress').textContent=ready+' / '+needed+' 组';
}
async function prepareAllSelected(token){
  // Batch two at a time to limit concurrent CPU work and peak decode pressure.
  const indexes=Array.from({length:choice.sheets.length},(_,i)=>i);
  for(let i=0;i<indexes.length;i+=2){
    await Promise.all(indexes.slice(i,i+2).map(index=>prepareSheet(index,token)));
    if(token!==runId||phase!=='preloading')return false;
  }
  return true;
}
function drawAnimal(spriteIndex){
  const cells=manifest.grid[0]*manifest.grid[1],index=Math.floor(spriteIndex/cells);
  const source=prepared.get(index);
  if(!source)throw Error('准备状态异常：动画帧未就绪 '+index);
  const entry=choice.sheets[index],rect=entry.rect;
  const width=rect[2]-rect[0],height=rect[3]-rect[1];
  const part=spriteIndex%cells;
  clear();
  ctx.drawImage(source,(part%manifest.grid[0])*width,Math.floor(part/manifest.grid[0])*height,
    width,height,rect[0],rect[1],width,height);
}
function render(){
  if(phase!=='playing')return;
  const t=video.currentTime;
  if(t>=choice.duration-.014){finish();return;}
  const globalIndex=Math.floor(t*manifest.fps);
  const spriteIndex=globalIndex-manifest.overlay_start_frame;
  if(spriteIndex<0){
    if(lastFrame!==-1){clear();lastFrame=-1;}
  }else if(spriteIndex<choice.frames&&spriteIndex!==lastFrame){
    try{
      if(lastFrame>=0&&spriteIndex-lastFrame>1)lateFrames+=spriteIndex-lastFrame-1;
      drawAnimal(spriteIndex);
      lastFrame=spriteIndex;
    }catch(e){
      setStatus('动画绘制出现问题：'+e.message);
      console.error(e);
    }
  }
  if(!audio.paused&&audio.readyState>=2&&Math.abs(audio.currentTime-t)>.25){
    try{audio.currentTime=t;}catch(_){}
  }
  raf=requestAnimationFrame(render);
}
function finish(){
  if(phase!=='playing')return;
  state('result');runId++;cancelAnimationFrame(raf);
  video.pause();audio.pause();
  $('preparing').hidden=true;skip.hidden=true;enter.hidden=false;
  $('result').hidden=false;
  tier.textContent=choice.tier===2?'二阶 · 高阶兽魂':'一阶 · 兽魂化生';
  beast.textContent=choice.label.replace(/[ⅠⅡ]$/,'');
  if(portraitPromise){
    portraitPromise.then(im=>{
      if(phase!=='result')return;
      portrait.src=im.src;portrait.hidden=false;clear();
    }).catch(e=>console.warn('结果静态图不可用',e));
  }
  setStatus('动画播放完成 · 入场前预加载 '+lastPrepareMs+'ms · 掉帧估算 '+lateFrames+' 帧');
}
async function fetchSelectedSound(token){
  if(audioObjectUrl){URL.revokeObjectURL(audioObjectUrl);audioObjectUrl=null;}
  const response=await fetch(file(choice.audio),{cache:'force-cache'});
  if(!response.ok)throw Error('音轨加载失败');
  const blob=await response.blob();
  if(token!==runId)return;
  audioObjectUrl=URL.createObjectURL(blob);
  audio.src=audioObjectUrl;
  audio.muted=muted;
  audio.preload='auto';audio.load();
}
async function ensureBackgroundReady(){
  if(backgroundObjectUrl)return;
  const response=await fetch(file(manifest.shared),{cache:'force-cache'});
  if(!response.ok)throw Error('公共视频加载失败');
  const blob=await response.blob();
  backgroundObjectUrl=URL.createObjectURL(blob);
  video.src=backgroundObjectUrl;
  video.playsInline=true;video.muted=true;video.preload='auto';
  video.load();
  // The entire background video byte payload is already in memory.
}
async function prepareSelection(key){
  if(!manifest||!manifest.cases[key])return;
  const token=++runId;
  cancelAnimationFrame(raf);
  closeBitmaps();
  choice=manifest.cases[key];
  lastFrame=-1;lateFrames=0;clear();
  wake.disabled=true;wake.textContent='兽魂准备中…';
  $('prepare-progress').textContent='0 / '+choice.sheets.length+' 组';
  $('preparing').hidden=true; // readiness belongs on the menu, not after Wake
  state('preloading');
  setStatus('开局界面后台预加载本次兽魂 · 唤醒按钮只负责播放');
  const began=performance.now();
  try{
    // Load ONLY this chosen/locked creature; never all draw-pool alternatives.
    // Sound/portrait/video are also resolved while the user is on the menu.
    const [complete]=await Promise.all([
      prepareAllSelected(token),
      ensureBackgroundReady(),
      fetchSelectedSound(token),
      (async()=>{
        const current=image(file(choice.result_image));
        portraitPromise=current;
        await current;
      })()
    ]);
    if(!complete||token!==runId||phase!=='preloading')return;
    lastPrepareMs=Math.round(performance.now()-began);
    wake.disabled=false;wake.textContent='唤醒兽魂';
    state('ready');
    setStatus('兽魂已提前准备完成（'+lastPrepareMs+'ms） · 点击即可播放，无后续图集加载');
  }catch(error){
    if(token!==runId)return;
    state('error');
    wake.disabled=true;wake.textContent='资源准备失败';
    setStatus('提前准备失败：'+error.message+'（刷新重试）');
    console.error(error);
  }
}
function start(){
  // MUST remain synchronous and network-free: the user gesture starts playback.
  if(phase!=='ready'||wake.disabled||!choice||prepared.size!==choice.sheets.length)return;
  lastFrame=-1;lateFrames=0;clear();
  $('result').hidden=true;portrait.hidden=true;enter.hidden=true;
  $('sample-holder').hidden=true;$('heading').hidden=true;
  wake.hidden=true;skip.hidden=false;video.hidden=false;
  video.currentTime=0;audio.currentTime=0;
  state('playing');
  setStatus('立即播放 · 本次动物已提前解码（'+lastPrepareMs+'ms）');
  // No await/download/createImageBitmap after the click.
  video.play().catch(error=>{
    if(phase==='playing')setStatus('背景视频无法开始：'+error.message);
    console.error(error);
  });
  if(!muted)audio.play().catch(error=>console.warn('设备限制音效',error));
  raf=requestAnimationFrame(render);
}
function confirm(){
  if(phase!=='result')return;
  state('done');$('result').hidden=true;enter.hidden=true;
  $('again').hidden=false;
  setStatus('兽魂结果已确认：'+choice.label);
  if(typeof window.onSoulAwakeningConfirmed==='function')
    window.onSoulAwakeningConfirmed({species:choice.species,tier:choice.tier});
}
function again(){
  if(phase!=='done')return;
  cancelAnimationFrame(raf);video.pause();audio.pause();
  portrait.hidden=true;portrait.removeAttribute('src');
  video.hidden=true;idle.hidden=false;clear();
  $('again').hidden=true;$('sample-holder').hidden=false;$('heading').hidden=false;
  wake.hidden=false;skip.hidden=true;$('result').hidden=true;enter.hidden=true;
  // Replay the same selected/decoded beast instantly. New choice triggers
  // background preparation via the select-change listener instead.
  wake.disabled=prepared.size!==choice.sheets.length;
  wake.textContent=wake.disabled?'兽魂准备中…':'唤醒兽魂';
  state(wake.disabled?'preloading':'ready');
  setStatus(wake.disabled?'正在准备兽魂':'已准备好，可直接再次唤醒');
}
async function boot(){
  try{
    const response=await fetch('output/manifest.json?v=3',{cache:'no-store'});
    if(!response.ok)throw Error('实验资源清单不可用');
    manifest=await response.json();
    if(manifest.version!==3||manifest.atlas_mode!=='per_sheet_true_alpha_crop')
      throw Error('旧版资源缓存，请强制刷新页面');
    for(const [key,item] of Object.entries(manifest.cases)){
      const opt=document.createElement('option');opt.value=key;opt.textContent=item.label;
      selector.appendChild(opt);
    }
    const requested=(params.get('beast')||'').toLowerCase()+(params.get('tier')==='2'?'2':'');
    selector.value=manifest.cases[requested]?requested:
      manifest.cases.wolf2?'wolf2':Object.keys(manifest.cases)[0];
    idle.src=file(manifest.idle);await idle.decode();
    video.playsInline=true;video.muted=true;video.preload='auto';
    await prepareSelection(selector.value);
  }catch(e){state('error');wake.disabled=true;setStatus('初始化失败：'+e.message);console.error(e);}
}
video.addEventListener('ended',()=>{if(phase==='playing')finish();});
video.addEventListener('waiting',()=>{if(phase==='playing')audio.pause();});
video.addEventListener('playing',()=>{
  if(phase!=='playing')return;
  idle.hidden=true; // Stage z-index: an unhidden idle image would cover the video.
  if(!muted&&audio.paused)audio.play().catch(()=>{});
});
video.addEventListener('pause',()=>{if(phase==='playing')audio.pause();});
selector.addEventListener('change',()=>{if(manifest&&manifest.cases[selector.value])prepareSelection(selector.value);});
wake.addEventListener('click',start);
skip.addEventListener('click',finish);
enter.addEventListener('click',confirm);
$('again').addEventListener('click',again);
$('sound').addEventListener('click',()=>{muted=!muted;audio.muted=muted;$('sound').textContent=muted?'♪̸':'♪';});
boot();
