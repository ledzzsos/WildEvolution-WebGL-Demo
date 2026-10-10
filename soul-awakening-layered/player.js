'use strict';
// One uninterrupted background video. Original app.js is the source of all
// animal/unique FX pixels, exported with genuine alpha (no background subtraction).
// The native video element decodes on its own; canvas ONLY paints animal atlases.
const $=id=>document.getElementById(id);
const video=$('common-video'),spriteCanvas=$('animal-layer'),ctx=spriteCanvas.getContext('2d');
const idleImage=$('idle-poster'),resultImage=$('result-picture');
const audio=$('selected-audio'),wake=$('wake'),skip=$('skip'),enter=$('enter');
const select=$('sample'),status=$('status'),tier=$('tier'),beast=$('beast-name');
const manifestUrl='output/manifest.json?v=2';
const url=path=>'output/'+path;
const qs=new URLSearchParams(location.search);
let manifest,choice,chosenKey='',phase='loading',muted=false,runId=0;
let rafId=0,lastFrame=-1,cache=new Map(),decoded=new Map(),resultPicturePromise;
let missingAlert=false;
const setStatus=s=>{if(status.textContent!==s)status.textContent=s;};
const setPhase=s=>{phase=s;$('stage').dataset.phase=s;};
const sleepFrame=()=>new Promise(done=>requestAnimationFrame(done));
function loadImage(source){
  const image=new Image();image.decoding='async';image.src=source;
  return image.decode().then(()=>image);
}
function requestAtlas(i,token=runId){
  if(i<0||i>=choice.sheets.length)return Promise.reject(Error('图集越界'));
  if(!cache.has(i)){
    const path=url(choice.sheets[i]);
    const promise=loadImage(path).then(image=>{
      if(token===runId)decoded.set(i,image);
      return image;
    });
    cache.set(i,promise);
  }
  return cache.get(i);
}
function clearAnimal(){
  ctx.clearRect(0,0,spriteCanvas.width,spriteCanvas.height);
}
function drawAnimal(index,atlas){
  const [x0,y0,x1,y1]=manifest.region,[columns,rows]=manifest.grid;
  const width=x1-x0,height=y1-y0,within=index%(columns*rows);
  clearAnimal();
  ctx.drawImage(atlas,(within%columns)*width,Math.floor(within/columns)*height,
    width,height,x0,y0,width,height);
}
function evictPast(i){
  for(const n of decoded.keys())if(n<i)decoded.delete(n);
  for(const n of cache.keys())if(n<i)cache.delete(n);
  // Only the current and next atlas are decoded during normal playback.
  if(i+1<choice.sheets.length && !cache.has(i+1)){
    requestAtlas(i+1).catch(e=>console.warn('下一图集预加载失败',e));
  }
}
function finish(){
  if(phase!=='playing')return;
  setPhase('result');cancelAnimationFrame(rafId);
  video.pause();audio.pause();skip.hidden=true;enter.hidden=false;
  tier.textContent=choice.tier===2?'二阶 · 高阶兽魂':'一阶 · 兽魂化生';
  beast.textContent=choice.label.replace(/[ⅠⅡ]$/,'');
  $('result').hidden=false;
  if(resultPicturePromise){
    const token=runId;
    resultPicturePromise.then(image=>{
      if(token===runId&&phase==='result'){
        resultImage.src=image.src;
        resultImage.hidden=false;clearAnimal();
      }
    }).catch(e=>console.warn('静态结果图加载失败',e));
  }
  setStatus('结果已确定 · 点击「踏入山海」');
}
function draw(now){
  if(phase!=='playing')return;
  const t=video.currentTime;
  if(t>=choice.duration-.014){
    finish();return;
  }
  const globalIndex=Math.floor(t*manifest.fps);
  const spriteIndex=globalIndex-manifest.overlay_start_frame;
  if(spriteIndex<0){
    if(lastFrame!==-1){clearAnimal();lastFrame=-1;}
  }else if(spriteIndex<choice.frames&&spriteIndex!==lastFrame){
    const cells=manifest.grid[0]*manifest.grid[1];
    const index=Math.floor(spriteIndex/cells);
    const frame=decoded.get(index);
    if(frame){
      drawAnimal(spriteIndex,frame);lastFrame=spriteIndex;evictPast(index);
      if(missingAlert){missingAlert=false;setStatus('同步播放 · 兽形透明序列帧');}
    }else{
      requestAtlas(index).catch(e=>setStatus('当前图集加载失败，可跳过：'+e.message));
      if(!missingAlert){missingAlert=true;setStatus('正在等待当前兽魂的透明图集…');}
    }
  }
  // Audio/visual alignment follows the VIDEO clock, not separate JS timers.
  // Align only when needed so a small timing jitter doesn't cause crackle.
  if(!audio.paused&&audio.readyState>=2&&Math.abs(audio.currentTime-t)>.22){
    try{audio.currentTime=t;}catch(_){}
  }
  rafId=requestAnimationFrame(draw);
}
async function boot(){
  try{
    const response=await fetch(manifestUrl,{cache:'no-cache'});
    if(!response.ok)throw Error('清单加载失败');
    manifest=await response.json();
    if(manifest.version!==2)throw Error('错误的旧资源版本，刷新页面');
    const available=Object.entries(manifest.cases);
    if(!available.length)throw Error('没有可播放的兽魂资源');
    for(const [key,c] of available){
      const opt=document.createElement('option');opt.value=key;opt.textContent=c.label;select.appendChild(opt);
    }
    const forced=(qs.get('beast')||'').toLowerCase()+(qs.get('tier')==='2'?'2':'');
    select.value=manifest.cases[forced]?forced:manifest.cases.wolf2?'wolf2':available[0][0];
    idleImage.src=url(manifest.idle);
    await idleImage.decode();
    video.src=url(manifest.shared);
    video.muted=true;video.playsInline=true;video.preload='metadata';
    wake.disabled=false;setPhase('ready');
    setStatus('公共视频完整播放；只按需加载选中的动物透明序列帧');
  }catch(e){
    setPhase('error');wake.disabled=true;setStatus('资源尚不可用：'+e.message);
    console.error(e);
  }
}
function awaken(){
  if(phase!=='ready')return;
  choice=manifest.cases[select.value];chosenKey=select.value;
  if(!choice)return;
  runId++;const token=runId;
  cache.clear();decoded.clear();lastFrame=-1;missingAlert=false;clearAnimal();
  $('result').hidden=true;resultImage.hidden=true;enter.hidden=true;
  $('sample-holder').hidden=true;$('heading').hidden=true;
  wake.hidden=true;skip.hidden=false;video.hidden=false;
  video.currentTime=0;audio.src=url(choice.audio);audio.currentTime=0;audio.muted=muted;
  resultPicturePromise=loadImage(url(choice.result_image));
  resultPicturePromise.catch(e=>console.warn('结果图预读失败',e));
  requestAtlas(0,token).catch(e=>console.warn('首图集预读失败',e));
  if(choice.sheets.length>1)requestAtlas(1,token).catch(e=>console.warn('第二图集预读失败',e));
  setPhase('playing');setStatus('公共背景连续播放，动物同步透明叠加');
  // Play operations occur in the direct click handler for mobile permission.
  video.play().catch(e=>{setStatus('无法播放视频：'+e.message);console.error(e);});
  audio.play().catch(e=>{console.warn('音频设备授权失败',e);setStatus('浏览器可能限制声音，请检查静音');});
  rafId=requestAnimationFrame(draw);
}
function confirm(){
  if(phase!=='result')return;
  setPhase('done');$('result').hidden=true;enter.hidden=true;
  $('again').hidden=false;
  const outcome={species:choice.species,tier:choice.tier};
  setStatus('结果已确认：'+choice.label+'。正式接入后由桥接接口进入Unity战斗');
  if(typeof window.onSoulAwakeningConfirmed==='function')window.onSoulAwakeningConfirmed(outcome);
}
function replay(){
  if(phase!=='done')return;
  runId++;cancelAnimationFrame(rafId);audio.pause();video.pause();
  cache.clear();decoded.clear();resultPicturePromise=null;clearAnimal();
  resultImage.hidden=true;resultImage.removeAttribute('src');
  video.hidden=true;idleImage.hidden=false;
  $('sample-holder').hidden=false;$('heading').hidden=false;
  $('result').hidden=true;$('again').hidden=true;
  skip.hidden=true;enter.hidden=true;wake.hidden=false;
  setPhase('ready');setStatus('准备再次唤醒：无需预加载其他动物');
}
video.addEventListener('playing',()=>{
  if(phase==='playing')idleImage.hidden=true;
  if(phase==='playing'&&audio.paused&&!muted)audio.play().catch(()=>{});
});
video.addEventListener('waiting',()=>{if(phase==='playing')audio.pause();});
video.addEventListener('ended',()=>{if(phase==='playing')finish();});
wake.addEventListener('click',awaken);
skip.addEventListener('click',finish);
enter.addEventListener('click',confirm);
$('again').addEventListener('click',replay);
$('sound').addEventListener('click',()=>{
  muted=!muted;audio.muted=muted;$('sound').textContent=muted?'♪̸':'♪';
});
boot();
