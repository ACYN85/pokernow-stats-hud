/* Shared PokerNow game-page scope contract for one Chrome execution world. */
(function (root) {
  'use strict';
  var PNHUD_BUILD_ID = 'v1.1.0-rc3-20260913-1702';
  console.log('[HUD BUILD] runtimeScope ' + PNHUD_BUILD_ID);

  function locationParts(locationLike) {
    try {
      if (!locationLike) return null;
      if (typeof locationLike === 'string') {
        var parsed = new URL(locationLike);
        return { protocol: parsed.protocol, hostname: parsed.hostname, pathname: parsed.pathname };
      }
      return {
        protocol: String(locationLike.protocol || ''),
        hostname: String(locationLike.hostname || ''),
        pathname: String(locationLike.pathname || '').split(/[?#]/)[0]
      };
    } catch (error) {
      return null;
    }
  }

  function isPokerNowGamePage(locationLike) {
    var parts = locationParts(locationLike);
    if (!parts) return false;
    var protocol = String(parts.protocol || '').toLowerCase();
    var hostname = String(parts.hostname || '').toLowerCase();
    var pathname = String(parts.pathname || '');
    if (protocol !== 'https:') return false;
    if (hostname !== 'pokernow.com' && hostname !== 'www.pokernow.com') return false;
    if (pathname.indexOf('/games/') !== 0) return false;
    var gameId = pathname.slice('/games/'.length).split('/')[0];
    return Boolean(gameId && gameId.trim());
  }

  var runtimeScope = Object.freeze({
    buildId: PNHUD_BUILD_ID,
    isPokerNowGamePage: isPokerNowGamePage,
    isSupportedLocation: isPokerNowGamePage
  });
  root.PokerNowRuntimeScope = runtimeScope;
  console.log('[HUD RUNTIME SCOPE] helper installed', {
    namespace: 'globalThis.PokerNowRuntimeScope',
    functionType: typeof runtimeScope.isPokerNowGamePage,
    hostname: typeof location !== 'undefined' ? location.hostname : null,
    worldGlobalIsWindow: typeof window !== 'undefined' && root === window
  });
  if (typeof module !== 'undefined' && module.exports) module.exports = runtimeScope;
})(typeof globalThis !== 'undefined' ? globalThis : this);
