(() => {
  if (window.top !== window) return;

  const STORAGE_KEY = "hc_review_payload";
  let shell = null;
  let busy = false;

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
          <div style="font-size:13px; line-height:1.5; color:#cbd5e1;">Review a sanitized snapshot (host + title). Pick what to upload.</div>
          <div id="hc-status" style="font-size:12px; color:#94a3b8; margin-top:4px;"></div>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
          <button id="hc-start-btn" style="background:#4f46e5; color:#fff; border:none; padding:10px 14px; border-radius:12px; font-weight:700; cursor:pointer;">Review now</button>
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
    startBtn.onclick = () => {
      if (busy) return;
      busy = true;
      startBtn.disabled = true;
      setStatus("Fetching history...");
      chrome.runtime.sendMessage(
        { type: "upload-history", reviewOnly: true, startTime: 0, apiBase: location.origin },
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
            setStatus("Unable to cache history locally.", "bad");
            return;
          }
          setStatus("Ready. Redirecting...", "good");
          window.location.href = "/review";
        }
      );
    };
    dismissBtn.onclick = () => {
      if (shell) shell.remove();
      document.body.style.paddingTop = "";
    };
  }

  chrome.runtime.sendMessage({ type: "hc-should-prompt" }, (r) => {
    if (!r?.ok || !r.shouldPrompt) return;
    injectShell();
    attachHandlers();
  });
})();
