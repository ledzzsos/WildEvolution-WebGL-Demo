'use strict';
/* Browser proof only. The visual pixels come from the approved app.js renderer.
   No Unity re-implementation of any soul effect is used. */
const $=id=>document.getElementById(id);
const canvas=$('display'),ctx=canvas.getContext('2d');
const video=$('common-video'),audio=$('selected-audio');
const status=$('status'),wake=$('wake'),skip=$('skip'),enter=$('enter');
const select=$('sample'),tier=$('tier'),beast=$('beast-name');
const manifestUrl='output/manifest.json';
let manifest,poster,idle,selectedCase,phase='loading';
let startTimestamp=0,pausedAt=0,waiting=false,muted=false,loaded={};
let currentFrame=0,renderedFrame=-1,tickHandle=0,downloaded=0;
const qs=new URLSearchParams(location.search);
const fileUrl=name=>'output/'+name;
function setStatus(s){status.textContent=s;}
function setPhase(next){phase=next;$('stage').dataset.phase=next;}
function drawCover(image){ctx.clearRect(0,0,canvas.width,canvas.height);if(image)ctx.drawImage(image,0,0,canvas.width,canvas.height);}
function img(src){const image=new Image();image.decoding='async';image.src=src;return image.decode().then(()=>image);}
async function boot(){
  try{
    const res=await fetch(manifestUrl,{cache:'no-cache'});
    if(!res.ok)throw Error('未找到导出清单');
    manifest=await res.json();
    [poster,idle]=await Promise.all([img(fileUrl(manifest.poster)),img(fileUrl(manifest.idle))]);
    drawCover(idle);
    const options=Object.entries(manifest.cases);
    if(!options.length)throw Error('尚未导出任何结果');
    const forced=qs.get('beast')?.toLowerCase()+(qs.get('tier')==='2'?'2':'');
    for(const [key,c] of options){const o=document.createElement('option');o.value=key;o.textContent=c.label;select.appendChild(o);}
    select.value=manifest.cases[forced]?forced:manifest.cases.wolf2?'wolf2':options[0][0];
    video.src=fileUrl(manifest.shared);
    video.preload='metadata';video.muted=true;video.playsInline=true;
    wake.disabled=false;setPhase('ready');
    setStatus('仅加载公共演出；选择兽魂后才会请求对应图集');
  }catch(error){
    setPhase('error');wake.disabled=true;
    setStatus('实验资源尚未生成：'+error.message+'。请先运行 hybrid/export_hybrid.py');
    console.error(error);
  }
}
const atlasCache=new Map();
function getAtlas(index){
  const file=selectedCase.sheets[index];
  if(!file)return Promise.reject(Error('不存在的图集 '+index));
  if(!atlasCache.has(index))atlasCache.set(index,img(fileUrl(file)));
  return atlasCache.get(index);
}
function paintSprite(frameIndex,sheet){
  drawCover(poster);
  const {region,grid}=manifest;
  const tileW=region[2]-region[0],tileH=region[3]-region[1];
  const within=frameIndex%(grid[0]*grid[1]);
  ctx.drawImage(sheet,(within%grid[0])*tileW,Math.floor(within/grid[0])*tileH,
    tileW,tileH,region[0],region[1],tileW,tileH);
}
function finish(){
  if(phase==='result'||phase==='done')return;
  setPhase('result');cancelAnimationFrame(tickHandle);
  video.pause();audio.pause();
  skip.hidden=true;enter.hidden=false;
  tier.textContent=selectedCase.tier===2?'二阶 · 高阶兽魂':'一阶 · 兽魂化生';
  beast.textContent=selectedCase.label.replace(/[ⅠⅡ]$/,'');
  $('result').hidden=false;
  setStatus('结果已确定 · 点击「踏入山海」');
}
function frame(now){
  if(phase!=='sequence')return;
  const elapsed=(now-startTimestamp)/1000;
  let target=Math.min(selectedCase.frames-1,Math.floor(elapsed*manifest.fps));
  if(target<0)target=0;
  const atlasIndex=Math.floor(target/(manifest.grid[0]*manifest.grid[1]));
  const sheetPromise=atlasCache.get(atlasIndex);
  if(!loaded[atlasIndex]){
    if(!waiting){
      waiting=true;pausedAt=performance.now();audio.pause();
      setStatus('正在加载当前兽魂后续图集…');
      (sheetPromise||getAtlas(atlasIndex)).then(sheet=>{
        loaded[atlasIndex]=sheet;
        startTimestamp+=performance.now()-pausedAt;
        waiting=false;audio.play().catch(()=>{});
        setStatus('兽魂凝形中');
        tickHandle=requestAnimationFrame(frame);
      }).catch(e=>{setStatus('图集加载失败，可跳过：'+e.message);console.error(e);});
    }
    return;
  }
  currentFrame=target;
  if(renderedFrame!==currentFrame){
    paintSprite(currentFrame,loaded[atlasIndex]);renderedFrame=currentFrame;
  }
  if(target>=selectedCase.frames-1){finish();return;}
  // Sliding window: retain only the current and next atlas, not all six.
  for(const key of Object.keys(loaded)){
    if(Number(key)<atlasIndex)delete loaded[key];
  }
  for(const key of atlasCache.keys()){
    if(key<atlasIndex)atlasCache.delete(key);
  }
  const next=atlasIndex+1;
  if(next<selectedCase.sheets.length&&!atlasCache.has(next)){
    getAtlas(next).then(image=>{loaded[next]=image;}).catch(e=>console.warn('Next atlas prefetch failed',e));
  }
  tickHandle=requestAnimationFrame(frame);
}
async function startSequence(){
  if(phase!=='shared')return;
  setPhase('loading-sequence');
  drawCover(poster);
  audio.pause();
  setStatus('公共视频完成 · 准备当前兽魂');
  try{
    loaded[0]=await getAtlas(0);
    // Decode at most two 1600x1760 atlases at a time (~22 MiB decoded).
    // Prefetch the next sheet while the current sheet plays.
    if(selectedCase.sheets.length>1)
      getAtlas(1).then(sheet=>{loaded[1]=sheet;}).catch(e=>console.warn('预读失败，播放时重试',e));
    setPhase('sequence');startTimestamp=performance.now();
    setStatus('兽魂凝形中');audio.play().catch(()=>{});
    tickHandle=requestAnimationFrame(frame);
  }catch(e){setStatus('当前兽魂加载失败，可跳过：'+e.message);}
}
function awaken(){
  if(phase!=='ready')return;
  const key=select.value, choice=manifest.cases[key];
  if(!choice)return;
  selectedCase=choice;
  setPhase('shared');wake.hidden=true;skip.hidden=false;$('sample-holder').hidden=true;$('heading').hidden=true;
  $('result').hidden=true;enter.hidden=true;
  loaded={};atlasCache.clear();currentFrame=0;renderedFrame=-1;waiting=false;
  setStatus('公共魂火演出播放中…');
  // Initiated in a real click gesture; video is silent, selected-only audio is fetched once.
  // No other beasts' audio or atlas packs are preloaded.
  audio.src=fileUrl(choice.audio);audio.muted=muted;
  audio.currentTime=0;
  audio.play().catch(e=>{console.warn('声音需手势解锁',e);setStatus('声音可能需要设备手势授权');});
  getAtlas(0).then(sheet=>{loaded[0]=sheet;}).catch(e=>console.warn('首张图集预取失败',e));
  video.currentTime=0;
  video.play().catch(e=>{setStatus('无法播放公共视频：'+e.message);console.error(e);});
  function drawVideo(){
    if(phase!=='shared')return;
    if(video.readyState>=2)ctx.drawImage(video,0,0,432,768);
    tickHandle=requestAnimationFrame(drawVideo);
  }
  tickHandle=requestAnimationFrame(drawVideo);
}
wake.addEventListener('click',awaken);
skip.addEventListener('click',finish);
enter.addEventListener('click',()=>{
  if(phase!=='result')return;
  setPhase('done');
  const data={species:selectedCase.species,tier:selectedCase.tier};
  $('result').hidden=true;enter.hidden=true;
  setStatus('确认结果：'+selectedCase.label+'。正式游戏可由桥接接口启动 Unity 战斗。');
  // Future WebGL/mini-game native bridge. No implicit second random draw.
  if(typeof window.onSoulAwakeningConfirmed==='function')window.onSoulAwakeningConfirmed(data);
  $('again').hidden=false;
});
$('again').addEventListener('click',()=>{
  cancelAnimationFrame(tickHandle);audio.pause();video.pause();
  $('again').hidden=true;wake.hidden=false;skip.hidden=true;
  $('sample-holder').hidden=false;$('heading').hidden=false;$('result').hidden=true;
  drawCover(idle);setPhase('ready');setStatus('再次唤醒 · 仅按需下载选择的结果');
});
$('sound').addEventListener('click',()=>{
  muted=!muted;audio.muted=muted;$('sound').textContent=muted?'♪̸':'♪';
});
video.addEventListener('ended',startSequence);
boot();
