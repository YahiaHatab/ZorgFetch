/**
 * ZORG-Ω Network Spy — Background Service Worker
 * Handles Chrome Debugger API attachment and network request interception.
 * Uses a Map keyed by tabId to store captured request data per session.
 */

// tabId → { requests: Map<requestId, {...}>, attached: boolean }
const tabSessions = new Map();

// ─── DEBUGGER LIFECYCLE ───────────────────────────────────────────────────────

async function attachDebugger(tabId) {
  if (tabSessions.get(tabId)?.attached) return { ok: true, alreadyAttached: true };

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
      maxResourceBufferSize: 10 * 1024 * 1024,
      maxTotalBufferSize:    50 * 1024 * 1024
    });

    tabSessions.set(tabId, { requests: new Map(), attached: true });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function detachDebugger(tabId) {
  const session = tabSessions.get(tabId);
  if (!session?.attached) return;
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) { /* tab may already be closed */ }
  tabSessions.delete(tabId);
}

// ─── NETWORK EVENT HANDLERS ───────────────────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  const { tabId } = source;
  const session = tabSessions.get(tabId);
  if (!session) return;

  if (method === 'Network.requestWillBeSent') {
    const { requestId, request } = params;
    session.requests.set(requestId, {
      requestId,
      url:            request.url,
      method:         request.method,
      requestHeaders: request.headers || {},
      postData:       request.postData || null,
      timestamp:      Date.now()
    });
  }

  if (method === 'Network.responseReceived') {
    const { requestId, response } = params;
    const entry = session.requests.get(requestId);
    if (entry) {
      entry.status          = response.status;
      entry.responseHeaders = response.headers || {};
      entry.mimeType        = response.mimeType || '';
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  tabSessions.delete(source.tabId);
});

// Clean up when a tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  tabSessions.delete(tabId);
});

// ─── PLATFORM DETECTION ───────────────────────────────────────────────────────

const PLATFORM_PATTERNS = [
  { id: 'a2zinc',      name: 'a2zinc',                  pattern: /a2zinc\.net/i },
  { id: 'eshow',       name: 'eShow',                   pattern: /eshowonline\.com|e-show\.com|eshow\.us|goeshow\.com/i },
  { id: 'algolia',     name: 'Algolia',                  pattern: /algolia\.net|algolianet\.com/i },
  { id: 'informa',     name: 'Informa Markets',          pattern: /informamarkets\.com|rxglobal\.com|informa\.com/i },
  { id: 'cadmium',     name: 'Cadmium',                  pattern: /cadmiumcd\.com|conference\.\.io|conferenceharvester\.com/i },
  { id: 'lasvegasmarket', name: 'Las Vegas Market',      pattern: /lasvegasmarket\.com/i },
  { id: 'mapdynamics', name: 'Map-Dynamics (Marketplace)', pattern: /map-dynamics\.com|a2\.advis\.com/i },
  { id: 'smartere',    name: 'Smartere',                 pattern: /intersolar\.de|smartere/i },
];

function detectPlatform(url) {
  if (!url) return null;
  for (const p of PLATFORM_PATTERNS) {
    if (p.pattern.test(url)) return p;
  }
  return null;
}

// ─── CAPTURE LOGIC — PER PLATFORM ────────────────────────────────────────────

/**
 * Build a cURL command string from a captured request entry.
 */
function buildCurl(entry) {
  const headerFlags = Object.entries(entry.requestHeaders)
    .filter(([k]) => !k.startsWith(':'))
    .map(([k, v]) => `  -H '${k}: ${v.replace(/'/g, "'\\''")}' \\`)
    .join('\n');

  const bodyFlag = entry.postData
    ? `\n  --data-raw '${entry.postData.replace(/'/g, "'\\''")}' \\`
    : '';

  return `curl '${entry.url}' \\\n${headerFlags}${bodyFlag}\n  --compressed`;
}

/**
 * Score a request entry for relevance to a given platform.
 * Returns 0 if not relevant, higher = more relevant.
 */
