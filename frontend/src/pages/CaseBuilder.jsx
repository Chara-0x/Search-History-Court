import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createCase, editCase, fetchSessionTags } from "../api/client";
import PageFrame from "../components/PageFrame";
import { SESSION_KEY } from "../config";
const statusColor = {
  muted: "text-slate-500",
  good: "text-emerald-600",
  bad: "text-rose-600",
};

export default function CaseBuilderPage() {
  const { sessionId } = useParams();
  const [tags, setTags] = useState([]);
  const [minTagCount, setMinTagCount] = useState(0);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [loadingTags, setLoadingTags] = useState(true);
  const [genStatus, setGenStatus] = useState({ msg: "", tone: "muted" });
  const [previewStatus, setPreviewStatus] = useState({ msg: "", tone: "muted" });
  const [roundsInput, setRoundsInput] = useState(8);
  const [caseState, setCaseState] = useState({ id: null, playUrl: null, rounds: [] });
  const [aiAlert, setAiAlert] = useState(null);
  const [overlay, setOverlay] = useState({
    active: false,
    progress: 0,
    message: "Selecting the weirdest tabs...",
  });
  const timerRef = useRef(null);

  useEffect(() => {
    loadTags();
  }, [sessionId]);

  // Persist session id so Portal can pick it up later.
  useEffect(() => {
    if (!sessionId) return;
    try {
      localStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      /* ignore */
    }
    try {
      document.cookie = `${SESSION_KEY}=${encodeURIComponent(sessionId)}; path=/; max-age=${60 * 60 * 24 * 30}`;
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  useEffect(() => {
    if (!overlay.active) return;
    timerRef.current = setInterval(() => {
      setOverlay((prev) => {
        const next = Math.min(99, prev.progress + Math.random() * 6);
        let message = prev.message;
        if (next > 90) message = "Sealing your case file...";
        else if (next > 70) message = "Convincing AI to fabricate believable lies...";
        return { ...prev, progress: next, message };
      });
    }, 400);
    return () => timerRef.current && clearInterval(timerRef.current);
  }, [overlay.active]);

  useEffect(() => {
    if (!aiAlert) return;
    const t = setTimeout(() => setAiAlert(null), 12000);
    return () => clearTimeout(t);
  }, [aiAlert]);

  const readyCount = useMemo(() => tags.filter((t) => t.count >= minTagCount).length, [tags, minTagCount]);

  async function loadTags() {
    setLoadingTags(true);
    try {
      const res = await fetchSessionTags(sessionId);
      if (!res.ok) throw new Error(res.error || "Failed to load tags");
      const ready = res.tags.filter((t) => t.count >= res.min_per_tag).map((t) => t.id);
      const fallback = res.tags.map((t) => t.id);
      setTags(res.tags || []);
      setMinTagCount(res.min_per_tag || 0);
      setSelectedTags(new Set(ready.length ? ready : fallback));
    } catch (err) {
      setGenStatus({ msg: err.message, tone: "bad" });
    } finally {
      setLoadingTags(false);
    }
  }

  function startOverlay() {
    if (timerRef.current) clearInterval(timerRef.current);
    setOverlay({ active: true, progress: 0, message: "Selecting the weirdest tabs..." });
  }

  function finishOverlay() {
    if (timerRef.current) clearInterval(timerRef.current);
    setOverlay({ active: true, progress: 100, message: "Done!" });
    setTimeout(() => setOverlay((prev) => ({ ...prev, active: false })), 350);
  }

  function nudgeOverlay() {
    if (!overlay.active) return;
    setOverlay((prev) => ({ ...prev, progress: Math.min(99, prev.progress + 5) }));
  }

  function showAiAlert(message, onRetry) {
    setAiAlert({ message, onRetry });
  }

  function makeGeneratePayload() {
    return {
      session_id: sessionId,
      rounds: Math.max(3, Math.min(15, Number(roundsInput) || 8)),
      tags: Array.from(selectedTags),
    };
  }

  async function handleGenerate() {
    setGenStatus({ msg: "Generating rounds...", tone: "muted" });
    startOverlay();
    try {
      const payload = makeGeneratePayload();
      const res = await createCase(payload);
      if (!res.ok) throw new Error(res.error || "Failed to generate");
      setCaseState({ id: res.case_id, playUrl: res.play_url, rounds: res.rounds || [] });
      setGenStatus({ msg: "New rounds ready. Share after you finish edits.", tone: "good" });
    } catch (err) {
      const msg = err.message || "AI generation failed.";
      setGenStatus({ msg, tone: "bad" });
      showAiAlert(msg, () => handleGenerate());
    } finally {
      finishOverlay();
    }
  }

  async function handleEdit(action, roundIndex = null) {
    if (!caseState.id) return;
    setPreviewStatus({ msg: "Updating...", tone: "muted" });
    try {
      const payload = { action, tags: Array.from(selectedTags) };
      if (roundIndex !== null) payload.round = roundIndex;
      if (action === "append_round") payload.count = 1;
      const res = await editCase(caseState.id, payload);
      if (!res.ok) throw new Error(res.error || "Edit failed");
      setCaseState((prev) => ({ ...prev, rounds: res.rounds || [] }));
      setPreviewStatus({ msg: "Updated.", tone: "good" });
    } catch (err) {
      const msg = err.message || "AI update failed.";
      setPreviewStatus({ msg, tone: "bad" });
      if (action !== "delete_round") {
        showAiAlert(msg, () => handleEdit(action, roundIndex));
      }
    }
  }

  async function handleRegenerateAll(skipConfirm = false) {
    if (!skipConfirm) {
      const ok = window.confirm("Replace all preview rounds with a fresh AI run? This removes the current set.");
      if (!ok) return;
    }
    setPreviewStatus({ msg: "Regenerating everything...", tone: "muted" });
    startOverlay();
    try {
      const payload = makeGeneratePayload();
      const res = await createCase(payload);
      if (!res.ok) throw new Error(res.error || "Failed to regenerate");
      setCaseState({ id: res.case_id, playUrl: res.play_url, rounds: res.rounds || [] });
      setPreviewStatus({ msg: "All rounds regenerated.", tone: "good" });
      setGenStatus({ msg: "Fresh case ready.", tone: "good" });
    } catch (err) {
      const msg = err.message || "AI regeneration failed.";
      setPreviewStatus({ msg, tone: "bad" });
      showAiAlert(msg, () => handleRegenerateAll(true));
    } finally {
      finishOverlay();
    }
  }

  async function copyLink() {
    if (!caseState.playUrl) return;
    try {
      await navigator.clipboard.writeText(caseState.playUrl);
      setPreviewStatus({ msg: "Link copied.", tone: "good" });
    } catch (err) {
      setPreviewStatus({ msg: "Could not copy link.", tone: "bad" });
    }
  }

  function selectAllTags() {
    setSelectedTags(new Set(tags.map((t) => t.id)));
  }

  function selectReady() {
    const ready = tags.filter((t) => t.count >= minTagCount).map((t) => t.id);
    setSelectedTags(new Set(ready.length ? ready : tags.map((t) => t.id)));
  }

  const selectedCount = selectedTags.size;

  return (
    <PageFrame badge="Case Builder" tag={`Session ${sessionId || "?"}`}>
      <main className="space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] font-mono text-slate-600">Case Builder</p>
          <h1 className="text-4xl md:text-5xl font-display font-black tracking-tight">Curate your evidence</h1>
          <p className="text-slate-700 max-w-3xl">
            We scanned your upload and grouped pages into website-type tags. Pick the perspectives you want, then preview and edit the rounds before sharing.
          </p>
          <div className="inline-flex items-center gap-2 text-xs text-slate-700 bg-white border-2 border-ink px-3 py-1.5 rounded-full shadow-hard-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Session <span className="font-mono text-ink">{sessionId}</span>
          </div>
        </header>

        <section className="shell-card overflow-hidden bg-white">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b-2 border-ink px-6 py-4 gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Website type tags</p>
              <p className="text-xs text-slate-600">Select the perspectives to feed the AI (aim for at least {minTagCount} items per tag).</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={selectReady} className="btn-outline px-3 py-2 rounded-lg bg-white">
                Ready-only
              </button>
              <button
                onClick={selectAllTags}
                className="btn-ink px-3 py-2 rounded-lg"
              >
                Select all
              </button>
            </div>
          </div>
          <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6 ${loadingTags ? "opacity-60" : ""}`}>
            {tags.length === 0 && <div className="text-sm text-slate-500">No history items yet. Upload from the extension and reload.</div>}
            {tags.map((tag) => {
              const isReady = tag.count >= minTagCount;
              const active = selectedTags.has(tag.id);
              const samples = (tag.items || []).slice(0, 3).map((it) => it.host);
              return (
                <button
                  key={tag.id}
                  className={[
                    "relative text-left shell-card p-4 transition rounded-none",
                    active ? "bg-neon-green/30 border-ink border-4 shadow-hard-sm" : "bg-white hover:-translate-y-1",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedTags((prev) => {
                      const next = new Set(prev);
                      next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id);
                      return next;
                    });
                  }}
                >
                  {active && (
                    <span className="absolute top-2 right-2 text-ink bg-white border-2 border-ink px-2 py-0.5 text-[10px] font-mono uppercase shadow-hard-sm">
                      Selected
                    </span>
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-600 font-mono">{tag.id}</p>
                      <p className="text-lg font-display font-bold text-ink">{tag.label}</p>
                    </div>
                  </div>
                  <p className={`mt-2 text-sm ${active ? "text-slate-700" : "text-slate-500"}`}>{tag.count} items</p>
                  <p className="mt-1 text-xs text-slate-500">eg. {samples.join(", ") || "..."}</p>
                  <span
                    className={`absolute bottom-2 right-2 text-[11px] font-mono uppercase px-2 py-1 border-2 shadow-hard-sm ${
                      isReady ? "border-emerald-500 bg-neon-green/60 text-ink" : "border-alert-red bg-neon-pink/30 text-ink"
                    }`}
                  >
                    {isReady ? "Ready" : `Needs ${Math.max(0, minTagCount - tag.count)} More`}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="px-6 pb-5 text-sm text-slate-700 font-mono">
            {selectedCount} selected - {readyCount} tags meet the {minTagCount}+ goal
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          <div className="md:col-span-2 shell-card bg-white p-6 space-y-4 rounded-none">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-ink">Rounds</label>
              <input
                type="number"
                min="3"
                max="15"
                value={roundsInput}
                onChange={(e) => setRoundsInput(e.target.value)}
                className="w-20 text-center rounded-lg border-2 border-ink px-2 py-2 font-semibold text-lg focus:outline-none"
              />
              <span className="text-xs text-slate-600">More rounds = more spice.</span>
            </div>
            <button
              onClick={handleGenerate}
              className="btn-ink inline-flex items-center gap-2 px-4 py-3 rounded-xl"
            >
              <span>Generate rounds</span>
              {overlay.active && <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>}
            </button>
            <div className={`text-sm ${statusColor[genStatus.tone] || statusColor.muted}`}>{genStatus.msg}</div>
          </div>

          <div className="border-2 border-ink bg-neon-blue/10 p-6 text-ink shadow-hard-sm rounded-none">
            <h3 className="font-display font-bold mb-2">Tips for better chaos</h3>
            <ul className="text-sm space-y-2 text-slate-800">
              <li>- Keep at least {minTagCount} items per tag so each perspective feels full.</li>
              <li>- Mix serious (school/work/news) with weird (social/entertainment/shopping) for fun lies.</li>
              <li>- Use the preview tools to delete or swap any boring round.</li>
            </ul>
          </div>
        </section>

        <section className={`${caseState.id ? "" : "hidden"} shell-card bg-white overflow-hidden rounded-none`} id="previewSection">
          <div className="flex flex-col md:flex-row md:items-center justify-between px-6 py-4 border-b-2 border-ink gap-3">
            <div>
              <p className="text-sm font-semibold text-ink">Preview &amp; edit</p>
              <p className="text-xs text-slate-600">Swap or delete rounds until you&apos;re happy. Changes save instantly.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleEdit("append_round")}
                className="btn-outline text-sm px-3 py-2 bg-white rounded-none"
              >
                Add round
              </button>
              <button
                onClick={() => handleRegenerateAll()}
                className="text-sm px-3 py-2 border-2 border-alert-red text-alert-red bg-white hover:-translate-y-0.5 transition-transform rounded-none"
              >
                Regenerate all rounds
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-b-2 border-ink flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-600 font-mono">Shareable link</p>
              <div className="bg-white border-2 border-ink px-3 py-2 font-mono text-sm text-ink break-all shadow-hard-sm rounded-none">
                {caseState.playUrl || "Awaiting generation..."}
              </div>
            </div>
              <button onClick={copyLink} className="btn-outline text-sm px-3 py-2 bg-white rounded-none">
                Copy
              </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {(!caseState.rounds || !caseState.rounds.length) && (
              <div className="text-sm text-slate-500">No rounds yet. Generate or add one.</div>
            )}
            {(caseState.rounds || []).map((round, idx) => (
              <div key={idx} className="border-2 border-ink p-4 bg-white shadow-hard-sm rounded-none">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-600 font-mono">Round {idx + 1}</p>
                    <p className="text-lg font-display font-bold text-ink">{round.topic || `Round ${idx + 1}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit("regenerate_round", idx)}
                      className="btn-outline text-xs px-3 py-1.5 bg-white rounded-none"
                    >
                      Swap
                    </button>
                    <button
                      onClick={() => handleEdit("delete_round", idx)}
                      className="text-xs px-3 py-1.5 border-2 border-alert-red text-alert-red bg-white hover:-translate-y-0.5 transition-transform rounded-none"
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  {(round.cards || []).map((c, ci) => {
                    const isLie = ci === round.lie_index || c.is_lie;
                    return (
                      <div
                      key={ci}
                      className={[
                          "flex items-start gap-3 px-3 py-2 border-2 rounded-none",
                          isLie ? "bg-neon-pink/10 border-alert-red" : "bg-white border-ink/30",
                        ].join(" ")}
                    >
                        <div className="text-xs font-mono text-slate-500">{ci + 1}</div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-ink">{c.title || "?"}</p>
                          <p className="text-xs text-slate-600">{c.host || "?"}</p>
                        </div>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${
                            isLie ? "bg-alert-red text-white" : "bg-neon-green text-ink"
                          }`}
                        >
                          {isLie ? "Lie" : "Truth"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className={`px-6 pb-5 text-sm ${statusColor[previewStatus.tone] || statusColor.muted}`}>{previewStatus.msg}</div>
        </section>
      </main>

      {aiAlert && (
        <div className="fixed top-4 right-4 z-40 max-w-sm drop-shadow-xl">
          <div className="bg-white border-2 border-ink shadow-hard-lg rounded-none p-4 space-y-3">
            <div className="flex items-start gap-2">
              <span className="mt-1 w-2 h-2 rounded-full bg-alert-red inline-block"></span>
              <div className="flex-1">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-600 font-mono">AI hiccup</p>
                <p className="text-sm text-ink leading-snug">{aiAlert.message || "Generation failed. Try again?"}</p>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAiAlert(null)}
                className="btn-outline text-xs px-3 py-2 bg-white rounded-none"
              >
                Keep current
              </button>
              <button
                onClick={() => {
                  const retry = aiAlert.onRetry;
                  setAiAlert(null);
                  retry && retry();
                }}
                className="btn-ink text-xs px-3 py-2 rounded-none"
              >
                Regenerate
              </button>
            </div>
          </div>
        </div>
      )}

      {overlay.active && (
        <div
          className="fixed inset-0 left-0 top-0 w-full h-full bg-ink/90 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          style={{ marginTop: 0 }}
        >
          <div className="w-full max-w-2xl bg-white shadow-hard-lg border-2 border-ink overflow-hidden rounded-none">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-500 font-semibold">Loading game</p>
                <h3 className="text-xl font-bold text-slate-900">Brewing spicy lies…</h3>
              </div>
              <span className="text-sm font-mono text-slate-500">{Math.floor(overlay.progress)}%</span>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="w-full h-3 bg-slate-100 overflow-hidden border border-ink">
                <div className="h-3 bg-ink" style={{ width: `${overlay.progress}%` }}></div>
              </div>
              <p className="text-sm text-slate-600">{overlay.message}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700">
                <div className="p-3 bg-white border-2 border-ink space-y-2 shadow-hard-sm rounded-none">
                  <p className="font-semibold mb-1">Mini-game</p>
                  <p className="text-xs text-slate-500">Click to nudge the progress bar or open the mini-game while you wait.</p>
                  <button
                    onClick={nudgeOverlay}
                    className="w-full btn-ink py-2 rounded-none"
                  >
                    Nudge progress
                  </button>
                  <button
                    onClick={() => window.open("/loading-game", "MiniGame", "width=600,height=700")}
                    className="w-full text-center btn-outline bg-neon-blue/30 py-2 font-semibold"
                  >
                    Open mini-game
                  </button>
                </div>
                <div className="p-3 bg-white border-2 border-ink shadow-hard-sm rounded-none">
                  <p className="font-semibold mb-1">What’s happening</p>
                  <ul className="text-xs text-slate-500 space-y-1">
                    <li>- Filtering boring logins</li>
                    <li>- Picking spicy titles per tag</li>
                    <li>- Asking AI for the strangest lies</li>
                    <li>- Packaging a share link</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </PageFrame>
  );
}
