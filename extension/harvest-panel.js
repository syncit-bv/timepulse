// TimePulse — Harvest panel injection
// Injects a suggestions sidebar into the Harvest web app showing:
// - Browser activity sessions (fetched from NAS)
// - Quick-add cards for common interruptions
// Clicking a card opens an inline mini-form that books directly to Harvest via the NAS API.

(function () {
  'use strict';

  if (!window.location.hostname.includes('harvestapp.com')) return;

  // ─── Config ─────────────────────────────────────────────────────────────────

  const INTERRUPTIONS = [
    { id: 'phone',   icon: '📞', label: 'Telefoongesprek',   minutes: 15, notes: 'Telefoongesprek' },
    { id: 'teams',   icon: '💬', label: 'Teams / meeting',   minutes: 30, notes: 'Teams vergadering' },
    { id: 'lunch',   icon: '🍽️', label: 'Lunchpauze',        minutes: 30, notes: 'Lunchpauze' },
    { id: 'break',   icon: '☕', label: 'Korte pauze',       minutes: 10, notes: 'Pauze' },
    { id: 'client',  icon: '🤝', label: 'Klantontmoeting',   minutes: 60, notes: 'Klantontmoeting' },
    { id: 'travel',  icon: '🚗', label: 'Verplaatsing',      minutes: 30, notes: 'Verplaatsing naar klant' },
    { id: 'admin',   icon: '📋', label: 'Administratie',     minutes: 15, notes: 'Administratieve taken' },
    { id: 'review',  icon: '👁️', label: 'Review / feedback', minutes: 20, notes: 'Code review / feedback' },
  ];

  const PANEL_ID = 'timepulse-harvest-panel';

  let serverUrl = '';
  let currentDate = todayDate();
  let projects = [];
  let sessions = [];
  let usedSessions = new Set();
  let panelOpen = false;

  // ─── Init ───────────────────────────────────────────────────────────────────

  async function init() {
    const result = await chrome.storage.sync.get(['serverUrl']);
    serverUrl = (result.serverUrl || '').replace(/\/$/, '');
    if (!serverUrl) return; // Not configured, don't inject

    const usedKey = `used_${currentDate}`;
    const stored = await chrome.storage.local.get(usedKey);
    usedSessions = new Set(stored[usedKey] || []);

    injectStyles();
    injectToggleButton();
    injectPanel();
    await loadData();

    // Watch for Harvest SPA navigation (date changes)
    observeDateChange();
  }

  // ─── Date detection ─────────────────────────────────────────────────────────

  function observeDateChange() {
    // Harvest is a SPA — URL changes when navigating days
    let lastUrl = location.href;
    new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        const detected = detectDateFromUrl();
        if (detected && detected !== currentDate) {
          currentDate = detected;
          refreshForDate();
        }
      }
    }).observe(document, { subtree: true, childList: true });
  }

  function detectDateFromUrl() {
    // Harvest URL patterns:
    // /time/day/YYYY/MM/DD
    // /time (today)
    const m = location.pathname.match(/\/time\/day\/(\d{4})\/(\d{2})\/(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    if (location.pathname.startsWith('/time')) return todayDate();
    return null;
  }

  async function refreshForDate() {
    const usedKey = `used_${currentDate}`;
    const stored = await chrome.storage.local.get(usedKey);
    usedSessions = new Set(stored[usedKey] || []);
    updatePanelDate();
    await loadData();
  }

  // ─── Data loading ────────────────────────────────────────────────────────────

  async function loadData() {
    renderLoading();
    try {
      const [sessionsResp, projectsResp] = await Promise.all([
        fetchNas(`/api/sessions/${currentDate}`),
        projects.length > 0 ? Promise.resolve({ projects }) : fetchNas('/api/projects')
      ]);
      sessions = sessionsResp.sessions || [];
      if (projectsResp.projects) projects = projectsResp.projects;
      renderContent();
    } catch (err) {
      renderError(err.message);
    }
  }

  async function fetchNas(path, options) {
    const resp = await fetch(`${serverUrl}${path}`, {
      ...options,
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      throw new Error(body.error || `HTTP ${resp.status}`);
    }
    return resp.json();
  }

  // ─── Panel structure ─────────────────────────────────────────────────────────

  function injectToggleButton() {
    const btn = document.createElement('button');
    btn.id = 'timepulse-toggle';
    btn.innerHTML = `<span class="tp-logo">⏱</span><span class="tp-label">TimePulse</span>`;
    btn.addEventListener('click', togglePanel);
    document.body.appendChild(btn);
  }

  function injectPanel() {
    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-label', 'TimePulse suggesties');
    panel.innerHTML = `
      <div class="tp-header">
        <span class="tp-title">⏱ TimePulse</span>
        <span class="tp-date" id="tp-date-label"></span>
        <button class="tp-close" id="tp-close">✕</button>
      </div>
      <div class="tp-body" id="tp-body">
        <div class="tp-loading">Laden…</div>
      </div>
    `;
    document.body.appendChild(panel);

    document.getElementById('tp-close').addEventListener('click', togglePanel);
    updatePanelDate();
  }

  function togglePanel() {
    panelOpen = !panelOpen;
    const panel = document.getElementById(PANEL_ID);
    const btn = document.getElementById('timepulse-toggle');
    if (panel) panel.classList.toggle('tp-open', panelOpen);
    if (btn) btn.classList.toggle('tp-active', panelOpen);
    if (panelOpen) loadData();
  }

  function updatePanelDate() {
    const el = document.getElementById('tp-date-label');
    if (el) {
      const d = new Date(currentDate + 'T12:00:00');
      el.textContent = d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
    }
  }

  // ─── Rendering ───────────────────────────────────────────────────────────────

  function renderLoading() {
    const body = document.getElementById('tp-body');
    if (body) body.innerHTML = '<div class="tp-loading">Laden…</div>';
  }

  function renderError(msg) {
    const body = document.getElementById('tp-body');
    if (body) body.innerHTML = `<div class="tp-error">Kan server niet bereiken.<br><small>${escHtml(msg)}</small></div>`;
  }

  function renderContent() {
    const body = document.getElementById('tp-body');
    if (!body) return;

    const html = `
      ${sessions.length > 0 ? renderSessions() : ''}
      <div class="tp-section-title">Snelle toevoegingen</div>
      <div class="tp-interruptions">${INTERRUPTIONS.map(renderInterruption).join('')}</div>
      ${sessions.length === 0 ? '<div class="tp-empty">Geen browseractiviteit gevonden voor deze dag.</div>' : ''}
    `;

    body.innerHTML = html;

    // Bind session clicks
    body.querySelectorAll('.tp-session[data-idx]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.idx, 10);
        if (!el.classList.contains('tp-used')) openMiniForm(el, sessions[idx]);
      });
    });

    // Bind interruption clicks
    body.querySelectorAll('.tp-interruption[data-id]').forEach(el => {
      el.addEventListener('click', () => {
        const interruption = INTERRUPTIONS.find(i => i.id === el.dataset.id);
        if (interruption) openInterruptionForm(el, interruption);
      });
    });
  }

  function renderSessions() {
    const items = sessions.map((sess, idx) => {
      const used = usedSessions.has(String(sess.start));
      const dur = Math.round((sess.end - sess.start) / 60000);
      const domains = (sess.domains || []).slice(0, 2).join(', ');
      const types = [...new Set(sess.activityTypes || [])].filter(t => t !== 'website').join(', ');
      return `
        <div class="tp-session${used ? ' tp-used' : ''}" data-idx="${idx}" title="${escHtml(domains)}">
          <div class="tp-session-time">${formatTime(sess.start)} – ${formatTime(sess.end)}</div>
          <div class="tp-session-dur">${formatDuration(dur)}</div>
          <div class="tp-session-domains">${escHtml(domains)}${types ? ` <span class="tp-tag">${escHtml(types)}</span>` : ''}</div>
          ${used ? '<div class="tp-used-label">✓ Ingeboekt</div>' : ''}
        </div>
      `;
    }).join('');

    return `
      <div class="tp-section-title">Browseractiviteit</div>
      <div class="tp-sessions">${items}</div>
    `;
  }

  function renderInterruption(intr) {
    return `
      <div class="tp-interruption" data-id="${intr.id}">
        <span class="tp-intr-icon">${intr.icon}</span>
        <div class="tp-intr-info">
          <div class="tp-intr-label">${escHtml(intr.label)}</div>
          <div class="tp-intr-dur">${intr.minutes} min</div>
        </div>
      </div>
    `;
  }

  // ─── Mini form (session) ──────────────────────────────────────────────────────

  function openMiniForm(cardEl, session) {
    closeMiniForm();

    const dur = (session.end - session.start) / 3600000;
    const form = createFormEl({
      startTime: formatTimeInput(session.start),
      endTime: formatTimeInput(session.end),
      notes: (session.domains || []).slice(0, 2).join(', '),
      onSubmit: async (data) => {
        await submitEntry(data, session.start);
        markSessionUsed(session.start);
        cardEl.classList.add('tp-used');
        cardEl.innerHTML += '<div class="tp-used-label">✓ Ingeboekt</div>';
        closeMiniForm();
      }
    });

    cardEl.after(form);
    form.querySelector('select.tp-project').focus();
  }

  // ─── Mini form (interruption) ─────────────────────────────────────────────────

  function openInterruptionForm(cardEl, interruption) {
    closeMiniForm();

    // Suggest time: last used session end, or round current time back
    const suggestedEnd = new Date();
    const suggestedStart = new Date(suggestedEnd.getTime() - interruption.minutes * 60000);

    const form = createFormEl({
      startTime: formatTimeInput(suggestedStart.getTime()),
      endTime: formatTimeInput(suggestedEnd.getTime()),
      notes: interruption.notes,
      onSubmit: async (data) => {
        await submitEntry(data, null);
        closeMiniForm();
        showToast(`${interruption.icon} Ingeboekt in Harvest`);
      }
    });

    cardEl.after(form);
    form.querySelector('select.tp-project').focus();
  }

  function createFormEl({ startTime, endTime, notes, onSubmit }) {
    const form = document.createElement('div');
    form.className = 'tp-mini-form';
    form.id = 'tp-active-form';

    const projectOptions = projects.map(p =>
      `<option value="${p.id}">${escHtml(p.clientName ? `${p.clientName} — ${p.name}` : p.name)}</option>`
    ).join('');

    form.innerHTML = `
      <div class="tp-form-row tp-form-times">
        <input type="time" class="tp-time" id="tp-start" value="${startTime}" />
        <span>–</span>
        <input type="time" class="tp-time" id="tp-end" value="${endTime}" />
        <span class="tp-form-dur" id="tp-form-dur"></span>
      </div>
      <div class="tp-form-row">
        <select class="tp-project">
          <option value="">Selecteer project…</option>
          ${projectOptions}
        </select>
      </div>
      <div class="tp-form-row">
        <select class="tp-task" disabled>
          <option value="">Selecteer eerst project</option>
        </select>
      </div>
      <div class="tp-form-row">
        <textarea class="tp-notes" rows="2" placeholder="Notities…">${escHtml(notes)}</textarea>
      </div>
      <div class="tp-form-actions">
        <button class="tp-btn-cancel">Annuleer</button>
        <button class="tp-btn-submit" disabled>Opslaan in Harvest</button>
      </div>
      <div class="tp-form-error" id="tp-form-error" style="display:none"></div>
    `;

    // Duration update
    function updateDur() {
      const s = timeInputToMs(form.querySelector('#tp-start').value);
      const e = timeInputToMs(form.querySelector('#tp-end').value);
      const diff = e - s;
      form.querySelector('#tp-form-dur').textContent = diff > 0 ? formatDuration(Math.round(diff / 60000)) : '';
    }
    form.querySelector('#tp-start').addEventListener('input', updateDur);
    form.querySelector('#tp-end').addEventListener('input', updateDur);
    updateDur();

    // Project → load tasks
    form.querySelector('.tp-project').addEventListener('change', async function () {
      const taskSel = form.querySelector('.tp-task');
      const submitBtn = form.querySelector('.tp-btn-submit');
      taskSel.disabled = true;
      submitBtn.disabled = true;
      taskSel.innerHTML = '<option value="">Laden…</option>';
      if (!this.value) {
        taskSel.innerHTML = '<option value="">Selecteer eerst project</option>';
        return;
      }
      try {
        const resp = await fetchNas(`/api/projects/${this.value}/tasks`);
        taskSel.innerHTML = '<option value="">Selecteer taak…</option>' +
          resp.tasks.map(t => `<option value="${t.id}">${escHtml(t.name)}</option>`).join('');
        taskSel.disabled = false;
      } catch {
        taskSel.innerHTML = '<option value="">Fout bij laden taken</option>';
      }
    });

    // Enable submit when task selected
    form.querySelector('.tp-task').addEventListener('change', function () {
      form.querySelector('.tp-btn-submit').disabled = !this.value;
    });

    form.querySelector('.tp-btn-cancel').addEventListener('click', closeMiniForm);

    form.querySelector('.tp-btn-submit').addEventListener('click', async () => {
      const startMs = timeInputToMs(form.querySelector('#tp-start').value);
      const endMs = timeInputToMs(form.querySelector('#tp-end').value);
      const hours = Math.round((endMs - startMs) / 3600000 * 100) / 100;
      const projectId = Number(form.querySelector('.tp-project').value);
      const taskId = Number(form.querySelector('.tp-task').value);
      const notesText = form.querySelector('.tp-notes').value.trim();

      if (hours <= 0) {
        showFormError(form, 'Eindtijd moet na begintijd liggen.');
        return;
      }
      if (!taskId) {
        showFormError(form, 'Selecteer een project en taak.');
        return;
      }

      const submitBtn = form.querySelector('.tp-btn-submit');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Bezig…';

      try {
        await onSubmit({ hours, projectId, taskId, notes: notesText });
      } catch (err) {
        showFormError(form, err.message);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Opslaan in Harvest';
      }
    });

    return form;
  }

  function closeMiniForm() {
    document.getElementById('tp-active-form')?.remove();
  }

  function showFormError(form, msg) {
    const el = form.querySelector('#tp-form-error');
    if (el) { el.textContent = msg; el.style.display = 'block'; }
  }

  // ─── Submit to Harvest via NAS ────────────────────────────────────────────────

  async function submitEntry({ hours, projectId, taskId, notes }) {
    await fetchNas('/api/entries', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ spentDate: currentDate, hours, projectId, taskId, notes })
    });
  }

  async function markSessionUsed(startTs) {
    usedSessions.add(String(startTs));
    const usedKey = `used_${currentDate}`;
    await chrome.storage.local.set({ [usedKey]: [...usedSessions] });
  }

  // ─── Toast ───────────────────────────────────────────────────────────────────

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'tp-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('tp-toast-show'), 10);
    setTimeout(() => { toast.classList.remove('tp-toast-show'); setTimeout(() => toast.remove(), 300); }, 3000);
  }

  // ─── Styles ─────────────────────────────────────────────────────────────────

  function injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
      /* Toggle button */
      #timepulse-toggle {
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 999998;
        background: #6366f1;
        color: white;
        border: none;
        border-radius: 24px;
        padding: 10px 16px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 6px;
        box-shadow: 0 4px 16px rgba(99,102,241,.4);
        transition: background .15s, transform .15s;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      #timepulse-toggle:hover { background: #4f46e5; }
      #timepulse-toggle.tp-active { background: #4f46e5; }
      .tp-logo { font-size: 15px; }

      /* Panel */
      #timepulse-harvest-panel {
        position: fixed;
        top: 0;
        right: -380px;
        width: 360px;
        height: 100vh;
        background: #fff;
        border-left: 1px solid #e2e8f0;
        box-shadow: -4px 0 24px rgba(0,0,0,.1);
        z-index: 999997;
        display: flex;
        flex-direction: column;
        transition: right .25s cubic-bezier(.4,0,.2,1);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 13px;
        color: #1e293b;
      }
      #timepulse-harvest-panel.tp-open { right: 0; }

      .tp-header {
        display: flex;
        align-items: center;
        padding: 14px 16px;
        border-bottom: 1px solid #e2e8f0;
        background: #f8fafc;
        gap: 8px;
        flex-shrink: 0;
      }
      .tp-title { font-weight: 700; font-size: 14px; }
      .tp-date { color: #64748b; font-size: 12px; flex: 1; }
      .tp-close {
        background: none; border: none; cursor: pointer;
        color: #94a3b8; font-size: 15px; padding: 2px 6px;
        border-radius: 4px; line-height: 1;
      }
      .tp-close:hover { background: #f1f5f9; color: #475569; }

      .tp-body {
        flex: 1;
        overflow-y: auto;
        padding: 12px;
      }

      .tp-loading, .tp-error, .tp-empty {
        text-align: center;
        color: #94a3b8;
        padding: 24px 16px;
        font-size: 13px;
        line-height: 1.5;
      }
      .tp-error { color: #dc2626; }

      .tp-section-title {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: .06em;
        color: #94a3b8;
        padding: 12px 4px 6px;
      }

      /* Sessions */
      .tp-sessions { display: flex; flex-direction: column; gap: 6px; }

      .tp-session {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px 12px;
        cursor: pointer;
        transition: background .1s, border-color .1s;
        border-left: 3px solid #6366f1;
      }
      .tp-session:hover { background: #eef2ff; border-color: #c7d2fe; }
      .tp-session.tp-used {
        opacity: .45;
        cursor: default;
        border-left-color: #94a3b8;
        background: #f8fafc;
      }
      .tp-session-time { font-weight: 600; font-size: 13px; }
      .tp-session-dur { color: #6366f1; font-size: 11px; font-weight: 600; }
      .tp-session.tp-used .tp-session-dur { color: #94a3b8; }
      .tp-session-domains { color: #64748b; font-size: 11px; margin-top: 2px; }
      .tp-used-label { color: #22c55e; font-size: 11px; font-weight: 600; margin-top: 4px; }
      .tp-tag {
        background: #e0e7ff; color: #4338ca;
        font-size: 10px; padding: 1px 5px; border-radius: 4px;
        font-weight: 600; margin-left: 4px;
      }

      /* Interruptions */
      .tp-interruptions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
      .tp-interruption {
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 8px 10px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: background .1s;
      }
      .tp-interruption:hover { background: #fef3c7; border-color: #fcd34d; }
      .tp-intr-icon { font-size: 18px; flex-shrink: 0; }
      .tp-intr-label { font-weight: 500; font-size: 12px; line-height: 1.2; }
      .tp-intr-dur { color: #94a3b8; font-size: 11px; }

      /* Mini form */
      .tp-mini-form {
        background: #f0f4ff;
        border: 1px solid #c7d2fe;
        border-radius: 8px;
        padding: 12px;
        margin: 6px 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }
      .tp-form-row { display: flex; flex-direction: column; gap: 4px; }
      .tp-form-times { flex-direction: row; align-items: center; gap: 6px; }
      .tp-form-dur { color: #6366f1; font-size: 11px; font-weight: 700; white-space: nowrap; }

      .tp-time, .tp-mini-form select, .tp-notes {
        padding: 7px 9px;
        border: 1px solid #c7d2fe;
        border-radius: 6px;
        font-size: 13px;
        color: #1e293b;
        background: white;
        font-family: inherit;
        outline: none;
      }
      .tp-time:focus, .tp-mini-form select:focus, .tp-notes:focus {
        border-color: #6366f1;
        box-shadow: 0 0 0 2px rgba(99,102,241,.15);
      }
      .tp-mini-form select { width: 100%; cursor: pointer; }
      .tp-notes { width: 100%; resize: none; }

      .tp-form-actions { display: flex; gap: 6px; }
      .tp-btn-cancel, .tp-btn-submit {
        flex: 1; padding: 7px; border-radius: 6px; border: none;
        font-size: 12px; font-weight: 600; cursor: pointer;
        font-family: inherit;
      }
      .tp-btn-cancel { background: #f1f5f9; color: #64748b; }
      .tp-btn-cancel:hover { background: #e2e8f0; }
      .tp-btn-submit { background: #6366f1; color: white; }
      .tp-btn-submit:hover:not(:disabled) { background: #4f46e5; }
      .tp-btn-submit:disabled { background: #c7d2fe; cursor: not-allowed; }

      .tp-form-error {
        color: #dc2626; font-size: 12px; background: #fee2e2;
        border-radius: 5px; padding: 6px 8px;
      }

      /* Toast */
      .tp-toast {
        position: fixed;
        bottom: 80px;
        right: 24px;
        background: #1e293b;
        color: white;
        padding: 10px 16px;
        border-radius: 8px;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        z-index: 999999;
        opacity: 0;
        transform: translateY(8px);
        transition: opacity .2s, transform .2s;
        pointer-events: none;
      }
      .tp-toast.tp-toast-show { opacity: 1; transform: translateY(0); }
    `;
    document.head.appendChild(style);
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  function todayDate() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  }

  function formatTimeInput(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', hour12: false });
  }

  function formatDuration(minutes) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 0) return `${m}min`;
    if (m === 0) return `${h}u`;
    return `${h}u ${m}min`;
  }

  function timeInputToMs(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.getTime();
  }

  function escHtml(str) {
    return String(str || '').replace(/[&<>"']/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
    })[c]);
  }

  // ─── Boot ────────────────────────────────────────────────────────────────────

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
