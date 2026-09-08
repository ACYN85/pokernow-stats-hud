'use strict';
var assert=require('assert'),vm=require('vm'),source=require('./testSupport/seatHudDomSource.js'),overlay=require('./seatOverlay.js');
var evidence=require('./fixtures/synthetic-seat-panel-layout.json');
function box(r){return Object.assign({},r,{right:r.left+r.width,bottom:r.top+r.height});}
function element(classes,r,text){
  var e={tagName:'DIV',id:'',className:classes,textContent:text||'',isConnected:true,parentElement:null,children:[],dataset:{},box:box(r),style:{display:'block',visibility:'visible',backgroundColor:'rgba(0, 0, 0, 0)',backgroundImage:'none'}};
  e.classList=classes.split(' ');e.getAttribute=function(){return null;};e.getBoundingClientRect=function(){return this.box;};e.getClientRects=function(){return this.isConnected?[this.box]:[];};
  e.matches=function(selector){return selector.split(',').some(function(s){s=s.trim();if(s==='*')return true;if(/^\.[\w-]+$/.test(s))return e.className.split(' ').includes(s.slice(1));var m=s.match(/^\[class\*="([^"]+)" i\]$/);return m?e.className.toLowerCase().includes(m[1].toLowerCase()):false;});};
  e.closest=function(selector){for(var c=this;c;c=c.parentElement)if(c.matches(selector))return c;return null;};
  e.querySelectorAll=function(selector){var all=[];this.children.forEach(function(c){if(c.matches(selector))all.push(c);all=all.concat(c.querySelectorAll(selector));});return all;};
  e.querySelector=function(selector){return this.querySelectorAll(selector)[0]||null;};
  e.append=function(c){c.parentElement=this;this.children.push(c);return c;};return e;
}
var ctx={document:{documentElement:null},PokerSeatOverlay:overlay,getComputedStyle:function(e){return e.style;},console:console};vm.createContext(ctx);
vm.runInContext(source.geometry.concat(['isExtensionOwnedUiElement','isVisible']).map(source.sourceFunction).join('\n'),ctx);
function fixture(record,state){
  var r=record.panelRect,seat=element('table-player '+state, {left:r.left-60,top:r.top-60,width:r.width+200,height:r.height+240});
  var panel=seat.append(element('table-player-infos-ctn',r));panel.style.backgroundColor=evidence.panelComputedStyle.backgroundColor;
  var inner=panel.append(element('infos-ctn-container',{left:r.left,top:r.top,width:r.width,height:0}));
  var name=inner.append(element('table-player-name',record.nameRect||{left:r.left+r.width*.52,top:r.top+20,width:100,height:21},record.name));
  var stack=inner.append(element('table-player-stack',{left:r.left+r.width*.52,top:r.top+r.height*.5,width:90,height:18},'264.33'));
  seat.append(element('player-table-signals-container top',{left:r.left+r.width-15,top:r.top-30,width:150,height:40},'21 2'));
  seat.append(element('table-player-status-icon '+state,{left:r.left,top:r.top,width:r.width*.5,height:r.height},state));
  seat.append(element('table-player-cards custom-avatar',{left:r.left-100,top:r.top-80,width:300,height:200}));
  seat.append(element('emoji-container action-bubble',{left:r.left+100,top:r.top+r.height+100,width:250,height:150}));
  return {seat:seat,panel:panel,inner:inner,name:name,stack:stack};
}
function place(v,viewport,offset){return overlay.layoutCanonicalSeatHudOverlays([{playerId:'p',rect:v.rect,visualRect:v.rect}],{p:{width:180,height:32}},viewport||{width:1600,height:1100},offset||{}).placements.get('p');}
var cases=0;
[2,3,4,6,9].forEach(function(count){['active','folded','away','offline','in-next-hand','avatar'].forEach(function(state){evidence.seats.concat(evidence.wideSeats).forEach(function(record){
  var f=fixture(record,state),v=ctx.resolvePlayerVisualGeometry(f.seat,record.name,264.33),p=place(v);
  assert.strictEqual(v.playerPanelBodySource,'live_panel');assert.strictEqual(v.rect.left,record.panelRect.left);assert.strictEqual(v.rect.bottom,record.panelRect.bottom);
  assert.ok(Math.abs(record.nameCenterX-record.panelCenterX)>10,'live name center differs from panel center');
  assert.ok(Math.abs(p.canonicalRect.left+90-record.panelCenterX)<1e-6,count+' seats '+state+' panel X');
  assert.ok(Math.abs(p.canonicalRect.top-record.panelRect.bottom-8)<1e-6,'direct panel Y');
  assert.strictEqual(v.horizontalVisualRect,v.verticalPanelRect,'one real box owns both axes');
  [f.panel,f.inner,f.name,f.stack].forEach(function(anchor){var nested=ctx.resolvePlayerVisualGeometry(anchor,record.name,264.33);assert.strictEqual(nested.rect.bottom,v.rect.bottom,'narrow identity subtree can reach its own panel');assert.strictEqual(nested.rect.centerX,v.rect.centerX);});
  f.name.textContent='An extremely long username';f.name.box=box({left:record.panelRect.left+90,top:record.panelRect.top+12,width:500,height:60});f.stack.textContent='999999999.99';
  assert.strictEqual(ctx.resolvePlayerVisualGeometry(f.seat,f.name.textContent,999999999.99).rect.centerX,v.rect.centerX,'name/stack changes never shift panel center');
  var offsets={p:{offsetX:31,offsetY:-9}},before=JSON.stringify(offsets),manual=place(v,null,offsets);
  assert.strictEqual(manual.requestedRect.left-manual.canonicalRect.left,31);assert.strictEqual(manual.requestedRect.top-manual.canonicalRect.top,-9);assert.strictEqual(JSON.stringify(offsets),before);
  assert.strictEqual(p.manualOffsetX,0);assert.strictEqual(p.manualOffsetY,0);
  var small=place(v,{width:200,height:120},offsets),large=place(v,{width:1600,height:1100},offsets);
  assert.strictEqual(small.viewportClampApplied,true);assert.deepStrictEqual(small.canonicalRect,large.canonicalRect);assert.deepStrictEqual(small.requestedRect,large.requestedRect);assert.strictEqual(large.viewportClampApplied,false);
  var d=ctx.seatHudPanelBodyAlignmentDiagnostic(v.reference,v.rect,p.canonicalRect);assert.strictEqual(d.centerDeltaX,0);assert.ok(Math.abs(d.verticalGap-8)<1e-6);assert.strictEqual(d.playerPanelBodySource,'live_panel');assert.doesNotThrow(function(){JSON.stringify(d);});
  f.panel.isConnected=false;var replacement=fixture(record,state).panel;replacement.box=box({left:record.panelRect.left-25,top:record.panelRect.top+10,width:record.panelRect.width+20,height:record.panelRect.height+15});f.seat.children=f.seat.children.filter(function(c){return c!==f.panel;});f.seat.append(replacement);
  var fresh=ctx.resolvePlayerVisualGeometry(f.seat,record.name,264.33);assert.strictEqual(fresh.rect.left,replacement.box.left);assert.strictEqual(fresh.rect.bottom,replacement.box.bottom);cases++;
});});});
var f=fixture(evidence.seats[0],'offline');f.panel.style.backgroundColor='rgba(0, 0, 0, 0)';
assert.strictEqual(ctx.resolvePlayerPanelBodyGeometry(f.seat),null,'transparent lookalike is not a painted body');
assert.strictEqual(ctx.resolvePlayerVisualGeometry(f.seat,'PlayerA',852.17).reference.playerPanelBodySource,'visual_fallback','missing painted body is explicitly diagnosed');
f.panel.style.backgroundColor=evidence.panelComputedStyle.backgroundColor;f.panel.style.display='none';assert.strictEqual(ctx.resolvePlayerPanelBodyGeometry(f.seat),null,'hidden body is unavailable');
f.panel.style.display='block';f.panel.dataset.pnhudOwned='true';assert.strictEqual(ctx.resolvePlayerPanelBodyGeometry(f.seat),null,'extension-owned body is rejected');delete f.panel.dataset.pnhudOwned;
f.seat.append(fixture(evidence.seats[0],'active').panel);assert.strictEqual(ctx.resolvePlayerPanelBodyGeometry(f.seat),null,'multiple direct bodies fail to fallback instead of guessing');
var bare=element('table-player', {left:100,top:100,width:200,height:90});assert.strictEqual(ctx.resolvePlayerVisualGeometry(bare,'absent',0).reference.playerPanelBodySource,'seat_fallback');
bare.isConnected=false;assert.strictEqual(ctx.resolvePlayerVisualGeometry(bare,'absent',0),null,'disconnected seat cannot retain stale geometry');
console.log('Live-panel body production geometry passed: '+cases+' recorded-geometry/state/table-size cases; narrow anchors, decorations, long names/stacks, reset/offset/remount/clamp, explicit fallbacks and alignment diagnostics.');
