'use strict';
// Smoothness-first proof: 6.833s native uninterrupted MP4 + true-alpha,
// per-sheet-trimmed sprite atlases. A selected result is fully decoded BEFORE
// the movie starts, so a late network request cannot freeze animal formation.
// Only the SELECTED species is downloaded, never all creatures at startup.
const $=id=>document.getElementById(id);
const video=$('common-video'),layer=$('animal-layer'),ctx=layer.getContext('2d');
const idle=$('idle-poster'),portrait=$('result-picture'),audio=$('selected-audio');
const wake=$('wake'),skip=$('skip'),enter=$('enter'),selector=$('sample');
const status=$('status'),tier=$('tier'),beast=$('beast-name');
const params=new URLSearchParams(location.search);
const file=name=>'output/'+name;
let manifest,choice,phase='loading',runId=0,muted=false,prepared=new Map();
let lastFrame=-1,raf=0,portraitPromise,prepareBegin=0,lastPrepareMs=0,lateFrames=0;
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
    if(token!==runId||phase!=='preparing')return false;
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
  if(phase!=='playing'&&phase!=='preparing')return;
  const previousPhase=phase;
  state('result');runId++;cancelAnimationFrame(raf);
  video.pause();audio.pause();closeBitmaps();
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
  setStatus(previousPhase==='preparing'?'已跳过准备阶段':
    '动画播放完成 · 预备 '+lastPrepareMs+'ms · 掉帧估算 '+lateFrames+' 帧');
}
async function start(){
  if(phase!=='ready')return;
  choice=manifest.cases[selector.value];
  if(!choice)return;
  const token=++runId;
  closeBitmaps();clear();lastFrame=-1;lateFrames=0;
  $('result').hidden=true;portrait.hidden=true;enter.hidden=true;
  $('sample-holder').hidden=true;$('heading').hidden=true;
  wake.hidden=true;skip.hidden=false;
  video.hidden=true;idle.hidden=false;
  video.pause();video.currentTime=0;
  audio.src=file(choice.audio);audio.currentTime=0;audio.muted=muted;
  portraitPromise=image(file(choice.result_image));
  portraitPromise.catch(e=>console.warn('预读结果图失败',e));
  $('prepare-progress').textContent='0 / '+choice.sheets.length+' 组';
  $('preparing').hidden=false;
  state('preparing');setStatus('只准备本次抽中的动物，准备好后才连续播放（不会中途下载图集）');
  prepareBegin=performance.now();
  try{
    const complete=await prepareAllSelected(token);
    if(!complete||token!==runId||phase!=='preparing')return;
    lastPrepareMs=Math.round(performance.now()-prepareBegin);
    $('preparing').hidden=true;
    video.hidden=false;
    // The movie never starts until all selected sprite sheets are DECODED.
    // As a result, none of the sprite intervals must await network or decode.
    state('playing');
    setStatus('透明动物已全部就绪 · 连续播放中；准备耗时 '+lastPrepareMs+'ms');
    audio.play().catch(e=>console.warn('设备可能要求再次手势开启声音',e));
    try{await video.play();}
    catch(e){
      setStatus('浏览器无法播放背景视频，可点击跳过：'+e.message);
      console.error(e);
      return;
    }
    if(phase==='playing')raf=requestAnimationFrame(render);
  }catch(e){
    if(token!==runId||phase!=='preparing')return;
    $('preparing').hidden=false;
    setStatus('准备失败，可跳过：'+e.message);
    console.error(e);
  }
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
  runId++;cancelAnimationFrame(raf);video.pause();audio.pause();closeBitmaps();
  portrait.hidden=true;portrait.removeAttribute('src');
  video.hidden=true;idle.hidden=false;clear();
  $('again').hidden=true;$('sample-holder').hidden=false;$('heading').hidden=false;
  wake.hidden=false;skip.hidden=true;$('result').hidden=true;enter.hidden=true;
  state('ready');setStatus('可以再次唤醒 · 只下载当前选中的物种');
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
    video.src=file(manifest.shared);video.preload='auto';video.playsInline=true;video.muted=true;
    wake.disabled=false;state('ready');
    setStatus('改进版：动物透明图集按真实区域裁剪，先准备后完整播放');
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
wake.addEventListener('click',start);
skip.addEventListener('click',finish);
enter.addEventListener('click',confirm);
$('again').addEventListener('click',again);
$('sound').addEventListener('click',()=>{muted=!muted;audio.muted=muted;$('sound').textContent=muted?'♪̸':'♪';});
boot();
