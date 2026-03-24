/**
 * ZORG-Ω Network Spy — Popup Controller
 * Manages UI state, communicates with the background service worker,
 * and handles per-platform credential capture + clipboard copy.
 */

// ─── PLATFORM CONFIG ───────────────────────────────────────────────────────────
const PLATFORMS = {
  eshow: {
    name:    'eShow',
    icon:    '🎪',
    color:   '#f5a623',
    hint:    'eshow / exhibitor portal',
    instruction: 'Navigate to the exhibitor list page and load it completely. The extension will extract the Bearer token from network requests.',
    captureLabel: 'Fetch Bearer Token',
  },
  a2zinc: {
    name:    'a2zinc',
    icon:    '🗺️',
    color:   '#6382ff',
    hint:    'a2zinc.net floor plan',
    instruction: 'Load the floor plan / exhibitor list on the a2zinc event page. For the SmallWorld URL, click any booth entry after loading.',
    captureLabel: 'Fetch cURL + SmallWorld URL',
  },
  algolia: {
    name:    'Algolia',
    icon:    '🔍',
    color:   '#b97cf3',
    hint:    'algolia-powered directory',
    instruction: 'Load the exhibitor search/list page. The extension will capture the Algolia API credentials from network traffic.',
    captureLabel: 'Fetch Algolia cURL',
  },
  informa: {
    name:    'Informa Markets',
    icon:    '📋',
    color:   '#3ecf8e',
    hint:    'informamarkets.com portal',
    instruction: 'Navigate to the exhibitor directory and let it load. The extension will extract the API request and auth token.',
    captureLabel: 'Fetch Informa cURL',
  },
  cadmium: {
    name:    'Cadmium',
    icon:    '⚗️',
    color:   '#f97316',
    hint:    'cadmiumcd.com booth list',
    instruction: 'Load the booth/exhibitor list page. The extension will extract the Event ID, Client ID, and Event Key.',
    captureLabel: 'Fetch Cadmium Params',
  },
  lasvegasmarket: {
    name:    'Las Vegas Market',
    icon:    '🎰',
    color:   '#f87171',
    hint:    'lasvegasmarket.com',
    instruction: 'Navigate to the Las Vegas Market exhibitor directory. The API key will be captured automatically.',
    captureLabel: 'Fetch API Key',
  },
  mapdynamics: {
    name:    'Map-Dynamics',
    icon:    '🏛️',
    color:   '#6382ff',
    hint:    'map-dynamics / marketplace',
    instruction: 'Navigate to the show page while logged in. The extension will extract the Show ID and your PHPSESSID session cookie.',
    captureLabel: 'Fetch Show ID + Session',
  },
};

// ─── STATE ────────────────────────────────────────────────────────────────────
let currentTabId  = null;
let currentTabUrl = null;
let spyActive     = false;
let detectedPlatform = null; // { id, name, pattern }
let selectedPlatform = null; // manually selected id string
let reqCountInterval = null;

// ─── INIT ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;

  currentTabId  = tab.id;
  currentTabUrl = tab.url;

  // Check if spy is already attached (popup was closed and reopened)
  const { attached } = await sendMsg({ action: 'isAttached', tabId: currentTabId });
  spyActive = attached;

  // Detect platform
  const platform = await sendMsg({ action: 'detectPlatform', pageUrl: currentTabUrl });
  detectedPlatform = platform;

  renderPlatformBadge(platform);
  renderSpyBar();
  renderPanel();
  startReqCountPoll();

  // Bind events
  document.getElementById('btnStart').addEventListener('click', onSpyStart);
  document.getElementById('btnStop').addEventListener('click', onSpyStop);
  document.getElementById('btnClear').addEventListener('click', onClear);
  document.getElementById('btnCapture').addEventListener('click', onCapture);

  // Platform tabs
  document.querySelectorAll('.platform-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      selectedPlatform = tab.dataset.platform;
      document.querySelectorAll('.platform-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      renderPlatformCard(selectedPlatform);
      clearResults();
    });
  });
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function sendMsg(msg) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage(msg, response => {
      resolve(response || {});
    });
  });
}

function activePlatformId() {
  // Auto-detected takes priority; manual override if auto failed
  if (detectedPlatform?.id) return detectedPlatform.id;
  return selectedPlatform;
}

function setFooter(text) {
  document.getElementById('footerStatus').textContent = text.toUpperCase();
}

// ─── SPY BAR ─────────────────────────────────────────────────────────────────