function scoreRequest(entry, platformId) {
  const url = entry.url.toLowerCase();
  let score = 0;

  switch (platformId) {
    case 'eshow':
      if (url.includes('floor_space.cfc?method=getshowsetup')) score += 40;
      if (url.includes('floor_space') || url.includes('exhibitor')) score += 10;
      // Case-insensitive check for authorization headers
      if (Object.keys(entry.requestHeaders).some(k => k.toLowerCase() === 'authorization' || k.toLowerCase() === 'token')) score += 20;
      break;
    case 'a2zinc':
      if (url.includes('/api/exhibitor') || url.includes('strboothclickurl') || url.includes('a2zinc')) score += 20;
      if (url.includes('eventmap.aspx')) score += 30; 
      if (url.includes('callback=')) score += 5; // JSONP
      break;
    case 'algolia':
      if (url.includes('.algolia.net/1/indexes/')) score += 30;
      if (url.includes('/query') || url.includes('/search')) score += 10;
      break;
    case 'informa':
      if (url.includes('/api/') || url.includes('/exhibitor')) score += 10;
      if (entry.requestHeaders['authorization']) score += 15;
      break;
    case 'cadmium':
      if (url.includes('createrentedboothlist.asp')) score += 40;
      if (url.includes('createrentedboothlist') || url.includes('cadmiumcd')) score += 20;
      break;
    case 'lasvegasmarket':
      if (url.includes('/imc-api/') || url.includes('/exhibitors/')) score += 20;
      break;
    case 'mapdynamics':
      if (url.includes('profile.marketplace.php')) score += 40; 
      if (url.includes('map-dynamics') || url.includes('phpsessid') || url.includes('showid')) score += 20;
      break;
    case 'smartere':
      if (url.includes('/search/execute')) score += 40;
      if (Object.keys(entry.requestHeaders).some(k => k.toLowerCase() === 'x-csrf-token')) score += 20;
      break;
  }

  // Penalize non-API requests
  if (/\.(css|js|png|jpg|gif|woff|svg|ico)($|\?)/.test(url)) score = 0;

  return score;
}

/**
 * Main extraction function — dispatches per platform.
 */
async function captureForPlatform(tabId, platformId, pageUrl) {
  const session = tabSessions.get(tabId);
  if (!session) return { ok: false, error: 'Debugger not attached. Enable Spy first.' };

  const allRequests = Array.from(session.requests.values());

  switch (platformId) {
    case 'eshow': return captureEshow(allRequests);
    case 'a2zinc': return await captureA2zinc(allRequests, tabId, pageUrl);
    case 'algolia': return captureAlgolia(allRequests);
    case 'informa': return captureInforma(allRequests);
    case 'cadmium': return captureCadmium(allRequests, pageUrl);
    case 'lasvegasmarket': return captureLasVegasMarket(allRequests, pageUrl);
    case 'mapdynamics': return await captureMapDynamics(allRequests, pageUrl, tabId);
    case 'smartere': return captureSmartere(allRequests);
    default: return { ok: false, error: 'Unknown platform.' };
  }
}

// ─── PLATFORM-SPECIFIC EXTRACTORS ────────────────────────────────────────────

function captureEshow(requests) {
  // Broaden search: Look for the specific endpoint or ANY auth/token header
  const candidates = requests
    .filter(r => {
       const url = r.url.toLowerCase();
       const hasAuth = Object.keys(r.requestHeaders).some(k => 
         k.toLowerCase() === 'authorization' || 
         k.toLowerCase() === 'x-token' || 
         k.toLowerCase() === 'token'
       );
       return hasAuth || url.includes('floor_space.cfc');
    })
    .sort((a, b) => scoreRequest(b, 'eshow') - scoreRequest(a, 'eshow'));

  if (!candidates.length) {
    return { ok: false, error: 'No eShow setup request found. Load the floor plan/exhibitor list first.' };
  }

  const best = candidates[0];
  
  // Extract token using case-insensitive header lookup
  let token = null;
  const authKey = Object.keys(best.requestHeaders).find(k => 
    k.toLowerCase() === 'authorization' || 
    k.toLowerCase() === 'x-token' || 
    k.toLowerCase() === 'token'
  );
  
  if (authKey) {
    // Strip "Bearer " (case-insensitive)
    token = best.requestHeaders[authKey].replace(/Bearer /i, '').trim();
  }

  return {
    ok: true,
    platform: 'eshow',
    fields: { 
      'Token': token || '(no auth header found)',
      'cURL Command': buildCurl(best) 
    },
    curl: buildCurl(best),
    summary: `eShow API request captured from: ${new URL(best.url).hostname}`
  };
}

