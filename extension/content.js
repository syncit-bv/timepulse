// TimePulse content script — runs inside every webpage.
//
// Responsibilities:
// 1. Track real user movement (mousemove/keyboard/scroll) with a 10s timeout
//    so we stop tracking much sooner than Chrome's idle API (5 min default).
// 2. Detect the activity type using platform definitions fetched from the NAS
//    and cached in chrome.storage.local. Falls back to a minimal hardcoded list.
// 3. Capture favicon URL.
// 4. Push enriched activity data to the background service worker.

(function () {
  'use strict';

  if (window.self !== window.top) return;
  if (!window.location.href.startsWith('http')) return;

  const MOVEMENT_TIMEOUT_MS = 10_000;

  let movement = true;
  let movementTimer = null;

  // ─── User activity signals ─────────────────────────────────────────────────

  function resetMovementTimer() {
    movement = true;
    clearTimeout(movementTimer);
    movementTimer = setTimeout(() => { movement = false; }, MOVEMENT_TIMEOUT_MS);
  }

  window.addEventListener('mousemove', resetMovementTimer, { passive: true });
  window.addEventListener('keydown',   resetMovementTimer, { passive: true });
  window.addEventListener('scroll',    resetMovementTimer, { passive: true });
  window.addEventListener('click',     resetMovementTimer, { passive: true });

  window.addEventListener('blur', () => {
    if (document.activeElement?.tagName?.toLowerCase() === 'iframe') {
      resetMovementTimer();
    } else {
      movement = false;
      clearTimeout(movementTimer);
    }
  });

  window.addEventListener('focus', resetMovementTimer);
  resetMovementTimer();

  // ─── Platform-based activity detection ────────────────────────────────────

  // Minimal fallback used before NAS platforms are cached (first install).
  const FALLBACK_PLATFORMS = [
    { slug: 'gmail',        urls: ['mail.google.com'] },
    { slug: 'outlook',      urls: ['outlook.live.com', 'outlook.office.com'] },
    { slug: 'jira',         urls: ['atlassian.net', '/jira/'] },
    { slug: 'github',       urls: ['github.com'] },
    { slug: 'gitlab',       urls: ['gitlab.com'] },
    { slug: 'googleDocs',   urls: ['docs.google.com/document'] },
    { slug: 'googleSheets', urls: ['docs.google.com/spreadsheets'] },
    { slug: 'googleSlides', urls: ['docs.google.com/presentation'] },
    { slug: 'sharepointDoc',urls: ['sharepoint.com/Doc.aspx', 'sharepoint.com/:w:'] },
    { slug: 'figma',        urls: ['figma.com'] },
    { slug: 'notion',       urls: ['notion.so', 'notion.site'] },
    { slug: 'slack',        urls: ['slack.com'] },
    { slug: 'harvest',      urls: ['harvestapp.com', 'harvest.is'] },
    { slug: 'pdf',          urls: ['.pdf'] },
  ];

  let cachedPlatforms = null;

  function getPlatforms() {
    return cachedPlatforms || FALLBACK_PLATFORMS;
  }

  // Load platforms cached by background.js on startup
  chrome.storage.local.get('tp_platforms', (result) => {
    if (result.tp_platforms?.length) {
      cachedPlatforms = result.tp_platforms;
    }
  });

  // React to platform refreshes without needing a page reload
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tp_platforms?.newValue?.length) {
      cachedPlatforms = changes.tp_platforms.newValue;
    }
  });

  function detectActivityType(url) {
    for (const p of getPlatforms()) {
      if (p.urls.some(pattern => url.includes(pattern))) {
        return p.slug;
      }
    }
    return 'website';
  }

  function getDocumentContext() {
    const url  = window.location.href;
    const type = detectActivityType(url);
    let docName = null;

    if (['googleDocs', 'googleSheets', 'googleSlides'].includes(type)) {
      docName = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || document.title;
    }

    if (type === 'sharepointDoc') {
      docName = document.querySelector('input[name="filename"], input[name="fileName"]')?.value
        || document.title;
    }

    if (type === 'jira') {
      const match = url.match(/\/browse\/([A-Z]+-\d+)|\/issues\/([A-Z]+-\d+)/);
      if (match) docName = match[1] || match[2];
    }

    return { type, docName };
  }

  function getFavicon() {
    const link = document.querySelector('link[rel~="icon"]');
    if (link?.href) return link.href;
    return `${window.location.origin}/favicon.ico`;
  }

  // ─── Report to background worker ──────────────────────────────────────────

  let reportInterval;

  function report() {
    if (!movement) return;

    const { type, docName } = getDocumentContext();

    try {
      chrome.runtime.sendMessage({
        action: 'contentActivity',
        data: {
          url:          window.location.href,
          domain:       window.location.hostname,
          title:        document.title || '',
          favicon:      getFavicon(),
          activityType: type,
          docName:      docName || null,
          timestamp:    Date.now()
        }
      }).catch(() => {});
    } catch {
      // Extension was reloaded while this page was open — stop trying
      clearInterval(reportInterval);
    }
  }

  reportInterval = setInterval(report, 15_000);

  if (document.readyState === 'complete') {
    report();
  } else {
    window.addEventListener('load', report, { once: true });
  }

})();
