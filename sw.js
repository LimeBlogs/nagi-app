/* ── Nagi (凪) · Service Worker 离线与极速资源缓存 ── */

const CACHE_NAME = 'nagi-cache-v1';
const ASSETS_CACHE_NAME = 'nagi-resources-v1';

// 核心预载资源清单
const PRECACHE_URLS = [
  '/',
  '/manifest.json',
  '/file.svg',
  '/globe.svg',
  '/window.svg',
  '/next.svg',
  '/vercel.svg',
];

// 安装阶段：预缓存核心壳文件
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_URLS).catch((err) => {
        console.warn('[Nagi SW] Precache warning:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

// 激活阶段：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME && key !== ASSETS_CACHE_NAME) {
            console.log('[Nagi SW] Removing outdated cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// 网络拦截与缓存响应策略
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 仅拦截 HTTP/HTTPS 的 GET 请求
  if (request.method !== 'GET') return;
  if (!request.url.startsWith('http://') && !request.url.startsWith('https://')) return;

  const url = new URL(request.url);

  // 绕过动态第三方 API 与鉴权路由，避免破坏实时业务
  if (
    url.hostname.includes('supabase.co') ||
    url.pathname.includes('/api/auth') ||
    url.hostname.includes('meting-api') ||
    url.hostname.includes('bilibili.com') ||
    url.hostname.includes('bid-get')
  ) {
    return;
  }

  // 1. 字体资源 (jsDelivr CDN / woff2 / css) -> Cache First (缓存优先)
  if (
    url.hostname.includes('jsdelivr.net') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname.endsWith('.woff') ||
    url.pathname.endsWith('.ttf')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone();
              caches.open(ASSETS_CACHE_NAME).then((cache) => {
                cache.put(request, responseToCache).catch(() => {});
              });
            }
            return networkResponse;
          })
          .catch(() => {
            // 离线时尝试匹配任何缓存中的样式
            return caches.match(request);
          });
      })
    );
    return;
  }

  // 2. 本地静态图标与矢量素材 -> Cache First
  if (
    url.pathname.endsWith('.svg') ||
    url.pathname.endsWith('.png') ||
    url.pathname.endsWith('.ico') ||
    url.pathname.startsWith('/_next/static/')
  ) {
    event.respondWith(
      caches.match(request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache).catch(() => {});
            });
          }
          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. 页面主视图导航 -> Network First, 降级至缓存
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => {
        return caches.match('/').then((cachedShell) => {
          return cachedShell || new Response('Nagi 离线漫游中...', {
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
          });
        });
      })
    );
    return;
  }

  // 4. 其他常规请求：Stale While Revalidate
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(request, responseToCache).catch(() => {});
          });
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
