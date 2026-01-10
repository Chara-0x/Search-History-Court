(async function () {
  // Avoid iframe spam
  if (window.top !== window) return;

  // Ask background if we're allowed to prompt right now
  chrome.runtime.sendMessage({ type: "hc-should-prompt" }, (r) => {
    if (!r?.ok || !r.shouldPrompt) return;

    const approved = window.confirm(
      "Search History Court wants to upload a sanitized snapshot (host + title only) to generate your Case File.\n\nProceed?"
    );
    if (!approved) return;

    chrome.runtime.sendMessage(
      { type: "upload-history", startTime: 0, apiBase: location.origin },
      (resp) => {
        if (!resp?.ok) {
          // One alert max per cooldown window
          alert(
            "Failed to upload history.\n\n" +
              (resp?.error || "unknown error") +
              "\nURL: " +
              (resp?.url || "unknown")
          );
          return;
        }
        if (resp.session_id) {
          window.location.href = `/me/${encodeURIComponent(resp.session_id)}`;
        }
      }
    );
  });
})();
