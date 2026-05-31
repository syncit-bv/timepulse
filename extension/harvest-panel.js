// TimePulse — Harvest panel (v2, UX redesign)
// Injects a slide-in panel into harvestapp.com with:
// - Recent project chips (book in 2 clicks)
// - In-place expanding session cards
// - Keyboard navigation (Tab, Enter, Escape)
// - Success animation + greyed used cards

(function () {
  'use strict';

  if (!window.location.hostname.includes('harvestapp.com')) return;

  // ─── Constants ───────────────────────────────────────────────────────────────

  const PANEL_ID   = 'tp-panel';
  const RECENT_KEY = 'tp_recent';
  const USED_PREFIX = 'tp_used_';

  const INTERRUPTIONS = [
    { id: 'phone',   icon: '📞', label: 'Telefoongesprek',   minutes: 15 },
    { id: 'teams',   icon: '💬', label: 'Teams / meeting',   minutes: 30 },
    { id: 'lunch',   icon: '🍽️', label: 'Lunchpauze',        minutes: 30 },
    { id: 'break',   icon: '☕', label: 'Pauze',             minutes: 10 },
    { id: 'client',  icon: '🤝', label: 'Klantontmoeting',   minutes: 60 },
    { id: 'travel',  icon: '🚗', label: 'Verplaatsing',      minutes: 30 },
    { id: 'admin',   icon: '📋', label: 'Administratie',     minutes: 15 },
    { id: 'review',  icon: '👁️', label: 'Review',            minutes: 20 },
  ];

  // ─── State ───────────────────────────────────────────────────────────────────

  let serverUrl  = '';
  let currentDate = todayDate();
  let projects   = [];
  let sessions   = [];
  let recentProjects = [];  // [{projectId, projectName, taskId, taskName}]
  let usedSessions = new Set();
  let harvestTotal = 0;
  let panelOpen  = false;
  let expandedCard = null; // currently open card element
  let platformMap  = {};   // slug → platform object (icon, logo_dev, color)

  // ─── Boot ───────────────────────────────────────────────────────────────────

  async function init() {
    const s = await chrome.storage.sync.get(['serverUrl']);
    serverUrl = (s.serverUrl || '').replace(/\/$/, '');
    if (!serverUrl) return;

    recentProjects = await loadRecent();
    usedSessions   = await loadUsed(currentDate);

    // Build slug → platform lookup for icon rendering
    const { tp_platforms = [] } = await chrome.storage.local.get('tp_platforms');
    tp_platforms.forEach(p => { platformMap[p.slug] = p; });

    injectStyles();
    buildPanel();
    buildToggle();
    watchNavigation();
  }

  // ─── Navigation watcher (SPA) ────────────────────────────────────────────────

  function watchNavigation() {
    let last = location.href;
    new MutationObserver(() => {
      if (location.href === last) return;
      last = location.href;
      const d = parseDateFromUrl();
      if (d && d !== currentDate) {
        currentDate = d;
        onDateChange();
      }
    }).observe(document, { subtree: true, childList: true });
  }

  function parseDateFromUrl() {
    const m = location.pathname.match(/\/time\/day\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    if (location.pathname.startsWith('/time')) return todayDate();
    return null;
  }

  async function onDateChange() {
    usedSessions = await loadUsed(currentDate);
    updateDateLabel();
    if (panelOpen) await loadAndRender();
  }

  // ─── Panel skeleton ──────────────────────────────────────────────────────────

  function buildPanel() {
    const el = div('', PANEL_ID);
    el.setAttribute('role', 'complementary');
    el.setAttribute('aria-label', 'TimePulse tijdsregistratie');
    el.innerHTML = `
      <div class="tp-head">
        <div class="tp-head-top">
          <span class="tp-wordmark">⏱ TimePulse</span>
          <button class="tp-x" id="tp-close" aria-label="Sluiten">✕</button>
        </div>
        <div class="tp-head-meta">
          <span id="tp-date-lbl" class="tp-meta-date"></span>
          <span id="tp-harvest-total" class="tp-meta-total"></span>
        </div>
      </div>
      <div class="tp-scroll" id="tp-scroll">
        <div id="tp-content"></div>
      </div>
    `;
    document.body.appendChild(el);
    document.getElementById('tp-close').addEventListener('click', closePanel);
    updateDateLabel();
  }

  function buildToggle() {
    const btn = div('tp-fab');
    btn.setAttribute('role', 'button');
    btn.setAttribute('tabindex', '0');
    btn.setAttribute('aria-label', 'TimePulse openen');
    btn.innerHTML = `<span class="tp-fab-icon">⏱</span><span class="tp-fab-txt">TimePulse</span>`;
    btn.addEventListener('click', togglePanel);
    btn.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') togglePanel(); });
    document.body.appendChild(btn);
  }

  function updateDateLabel() {
    const d = new Date(currentDate + 'T12:00:00');
    const label = currentDate === todayDate() ? 'Vandaag' :
      d.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' });
    setText('tp-date-lbl', label);
  }

  // ─── Open / close ────────────────────────────────────────────────────────────

  function togglePanel() {
    panelOpen ? closePanel() : openPanel();
  }

  async function openPanel() {
    panelOpen = true;
    document.getElementById(PANEL_ID)?.classList.add('tp-open');
    document.querySelector('.tp-fab')?.classList.add('tp-fab-active');
    document.body.classList.add('tp-body-shifted');
    await loadAndRender();
  }

  function closePanel() {
    panelOpen = false;
    document.getElementById(PANEL_ID)?.classList.remove('tp-open');
    document.querySelector('.tp-fab')?.classList.remove('tp-fab-active');
    document.body.classList.remove('tp-body-shifted');
    collapseAll();
  }

  // Escape key closes panel or collapses open card
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      if (expandedCard) collapseAll();
      else if (panelOpen) closePanel();
    }
  });

  // ─── Data ───────────────────────────────────────────────────────────────────

  async function loadAndRender() {
    renderSkeleton();
    try {
      const [sessResp, projResp, harvestResp] = await Promise.all([
        fetchNas(`/api/sessions/${currentDate}`),
        projects.length ? Promise.resolve({ projects }) : fetchNas('/api/projects'),
        fetchNas(`/api/entries/${currentDate}`).catch(() => ({ entries: [] }))
      ]);
      sessions  = sessResp.sessions || [];
      if (projResp.projects) projects = projResp.projects;
      harvestTotal = (harvestResp.entries || []).reduce((s, e) => s + e.hours, 0);
      setText('tp-harvest-total', harvestTotal > 0 ? `${formatHours(harvestTotal)} in Harvest` : 'Nog niets ingeboekt');
      renderAll();
    } catch (err) {
      renderError(err.message);
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  function renderSkeleton() {
    const c = document.getElementById('tp-content');
    if (!c) return;
    c.innerHTML = `
      <div class="tp-skeleton-wrap">
        ${[100,80,90,70].map(w => `<div class="tp-skel" style="width:${w}%"></div>`).join('')}
      </div>`;
  }

  function renderError(msg) {
    const c = document.getElementById('tp-content');
    if (!c) return;
    c.innerHTML = `
      <div class="tp-state-box">
        <div class="tp-state-icon">⚠️</div>
        <div class="tp-state-msg">Server niet bereikbaar</div>
        <div class="tp-state-sub">${escHtml(msg)}</div>
        <button class="tp-retry-btn" onclick="location.reload()">Opnieuw proberen</button>
      </div>`;
  }

  function renderAll() {
    const c = document.getElementById('tp-content');
    if (!c) return;
    c.innerHTML = '';

    // Recent projects quick-strip (if any)
    if (recentProjects.length > 0) {
      c.appendChild(buildRecentStrip());
    }

    // Sessions
    const activeSessions = sessions.filter(s => !usedSessions.has(String(s.start)));
    const usedSess = sessions.filter(s => usedSessions.has(String(s.start)));

    if (sessions.length > 0) {
      c.appendChild(sectionTitle('Browseractiviteit'));
      activeSessions.forEach(s => c.appendChild(buildSessionCard(s)));
      if (usedSess.length > 0) {
        usedSess.forEach(s => c.appendChild(buildSessionCard(s, true)));
      }
    } else {
      c.appendChild(emptyState('Geen browseractiviteit voor deze dag gevonden.'));
    }

    // Interruptions
    c.appendChild(sectionTitle('Onderbrekingen'));
    c.appendChild(buildInterruptionGrid());
  }

  // ─── Recent projects strip ────────────────────────────────────────────────────

  function buildRecentStrip() {
    const wrap = div('tp-recent-strip');
    wrap.innerHTML = `<div class="tp-recent-label">Snel boeken</div>`;
    const chips = div('tp-recent-chips');
    recentProjects.forEach(r => {
      const chip = div('tp-chip');
      chip.textContent = `${r.projectName} — ${r.taskName}`;
      chip.title = `${r.projectName}\n${r.taskName}`;
      chip.addEventListener('click', () => openQuickForm(r));
      chips.appendChild(chip);
    });
    wrap.appendChild(chips);
    return wrap;
  }

  // ─── Platform icon helper ─────────────────────────────────────────────────────
  // Returns an <img> with 3-level fallback: primary CDN → logo.dev → hidden

  function platformIconHtml(slug) {
    const p = platformMap[slug];
    if (!p) return '';
    const primary  = p.icon    || '';
    const fallback = p.logo_dev || '';
    if (!primary && !fallback) return '';
    const src = primary || fallback;
    const fb  = primary ? fallback : '';
    const onerror = fb
      ? `if(!this.dataset.tried){this.dataset.tried=1;this.src='${fb}';}else{this.style.display='none';}`
      : `this.style.display='none'`;
    return `<img class="tp-platform-ico" src="${src}" data-fallback="${fb}" onerror="${onerror}" alt="">`;
  }

  // ─── Session card ─────────────────────────────────────────────────────────────

  function buildSessionCard(session, used = false) {
    const dur = Math.round((session.end - session.start) / 60000);
    const domains = (session.domains || []).slice(0, 3).join(', ');
    const types = [...new Set((session.activityTypes || []).filter(t => t && t !== 'website'))];
    const card = div(`tp-card${used ? ' tp-card-used' : ''}`);
    card.dataset.start = session.start;

    card.innerHTML = `
      <div class="tp-card-summary">
        <div class="tp-card-left">
          <div class="tp-card-time">${formatTime(session.start)} – ${formatTime(session.end)}</div>
          <div class="tp-card-meta">
            <span class="tp-card-dur">${formatDuration(dur)}</span>
            ${domains ? `<span class="tp-card-sep">·</span><span class="tp-card-domains">${escHtml(domains)}</span>` : ''}
            ${types.map(t => `<span class="tp-badge">${platformIconHtml(t)}<span>${escHtml(t)}</span></span>`).join('')}
          </div>
        </div>
        <div class="tp-card-right">
          ${used
            ? `<span class="tp-check">✓</span>`
            : `<svg class="tp-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6l4 4 4-4"/></svg>`
          }
        </div>
      </div>
      ${!used ? buildFormHTML(session) : ''}
    `;

    if (!used) {
      card.querySelector('.tp-card-summary').addEventListener('click', () => toggleCard(card, session));
    }

    return card;
  }

  function buildFormHTML(session) {
    const projectOptions = projects.map(p =>
      `<option value="${p.id}">${escHtml(p.clientName ? `${p.clientName} — ${p.name}` : p.name)}</option>`
    ).join('');

    const suggestedNotes = buildSuggestedNotes(session);

    return `
      <div class="tp-form" aria-hidden="true">
        <div class="tp-form-inner">
          <div class="tp-recent-in-form" id="tp-recent-${session.start}"></div>

          <div class="tp-field-row tp-time-row">
            <div class="tp-field">
              <label class="tp-lbl">Van</label>
              <input class="tp-input tp-time-input" type="time" value="${formatTimeInput(session.start)}" data-role="start" />
            </div>
            <div class="tp-time-sep">–</div>
            <div class="tp-field">
              <label class="tp-lbl">Tot</label>
              <input class="tp-input tp-time-input" type="time" value="${formatTimeInput(session.end)}" data-role="end" />
            </div>
            <span class="tp-duration-badge" data-role="dur"></span>
          </div>

          <div class="tp-field">
            <label class="tp-lbl">Project</label>
            <select class="tp-input tp-select tp-project-sel">
              <option value="">Kies project…</option>
              ${projectOptions}
            </select>
          </div>

          <div class="tp-field">
            <label class="tp-lbl">Taak</label>
            <select class="tp-input tp-select tp-task-sel" disabled>
              <option value="">Kies eerst een project</option>
            </select>
          </div>

          <div class="tp-field">
            <label class="tp-lbl">Notities</label>
            <input class="tp-input" type="text" value="${escHtml(suggestedNotes)}" placeholder="Optioneel…" data-role="notes" />
          </div>

          <div class="tp-form-actions">
            <button class="tp-btn-ghost tp-collapse-btn" type="button">Annuleer</button>
            <button class="tp-btn-primary tp-submit-btn" type="button" disabled>
              <span class="tp-btn-txt">Opslaan in Harvest</span>
              <span class="tp-btn-spin" aria-hidden="true"></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function buildSuggestedNotes(session) {
    const types = [...new Set((session.activityTypes || []).filter(t => t && t !== 'website'))];
    if (types.includes('jira')) return 'Jira tickets verwerken';
    if (types.includes('github') || types.includes('gitlab')) return 'Code development';
    if (types.includes('figma')) return 'Design werkzaamheden';
    if (types.includes('googleDocs')) return 'Documentatie';
    if (types.includes('gmail') || types.includes('outlook')) return 'E-mail verwerken';
    if (types.includes('linear')) return 'Project management';
    return '';
  }

  // ─── Card expand / collapse ──────────────────────────────────────────────────

  function toggleCard(card, session) {
    const isOpen = card.classList.contains('tp-card-open');
    collapseAll();
    if (!isOpen) expandCard(card, session);
  }

  function expandCard(card, session) {
    expandedCard = card;
    card.classList.add('tp-card-open');
    const form = card.querySelector('.tp-form');
    if (!form) return;
    form.setAttribute('aria-hidden', 'false');

    // Inject recent chips inside form
    injectRecentChips(card, session);

    // Wire up form interactions
    wireForm(card, session);

    // Focus first interactive element
    setTimeout(() => {
      const firstSel = card.querySelector('.tp-project-sel');
      if (firstSel) firstSel.focus();
    }, 150);

    // Scroll into view
    setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
  }

  function collapseAll() {
    document.querySelectorAll('.tp-card-open').forEach(c => {
      c.classList.remove('tp-card-open');
      c.querySelector('.tp-form')?.setAttribute('aria-hidden', 'true');
    });
    expandedCard = null;
  }

  function injectRecentChips(card, session) {
    const container = card.querySelector(`#tp-recent-${session.start}`);
    if (!container || recentProjects.length === 0) return;
    container.innerHTML = `<div class="tp-recent-label-sm">Snel kiezen:</div>`;
    const chips = div('tp-recent-chips-sm');
    recentProjects.forEach(r => {
      const chip = div('tp-chip-sm');
      chip.textContent = `${r.projectName} — ${r.taskName}`;
      chip.addEventListener('click', () => applyRecent(card, r));
      chips.appendChild(chip);
    });
    container.appendChild(chips);
  }

  function applyRecent(card, recent) {
    const projSel = card.querySelector('.tp-project-sel');
    const taskSel = card.querySelector('.tp-task-sel');
    const submitBtn = card.querySelector('.tp-submit-btn');

    // Set project
    projSel.value = recent.projectId;

    // Fetch and set tasks, then set task value
    loadTasksForCard(card, recent.projectId, () => {
      taskSel.value = recent.taskId;
      submitBtn.disabled = false;
    });
  }

  // ─── Form wiring ─────────────────────────────────────────────────────────────

  function wireForm(card, session) {
    const projSel   = card.querySelector('.tp-project-sel');
    const taskSel   = card.querySelector('.tp-task-sel');
    const submitBtn = card.querySelector('.tp-submit-btn');
    const startInput = card.querySelector('[data-role="start"]');
    const endInput   = card.querySelector('[data-role="end"]');
    const durBadge   = card.querySelector('[data-role="dur"]');
    const notesInput = card.querySelector('[data-role="notes"]');
    const collapseBtn = card.querySelector('.tp-collapse-btn');

    // Duration update
    function updateDur() {
      const s = timeInputToMs(startInput.value);
      const e = timeInputToMs(endInput.value);
      const diff = e - s;
      durBadge.textContent = diff > 0 ? formatDuration(Math.round(diff / 60000)) : '';
      durBadge.classList.toggle('tp-dur-valid', diff > 0);
    }
    startInput.addEventListener('input', updateDur);
    endInput.addEventListener('input', updateDur);
    updateDur();

    // Project change → load tasks
    projSel.addEventListener('change', () => {
      submitBtn.disabled = true;
      taskSel.disabled = true;
      taskSel.innerHTML = '<option value="">Laden…</option>';
      if (!projSel.value) {
        taskSel.innerHTML = '<option value="">Kies eerst een project</option>';
        return;
      }
      loadTasksForCard(card, projSel.value);
    });

    // Task change → enable submit
    taskSel.addEventListener('change', () => {
      submitBtn.disabled = !taskSel.value;
    });

    // Collapse
    collapseBtn.addEventListener('click', collapseAll);

    // Submit
    submitBtn.addEventListener('click', () => handleSubmit(card, session, {
      startInput, endInput, notesInput, projSel, taskSel, submitBtn
    }));

    // Keyboard: Enter on fields submits
    [notesInput].forEach(el => {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' && !submitBtn.disabled) submitBtn.click();
      });
    });
  }

  async function loadTasksForCard(card, projectId, callback) {
    const taskSel = card.querySelector('.tp-task-sel');
    taskSel.innerHTML = '<option value="">Laden…</option>';
    taskSel.disabled = true;
    try {
      const resp = await fetchNas(`/api/projects/${projectId}/tasks`);
      taskSel.innerHTML = '<option value="">Kies taak…</option>' +
        resp.tasks.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
      taskSel.disabled = false;
      if (callback) callback();
    } catch {
      taskSel.innerHTML = '<option value="">Fout bij laden</option>';
    }
  }

  async function handleSubmit(card, session, { startInput, endInput, notesInput, projSel, taskSel, submitBtn }) {
    const startMs = timeInputToMs(startInput.value);
    const endMs   = timeInputToMs(endInput.value);
    const hours   = Math.round((endMs - startMs) / 3600000 * 100) / 100;

    if (hours <= 0) { showCardError(card, 'Eindtijd moet na begintijd liggen.'); return; }
    if (!taskSel.value) { showCardError(card, 'Kies een project en taak.'); return; }

    // Loading state
    submitBtn.disabled = true;
    submitBtn.classList.add('tp-loading');

    try {
      await fetchNas('/api/entries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spentDate: currentDate,
          hours,
          projectId: Number(projSel.value),
          taskId: Number(taskSel.value),
          notes: notesInput.value.trim()
        })
      });

      // Remember this project/task combination
      const selectedProject = projects.find(p => String(p.id) === projSel.value);
      const selectedTaskOpt = taskSel.options[taskSel.selectedIndex];
      if (selectedProject && selectedTaskOpt.value) {
        await saveRecent({
          projectId: Number(projSel.value),
          projectName: selectedProject.name,
          taskId: Number(taskSel.value),
          taskName: selectedTaskOpt.textContent
        });
      }

      // Mark session as used
      usedSessions.add(String(session.start));
      await chrome.storage.local.set({ [`${USED_PREFIX}${currentDate}`]: [...usedSessions] });

      // Update harvest total
      harvestTotal += hours;
      setText('tp-harvest-total', `${formatHours(harvestTotal)} in Harvest`);

      // Success animation then convert card to used state
      card.classList.add('tp-card-success');
      setTimeout(() => {
        card.classList.remove('tp-card-open', 'tp-card-success');
        card.classList.add('tp-card-used');
        card.innerHTML = buildUsedCardHTML(session, Math.round((endMs - startMs) / 60000));
        expandedCard = null;
      }, 900);

    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('tp-loading');
      showCardError(card, err.message);
    }
  }

  function buildUsedCardHTML(session, dur) {
    return `
      <div class="tp-card-summary">
        <div class="tp-card-left">
          <div class="tp-card-time">${formatTime(session.start)} – ${formatTime(session.end)}</div>
          <div class="tp-card-meta">
            <span class="tp-card-dur">${formatDuration(dur)}</span>
          </div>
        </div>
        <div class="tp-card-right"><span class="tp-check">✓</span></div>
      </div>`;
  }

  function showCardError(card, msg) {
    let err = card.querySelector('.tp-card-error');
    if (!err) {
      err = div('tp-card-error');
      card.querySelector('.tp-form-actions')?.after(err);
    }
    err.textContent = msg;
    err.style.display = 'block';
    setTimeout(() => { if (err) err.style.display = 'none'; }, 4000);
  }

  // ─── Interruptions grid ───────────────────────────────────────────────────────

  function buildInterruptionGrid() {
    const grid = div('tp-intr-grid');
    INTERRUPTIONS.forEach(intr => {
      const btn = div('tp-intr-btn');
      btn.innerHTML = `
        <span class="tp-intr-ico">${intr.icon}</span>
        <span class="tp-intr-lbl">${escHtml(intr.label)}</span>
        <span class="tp-intr-min">${intr.minutes}min</span>
      `;
      btn.addEventListener('click', () => openQuickForm(null, intr));
      grid.appendChild(btn);
    });
    return grid;
  }

  // ─── Quick form (interruptions + recent chips) ────────────────────────────────

  function openQuickForm(recent, interruption) {
    // Remove existing quick form
    document.getElementById('tp-quick-form')?.remove();

    const endMs   = Date.now();
    const startMs = interruption
      ? endMs - interruption.minutes * 60000
      : endMs - 1800000; // 30min default for recent chip

    const projectOptions = projects.map(p =>
      `<option value="${p.id}" ${recent && p.id === recent.projectId ? 'selected' : ''}>${escHtml(p.clientName ? `${p.clientName} — ${p.name}` : p.name)}</option>`
    ).join('');

    const qf = div('tp-quick-form');
    qf.id = 'tp-quick-form';
    qf.innerHTML = `
      <div class="tp-qf-header">
        <strong>${interruption ? interruption.icon + ' ' + interruption.label : '⏱ Snel boeken'}</strong>
        <button class="tp-x tp-qf-close" aria-label="Sluiten">✕</button>
      </div>
      <div class="tp-field-row tp-time-row">
        <div class="tp-field">
          <label class="tp-lbl">Van</label>
          <input class="tp-input tp-time-input" type="time" value="${formatTimeInput(startMs)}" data-role="start" />
        </div>
        <div class="tp-time-sep">–</div>
        <div class="tp-field">
          <label class="tp-lbl">Tot</label>
          <input class="tp-input tp-time-input" type="time" value="${formatTimeInput(endMs)}" data-role="end" />
        </div>
        <span class="tp-duration-badge tp-dur-valid" data-role="dur"></span>
      </div>
      <div class="tp-field">
        <label class="tp-lbl">Project</label>
        <select class="tp-input tp-select tp-project-sel">
          <option value="">Kies project…</option>
          ${projectOptions}
        </select>
      </div>
      <div class="tp-field">
        <label class="tp-lbl">Taak</label>
        <select class="tp-input tp-select tp-task-sel" disabled>
          <option value="">Kies eerst een project</option>
        </select>
      </div>
      <div class="tp-field">
        <label class="tp-lbl">Notities</label>
        <input class="tp-input" type="text" value="${escHtml(interruption?.label || '')}" placeholder="Optioneel…" data-role="notes" />
      </div>
      <div class="tp-form-actions">
        <button class="tp-btn-ghost tp-qf-close" type="button">Annuleer</button>
        <button class="tp-btn-primary tp-submit-btn" type="button" ${recent ? '' : 'disabled'}>
          <span class="tp-btn-txt">Opslaan in Harvest</span>
          <span class="tp-btn-spin" aria-hidden="true"></span>
        </button>
      </div>
      <div class="tp-card-error" style="display:none"></div>
    `;

    document.getElementById('tp-content').prepend(qf);

    // Wire duration
    const startI = qf.querySelector('[data-role="start"]');
    const endI   = qf.querySelector('[data-role="end"]');
    const durB   = qf.querySelector('[data-role="dur"]');
    function updateDur() {
      const diff = timeInputToMs(endI.value) - timeInputToMs(startI.value);
      durB.textContent = diff > 0 ? formatDuration(Math.round(diff / 60000)) : '';
    }
    startI.addEventListener('input', updateDur);
    endI.addEventListener('input', updateDur);
    updateDur();

    // Wire project change
    const projSel = qf.querySelector('.tp-project-sel');
    const taskSel = qf.querySelector('.tp-task-sel');
    const submitBtn = qf.querySelector('.tp-submit-btn');

    projSel.addEventListener('change', () => {
      submitBtn.disabled = true;
      taskSel.disabled = true;
      taskSel.innerHTML = '<option value="">Laden…</option>';
      if (!projSel.value) { taskSel.innerHTML = '<option value="">Kies eerst een project</option>'; return; }
      fetchNas(`/api/projects/${projSel.value}/tasks`).then(r => {
        taskSel.innerHTML = '<option value="">Kies taak…</option>' +
          r.tasks.map(t => `<option value="${t.id}" ${recent && t.id === recent.taskId ? 'selected' : ''}>${escHtml(t.name)}</option>`).join('');
        taskSel.disabled = false;
        if (recent) submitBtn.disabled = false;
      }).catch(() => { taskSel.innerHTML = '<option value="">Fout bij laden</option>'; });
    });

    taskSel.addEventListener('change', () => { submitBtn.disabled = !taskSel.value; });

    // Pre-load tasks if recent selected
    if (recent && projSel.value) projSel.dispatchEvent(new Event('change'));

    // Close buttons
    qf.querySelectorAll('.tp-qf-close').forEach(b => b.addEventListener('click', () => qf.remove()));

    // Submit
    submitBtn.addEventListener('click', async () => {
      const hours = Math.round((timeInputToMs(endI.value) - timeInputToMs(startI.value)) / 3600000 * 100) / 100;
      if (hours <= 0) { showQfError(qf, 'Eindtijd moet na begintijd liggen.'); return; }
      if (!taskSel.value) { showQfError(qf, 'Kies project en taak.'); return; }

      submitBtn.disabled = true;
      submitBtn.classList.add('tp-loading');

      try {
        await fetchNas('/api/entries', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spentDate: currentDate, hours,
            projectId: Number(projSel.value),
            taskId: Number(taskSel.value),
            notes: qf.querySelector('[data-role="notes"]').value.trim()
          })
        });

        const selectedProject = projects.find(p => String(p.id) === projSel.value);
        const selectedTask = taskSel.options[taskSel.selectedIndex];
        if (selectedProject && selectedTask.value) {
          await saveRecent({ projectId: Number(projSel.value), projectName: selectedProject.name, taskId: Number(taskSel.value), taskName: selectedTask.textContent });
        }

        harvestTotal += hours;
        setText('tp-harvest-total', `${formatHours(harvestTotal)} in Harvest`);
        qf.classList.add('tp-qf-success');
        setTimeout(() => qf.remove(), 800);

      } catch (err) {
        submitBtn.disabled = false;
        submitBtn.classList.remove('tp-loading');
        showQfError(qf, err.message);
      }
    });

    qf.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => projSel.focus(), 100);
  }

  function showQfError(qf, msg) {
    const e = qf.querySelector('.tp-card-error');
    if (e) { e.textContent = msg; e.style.display = 'block'; }
  }

  // ─── Recent storage ───────────────────────────────────────────────────────────

  async function loadRecent() {
    const r = await chrome.storage.local.get(RECENT_KEY);
    return r[RECENT_KEY] || [];
  }

  async function saveRecent(entry) {
    const current = await loadRecent();
    const filtered = current.filter(r => !(r.projectId === entry.projectId && r.taskId === entry.taskId));
    recentProjects = [entry, ...filtered].slice(0, 3);
    await chrome.storage.local.set({ [RECENT_KEY]: recentProjects });
  }

  async function loadUsed(date) {
    const r = await chrome.storage.local.get(`${USED_PREFIX}${date}`);
    return new Set(r[`${USED_PREFIX}${date}`] || []);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  function sectionTitle(text) {
    const el = div('tp-section-title');
    el.textContent = text;
    return el;
  }

  function emptyState(text) {
    const el = div('tp-empty-state');
    el.textContent = text;
    return el;
  }

  async function fetchNas(path, options) {
    const resp = await fetch(`${serverUrl}${path}`, { ...options, signal: AbortSignal.timeout(8000) });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  function div(cls, id) {
    const el = document.createElement('div');
    if (cls) el.className = cls;
    if (id) el.id = id;
    return el;
  }

  function setText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function todayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function pad(n) { return String(n).padStart(2, '0'); }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  }

  function formatTimeInput(ts) {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDuration(min) {
    const h = Math.floor(min / 60), m = min % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}u`;
    return `${h}u ${m}min`;
  }

  function formatHours(h) {
    const hrs = Math.floor(h), mins = Math.round((h - hrs) * 60);
    if (hrs === 0) return `${mins}min`;
    if (mins === 0) return `${hrs}u`;
    return `${hrs}u ${mins}min`;
  }

  function timeInputToMs(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    const d = new Date(); d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c =>
      ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' })[c]);
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
/* ── Reset & vars ────────────────────────────────────────────────── */
#tp-panel, #tp-panel * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', sans-serif; }
:root {
  --tp-indigo:    #6366f1;
  --tp-indigo-dk: #4f46e5;
  --tp-indigo-lt: #eef2ff;
  --tp-green:     #22c55e;
  --tp-amber:     #f59e0b;
  --tp-red:       #ef4444;
  --tp-text:      #1e293b;
  --tp-muted:     #64748b;
  --tp-subtle:    #94a3b8;
  --tp-border:    #e2e8f0;
  --tp-bg:        #f8fafc;
  --tp-surface:   #ffffff;
  --tp-radius:    10px;
  --tp-panel-w:   340px;
}

/* ── FAB toggle ──────────────────────────────────────────────────── */
.tp-fab {
  position: fixed; bottom: 28px; right: 28px; z-index: 999998;
  background: var(--tp-indigo);
  color: #fff;
  border-radius: 28px;
  padding: 11px 18px;
  display: flex; align-items: center; gap: 7px;
  font-size: 13px; font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 20px rgba(99,102,241,.35);
  transition: background .15s, box-shadow .15s, transform .1s;
  user-select: none;
}
.tp-fab:hover { background: var(--tp-indigo-dk); box-shadow: 0 6px 24px rgba(99,102,241,.45); }
.tp-fab:active { transform: scale(.97); }
.tp-fab.tp-fab-active { background: var(--tp-indigo-dk); }
.tp-fab-icon { font-size: 16px; }
.tp-fab-txt { letter-spacing: .01em; }

/* ── Panel ───────────────────────────────────────────────────────── */
#tp-panel {
  position: fixed; top: 0; right: -360px; width: var(--tp-panel-w);
  height: 100dvh;
  background: var(--tp-surface);
  border-left: 1px solid var(--tp-border);
  box-shadow: -6px 0 32px rgba(0,0,0,.08);
  z-index: 999997;
  display: flex; flex-direction: column;
  transition: right .28s cubic-bezier(.4,0,.2,1);
}
#tp-panel.tp-open { right: 0; }

/* ── Header ──────────────────────────────────────────────────────── */
.tp-head {
  padding: 16px 16px 12px;
  border-bottom: 1px solid var(--tp-border);
  background: var(--tp-bg);
  flex-shrink: 0;
}
.tp-head-top { display: flex; align-items: center; justify-content: space-between; }
.tp-wordmark { font-size: 15px; font-weight: 700; letter-spacing: -.01em; }
.tp-x {
  background: none; border: none; cursor: pointer;
  color: var(--tp-subtle); font-size: 14px;
  width: 28px; height: 28px; border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: background .1s, color .1s;
}
.tp-x:hover { background: var(--tp-border); color: var(--tp-text); }
.tp-head-meta { display: flex; align-items: baseline; justify-content: space-between; margin-top: 6px; }
.tp-meta-date { font-size: 12px; font-weight: 600; color: var(--tp-muted); }
.tp-meta-total { font-size: 13px; font-weight: 700; color: var(--tp-indigo); }

/* ── Scroll area ─────────────────────────────────────────────────── */
.tp-scroll { flex: 1; overflow-y: auto; padding: 14px 14px 80px; scroll-behavior: smooth; }
.tp-scroll::-webkit-scrollbar { width: 4px; }
.tp-scroll::-webkit-scrollbar-thumb { background: var(--tp-border); border-radius: 4px; }

/* ── Section title ───────────────────────────────────────────────── */
.tp-section-title {
  font-size: 10px; font-weight: 700; text-transform: uppercase;
  letter-spacing: .08em; color: var(--tp-subtle);
  padding: 14px 2px 6px; margin: 0;
}

/* ── Skeleton ────────────────────────────────────────────────────── */
.tp-skeleton-wrap { padding: 8px 0; display: flex; flex-direction: column; gap: 10px; }
.tp-skel {
  height: 56px; background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
  background-size: 200% 100%; border-radius: var(--tp-radius);
  animation: tp-shimmer 1.4s ease infinite;
}
@keyframes tp-shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

/* ── State boxes ─────────────────────────────────────────────────── */
.tp-state-box { text-align: center; padding: 32px 16px; }
.tp-state-icon { font-size: 32px; margin-bottom: 8px; }
.tp-state-msg { font-size: 14px; font-weight: 600; color: var(--tp-text); }
.tp-state-sub { font-size: 12px; color: var(--tp-subtle); margin-top: 4px; }
.tp-empty-state { text-align: center; color: var(--tp-subtle); font-size: 13px; padding: 16px 8px; }
.tp-retry-btn {
  margin-top: 14px; padding: 8px 16px;
  background: var(--tp-indigo); color: #fff;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;
}

/* ── Recent strip ────────────────────────────────────────────────── */
.tp-recent-strip {
  background: var(--tp-indigo-lt);
  border: 1px solid #c7d2fe;
  border-radius: var(--tp-radius);
  padding: 10px 12px;
  margin-bottom: 4px;
}
.tp-recent-label { font-size: 10px; font-weight: 700; color: var(--tp-indigo); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 7px; }
.tp-recent-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.tp-chip {
  background: #fff; border: 1px solid #c7d2fe;
  color: var(--tp-indigo); font-size: 12px; font-weight: 600;
  padding: 5px 10px; border-radius: 20px; cursor: pointer;
  max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background .1s, border-color .1s;
}
.tp-chip:hover { background: var(--tp-indigo); color: #fff; border-color: var(--tp-indigo); }

/* ── Session cards ───────────────────────────────────────────────── */
.tp-card {
  background: var(--tp-surface);
  border: 1.5px solid var(--tp-border);
  border-radius: var(--tp-radius);
  margin-bottom: 8px;
  overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
  border-left: 3px solid var(--tp-indigo);
}
.tp-card:hover:not(.tp-card-used) { border-color: #a5b4fc; box-shadow: 0 2px 12px rgba(99,102,241,.1); }
.tp-card-open { border-color: var(--tp-indigo); box-shadow: 0 4px 20px rgba(99,102,241,.15); }
.tp-card-used { border-left-color: var(--tp-border); opacity: .5; }
.tp-card-success { border-color: var(--tp-green) !important; background: #f0fdf4 !important; }

.tp-card-summary {
  display: flex; align-items: center; justify-content: space-between;
  padding: 11px 13px; cursor: pointer;
}
.tp-card-used .tp-card-summary { cursor: default; }
.tp-card-left { min-width: 0; }
.tp-card-time { font-size: 13px; font-weight: 700; color: var(--tp-text); }
.tp-card-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 4px; margin-top: 2px; }
.tp-card-dur { font-size: 11px; font-weight: 700; color: var(--tp-indigo); }
.tp-card-used .tp-card-dur { color: var(--tp-subtle); }
.tp-card-sep { color: var(--tp-subtle); font-size: 11px; }
.tp-card-domains { font-size: 11px; color: var(--tp-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 160px; }
.tp-badge { background: #e0e7ff; color: #4338ca; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; display: inline-flex; align-items: center; gap: 3px; }
.tp-platform-ico { width: 12px; height: 12px; object-fit: contain; border-radius: 2px; flex-shrink: 0; }
.tp-card-right { flex-shrink: 0; margin-left: 8px; }
.tp-chevron { width: 16px; height: 16px; color: var(--tp-subtle); transition: transform .2s; }
.tp-card-open .tp-chevron { transform: rotate(180deg); }
.tp-check { color: var(--tp-green); font-size: 15px; font-weight: 700; }

/* ── Inline form (accordion) ─────────────────────────────────────── */
.tp-form {
  max-height: 0; overflow: hidden;
  transition: max-height .3s cubic-bezier(.4,0,.2,1);
}
.tp-card-open .tp-form { max-height: 520px; }
.tp-form-inner {
  padding: 0 13px 13px;
  border-top: 1px solid var(--tp-border);
  display: flex; flex-direction: column; gap: 9px;
}

/* ── Recent in-form ──────────────────────────────────────────────── */
.tp-recent-label-sm { font-size: 10px; font-weight: 700; color: var(--tp-indigo); text-transform: uppercase; letter-spacing: .06em; margin-bottom: 5px; margin-top: 10px; }
.tp-recent-chips-sm { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 4px; }
.tp-chip-sm {
  background: var(--tp-indigo-lt); border: 1px solid #c7d2fe;
  color: var(--tp-indigo); font-size: 11px; font-weight: 600;
  padding: 4px 9px; border-radius: 16px; cursor: pointer;
  max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  transition: background .1s;
}
.tp-chip-sm:hover { background: var(--tp-indigo); color: #fff; }

/* ── Form fields ─────────────────────────────────────────────────── */
.tp-field { display: flex; flex-direction: column; gap: 4px; }
.tp-field-row { display: flex; align-items: flex-end; gap: 6px; }
.tp-time-row .tp-field { flex: 1; }
.tp-time-sep { color: var(--tp-muted); font-size: 14px; padding-bottom: 8px; }
.tp-lbl { font-size: 11px; font-weight: 600; color: var(--tp-muted); }
.tp-input {
  width: 100%; padding: 8px 10px;
  border: 1.5px solid var(--tp-border); border-radius: 8px;
  font-size: 13px; color: var(--tp-text); background: var(--tp-surface);
  outline: none; transition: border-color .15s, box-shadow .15s;
  font-family: inherit;
}
.tp-input:focus { border-color: var(--tp-indigo); box-shadow: 0 0 0 3px rgba(99,102,241,.12); }
.tp-select { cursor: pointer; }
.tp-time-input { font-variant-numeric: tabular-nums; }
.tp-duration-badge {
  font-size: 11px; font-weight: 700; color: var(--tp-subtle);
  white-space: nowrap; padding-bottom: 10px; min-width: 44px; text-align: right;
}
.tp-dur-valid { color: var(--tp-indigo); }

/* ── Form actions ────────────────────────────────────────────────── */
.tp-form-actions { display: flex; gap: 8px; margin-top: 2px; }
.tp-btn-ghost {
  flex: 0 0 auto; padding: 9px 14px;
  background: none; border: 1.5px solid var(--tp-border);
  border-radius: 8px; font-size: 13px; font-weight: 600;
  color: var(--tp-muted); cursor: pointer; transition: background .1s;
  font-family: inherit;
}
.tp-btn-ghost:hover { background: var(--tp-bg); }
.tp-btn-primary {
  flex: 1; padding: 9px 14px;
  background: var(--tp-indigo); color: #fff;
  border: none; border-radius: 8px; font-size: 13px; font-weight: 600;
  cursor: pointer; transition: background .15s; position: relative;
  font-family: inherit; display: flex; align-items: center; justify-content: center; gap: 6px;
}
.tp-btn-primary:hover:not(:disabled) { background: var(--tp-indigo-dk); }
.tp-btn-primary:disabled { background: #c7d2fe; cursor: not-allowed; }
.tp-btn-spin {
  display: none; width: 14px; height: 14px;
  border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
  border-radius: 50%; animation: tp-spin .6s linear infinite;
}
.tp-loading .tp-btn-txt { opacity: .6; }
.tp-loading .tp-btn-spin { display: block; }
@keyframes tp-spin { to { transform: rotate(360deg); } }

.tp-card-error {
  font-size: 12px; color: #dc2626;
  background: #fee2e2; border-radius: 6px;
  padding: 7px 10px; margin-top: 4px;
}

/* ── Interruption grid ───────────────────────────────────────────── */
.tp-intr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.tp-intr-btn {
  background: var(--tp-bg); border: 1.5px solid var(--tp-border);
  border-radius: var(--tp-radius); padding: 10px 10px;
  cursor: pointer; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  transition: background .1s, border-color .1s;
}
.tp-intr-btn:hover { background: #fffbeb; border-color: #fcd34d; }
.tp-intr-ico { font-size: 20px; line-height: 1; }
.tp-intr-lbl { font-size: 12px; font-weight: 600; color: var(--tp-text); line-height: 1.3; }
.tp-intr-min { font-size: 11px; color: var(--tp-subtle); }

/* ── Quick form ──────────────────────────────────────────────────── */
.tp-quick-form {
  background: var(--tp-indigo-lt);
  border: 1.5px solid #c7d2fe;
  border-radius: var(--tp-radius);
  padding: 14px;
  margin-bottom: 12px;
  display: flex; flex-direction: column; gap: 9px;
  animation: tp-slide-down .2s ease;
}
@keyframes tp-slide-down { from { opacity: 0; transform: translateY(-8px); } to { opacity: 1; transform: translateY(0); } }
.tp-qf-header { display: flex; align-items: center; justify-content: space-between; }
.tp-qf-header strong { font-size: 13px; color: var(--tp-text); }
.tp-qf-success { background: #f0fdf4; border-color: var(--tp-green); animation: tp-success-flash .8s ease forwards; }
@keyframes tp-success-flash { 0% { opacity: 1; } 80% { opacity: 1; } 100% { opacity: 0; } }
    `;
    document.head.appendChild(s);
  }

  // ─── Start ──────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
