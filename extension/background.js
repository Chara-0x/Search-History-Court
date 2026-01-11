chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: "https://historycourt.lol/review" });
});

const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour cooldown
const UPLOAD_LOCK_KEY = "hc_upload_in_progress";
const NEXT_PROMPT_AT_KEY = "hc_next_prompt_at";

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
  return !inProgress && now >= nextAt;
}

async function setCooldown(ms = COOLDOWN_MS) {
  await chrome.storage.local.set({ [NEXT_PROMPT_AT_KEY]: Date.now() + ms });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "hc-should-prompt") {
      sendResponse({ ok: true, shouldPrompt: await shouldPromptNow() });
      return;
    }

    if (message?.type !== "upload-history") return;

    const reviewOnly = Boolean(message.reviewOnly);
    // prevent spam if already uploading
    const can = await shouldPromptNow();
    if (!can) {
      sendResponse({ ok: false, error: "cooldown_or_in_progress" });
      return;
    }

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
        await setCooldown(COOLDOWN_MS);
        sendResponse({ ok: true, history: shuffled });
        return;
      }

      const apiBase = message.apiBase || "https://historycourt.lol";
      url = `${apiBase.replace(/\/$/, "")}/api/upload-history`;

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ history: shuffled }),
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
      sendResponse({ ok: true, ...json, url });
    } catch (e) {
      await setCooldown(10 * 60 * 1000);
      sendResponse({ ok: false, error: String(e), url });
    } finally {
      await chrome.storage.local.set({ [UPLOAD_LOCK_KEY]: false });
    }
  })();

  return true; // keep channel open
});