async function captureA2zinc(requests, tabId, pageUrl) {
  // Look for the exhibitor API (JSONP) request
  const candidates = requests
    .filter(r => r.url.includes('/api/exhibitor') || (r.url.includes('a2zinc') && r.url.includes('callback=')))
    .sort((a, b) => scoreRequest(b, 'a2zinc') - scoreRequest(a, 'a2zinc'));

  let strBoothClickURL = null;

  // Search for the Eventmap.aspx request to fetch its response body for the redirect URL
  const eventMapReq = requests.find(r => r.url.toLowerCase().includes('eventmap.aspx'));
  if (eventMapReq) {
    try {
      const response = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId: eventMapReq.requestId }
      );
      if (response && response.body) {
        // Find strBoothClickURL = "..." using regex
        const match = response.body.match(/strBoothClickURL\s*=\s*"([^"]+)"/i);
        if (match) {
          strBoothClickURL = decodeURIComponent(match[1]);
        }
      }
    } catch (e) {
      console.error("Failed to fetch response body for a2zinc:", e);
    }
  }

  // Fallback to legacy SmallWorld pattern matching in URL params/referrers
  if (!strBoothClickURL) {
    for (const req of requests) {
      const swMatch = req.url.match(/(https?:\/\/[^&"'\s]*smallworld[^&"'\s]*(?:\?[^&"'\s]*boothId=[^&"'\s]*)?)/i);
      if (swMatch) {
        let swUrl = swMatch[1];
        swUrl = swUrl.replace(/(boothId=)[^&"'\s]*/i, '$1'); 
        strBoothClickURL = swUrl;
        break;
      }
    }
  }

  if (!candidates.length) {
    if (strBoothClickURL) {
      return {
        ok: true,
        partial: true,
        platform: 'a2zinc',
        fields: { 'strBoothClickURL': strBoothClickURL },
        curl: '',
        summary: 'Found strBoothClickURL but no exhibitor API request yet. Try clicking a booth on the floor plan.'
      };
    }
    return { ok: false, error: 'No a2zinc exhibitor API request found. Load the floor plan/exhibitor list then try again.' };
  }

  const best = candidates[0];

  return {
    ok: true,
    platform: 'a2zinc',
    fields: {
      'cURL Command': buildCurl(best),
      'strBoothClickURL': strBoothClickURL || '(Not found — check response bodies manually)'
    },
    curl: buildCurl(best),
    strBoothClickURL: strBoothClickURL || null,
    summary: `Exhibitor API captured. ${strBoothClickURL ? 'Booth click URL also extracted.' : 'No redirect URL found.'}`
  };
}

function captureAlgolia(requests) {
  // Target requests matching the Algolia API index query pattern
  const candidates = requests
    .filter(r => r.url.includes('.algolia.net/1/indexes/'))
    .sort((a, b) => scoreRequest(b, 'algolia') - scoreRequest(a, 'algolia'));

  if (!candidates.length) {
    return { ok: false, error: 'No Algolia search request found. Trigger a search or load the exhibitor list first.' };
  }

  const best = candidates[0];
  let appId = null;
  let apiKey = null;

  try {
    const url = new URL(best.url);
    appId = url.searchParams.get('x-algolia-application-id');
    apiKey = url.searchParams.get('x-algolia-api-key');
  } catch (_) {}

  return {
    ok: true,
    platform: 'algolia',
    fields: { 
      'App ID': appId || '(not found)',
      'API Key': apiKey || '(not found)',
      'cURL Command': buildCurl(best) 
    },
    curl: buildCurl(best),
    summary: `Algolia App ID and Key extracted.`
  };
}

function captureInforma(requests) {
  const candidates = requests
    .filter(r => r.requestHeaders['authorization'] || r.url.includes('/api/'))
    .filter(r => !/(\.css|\.js|\.png|\.jpg|\.ico)/.test(r.url))
    .sort((a, b) => scoreRequest(b, 'informa') - scoreRequest(a, 'informa'));

  if (!candidates.length) {
    return { ok: false, error: 'No Informa API request found. Load the exhibitor list then try again.' };
  }

  const best = candidates[0];
  const curl = buildCurl(best);

  return {
    ok: true,
    platform: 'informa',
    fields: { 'cURL Command': curl },
    curl,
    summary: `Informa API captured from: ${new URL(best.url).pathname}`
  };
}

function captureCadmium(requests, pageUrl) {
  // Prioritize the POST request to CreateRentedBoothList.asp
  const candidates = requests.filter(r => r.url.includes('CreateRentedBoothList.asp') && r.method === 'POST');

  let eventId = null, clientId = null, eventKey = null;

  if (candidates.length && candidates[0].postData) {
    // Parse form-urlencoded payload from the POST request
    const params = new URLSearchParams(candidates[0].postData);
    eventId = params.get('EventID') || params.get('EventId');
    clientId = params.get('EventClientID') || params.get('ClientID');
    eventKey = params.get('EventKey');
  }

  // Fallback: try GET requests or the page URL itself
  if (!eventId) {
    const getCandidates = requests.filter(r => r.url.includes('CreateRentedBoothList'));
    if (getCandidates.length) {
      try {
        const url = new URL(getCandidates[0].url);
        eventId  = url.searchParams.get('EventID')  || url.searchParams.get('EventId')  || null;
        clientId = url.searchParams.get('ClientID') || url.searchParams.get('ClientId') || null;
        eventKey = url.searchParams.get('EventKey') || null;
      } catch (_) {}
    } else if (pageUrl) {
      try {
        const url = new URL(pageUrl);
        eventId  = url.searchParams.get('EventID')  || null;
        clientId = url.searchParams.get('ClientID') || null;
        eventKey = url.searchParams.get('EventKey') || null;
      } catch (_) {}
    }
  }

  if (!eventId && !clientId && !eventKey) {
    return { ok: false, error: 'No Cadmium parameters found in payload. Load the booth list page then try again.' };
  }

  return {
    ok: true,
    platform: 'cadmium',
    fields: {
      'Event ID':   eventId  || '(not found)',
      'Client ID':  clientId || '(not found)',
      'Event Key':  eventKey || '(not found)'
    },
    curl: candidates.length ? buildCurl(candidates[0]) : null,
    summary: `Cadmium params captured: EventID=${eventId}, Key=${eventKey}`
  };
}

function captureLasVegasMarket(requests, pageUrl) {
  const candidates = requests.filter(r => r.url.includes('/imc-api/') || r.url.includes('/exhibitors/'));

  let apiKey = null;
  if (candidates.length) {
    const headers = candidates[0].requestHeaders;
    apiKey = headers['x-api-key'] || headers['authorization'] || headers['apikey'] || null;
  }

  const knownKey = '391D75C6-01EE-463C-8B51-47B2748F8ACD';

  return {
    ok: true,
    platform: 'lasvegasmarket',
    fields: {
      'API Key': apiKey || knownKey,
      'Base URL': 'https://www.lasvegasmarket.com/imc-api/v2/exhibitors/az'
    },
    curl: candidates.length ? buildCurl(candidates[0]) : null,
    summary: apiKey ? 'API key captured from network.' : 'Using known static API key.'
  };
}

async function captureMapDynamics(requests, pageUrl, tabId) {
  let showId = null;
  let phpsessid = null;

  // 1. Try to get PHPSESSID from cookies
  try {
    const cookies = await chrome.cookies.getAll({ url: pageUrl });
    const sessionCookie = cookies.find(c => c.name.toUpperCase() === 'PHPSESSID');
    phpsessid = sessionCookie?.value || null;
  } catch (_) {}

  if (!phpsessid) {
    for (const req of requests) {
      const cookieHeader = req.requestHeaders['cookie'] || '';
      const match = cookieHeader.match(/PHPSESSID=([^;]+)/i);
      if (match) { phpsessid = match[1]; break; }
    }
  }

  // 2. Try to get Show_ID from the profile.marketplace.php POST payload
  const profileReqs = requests.filter(r => r.url.includes('profile.marketplace.php') && r.postData);
  if (profileReqs.length > 0) {
    const params = new URLSearchParams(profileReqs[0].postData);
    showId = params.get('Show_ID') || params.get('show_id');
  }

  // 3. Fallback: Check URL params and other requests
  if (!showId) {
    try {
      const url = new URL(pageUrl);
      showId = url.searchParams.get('showId') || url.searchParams.get('show_id') || url.searchParams.get('Show_ID') || null;
    } catch (_) {}
  }

  if (!showId) {
    for (const req of requests) {
      try {
        const url = new URL(req.url);
        showId = url.searchParams.get('showId') || url.searchParams.get('show_id') || url.searchParams.get('Show_ID') || null;
        if (showId) break;
      } catch (_) {}
    }
  }

  return {
    ok: true,
    platform: 'mapdynamics',
    fields: {
      'Show ID':    showId    || '(not found — click an exhibitor to trigger the request)',
      'PHPSESSID':  phpsessid || '(not found — ensure you are logged in)'
    },
    curl: profileReqs.length ? buildCurl(profileReqs[0]) : null,
    summary: `Show ID: ${showId || 'unknown'} | Session: ${phpsessid ? 'found' : 'not found'}`
  };
}

function captureSmartere(requests) {
  const candidates = requests
    .filter(r => r.url.includes('/search/execute') && r.postData)
    .sort((a, b) => scoreRequest(b, 'smartere') - scoreRequest(a, 'smartere'));

  if (!candidates.length) {
    return { ok: false, error: 'No Smartere search request found. Trigger a search or load the list first.' };
  }

  const best = candidates[0];
  let menuPageId = null;
  let csrfToken = null;
  let cookie = null;

  // 1. Extract X-CSRF-TOKEN (case-insensitive)
  const csrfKey = Object.keys(best.requestHeaders).find(k => k.toLowerCase() === 'x-csrf-token');
  if (csrfKey) csrfToken = best.requestHeaders[csrfKey];

  // 2. Extract Cookie (case-insensitive)
  const cookieKey = Object.keys(best.requestHeaders).find(k => k.toLowerCase() === 'cookie');
  if (cookieKey) cookie = best.requestHeaders[cookieKey];

  // 3. Extract menuPageId from the JSON payload
  try {
    const payload = JSON.parse(best.postData);
    if (payload.menuPageId) menuPageId = payload.menuPageId;
  } catch (e) {
    console.error("Could not parse Smartere payload", e);
  }

  return {
    ok: true,
    platform: 'smartere',
    fields: {
      'Menu Page ID': menuPageId || '(not found in payload)',
      'X-CSRF-Token': csrfToken || '(not found)',
      'Cookie': cookie || '(not found)',
      'cURL Command': buildCurl(best)
    },
    curl: buildCurl(best),
    summary: `Smartere data captured.`
  };
}

// ─── MESSAGE HANDLER ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const { action, tabId, platformId, pageUrl } = msg;

    if (action === 'attach') {
      const result = await attachDebugger(tabId);
      sendResponse(result);
      return;
    }

    if (action === 'detach') {
      await detachDebugger(tabId);
      sendResponse({ ok: true });
      return;
    }

    if (action === 'isAttached') {
      sendResponse({ attached: !!tabSessions.get(tabId)?.attached });
      return;
    }

    if (action === 'getRequestCount') {
      const count = tabSessions.get(tabId)?.requests.size ?? 0;
      sendResponse({ count });
      return;
    }

    if (action === 'clearRequests') {
      const session = tabSessions.get(tabId);
      if (session) session.requests.clear();
      sendResponse({ ok: true });
      return;
    }

    if (action === 'capture') {
      const result = await captureForPlatform(tabId, platformId, pageUrl);
      sendResponse(result);
      return;
    }

    if (action === 'detectPlatform') {
      sendResponse(detectPlatform(pageUrl));
      return;
    }

    sendResponse({ ok: false, error: 'Unknown action.' });
  })();
  return true; // keep message channel open for async
});