'use strict';
var assert = require('assert');
var vm = require('vm');
var source = require('./testSupport/seatHudDomSource.js');
var overlay = require('./seatOverlay.js');
function rect(x, y, w, h) { return { left: x, top: y, width: w, height: h, right: x + w, bottom: y + h }; }
function element(text, box, classes, parent) {
  var values = new Set((classes || '').split(' ').filter(Boolean));
  var el = { textContent: text, innerText: text, id: '', tagName: 'DIV', dataset: {}, parentElement: parent || null, isConnected: true, style: { position: 'static', removeProperty: function (key) { delete this[key === 'clip-path' ? 'clipPath' : key]; } },
    get className() { return Array.from(values).join(' '); }, classList: { add: function (v) { values.add(v); }, remove: function () { Array.from(arguments).forEach(function (v) { values.delete(v); }); }, contains: function (v) { return values.has(v); }, [Symbol.iterator]: function () { return values[Symbol.iterator](); } },
    getAttribute: function () { return null; }, getClientRects: function () { return this.isConnected ? [box] : []; }, getBoundingClientRect: function () { return box; }, closest: function () { return null; }, querySelectorAll: function () { return []; } };
  return el;
}
var html = element('', rect(0,0,1280,720)); html.tagName = 'HTML';
var doc = { documentElement: html, body: element('', rect(0,0,1280,720), '', html), getElementById: function () { return null; }, createTreeWalker: function (el) { var nodes = (el.textNodes || []).slice(); return { nextNode: function () { return nodes.shift() || null; } }; }, createRange: function () { var text; return { selectNodeContents: function (node) { text = node; }, getClientRects: function () { return [text.rect]; } }; } };
var context = { document: doc, window: { innerWidth:1280, innerHeight:720 }, NodeFilter:{SHOW_TEXT:4}, PokerSeatOverlay:overlay, getComputedStyle:function(el){return Object.assign({display:'block',visibility:'visible',opacity:'1',transform:'none'},el.style);}, expandedPokerNowPanelLayerElements:new Map(), console:console };
vm.createContext(context);
vm.runInContext(source.geometry.concat(source.panels).map(source.sourceFunction).join('\n'), context);
function textNode(el, text, box) { el.textNodes = [{ nodeValue:text, parentElement:el, rect:box }]; }
[2,3,4,6,9].forEach(function (count) {
  for(var i=0;i<count;i++) {
    var name=element('Player '+i,rect(100,100,260,30),'table-player-name'); textNode(name,'Player '+i,rect(112,104,56,16));
    var stack=element('1000',rect(100,126,280,22),'table-player-stack'); textNode(stack,'1000',rect(180,128,36,16));
    var cards=element('',rect(112,90,56,72),'table-player-cards');
    var seat=element('',rect(30,50,410,150));
    name.parentElement=seat;stack.parentElement=seat;cards.parentElement=seat;
    seat.querySelector=function(){return stack;};
    cards.matches=function(){return true;};
    seat.querySelectorAll=function(selector){return selector.indexOf('a[href')===0?[name]:selector.indexOf('.table-player-name')===0?[cards]:[];};
    var visual=context.resolvePlayerVisualGeometry(seat,'Player '+i,1000);
    assert.strictEqual(visual.rect.centerX,140,'wide name/stack wrappers and right-aligned chip text cannot bias X');
    assert.strictEqual(visual.rect.bottom,162,'current player cards provide vertical clearance');
    var placement=overlay.layoutCanonicalSeatHudOverlays([{playerId:'p',rect:seat.getBoundingClientRect(),visualRect:visual.rect}],{p:{width:180,height:30}},{width:1280,height:720},{p:{offsetX:20,offsetY:-5}}).placements.get('p');
    assert.strictEqual(placement.canonicalRect.left+90,140);assert.strictEqual(placement.canonicalRect.top,170);
    assert.strictEqual(placement.requestedRect.left-placement.canonicalRect.left,20);
    textNode(name,'Player '+i,rect(92,104,56,16));
    assert.strictEqual(context.resolvePlayerVisualGeometry(seat,'Player '+i,1000).rect.centerX,120,'replacement/current text is remeasured');
  }
});
// Y belongs to complete panel boxes, not the glyph bottom used by the old resolver.
[2,3,4,6,9].forEach(function(count){
  ['active','folded','avatar','cards','long-name','stack','badge','action-wrapper'].forEach(function(kind,index){
    var y=index%3===2?630:80+index*8;
    var seat=element('',rect(10,y-40,480,340),'broad-fold-action-wrapper');
    var panel=element('',rect(100,y,240,110),'table-player-panel '+(kind==='folded'?'folded':'active'),seat);
    var label=kind==='long-name'?'A rather long player name':'PlayerC',width=kind==='long-name'?170:44;
    var name=element(label,rect(100,y+10,230,30),'table-player-name',panel);textNode(name,label,rect(112,y+14,width,16));
    var stack=element('1000',rect(100,y+40,240,45),'table-player-stack',panel);textNode(stack,'1000',rect(240,y+43,40,16));
    var card=element('',rect(90,y-20,180,kind==='avatar'?220:kind==='cards'?190:45),kind==='avatar'?'custom-avatar':'table-player-cards',panel);
    var badge=element('',rect(100,y+290,200,40),'player-card trophy-badge',seat);
    var action=element('',rect(100,y+240,300,50),'player-panel action-animation',seat);
    var candidates=[panel,name,stack,card,badge,action];
    candidates.forEach(function(el){el.matches=function(){return true;};});
    seat.querySelector=function(){return stack;};
    seat.querySelectorAll=function(selector){return selector.indexOf('a[href')===0?[name]:selector.indexOf('.table-player-name')===0?candidates:[];};
    var visual=context.resolvePlayerVisualGeometry(seat,label,1000);
    var bottom=y+(kind==='avatar'?200:kind==='cards'?170:110);
    assert.strictEqual(visual.horizontalVisualRect.left+visual.horizontalVisualRect.width/2,112+width/2,kind+' compact X');
    assert.strictEqual(visual.verticalPanelRect.bottom,bottom,kind+' complete player panel bottom');
    assert.strictEqual(visual.reference.verticalAnchorSource,'complete-visible-player-panel');
    assert.doesNotThrow(function(){JSON.stringify(visual.reference);},'JSON-safe diagnostics');
    var offsets={p:{offsetX:31,offsetY:-9}},saved=JSON.stringify(offsets);
    function place(v,viewport,manual){return overlay.layoutCanonicalSeatHudOverlays([{playerId:'p',rect:seat.getBoundingClientRect(),visualRect:v.rect}],{p:{width:180,height:32}},viewport,manual).placements.get('p');}
    var reset=place(visual,{width:1280,height:720},{}),manual=place(visual,{width:1280,height:720},offsets);
    assert.strictEqual(reset.canonicalRect.left+90,112+width/2,count+' seats '+kind+' center');
    assert.strictEqual(reset.canonicalRect.top,bottom+8,count+' seats '+kind+' below full panel');
    assert.strictEqual(reset.manualOffsetX,0);assert.strictEqual(reset.manualOffsetY,0);
    assert.ok(reset.canonicalRect.top>stack.getBoundingClientRect().bottom,'zero-offset canonical clears stack box');
    assert.strictEqual(manual.requestedRect.left-reset.canonicalRect.left,31);
    assert.strictEqual(manual.requestedRect.top-reset.canonicalRect.top,-9);
    assert.strictEqual(JSON.stringify(offsets),saved,'offset storage unchanged');
    var short=place(visual,{width:640,height:160},{}),expanded=place(visual,{width:1280,height:1200},{});
    assert.strictEqual(short.canonicalRect.top,bottom+8,'clamp never redefines canonical intent');
    assert.strictEqual(short.viewportClampApplied,true);assert.strictEqual(expanded.viewportClampApplied,false);
    assert.strictEqual(expanded.top,expanded.requestedRect.top,'expansion restores request');
    panel.isConnected=false;name.isConnected=false;stack.isConnected=false;card.isConnected=false;
    var replacement=element('',rect(120,y,230,250),'table-player-panel folded',seat);
    name=element(label,rect(120,y+10,220,30),'table-player-name',replacement);textNode(name,label,rect(132,y+14,width,16));
    stack=element('1000',rect(120,y+40,230,40),'table-player-stack',replacement);textNode(stack,'1000',rect(240,y+44,40,16));
    replacement.matches=function(){return true;};candidates=[replacement,badge,action];
    var remount=context.resolvePlayerVisualGeometry(seat,label,1000);
    assert.strictEqual(remount.rect.centerX,visual.rect.centerX+20,'remount re-resolves X');
    assert.strictEqual(remount.verticalPanelRect.bottom,y+250,'remount re-resolves Y');
  });
});
['session_log','ledger','replayer','account_game_menu'].forEach(function(type){
  var app=element('',rect(0,0,1280,720),'app',doc.body);app.style.transform='translateZ(0)';app.style.zIndex='1';
  var panel=element('',rect(100,80,400,350),'expanded-panel',app);
  var labels=type==='account_game_menu'?['Game Configurations','Preferences','Video/Audio']:[type==='replayer'?'Replayer':type==='ledger'?'Ledger':'SESSION LOG','Full Log'];
  var controls=labels.map(function(label){return element(label,rect(110,90,80,20),'',panel);});
  panel.querySelectorAll=function(){return controls;};
  doc.querySelectorAll=function(){return controls;};
  var found=context.discoverSeatHudExpandedSurfaces();
  assert.strictEqual(found.length,1);assert.strictEqual(found[0].kind,type,'case-insensitive controls and account menu command groups are recognized');
  context.applyExpandedPokerNowPanelLayerMarker(panel,type);
  assert.ok(panel.classList.contains('pokernow-hud-expanded-panel-layer'));
  var hud=element('',rect(470,120,180,36),'pnhud-seat-overlay');hud.id='pnhud-test';
  var before=JSON.stringify(hud.getBoundingClientRect());
  var visible=context.applySeatHudExpandedPanelOcclusion(hud,[panel.getBoundingClientRect()]);
  assert.ok(visible.occluded&&!visible.fullyOccluded);assert.ok(hud.style.clipPath.includes('M 30 0'));
  assert.strictEqual(JSON.stringify(hud.getBoundingClientRect()),before,'occlusion never changes geometry');
  context.applySeatHudExpandedPanelOcclusion(hud,[]);assert.ok(!hud.style.clipPath);
  context.clearExpandedPokerNowPanelLayerMarker(null);assert.ok(!panel.classList.contains('pokernow-hud-expanded-panel-layer'));
});
console.log('Production painted-text geometry, card clearance, 2/3/4/6/9 seats, current-node replacement, nested-context log/menu detection, partial clip/hit-region and cleanup regressions passed.');
