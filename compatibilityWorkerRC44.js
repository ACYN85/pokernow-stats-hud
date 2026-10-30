/* RC4 independent compatibility policy; sole gameplay writer stays V1.5. */
'use strict';
importScripts('runtimeScope.js');
if(!PokerNowRuntimeScope.compatibilityOnly||PokerNowRuntimeScope.compatibilityPersonPolicy!=='manual-opaque-ledger-v1')throw Error('COMPATIBILITY_POLICY_REQUIRED');
importScripts('careerServiceWorker.js');
importScripts('playerIdentityCatalog.js','playerIdentityLinkStore.js','playerIdentityCareer.js','playerIdentityCareerStore.js','personAuthorityObservation.js','personAuthorization.js','compatibilityPersonCatalog.js','compatibilityPersonWorker.js');
