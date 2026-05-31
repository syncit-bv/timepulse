// TimePulse content script — runs inside every webpage.
//
// Verbeteringen t.o.v. v1 (gebaseerd op ClockAssist-analyse):
// 1. Rapport elke 5s (was 15s) — nauwkeuriger sessiedetectie
// 2. SPA-navigatiedetectie via history API + MutationObserver
// 3. document.visibilitychange — stop tracking op verborgen tabs
// 4. Rijkere context: Jira-ticket, GitHub PR/issue, Gmail-onderwerp,
//    Outlook compose, Figma-bestand, Notion-pagina, vergaderdetectie
// 5. Slimme titelopschoning (platform-suffixen verwijderen)
// 6. Focus-score: tabwisselingen bijhouden als productiviteitssignaal

(function () {
  'use strict';

  if (window.self !== window.top) return;
  if (!window.location.href.startsWith('http')) return;

  const REPORT_INTERVAL_MS    = 5_000;   // elke 5s rapporteren (was 15s)
  const MOVEMENT_TIMEOUT_MS   = 10_000;  // inactief na 10s geen beweging

  // ─── Bewegingsdetectie ────────────────────────────────────────────────────

  let movement = true;
  let movementTimer = null;
  let tabVisible = !document.hidden;

  function resetMovementTimer() {
    movement = true;
    clearTimeout(movementTimer);
    movementTimer = setTimeout(() => { movement = false; }, MOVEMENT_TIMEOUT_MS);
  }

  window.addEventListener('mousemove', resetMovementTimer, { passive: true });
  window.addEventListener('keydown',   resetMovementTimer, { passive: true });
  window.addEventListener('scroll',    resetMovementTimer, { passive: true });
  window.addEventListener('click',     resetMovementTimer, { passive: true });
  window.addEventListener('touchstart',resetMovementTimer, { passive: true });

  // Tab focus/blur — stop tracking als tab niet gefocust is
  window.addEventListener('blur', () => {
    if (document.activeElement?.tagName?.toLowerCase() === 'iframe') {
      resetMovementTimer(); // iframe-klik telt als activiteit
    } else {
      movement = false;
      clearTimeout(movementTimer);
    }
  });
  window.addEventListener('focus', resetMovementTimer);

  // Tab visibility (minimized, andere tab actief)
  document.addEventListener('visibilitychange', () => {
    tabVisible = !document.hidden;
    if (tabVisible) resetMovementTimer();
    else { movement = false; clearTimeout(movementTimer); }
  });

  resetMovementTimer();

  // ─── SPA-navigatiedetectie ────────────────────────────────────────────────
  // Vangt pushState/replaceState op — voor React/Vue/Angular apps zoals
  // Jira, Notion, Linear, GitHub die de URL wijzigen zonder pagina-reload.

  let lastUrl = window.location.href;

  function onUrlChange() {
    const newUrl = window.location.href;
    if (newUrl === lastUrl) return;
    lastUrl = newUrl;
    resetMovementTimer();
    report(); // onmiddellijk rapporteren bij navigatie
  }

  // Patch history API
  ['pushState', 'replaceState'].forEach(method => {
    const original = history[method];
    history[method] = function (...args) {
      original.apply(this, args);
      onUrlChange();
    };
  });
  window.addEventListener('popstate', onUrlChange);

  // Fallback: MutationObserver op de titel (vangt SPA-navigaties die
  // history API niet gebruiken, bv. sommige Jira-versies)
  let titleObserver = null;
  try {
    titleObserver = new MutationObserver(() => onUrlChange());
    const titleEl = document.querySelector('title');
    if (titleEl) titleObserver.observe(titleEl, { childList: true });
  } catch {}

  // ─── Platform-detectie ────────────────────────────────────────────────────

  const FALLBACK_PLATFORMS = [
    { slug: 'gmail',         urls: ['mail.google.com'] },
    { slug: 'outlook',       urls: ['outlook.live.com', 'outlook.office.com', 'outlook.office365.com'] },
    { slug: 'jira',          urls: ['atlassian.net', '/jira/'] },
    { slug: 'github',        urls: ['github.com'] },
    { slug: 'gitlab',        urls: ['gitlab.com'] },
    { slug: 'linear',        urls: ['linear.app'] },
    { slug: 'googleDocs',    urls: ['docs.google.com/document'] },
    { slug: 'googleSheets',  urls: ['docs.google.com/spreadsheets'] },
    { slug: 'googleSlides',  urls: ['docs.google.com/presentation'] },
    { slug: 'googledrive',   urls: ['drive.google.com'] },
    { slug: 'sharepointDoc', urls: ['sharepoint.com/Doc.aspx', 'sharepoint.com/:w:', 'sharepoint.com/:x:'] },
    { slug: 'figma',         urls: ['figma.com'] },
    { slug: 'notion',        urls: ['notion.so', 'notion.site'] },
    { slug: 'confluence',    urls: ['confluence.atlassian.net', '/wiki/spaces/'] },
    { slug: 'slack',         urls: ['slack.com'] },
    { slug: 'teams',         urls: ['teams.microsoft.com', 'teams.live.com'] },
    { slug: 'meet',          urls: ['meet.google.com'] },
    { slug: 'zoom',          urls: ['zoom.us/j/', 'zoom.us/wc/'] },
    { slug: 'harvest',       urls: ['harvestapp.com', 'harvest.is'] },
    { slug: 'pdf',           urls: ['.pdf'] },
  ];

  // Vergaderplatformen — aparte activiteitsklasse
  const MEETING_SLUGS = new Set(['meet', 'zoom', 'teams']);

  let cachedPlatforms = null;
  function getPlatforms() { return cachedPlatforms || FALLBACK_PLATFORMS; }

  chrome.storage.local.get('tp_platforms', (result) => {
    if (result.tp_platforms?.length) cachedPlatforms = result.tp_platforms;
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.tp_platforms?.newValue?.length)
      cachedPlatforms = changes.tp_platforms.newValue;
  });

  function detectPlatformSlug(url) {
    for (const p of getPlatforms()) {
      if (p.urls.some(pattern => url.includes(pattern))) return p.slug;
    }
    return 'website';
  }

  // ─── Rijke contextextractie ───────────────────────────────────────────────

  function getDocumentContext() {
    const url  = window.location.href;
    const slug = detectPlatformSlug(url);
    let docName    = null;
    let activityType = slug;
    let emailData    = null;
    let ticketId     = null;

    // Vergadering detectie — hoge prioriteit
    if (MEETING_SLUGS.has(slug)) {
      activityType = 'meeting';
    }

    // ── Jira ──────────────────────────────────────────────────────────────
    else if (slug === 'jira') {
      const patterns = [
        /\/browse\/([A-Z][A-Z0-9]+-\d+)/,
        /\/issues\/([A-Z][A-Z0-9]+-\d+)/,
        /selectedIssue=([A-Z][A-Z0-9]+-\d+)/,
        /\/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)/
      ];
      for (const re of patterns) {
        const m = url.match(re);
        if (m) { ticketId = m[1]; docName = m[1]; break; }
      }
      // Projectnaam als fallback
      if (!docName) {
        const projMatch = url.match(/\/projects\/([^/]+)/);
        if (projMatch) docName = projMatch[1];
      }
    }

    // ── Linear ────────────────────────────────────────────────────────────
    else if (slug === 'linear') {
      const m = url.match(/\/([A-Z][A-Z0-9]+-\d+)(?:[/?#]|$)/);
      if (m) { ticketId = m[1]; docName = m[1]; }
    }

    // ── GitHub ────────────────────────────────────────────────────────────
    else if (slug === 'github') {
      const m = url.match(/github\.com\/([^/]+\/[^/]+)\/(pull|issues)\/(\d+)/);
      if (m) {
        const type = m[2] === 'pull' ? 'PR' : 'Issue';
        docName = `${m[1]} ${type} #${m[3]}`;
      } else {
        const repo = url.match(/github\.com\/([^/]+\/[^/]+)/);
        if (repo) docName = repo[1];
      }
    }

    // ── GitLab ────────────────────────────────────────────────────────────
    else if (slug === 'gitlab') {
      const mr = url.match(/\/-\/merge_requests\/(\d+)/);
      const issue = url.match(/\/-\/issues\/(\d+)/);
      if (mr) docName = `MR !${mr[1]}`;
      else if (issue) docName = `Issue #${issue[1]}`;
    }

    // ── Google Docs / Sheets / Slides ─────────────────────────────────────
    else if (['googleDocs', 'googleSheets', 'googleSlides'].includes(slug)) {
      docName = document.querySelector('meta[property="og:title"]')?.getAttribute('content')
        || cleanTitle(document.title, ['Google Docs', 'Google Sheets', 'Google Slides', 'Google Drive']);
    }

    // ── SharePoint / OneDrive ─────────────────────────────────────────────
    else if (slug === 'sharepointDoc') {
      docName = document.querySelector('input[name="filename"], input[name="fileName"]')?.value
        || cleanTitle(document.title, ['SharePoint', 'OneDrive']);
    }

    // ── Figma ─────────────────────────────────────────────────────────────
    else if (slug === 'figma') {
      docName = cleanTitle(document.title, ['Figma', '– Figma']);
    }

    // ── Notion ────────────────────────────────────────────────────────────
    else if (slug === 'notion') {
      docName = cleanTitle(document.title, ['Notion']);
    }

    // ── Confluence ────────────────────────────────────────────────────────
    else if (slug === 'confluence') {
      docName = cleanTitle(document.title, ['Confluence', '- Confluence']);
    }

    // ── Gmail ─────────────────────────────────────────────────────────────
    else if (slug === 'gmail') {
      const composing = url.includes('compose') || !!document.querySelector('input[name="composeid"]');
      activityType = composing ? 'emailCompose' : 'emailRead';
      if (!composing) {
        // Probeer onderwerp van open mail te lezen
        const subjectEl = document.querySelector('h2[data-thread-id], [data-legacy-thread-id]');
        if (subjectEl) docName = subjectEl.textContent?.trim() || null;
      }
      emailData = { client: 'gmail', composing };
    }

    // ── Outlook ───────────────────────────────────────────────────────────
    else if (slug === 'outlook') {
      const composing = !!document.querySelector('div[aria-multiline="true"][contenteditable="true"]');
      activityType = composing ? 'emailCompose' : 'emailRead';
      emailData = { client: 'outlook', composing };
    }

    // ── PDF ───────────────────────────────────────────────────────────────
    else if (slug === 'pdf') {
      const parts = url.split('/');
      docName = decodeURIComponent(parts[parts.length - 1].split('?')[0]);
    }

    return { activityType, docName, ticketId, emailData };
  }

  // Verwijder platformnamen uit paginatitels
  function cleanTitle(title, suffixes) {
    if (!title) return null;
    let t = title.trim();
    for (const s of suffixes) {
      t = t.replace(new RegExp(`\\s*[-–|]\\s*${s}\\s*$`, 'i'), '').trim();
      t = t.replace(new RegExp(`^${s}\\s*[-–|]\\s*`, 'i'), '').trim();
    }
    return t || null;
  }

  function getFavicon() {
    const link = document.querySelector('link[rel~="icon"][href]');
    if (link?.href) return link.href;
    return `${window.location.origin}/favicon.ico`;
  }

  // ─── Focus-score: tabwisselingen bijhouden ────────────────────────────────
  // Minder tabwisselingen = hogere focus. Nuttig voor productiviteitsrapport.

  let tabSwitchCount = 0;
  let focusWindowStart = Date.now();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) tabSwitchCount++;
  });

  function getFocusScore() {
    const elapsedMin = (Date.now() - focusWindowStart) / 60_000;
    if (elapsedMin < 0.5) return null; // te weinig data
    const switchesPerMin = tabSwitchCount / elapsedMin;
    // Reset venster elke 5 minuten
    if (elapsedMin > 5) { tabSwitchCount = 0; focusWindowStart = Date.now(); }
    // Score 0-100: 0 wissels/min = 100, 6+ wissels/min = 0
    return Math.max(0, Math.round(100 - switchesPerMin * 16.7));
  }

  // ─── Rapporteren aan background worker ───────────────────────────────────

  let reportInterval;

  function report() {
    if (!movement || !tabVisible) return;

    const { activityType, docName, ticketId, emailData } = getDocumentContext();
    const focusScore = getFocusScore();

    try {
      chrome.runtime.sendMessage({
        action: 'contentActivity',
        data: {
          url:          window.location.href,
          domain:       window.location.hostname,
          title:        document.title || '',
          favicon:      getFavicon(),
          activityType,
          docName:      docName   || null,
          ticketId:     ticketId  || null,
          emailData:    emailData || null,
          focusScore:   focusScore,
          timestamp:    Date.now()
        }
      }).catch(() => {});
    } catch {
      clearInterval(reportInterval);
      if (titleObserver) titleObserver.disconnect();
    }
  }

  reportInterval = setInterval(report, REPORT_INTERVAL_MS);

  // Onmiddellijk rapporteren bij laden
  if (document.readyState === 'complete') {
    report();
  } else {
    window.addEventListener('load', report, { once: true });
  }

})();
