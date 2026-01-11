(() => {
  if (window.top !== window) return;

  const STORAGE_KEY = "hc_review_payload";
  const NAME_KEY = "hc_player_name";
  const SESSION_KEY = "hc_session_id";
  const path = window.location.pathname || "";
  const roomMatch = path.match(/^\/roulette-room\/([^/]+)/);
  const isRoomPage = Boolean(roomMatch);
  const roomId = roomMatch ? roomMatch[1] : null;
  let shell = null;
  let busy = false;

  function getSessionId() {
    try {
      return localStorage.getItem(SESSION_KEY) || "";
    } catch {
      return "";
    }
  }

  function setSessionId(id) {
    if (!id) return;
    try {
      localStorage.setItem(SESSION_KEY, id);
    } catch {}
    try {
      document.cookie = `${SESSION_KEY}=${encodeURIComponent(id)}; path=/; max-age=${60 * 60 * 24 * 30}`;
    } catch {}
    // Tell background to persist and set cooldown so the banner hides.
    try {
      chrome.runtime.sendMessage({ type: "hc-set-session", sessionId: id });
    } catch {}
  }

  function injectShell() {
    if (shell) return shell;
    shell = document.createElement("div");
    shell.id = "hc-page-banner";
    shell.style.position = "fixed";
    shell.style.top = "0";
    shell.style.left = "0";
    shell.style.right = "0";
    shell.style.zIndex = "2147483647";
    shell.style.background = "#FDFBF7";
    shell.style.color = "#18181B";
    shell.style.padding = "14px 18px";
    shell.style.boxShadow = "4px 4px 0 #18181B";
    shell.style.borderBottom = "2px solid #18181B";
    shell.style.fontFamily = "'Inter', 'Space Grotesk', system-ui, sans-serif";
    shell.innerHTML = `
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Space+Grotesk:wght@600;800&family=JetBrains+Mono:wght@500;700&display=swap');
        #hc-page-banner * { box-sizing: border-box; }
        .hc-wrap { display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between; }
        .hc-left { flex:1; min-width:240px; }
        .hc-title { font-family:'Space Grotesk',sans-serif; font-weight:800; font-size:18px; letter-spacing:-0.03em; }
        .hc-sub { font-size:13px; line-height:1.45; color:#334155; margin-top:2px; }
        .hc-status { font-size:12px; color:#475569; margin-top:4px; font-family:'JetBrains Mono', monospace; }
        .hc-buttons { display:flex; gap:8px; flex-wrap:wrap; align-items:center; }
        .hc-btn { border:2px solid #18181B; background:#18181B; color:#fff; padding:10px 14px; font-weight:700; font-family:'JetBrains Mono', monospace; box-shadow:3px 3px 0 #18181B; cursor:pointer; transition:transform 120ms ease; }
        .hc-btn:hover { transform: translateY(-2px); }
        .hc-btn.secondary { background:#FDFBF7; color:#18181B; }
        .hc-btn.danger { background:#FF5E78; color:#18181B; }
        .hc-pill { display:inline-flex; align-items:center; gap:6px; border:2px solid #18181B; padding:6px 10px; font-family:'JetBrains Mono', monospace; font-size:11px; box-shadow:2px 2px 0 #18181B; background:#CCF381; }
      </style>
      <div class="hc-wrap">
        <div class="hc-left">
          <div class="hc-title">History Court</div>
          <div class="hc-sub">
            ${isRoomPage ? "Send your browsing snapshot straight into this room." : "Review a sanitized snapshot (host + title). Pick what to upload."}
          </div>
          <div id="hc-status" class="hc-status"></div>
        </div>
        <div class="hc-buttons">
          <span class="hc-pill">${isRoomPage ? "Room" : "Upload"}</span>
          <button id="hc-start-btn" class="hc-btn">${isRoomPage ? "Send to room" : "Review & upload"}</button>
          <button id="hc-delete-btn" class="hc-btn danger" style="display:${getSessionId() ? "inline-flex" : "none"};">Delete my data</button>
          <button id="hc-dismiss-btn" class="hc-btn secondary">Dismiss</button>
        </div>
      </div>
    `;
    document.body.appendChild(shell);
    document.body.style.paddingTop = "90px";
    return shell;
  }

  function setStatus(msg, tone = "muted") {
    const el = shell?.querySelector("#hc-status");
    if (!el) return;
    el.style.color = tone === "bad" ? "#FF5E78" : tone === "good" ? "#16a34a" : "#475569";
    el.textContent = msg || "";
  }

  function attachHandlers() {
    const startBtn = shell.querySelector("#hc-start-btn");
    const dismissBtn = shell.querySelector("#hc-dismiss-btn");
    const deleteBtn = shell.querySelector("#hc-delete-btn");
    startBtn.onclick = () => {
      if (busy) return;
      busy = true;
      startBtn.disabled = true;
      setStatus("Fetching history for review...");

      if (isRoomPage && roomId) {
        const storedName = localStorage.getItem(NAME_KEY) || "";
        const name = prompt("Name to show in the room?", storedName || "Player") || storedName || "Player";
        if (name) localStorage.setItem(NAME_KEY, name);

        let cached = null;
        try {
          cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
        } catch (e) {
          cached = null;
        }

        const message = cached && Array.isArray(cached) && cached.length
          ? { type: "join-room-with-history", roomId, name, apiBase: location.origin, history: cached, sessionId: getSessionId() }
          : { type: "join-room", roomId, name, apiBase: location.origin, sessionId: getSessionId() };

        chrome.runtime.sendMessage(message, (resp) => {
          busy = false;
          startBtn.disabled = false;
          if (!resp?.ok) {
            setStatus(resp?.error || "Failed to join room.", "bad");
            return;
          }
          if (resp.history && Array.isArray(resp.history)) {
            try { localStorage.setItem(STORAGE_KEY, JSON.stringify(resp.history)); } catch (_) {}
          }
          if (resp.session_id) setSessionId(resp.session_id);
          setStatus(`Joined! (${resp.count || "uploaded"}) Waiting for host to start.`, "good");
        });
        return;
      }

      chrome.runtime.sendMessage(
        { type: "upload-history", reviewOnly: true, startTime: 0, apiBase: location.origin, sessionId: getSessionId() },
        (resp) => {
          busy = false;
          startBtn.disabled = false;
          if (!resp?.ok || !Array.isArray(resp.history)) {
            setStatus(resp?.error || "Failed to fetch history.", "bad");
            return;
          }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(resp.history));
          } catch (e) {
            /* ignore cache failure */
          }
          if (resp.session_id) setSessionId(resp.session_id);
          setStatus("Snapshot cached. Opening review…", "good");
          // Hide banner right after successful fetch so it doesn't linger.
          if (shell) {
            shell.remove();
            document.body.style.paddingTop = "";
          }
          const goReview = () => {
            if (window.location.pathname === "/review") {
              window.location.reload();
            } else {
              window.location.href = "/review";
            }
          };
          setTimeout(goReview, 50);
        }
      );
    };
    dismissBtn.onclick = () => {
      if (shell) shell.remove();
      document.body.style.paddingTop = "";
    };
    deleteBtn.onclick = () => {
      const sess = getSessionId();
      if (!sess) {
        setStatus("No session found to delete.", "bad");
        return;
      }
      if (!confirm("Delete all your data (local + server)?")) return;
      chrome.runtime.sendMessage({ type: "delete-user", sessionId: sess, apiBase: location.origin }, (resp) => {
        if (!resp?.ok) {
          setStatus(resp?.error || "Delete failed.", "bad");
          return;
        }
        try {
          localStorage.removeItem(SESSION_KEY);
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        setStatus("Deleted. You can upload again anytime.", "good");
        if (deleteBtn) deleteBtn.style.display = "none";
      });
    };
  }

  if (isRoomPage) {
    injectShell();
    attachHandlers();
  } else {
    chrome.runtime.sendMessage({ type: "hc-session-state" }, (state) => {
      if (!state?.ok) return;
      const hasSessionLocal = (() => {
        try {
          return Boolean(localStorage.getItem(SESSION_KEY));
        } catch {
          return false;
        }
      })();
      const hasCache = (() => {
        try {
          return Boolean(localStorage.getItem(STORAGE_KEY));
        } catch {
          return false;
        }
      })();
      const hasSession = hasSessionLocal || Boolean(state.sessionId);
      const now = Date.now();
      const sessionFresh = hasSession && state.nextPromptAt && now < state.nextPromptAt;

      // If we already have a session, hide the banner entirely (user uploaded before).
      if (hasSession) return;

      // Otherwise fall back to prompt gating (allows post-delete re-prompt).
      chrome.runtime.sendMessage({ type: "hc-should-prompt" }, (r) => {
        const allowLocalReset = !hasSession && !hasCache; // e.g. after portal deletion
        if (!r?.ok) return;
        if (!r.shouldPrompt && !allowLocalReset) return;
        injectShell();
        attachHandlers();
      });
    });
  }
})();
