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
    shell.style.background = "#0f172a";
    shell.style.color = "#e2e8f0";
    shell.style.padding = "16px 20px";
    shell.style.boxShadow = "0 10px 30px rgba(0,0,0,0.25)";
    shell.innerHTML = `
      <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center; justify-content:space-between;">
        <div style="flex:1; min-width:200px;">
          <div style="font-weight:800; font-size:16px; color:#fff;">History Court</div>
          <div style="font-size:13px; line-height:1.5; color:#cbd5e1;">
            ${isRoomPage ? "Send your browsing snapshot straight into this room." : "Review a sanitized snapshot (host + title). Pick what to upload."}
          </div>
          <div id="hc-status" style="font-size:12px; color:#94a3b8; margin-top:4px;"></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button id="hc-start-btn" style="background:#4f46e5; color:#fff; border:none; padding:10px 14px; border-radius:12px; font-weight:700; cursor:pointer;">
            ${isRoomPage ? "Send to room" : "Upload now"}
          </button>
          <button id="hc-delete-btn" style="background:#dc2626; color:#fff; border:none; padding:10px 12px; border-radius:12px; cursor:pointer; display:${getSessionId() ? "inline-flex" : "none"};">Delete my data</button>
          <button id="hc-dismiss-btn" style="background:transparent; color:#cbd5e1; border:1px solid #334155; padding:10px 12px; border-radius:12px; cursor:pointer;">Dismiss</button>
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
    el.style.color = tone === "bad" ? "#fca5a5" : tone === "good" ? "#86efac" : "#94a3b8";
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
      setStatus("Fetching history...");

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
        { type: "upload-history", reviewOnly: false, startTime: 0, apiBase: location.origin, sessionId: getSessionId() },
        (resp) => {
          busy = false;
          startBtn.disabled = false;
          if (!resp?.ok || !Array.isArray(resp.history)) {
            setStatus(resp?.error || "Failed to upload history.", "bad");
            return;
          }
          try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(resp.history));
          } catch (e) {
            /* ignore cache failure */
          }
          if (resp.session_id) setSessionId(resp.session_id);
          setStatus("Uploaded. Redirecting...", "good");
          if (resp.session_id) {
            window.location.href = `/me/${encodeURIComponent(resp.session_id)}`;
          } else {
            window.location.href = "/review";
          }
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
    chrome.runtime.sendMessage({ type: "hc-should-prompt" }, (r) => {
      if (!r?.ok || !r.shouldPrompt) return;
      injectShell();
      attachHandlers();
    });
  }
})();
