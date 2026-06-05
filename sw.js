/* ============================================================
   SafeZone RPG — Service Worker
   S-02 · Cache-First + Network-Fallback strategy
   ============================================================ */

const CACHE_NAME    = 'safezone-rpg-v9';
const OFFLINE_URL   = './index.html';

/* Assets mis en cache au premier lancement */
const PRECACHE_ASSETS = [
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  /* Fonts Google (snapshot offline) — sera mis en cache dynamiquement
     si l'utilisateur a une connexion au premier lancement */
];

/* Domaines mis en cache dynamiquement (réseau d'abord pour les fonts) */
const DYNAMIC_CACHE_ORIGINS = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];


/* ── INSTALL ──────────────────────────────────────────────── */
self.addEventListener('install', (event) => {
  console.log('[SW] Install · cache:', CACHE_NAME);

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Précache des assets essentiels');
        /* addAll échoue si un asset est manquant ; on utilise
           add() individuel pour résister aux icônes absentes */
        return Promise.allSettled(
          PRECACHE_ASSETS.map(url =>
            cache.add(url).catch(err =>
              console.warn('[SW] Précache ignoré:', url, err.message)
            )
          )
        );
      })
      .then(() => self.skipWaiting())   /* active immédiatement */
  );
});


/* ── ACTIVATE ─────────────────────────────────────────────── */
self.addEventListener('activate', (event) => {
  console.log('[SW] Activate · nettoyage anciens caches');

  event.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(key => key !== CACHE_NAME)
            .map(key => {
              console.log('[SW] Suppression cache obsolète:', key);
              return caches.delete(key);
            })
        )
      )
      .then(() => self.clients.claim())  /* prend le contrôle de tous les onglets */
  );
});


/* ── FETCH ────────────────────────────────────────────────── */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  /* On ignore les requêtes non-GET et les extensions navigateur */
  if (request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  /* Stratégie fonts Google : Cache-First avec fallback réseau */
  if (DYNAMIC_CACHE_ORIGINS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request));
    return;
  }

  /* Stratégie assets locaux : Cache-First avec mise à jour en arrière-plan */
  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  /* Requêtes externes (Google Sheets API, etc.) : Network-First */
  event.respondWith(networkFirst(request));
});


/* ── STRATÉGIES ───────────────────────────────────────────── */

/** Cache-First : renvoie le cache, sinon réseau + mise en cache */
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch {
    return offlineFallback(request);
  }
}

/** Stale-While-Revalidate : cache immédiat + MAJ en arrière-plan */
async function staleWhileRevalidate(request) {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  return cached || networkFetch || offlineFallback(request);
}

/** Network-First : réseau en priorité, cache en secours */
async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    return cached || offlineFallback(request);
  }
}

/** Fallback hors-ligne : renvoie index.html si disponible */
async function offlineFallback(request) {
  const cached = await caches.match(OFFLINE_URL);
  if (cached) {
    console.warn('[SW] Hors-ligne — fallback index.html pour:', request.url);
    return cached;
  }
  /* Réponse d'erreur minimale si même l'index n'est pas en cache */
  return new Response(
    '<h1 style="font-family:sans-serif;color:#ff4757;padding:24px">SafeZone RPG — Hors-ligne<br><small>Reconnectez-vous pour accéder à l\'application.</small></h1>',
    { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}


/* ── MESSAGE (force update depuis l'app) ──────────────────── */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    console.log('[SW] Force update reçu');
    self.skipWaiting();
  }

  if (event.data && event.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() =>
      console.log('[SW] Cache vidé manuellement')
    );
  }
});


/* ── BACKGROUND SYNC (préparation S-10 signalements offline) ─ */
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-signalements') {
    console.log('[SW] Background sync: envoi signalements en attente');
    event.waitUntil(syncPendingSignalements());
  }
});

async function syncPendingSignalements() {
  /* TODO S-10 : lire IndexedDB → poster vers Google Apps Script */
  console.log('[SW] syncPendingSignalements — implémentation S-10');
}
