'use strict';
// V5: roll exactly once at application startup and lock the outcome before the
// opening/home UI appears. During the boot splash, preload only its background,
// transparent sheets, audio, and result image. Wake merely starts playback.
// Fixed species controls are only available behind ?review=1 for manual QA.
const $=id=>document.getElementById(id);
const video=$('common-video'),layer=$('animal-layer'),ctx=layer.getContext('2d');
const idle=$('idle-poster'),portrait=$('result-picture'),audio=$('selected-audio');
const wake=$('wake'),skip=$('skip'),enter=$('enter'),selector=$('sample');
const status=$('status'),tier=$('tier'),beast=$('beast-name');
const params=new URLSearchParams(location.search);
const reviewMode=params.get('review')==='1';
const file=name=>'output/'+name;
function rollKey(value){
  const roll=Math.min(1-Number.EPSILON,Math.max(0,value));
  if(roll>=.95)return 'bear2';
  if(roll>=.90)return 'wolf2';
  return ['wolf','bear','eagle','spider','kun'][Math.min(4,Math.floor(roll/.18))];
}
let lockedKey=null;
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
async function prepareSheet(index,token,selected){
  const entry=selected.sheets[index];
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
  const ready=prepared.size,needed=selected.sheets.length;
  $('prepare-progress').textContent=ready+' / '+needed+' 组';
}
async function prepareAllSelected(token,selected){
  // Batch two at a time to bound concurrent CPU work during boot.
  const indexes=Array.from({length:selected.sheets.length},(_,i)=>i);
  for(let i=0;i<indexes.length;i+=2){
    await Promise.all(indexes.slice(i,i+2).map(index=>prepareSheet(index,token,selected)));
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
async function fetchSelectedSound(token,selected){
  if(audioObjectUrl){URL.revokeObjectURL(audioObjectUrl);audioObjectUrl=null;}
  const response=await fetch(file(selected.audio),{cache:'force-cache'});
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
  if(!manifest||!manifest.cases[key])throw Error('抽取结果没有对应动画资源：'+key);
  const token=++runId;
  const selected=manifest.cases[key];
  cancelAnimationFrame(raf);
  closeBitmaps();
  choice=selected;
  lastFrame=-1;lateFrames=0;clear();
  wake.disabled=true;wake.textContent='兽魂准备中…';
  $('prepare-progress').textContent='0 / '+choice.sheets.length+' 组';
  $('preparing').hidden=true; // Boot splash owns preparation, not the Wake click.
  state('preloading');
  setStatus('启动阶段准备演出资源 · 即将进入开局界面');
  const began=performance.now();
  try{
    // Load ONLY this chosen/locked creature; never all draw-pool alternatives.
    // Sound/portrait/video are also resolved while the user is on the menu.
    const [complete]=await Promise.all([
      prepareAllSelected(token,selected),
      ensureBackgroundReady(),
      fetchSelectedSound(token,selected),
      (async()=>{
        const current=image(file(selected.result_image));
        portraitPromise=current;
        await current;
      })()
    ]);
    if(!complete||token!==runId||phase!=='preloading')return;
    if(!idle.complete)await idle.decode();
    if(token!==runId||phase!=='preloading')return;
    lastPrepareMs=Math.round(performance.now()-began);
    // Do not expose the home/login UI until the locked result is fully decoded.
    $('boot-cover').hidden=true;
    wake.disabled=false;wake.textContent='唤醒兽魂';
    state('ready');
    setStatus('开局准备完成（'+lastPrepareMs+'ms） · 点击直接播放');
  }catch(error){
    if(token!==runId)return;
    state('error');
    wake.disabled=true;wake.textContent='资源准备失败';
    $('boot-cover').hidden=false;
    $('boot-message').textContent='加载失败，请刷新重试';
    setStatus('启动加载失败：'+error.message);
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
  setStatus('即时播放 · 本局兽魂已在进入界面前准备就绪');
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
  $('again').hidden=true;$('sample-holder').hidden=!reviewMode;$('heading').hidden=false;
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
    // A regular game session rolls only once. No roll during Wake/skip/confirm.
    lockedKey=reviewMode&&manifest.cases[requested]?requested:rollKey(Math.random());
    if(!manifest.cases[lockedKey])throw Error('抽取池与资源清单不匹配：'+lockedKey);
    selector.value=lockedKey;
    $('sample-holder').hidden=!reviewMode;
    idle.src=file(manifest.idle);
    video.playsInline=true;video.muted=true;video.preload='auto';
    await prepareSelection(lockedKey);
  }catch(e){
    state('error');wake.disabled=true;
    $('boot-message').textContent='启动失败，请刷新重试';
    setStatus('初始化失败：'+e.message);console.error(e);
  }
}
video.addEventListener('ended',()=>{if(phase==='playing')finish();});
video.addEventListener('waiting',()=>{if(phase==='playing')audio.pause();});
video.addEventListener('playing',()=>{
  if(phase!=='playing')return;
  idle.hidden=true; // Stage z-index: an unhidden idle image would cover the video.
  if(!muted&&audio.paused)audio.play().catch(()=>{});
});
video.addEventListener('pause',()=>{if(phase==='playing')audio.pause();});
selector.addEventListener('change',()=>{
  if(reviewMode&&manifest&&manifest.cases[selector.value]){
    lockedKey=selector.value;
    prepareSelection(lockedKey);
  }
});
wake.addEventListener('click',start);
skip.addEventListener('click',finish);
enter.addEventListener('click',confirm);
$('again').addEventListener('click',again);
$('sound').addEventListener('click',()=>{muted=!muted;audio.muted=muted;$('sound').textContent=muted?'♪̸':'♪';});
boot();
