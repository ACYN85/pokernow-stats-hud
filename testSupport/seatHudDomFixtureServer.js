'use strict';
// Local-only browser verification. Serves exact production functions, never a
// handwritten replacement for geometry, detection, clipping, or pointer drag.
var http=require('http'),fs=require('fs'),path=require('path');
var root=path.join(__dirname,'..'), source=require('./seatHudDomSource.js');
var runtime=`function createSeatHudFixtureRuntime(layer, relayout, notify) {
var seatOverlayLayer=layer, seatOverlayController={records:new Map()}, manualOverlayPositions={};
var expandedPokerNowPanelLayerElements=new Map(), seatHudLogPanelState={open:false,revision:0}, seatHudBlockingPanelState={};
var nativePanelOcclusionFrame=null, extensionCleanedUp=false, activePanel=null;
var nativePanelLayeringDiagnostics=[],lastNativePanelLayeringSignature='',seatHudPositionDiagnostics=new Map();
var hudUiPreferences={settingsOpen:false}, SEMANTIC_BLOCKING_PANEL_SELECTOR='dialog[open], [role="dialog"], [aria-modal="true"], [class*="ledger" i]';
var overlayDraggingUnlocked=true,activeOverlayDrag=null,overlayDragBehaviors=new WeakMap(),overlayDragTraceSequence=0,overlayDragTimeline=[];
var deferredSeatDiscoveryDuringOverlayDrag=null,deferredSeatReconcileDuringOverlayDrag=null;
var STORAGE_KEYS={manualOverlayPositions:'fixture-only'},pokerNowGameId='fixture',storageNamespace='fixture';
var chrome={storage:{local:{set:function(){notify();},get:function(_,cb){cb({});},remove:function(_,cb){cb();}}}};
function cloneJson(value){return JSON.parse(JSON.stringify(value));}
function seatOverlaysVisible(){return true;}
function scheduleSeatOverlayReconcile(){relayout();}
function scheduleSeatDiscovery(){relayout();}
function scheduleHeroPotOddsAnchorReconcile(){}
function openPlayerDashboard(){notify('HUD click');}
function closeStatTooltip(){}
${source.source()}
return {resolve:resolvePlayerVisualGeometry,records:seatOverlayController.records,install:installDragBehavior,reset:resetOverlayPositions,
offsets:function(){return manualOverlayPositions;},layer:function(){refreshSeatHudLogPanelState('fixture');applyNativePanelOcclusion('fixture');},
state:function(){return seatHudBlockingPanelState;},settings:function(value){hudUiPreferences.settingsOpen=value;},trace:function(){return overlayDragTimeline;}};
}`;
var files=new Set(['hud.css','seatOverlay.js','playerProfileClassifier.js','playerProfilePresentation.js','playerProfileExplanation.js','overlayStats.js']);
http.createServer(function(req,res){
  var name=decodeURIComponent(req.url.split('?')[0]).slice(1);
  if(name==='runtime.js'){res.setHeader('Content-Type','text/javascript');return res.end(runtime);}
  var target=name===''?path.join(__dirname,'seatHudDomFixture.html'):name==='center-bottom.html'?path.join(__dirname,'seatHudCenterBottomFixture.html'):name==='live-panel.html'?path.join(__dirname,'seatHudLivePanelFixture.html'):files.has(name)?path.join(root,name):null;
  if(!target){res.statusCode=404;return res.end('Not found');}
  res.setHeader('Content-Type',name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(target));
}).listen(8765,'127.0.0.1',function(){console.log('Seat HUD production DOM fixture: http://127.0.0.1:8765/');});
