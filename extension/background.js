chrome.action.onClicked.addListener(() => {
  (async () => {
    try {
      await chrome.storage.local.set({ hc_show_banner: true });
    } catch {
      /* ignore */
    }
    chrome.tabs.create({ url: "http://historycourt.lol" });
  })();
});

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown
const UPLOAD_LOCK_KEY = "hc_upload_in_progress";
const NEXT_PROMPT_AT_KEY = "hc_next_prompt_at";
const SESSION_KEY = "hc_session_id";

function sanitizeHistoryItems(items) {
  const out = [];
  for (const it of items || []) {
    if (!it?.url) continue;
    if (
      it.url.startsWith("chrome://") ||
      it.url.startsWith("chrome-extension://") ||
      it.url.startsWith("file://")
    ) continue;

    let host;
    try { host = new URL(it.url).host; } catch { continue; }

    out.push({
      host,
      title: it.title || "",
      // lastVisitTime: it.lastVisitTime || null,
      visitCount: it.visitCount ?? null,
    });
  }
  return out;
}

async function fetchAllHistory({ startTime = 0, batchSize = 5000 } = {}) {
  let endTime = Date.now();
  const results = [];
  const seenUrls = new Set();
  const size = Math.max(100, Math.min(Number(batchSize) || 5000, 20000));

  // Pull history in batches to avoid implicit API result caps.
  while (true) {
    const batch = await chrome.history.search({
      text: "",
      startTime,
      endTime,
      maxResults: size,
    });

    if (!Array.isArray(batch) || batch.length === 0) break;

    for (const item of batch) {
      if (!item?.url || seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      results.push(item);
    }

    if (batch.length < size) break;

    const oldest = batch.reduce((min, item) => {
      const ts = Number(item?.lastVisitTime);
      return Number.isFinite(ts) && ts < min ? ts : min;
    }, Number.POSITIVE_INFINITY);

    if (!Number.isFinite(oldest) || oldest <= startTime) break;
    endTime = oldest - 1;
  }

  return results;
}

function dedupeSanitizedItems(items) {
  const seen = new Set();
  const unique = [];
  for (const it of items || []) {
    const key = `${it.host}||${it.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(it);
  }
  return unique;
}

function shuffleInPlace(items) {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

async function shouldPromptNow() {
  const now = Date.now();
  const st = await chrome.storage.local.get([NEXT_PROMPT_AT_KEY, UPLOAD_LOCK_KEY]);
  const nextAt = Number(st[NEXT_PROMPT_AT_KEY] || 0);
  const inProgress = Boolean(st[UPLOAD_LOCK_KEY]);
  if (inProgress) return false;
  return now >= nextAt;
}

async function setCooldown(ms = COOLDOWN_MS) {
  await chrome.storage.local.set({ [NEXT_PROMPT_AT_KEY]: Date.now() + ms });
}

async function getSessionId() {
  const st = await chrome.storage.local.get([SESSION_KEY]);
  return st[SESSION_KEY] || "";
}

async function setSessionId(id) {
  if (!id) return;
  await chrome.storage.local.set({ [SESSION_KEY]: id });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "hc-session-state") {
      const st = await chrome.storage.local.get([SESSION_KEY, NEXT_PROMPT_AT_KEY, UPLOAD_LOCK_KEY]);
      const nextAt = Number(st[NEXT_PROMPT_AT_KEY] || 0);
      const inProgress = Boolean(st[UPLOAD_LOCK_KEY]);
      const canPrompt = await shouldPromptNow();
      sendResponse({
        ok: true,
        sessionId: st[SESSION_KEY] || "",
        nextPromptAt: nextAt,
        inProgress,
        canPrompt,
      });
      return;
    }

    if (message?.type === "hc-set-session") {
      const sess = (message.sessionId || "").trim();
      if (!sess) {
        sendResponse({ ok: false, error: "session_id_missing" });
        return;
      }
      await setSessionId(sess);
      await setCooldown(COOLDOWN_MS);
      sendResponse({ ok: true, sessionId: sess });
      return;
    }

    if (message?.type === "hc-should-prompt") {
      sendResponse({ ok: true, shouldPrompt: await shouldPromptNow() });
      return;
    }

    if (message?.type === "join-room" || message?.type === "join-room-with-history") {
      const roomId = (message.roomId || "").trim();
      const name = (message.name || "Player").trim() || "Player";
      if (!roomId) {
        sendResponse({ ok: false, error: "room_id_missing" });
        return;
      }
      // Skip cooldown for room joins to avoid blocking on previous uploads
      await chrome.storage.local.set({ [UPLOAD_LOCK_KEY]: true });

      let url = null;
      try {
        let shuffled = [];
        if (message?.type === "join-room-with-history" && Array.isArray(message.history) && message.history.length) {
          shuffled = dedupeSanitizedItems(message.history);
        } else {
          const startTime = 0;
          const batchSize = Math.max(200, Math.min(Number(message.maxResults) || 5000, 20000));

          const items = await fetchAllHistory({ startTime, batchSize });
          const sanitized = sanitizeHistoryItems(items);
          const deduped = dedupeSanitizedItems(sanitized);
          shuffled = shuffleInPlace(deduped);
        }

        const apiBase = message.apiBase || "http://historycourt.lol";
        url = `${apiBase.replace(/\/$/, "")}/api/roulette/room/${encodeURIComponent(roomId)}/join`;

        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            history: shuffled,
            session_id: (message.sessionId || "").trim(),
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          sendResponse({ ok: false, error: json.error || `HTTP ${res.status}`, url });
          return;
        }
        sendResponse({ ok: true, ...json, url, history: shuffled });
      } catch (e) {
        sendResponse({ ok: false, error: String(e), url });
      } finally {
        await chrome.storage.local.set({ [UPLOAD_LOCK_KEY]: false });
      }
      return;
    }

    if (message?.type === "delete-user") {
      const sessionId = (message.sessionId || "").trim();
      if (!sessionId) {
        sendResponse({ ok: false, error: "session_id_missing" });
        return;
      }
      try {
        const apiBase = message.apiBase || "http://historycourt.lol";
        const res = await fetch(`${apiBase.replace(/\/$/, "")}/api/delete-user`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const json = await res.json().catch(() => ({}));
        await chrome.storage.local.remove([SESSION_KEY, NEXT_PROMPT_AT_KEY, UPLOAD_LOCK_KEY, "hc_review_payload"]);
        if (!res.ok) {
          sendResponse({ ok: false, error: json.error || `HTTP ${res.status}` });
          return;
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
      return;
    }

    if (message?.type !== "upload-history") return;

    const reviewOnly = Boolean(message.reviewOnly);
    // review-only fetch should NOT be blocked by cooldown
    if (!reviewOnly) {
      const can = await shouldPromptNow();
      if (!can) {
        sendResponse({ ok: false, error: "cooldown_or_in_progress" });
        return;
      }
    }

    // For review-only we still mark lock to avoid parallel spam, but we clear immediately after.
    await chrome.storage.local.set({ [UPLOAD_LOCK_KEY]: true });

    let url = null;
    try {
      const startTime = 0; // fetch everything
      const batchSize = Math.max(200, Math.min(Number(message.maxResults) || 5000, 20000));

      const items = await fetchAllHistory({ startTime, batchSize });
      const sanitized = sanitizeHistoryItems(items);
      const deduped = dedupeSanitizedItems(sanitized);
      const shuffled = shuffleInPlace(deduped);

      if (reviewOnly) {
        // Skip cooldown so the banner can re-open quickly after delete; just clear lock below.
        sendResponse({ ok: true, history: shuffled });
        return;
      }

      const apiBase = message.apiBase || "http://historycourt.lol";
      url = `${apiBase.replace(/\/$/, "")}/api/upload-history`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          history: shuffled,
          session_id: (message.sessionId || "").trim(),
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok || !json.session_id) {
        // on failure, back off a bit so it won’t keep prompting
        await setCooldown(10 * 60 * 1000); // 10 min cooldown on failure
        sendResponse({ ok: false, error: json.error || `HTTP ${res.status}`, url });
        return;
      }

      // success: long cooldown so it doesn't reprompt
      await setCooldown(COOLDOWN_MS);
      if (json.session_id) await setSessionId(json.session_id);
      sendResponse({ ok: true, ...json, url, history: shuffled, session_id: json.session_id });
    } catch (e) {
      await setCooldown(10 * 60 * 1000);
      sendResponse({ ok: false, error: String(e), url });
    } finally {
      await chrome.storage.local.set({ [UPLOAD_LOCK_KEY]: false });
    }
  })();

  return true; // keep channel open
});