function renderSpyBar() {
  const dot   = document.getElementById('spyDot');
  const label = document.getElementById('spyLabel');
  const start = document.getElementById('btnStart');
  const stop  = document.getElementById('btnStop');
  const bar   = document.getElementById('spyBar');

  if (spyActive) {
    dot.classList.add('live');
    label.classList.add('live');
    label.textContent = 'Spy Active';
    start.style.display = 'none';
    stop.style.display  = 'inline-flex';
    bar.classList.add('active');
    setFooter('INTERCEPTING');
  } else {
    dot.classList.remove('live');
    label.classList.remove('live');
    label.textContent = 'Spy Inactive';
    start.style.display = 'inline-flex';
    stop.style.display  = 'none';
    bar.classList.remove('active');
    setFooter('IDLE');
  }
}

function renderPanel() {
  const mainPanel  = document.getElementById('mainPanel');
  const noSpyWall  = document.getElementById('noSpyWall');

  if (spyActive) {
    mainPanel.style.display = 'block';
    noSpyWall.style.display = 'none';

    // Show manual selector if platform not auto-detected
    document.getElementById('manualSelector').style.display =
      detectedPlatform?.id ? 'none' : 'block';

    const pid = activePlatformId();
    if (pid) renderPlatformCard(pid);
  } else {
    mainPanel.style.display = 'none';
    noSpyWall.style.display = 'flex';
  }
}

function renderPlatformBadge(platform) {
  const badge     = document.getElementById('platformBadge');
  const badgeIcon = document.getElementById('platformBadgeIcon');
  const badgeName = document.getElementById('platformBadgeName');
  const badgeHint = document.getElementById('platformBadgeHint');
  const pill      = document.getElementById('platformPill');

  if (platform?.id) {
    const cfg = PLATFORMS[platform.id];
    badge.className = 'platform-detected found z fade-up';
    badgeIcon.textContent = cfg?.icon ?? '🔗';
    badgeIcon.style.background = (cfg?.color ?? '#6382ff') + '20';
    badgeName.textContent = cfg?.name ?? platform.name;
    badgeHint.textContent = 'Platform auto-detected';
    pill.textContent = (cfg?.name ?? platform.name).toUpperCase();
    pill.style.color = cfg?.color ?? 'var(--accent)';
    pill.style.borderColor = (cfg?.color ?? '#6382ff') + '50';
  } else {
    badge.className = 'platform-detected unknown z';
    badgeIcon.textContent = '❓';
    badgeIcon.style.background = 'var(--raised)';
    badgeName.textContent = 'Unknown platform';
    badgeHint.textContent = 'Select manually below';
    pill.textContent = 'UNKNOWN';
    pill.style.color = 'var(--faint)';
    pill.style.borderColor = 'var(--border)';
  }
}

function renderPlatformCard(platformId) {
  const cfg = PLATFORMS[platformId];
  if (!cfg) return;

  document.getElementById('cardTitle').textContent = cfg.name.toUpperCase();
  document.getElementById('instRow').textContent   = cfg.instruction;

  const btn = document.getElementById('btnCapture');
  btn.disabled = false;
  btn.textContent = '';

  // Rebuild button with icon
  btn.innerHTML = `
    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
      <path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>
    </svg>
    ${cfg.captureLabel}
  `;
}

// ─── SPY LIFECYCLE ────────────────────────────────────────────────────────────

async function onSpyStart() {
  const result = await sendMsg({ action: 'attach', tabId: currentTabId });

  if (!result.ok) {
    showBanner('error', `Failed to start spy: ${result.error}`);
    return;
  }

  spyActive = true;
  renderSpyBar();
  renderPanel();

  if (activePlatformId()) renderPlatformCard(activePlatformId());
}

async function onSpyStop() {
  await sendMsg({ action: 'detach', tabId: currentTabId });
  spyActive = false;
  clearResults();
  renderSpyBar();
  renderPanel();
  document.getElementById('reqCount').textContent = '';
}

async function onClear() {
  await sendMsg({ action: 'clearRequests', tabId: currentTabId });
  clearResults();
  document.getElementById('reqCount').textContent = '';
  showBanner('warning', 'Captured requests cleared. Reload the target page and try again.');
}

// ─── REQUEST COUNT POLL ───────────────────────────────────────────────────────

