// TimePulse content script — runs inside every webpage.
//
// Responsibilities:
// 1. Track real user movement (mousemove/keyboard/scroll) with a 10s timeout
//    so we stop tracking much sooner than Chrome's idle API (5 min default).
// 2. Detect the activity type (gmail, jira, googleDocs, etc.) for richer context.
// 3. Capture favicon URL.
// 4. Push enriched activity data to the background service worker.

(function () {
  'use strict';

  // Don't run in iframes or internal pages
  if (window.self !== window.top) return;
  if (!window.location.href.startsWith('http')) return;

  const MOVEMENT_TIMEOUT_MS = 10_000; // 10 seconds without input = not active

  let movement = true;
  let movementTimer = null;

  // ─── User activity signals ─────────────────────────────────────────────────

  function resetMovementTimer() {
    movement = true;
    clearTimeout(movementTimer);
    movementTimer = setTimeout(() => { movement = false; }, MOVEMENT_TIMEOUT_MS);
  }

  window.addEventListener('mousemove', resetMovementTimer, { passive: true });
  window.addEventListener('keydown', resetMovementTimer, { passive: true });
  window.addEventListener('scroll', resetMovementTimer, { passive: true });
  window.addEventListener('click', resetMovementTimer, { passive: true });

  window.addEventListener('blur', () => {
    // If focus moved to an iframe, don't mark as inactive immediately
    if (document.activeElement?.tagName?.toLowerCase() === 'iframe') {
      resetMovementTimer();
    } else {
      movement = false;
      clearTimeout(movementTimer);
    }
  });

  window.addEventListener('focus', () => {
    resetMovementTimer();
  });

  // Start the first timer
  resetMovementTimer();

  // ─── Activity type detection ───────────────────────────────────────────────

  function detectActivityType() {
    const url = window.location.href;
    const hostname = window.location.hostname;

    if (url.includes('mail.google.com')) return 'gmail';
    if (url.includes('outlook.live.com') || url.includes('outlook.office') || hostname.includes('outlook')) return 'outlook';
    if (url.includes('atlassian.net') || url.includes('/jira/')) return 'jira';
    if (url.includes('linear.app')) return 'linear';
    if (url.includes('github.com')) return 'github';
    if (url.includes('gitlab.com')) return 'gitlab';
    if (url.includes('docs.google.com/document')) return 'googleDocs';
    if (url.includes('docs.google.com/spreadsheets')) return 'googleSheets';
    if (url.includes('docs.google.com/presentation')) return 'googleSlides';
    if (url.includes('sharepoint.com') && url.includes('Doc.aspx')) return 'sharepointDoc';
    if (url.includes('figma.com')) return 'figma';
    if (url.includes('notion.so') || url.includes('notion.site')) return 'notion';
    if (url.includes('slack.com')) return 'slack';
    if (url.includes('trello.com')) return 'trello';
    if (url.includes('asana.com')) return 'asana';
    if (url.includes('monday.com')) return 'monday';
    if (url.includes('clickup.com')) return 'clickup';
    if (url.includes('harvest.is') || url.includes('harvestapp.com')) return 'harvest';
    if (url.endsWith('.pdf') || document.contentType === 'application/pdf') return 'pdf';

    return 'website';
  }

  function getDocumentContext() {
    const type = detectActivityType();
    const url = window.location.href;
    let docName = null;

    if (type === 'googleDocs' || type === 'googleSheets' || type === 'googleSlides') {
      docName = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || document.title;
    }

    if (type === 'sharepointDoc') {
      docName = document.querySelector('input[name="filename"], input[name="fileName"]')?.value
        || document.title;
    }

    if (type === 'jira') {
      // Extract ticket ID from URL
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

  function report() {
    if (!movement) return;

    const { type, docName } = getDocumentContext();

    chrome.runtime.sendMessage({
      action: 'contentActivity',
      data: {
        url: window.location.href,
        domain: window.location.hostname,
        title: document.title || '',
        favicon: getFavicon(),
        activityType: type,
        docName: docName || null,
        timestamp: Date.now()
      }
    }).catch(() => {
      // Extension may be reloading — silently ignore
    });
  }

  // Report every 15 seconds (background will deduplicate/throttle further)
  setInterval(report, 15_000);

  // Also report immediately on page load
  if (document.readyState === 'complete') {
    report();
  } else {
    window.addEventListener('load', report, { once: true });
  }

})();
