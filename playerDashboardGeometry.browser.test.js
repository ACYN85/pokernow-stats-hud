'use strict';
// Real DOM/layout coverage using the installed Chrome binary; no npm dependency.
const assert=require('assert'), fs=require('fs'), os=require('os'), path=require('path'), cp=require('child_process');
if(!process.argv.includes('--browser')){console.log('Dashboard browser layout test: run with --browser to launch installed Chrome.');process.exit(0);}
const chrome=process.env.CHROME_BIN || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
if(!fs.existsSync(chrome)){console.log('SKIP Dashboard browser test: set CHROME_BIN to installed Chrome.');process.exit(0);}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pnhud-dashboard-dom-'));
const test=function(){
 const errors=[];let checks=0;function check(value,label){checks++;if(!value)errors.push(label);}
 try {
 const panel=document.createElement('section');panel.id='pnhud-player-dashboard';document.body.append(panel);
 const state={mode:'session',playerId:'a',displayName:'A player with a long display name',noteDraft:'A note'};
 panel.innerHTML=PokerPlayerDashboard.render(state);const memory={geometry:null};const controller=PokerPlayerDashboard.createGeometryController(panel,window,memory);
 const r=panel.getBoundingClientRect();const expectedHeight=Math.min(680,innerHeight*.86,innerHeight-16);
 const expectedWidth=innerWidth<=700?innerWidth-16:innerWidth<=1280?Math.min(560,innerWidth*.45-18):560;check(Math.abs(r.width-expectedWidth)<1,'default width');check(Math.abs(r.height-expectedHeight)<1,'default height');check(Math.abs(r.right-(innerWidth-(innerWidth<=700?8:12)))<1,'default right');check(Math.abs(r.top-(innerHeight-r.height)/2)<1,'default vertical center');
 function filterRects(){
  const row=panel.querySelector('.pnhud-dashboard-filter-row');
  const source=panel.querySelector('.pnhud-dashboard-tabs');
  const controls=['table-size','situation','position'].map(function(name){return panel.querySelector('.pnhud-dashboard-'+name);});
  check(Boolean(row&&source&&controls.every(Boolean)),'source and all context filters remain mounted');
  check(Boolean(source.querySelector('[data-dashboard-mode="session"]')&&source.querySelector('[data-dashboard-mode="career"]')),'Session and Career remain the source control');
  controls.forEach(function(label){check(Boolean(label.querySelector('select')&&label.contains(label.querySelector('select'))),'filter label retains its select');});
  return {row:row,source:source.getBoundingClientRect(),context:controls.map(function(label){return label.getBoundingClientRect();})};
 }
 const normal=filterRects();
 check(normal.source.bottom<normal.context[0].top,'source selector has a dedicated first row');
 check(normal.context.every(function(rect){return Math.abs(rect.top-normal.context[0].top)<1;}),'Table, Situation, and Position share the normal-width context row');
 function pointer(type,target,x,y){target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:1,isPrimary:true,button:0,buttons:type==='pointerup'?0:1,clientX:x,clientY:y}));}
 const header=panel.querySelector('header');pointer('pointerdown',header,r.left+20,r.top+20);pointer('pointermove',document,r.left+20,r.top+20);check(memory.geometry===null,'no grab jump');pointer('pointermove',document,r.left-80,r.top+40);pointer('pointerup',document,0,0);
 check(Math.abs(panel.getBoundingClientRect().left-Math.max(8,r.left-100))<1,'drag exact delta');
 const draggedSize={width:panel.getBoundingClientRect().width,height:panel.getBoundingClientRect().height};controller.resetPosition();const resetRect=panel.getBoundingClientRect();
 check(memory.positionCustomized===false,'reset clears customized position');check(Math.abs(resetRect.right-(innerWidth-(innerWidth<=700?8:12)))<1,'reset responsive right');check(Math.abs(resetRect.top-(innerHeight-resetRect.height)/2)<1,'reset vertical center');check(Math.abs(resetRect.width-draggedSize.width)<1&&Math.abs(resetRect.height-draggedSize.height)<1,'reset preserves size');
 const before=JSON.stringify(memory.geometry);const close=panel.querySelector('.pnhud-dashboard-close');pointer('pointerdown',close,20,20);pointer('pointermove',document,100,100);pointer('pointerup',document,0,0);check(JSON.stringify(memory.geometry)===before,'button cannot drag');
 const resize=panel.querySelector('.pnhud-dashboard-resize');pointer('pointerdown',resize,500,500);pointer('pointermove',document,350,350);pointer('pointerup',document,0,0);check(Math.abs(panel.getBoundingClientRect().width-Math.max(320,r.width-150))<1,'resize width');
 pointer('pointerdown',resize,500,500);pointer('pointermove',document,-900,-900);pointer('pointerup',document,0,0);check(panel.getBoundingClientRect().width===320,'minimum width');check(panel.getBoundingClientRect().height===240,'minimum height');
 const narrow=filterRects();const rowBounds=narrow.row.getBoundingClientRect();
 check(narrow.context.some(function(rect){return rect.top>narrow.context[0].top+1;}),'narrow context filters wrap within their group');
 check(narrow.row.scrollWidth<=narrow.row.clientWidth+1,'narrow filters introduce no horizontal overflow');
 check(narrow.context.every(function(rect){return rect.left>=rowBounds.left-1&&rect.right<=rowBounds.right+1;}),'narrow context controls remain within Dashboard');
 controller.resetPosition();check(panel.getBoundingClientRect().width===320&&panel.getBoundingClientRect().height===240,'reset preserves resized dimensions');
 const body=panel.querySelector('.pnhud-dashboard-body');check(getComputedStyle(body).overflowY==='auto','internal scrolling owner');check(body.scrollHeight>body.clientHeight,'body overflow scrollable');body.scrollTop=100;check(body.scrollTop>0,'scroll responds');
 const saved=JSON.stringify(memory.geometry);panel.hidden=true;controller.cancel();panel.innerHTML=PokerPlayerDashboard.render(Object.assign({},state,{playerId:'b',displayName:'Another player'}));panel.hidden=false;controller.sync();check(JSON.stringify(memory.geometry)===saved,'geometry retained across rerender/reopen');
 const corner=panel.querySelector('.pnhud-dashboard-resize');corner.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true,cancelable:true}));check(memory.geometry.width===330,'keyboard resize');
 pointer('pointerdown',corner,400,400);pointer('pointermove',document,10000,10000);pointer('pointerup',document,0,0);const big=panel.getBoundingClientRect();check(big.right<=innerWidth-8+.1&&big.bottom<=innerHeight-8+.1,'viewport maximum');
 pointer('pointerdown',panel.querySelector('header'),50,50);controller.dispose();const disposed=JSON.stringify(memory.geometry);pointer('pointermove',document,80,80);check(JSON.stringify(memory.geometry)===disposed,'dispose cancels active drag');
 check(getComputedStyle(panel).zIndex==='2147483647','existing dashboard layer unchanged');
 }catch(error){errors.push(error.stack||String(error));}
 document.body.innerHTML='<pre id="result">'+JSON.stringify({checks:checks,errors:errors})+'</pre>';
};
const html='<!doctype html><meta charset="utf-8"><style>'+fs.readFileSync(path.join(__dirname,'hud.css'),'utf8')+'</style><body><script>'+fs.readFileSync(path.join(__dirname,'statEvidence.js'),'utf8')+'</script><script>'+fs.readFileSync(path.join(__dirname,'playerDashboard.js'),'utf8')+'</script><script>('+test.toString()+')()</script>';
fs.writeFileSync(path.join(dir,'test.html'),html);
try {
const result=cp.spawnSync(chrome,['--headless','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-extensions','--window-size='+(process.env.DASHBOARD_TEST_WINDOW || '1200,900'),'--user-data-dir='+path.join(dir,'profile'),'--dump-dom','file:///'+path.join(dir,'test.html').replaceAll('\\','/')],{encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:2e6});
if(result.error)throw result.error;
const match=result.stdout.match(/<pre id="result">(\{[^<]+)<\/pre>/);assert.ok(match,'Chrome must finish DOM assertions: '+result.stderr);
const report=JSON.parse(match[1].replaceAll('&gt;','>').replaceAll('&lt;','<').replaceAll('&amp;','&'));
assert.deepStrictEqual(report.errors,[]);console.log('Installed Chrome real DOM Dashboard: '+report.checks+' checks passed.');

} finally {
  const resolved=path.resolve(dir); const tempRoot=path.resolve(os.tmpdir())+path.sep;
  if (!resolved.startsWith(tempRoot) || !path.basename(resolved).startsWith('pnhud-dashboard-dom-')) throw new Error('Unexpected browser fixture cleanup path');
  fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