function startReqCountPoll() {
  if (reqCountInterval) clearInterval(reqCountInterval);
  reqCountInterval = setInterval(async () => {
    if (!spyActive) return;
    const { count } = await sendMsg({ action: 'getRequestCount', tabId: currentTabId });
    const el = document.getElementById('reqCount');
    el.textContent = count ? `· ${count} req` : '';
  }, 1200);
}

// ─── CAPTURE ─────────────────────────────────────────────────────────────────

async function onCapture() {
  const platformId = activePlatformId();
  if (!platformId) {
    showBanner('error', 'No platform selected. Use the manual selector below.');
    return;
  }

  const btn = document.getElementById('btnCapture');
  btn.disabled = true;
  btn.classList.add('loading');
  btn.innerHTML = `
    <svg style="animation:spin 1s linear infinite;" xmlns="http://www.w3.org/2000/svg" width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
      <path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
    </svg>
    Scanning requests...
  `;

  // Add spin keyframes if not already present
  if (!document.getElementById('spinStyle')) {
    const style = document.createElement('style');
    style.id = 'spinStyle';
    style.textContent = '@keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }';
    document.head.appendChild(style);
  }

  const result = await sendMsg({
    action: 'capture',
    tabId: currentTabId,
    platformId,
    pageUrl: currentTabUrl
  });

  btn.disabled = false;
  btn.classList.remove('loading');
  renderPlatformCard(platformId); // restore button

  if (!result.ok) {
    showBanner('error', result.error);
    return;
  }

  if (result.partial) {
    showBanner('warning', result.summary);
  } else {
    showBanner('success', result.summary || 'Credentials captured successfully.');
  }

  renderResults(result);
  setFooter('CAPTURED');
}

// ─── RESULTS RENDERING ────────────────────────────────────────────────────────

function clearResults() {
  const area = document.getElementById('resultArea');
  area.innerHTML = '';
  area.classList.remove('visible');
}

function renderResults(result) {
  const area = document.getElementById('resultArea');
  area.innerHTML = '';
  area.classList.add('visible');

  const { fields } = result;
  if (!fields || !Object.keys(fields).length) return;

  for (const [label, value] of Object.entries(fields)) {
    if (!value) continue;
    const isCurl = label.toLowerCase().includes('curl');
    const fieldEl = createResultField(label, value, isCurl);
    area.appendChild(fieldEl);
  }
}

function createResultField(label, value, isCurl = false) {
  const div = document.createElement('div');
  div.className = 'result-field fade-up';

  const copyId = `copy-${label.replace(/\s+/g, '-').toLowerCase()}`;

  div.innerHTML = `
    <div class="result-field-header">
      <span class="result-field-label">${label}</span>
      <button class="btn-copy" id="${copyId}">
        <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
        </svg>
        Copy
      </button>
    </div>
    <div class="result-field-value ${isCurl ? 'curl-val' : ''}">${escapeHtml(value)}</div>
  `;

  div.querySelector(`#${copyId}`).addEventListener('click', () => {
    copyToClipboard(value, `#${copyId}`, div.querySelector(`#${copyId}`));
  });

  return div;
}

async function copyToClipboard(text, btnSelector, btnEl) {
  try {
    await navigator.clipboard.writeText(text);
    const orig = btnEl.innerHTML;
    btnEl.classList.add('copied');
    btnEl.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
        <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/>
      </svg>
      Copied!
    `;
    setTimeout(() => {
      btnEl.classList.remove('copied');
      btnEl.innerHTML = orig;
    }, 2000);
  } catch (_) {
    // Fallback for clipboard issues in some extension contexts
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
    btnEl.textContent = '✓';
    setTimeout(() => { btnEl.textContent = 'Copy'; }, 1500);
  }
}

// ─── BANNERS ──────────────────────────────────────────────────────────────────

function showBanner(type, message) {
  const area = document.getElementById('resultArea');

  // Remove existing banners
  area.querySelectorAll('.banner').forEach(b => b.remove());
  area.classList.add('visible');

  const icons = { success: '✓', error: '✗', warning: '⚠' };

  const banner = document.createElement('div');
  banner.className = `banner ${type} fade-up`;
  banner.innerHTML = `
    <span class="banner-icon">${icons[type] ?? '·'}</span>
    <span>${escapeHtml(message)}</span>
  `;

  area.insertBefore(banner, area.firstChild);

  if (type !== 'error') {
    setTimeout(() => {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => banner.remove(), 400);
    }, 4000);
  }
}

function escapeHtml(str) {
  if (typeof str !== 'string') return String(str ?? '');
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
