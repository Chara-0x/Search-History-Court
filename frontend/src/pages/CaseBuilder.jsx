import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { createCase, editCase, fetchCaseRounds, fetchSessionTags } from "../api/client";

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
  const [overlay, setOverlay] = useState({
    active: false,
    progress: 0,
    message: "Selecting the weirdest tabs...",
  });
  const timerRef = useRef(null);

  useEffect(() => {
    loadTags();
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

  async function handleGenerate() {
    setGenStatus({ msg: "Generating rounds...", tone: "muted" });
    startOverlay();
    try {
      const payload = {
        session_id: sessionId,
        rounds: Math.max(3, Math.min(15, Number(roundsInput) || 8)),
        tags: Array.from(selectedTags),
      };
      const res = await createCase(payload);
      if (!res.ok) throw new Error(res.error || "Failed to generate");
      setCaseState({ id: res.case_id, playUrl: res.play_url, rounds: res.rounds || [] });
      setGenStatus({ msg: "New rounds ready. Share after you finish edits.", tone: "good" });
    } catch (err) {
      setGenStatus({ msg: err.message, tone: "bad" });
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
      setPreviewStatus({ msg: err.message, tone: "bad" });
    }
  }

  async function handleRefresh() {
    if (!caseState.id) return;
    setPreviewStatus({ msg: "Refreshing...", tone: "muted" });
    try {
      const res = await fetchCaseRounds(caseState.id);
      if (!res.ok) throw new Error(res.error || "Failed to refresh");
      setCaseState((prev) => ({ ...prev, rounds: res.rounds || [] }));
      setPreviewStatus({ msg: "Preview synced.", tone: "good" });
    } catch (err) {
      setPreviewStatus({ msg: err.message, tone: "bad" });
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
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <main className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] text-indigo-500 font-semibold">Case Builder</p>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Curate your evidence</h1>
          <p className="text-slate-600 max-w-3xl">
            We scanned your upload and grouped pages into website-type tags. Pick the perspectives you want, then preview and edit the rounds before sharing.
          </p>
          <div className="inline-flex items-center gap-2 text-xs text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-full shadow-sm">
            <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
            Session <span className="font-mono text-slate-700">{sessionId}</span>
          </div>
        </header>

        <section className="bg-white border border-slate-200 rounded-2xl shadow-sm">
          <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-slate-100 px-6 py-4 gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Website type tags</p>
              <p className="text-xs text-slate-500">Select the perspectives to feed the AI (aim for at least {minTagCount} items per tag).</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={selectReady} className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-slate-100 hover:bg-slate-200">
                Ready-only
              </button>
              <button
                onClick={selectAllTags}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 bg-indigo-600 text-white hover:bg-indigo-700"
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
                    "text-left rounded-xl border p-4 transition shadow-sm",
                    active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300",
                  ].join(" ")}
                  onClick={() => {
                    setSelectedTags((prev) => {
                      const next = new Set(prev);
                      next.has(tag.id) ? next.delete(tag.id) : next.add(tag.id);
                      return next;
                    });
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">{tag.id}</p>
                      <p className="text-lg font-bold text-slate-900">{tag.label}</p>
                    </div>
                    <span className={`text-xs px-2 py-1 rounded-full ${isReady ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>
                      {isReady ? "Ready" : `Needs ${Math.max(0, minTagCount - tag.count)}`}
                    </span>
                  </div>
                  <p className={`mt-2 text-sm ${active ? "text-slate-700" : "text-slate-500"}`}>{tag.count} items</p>
                  <p className="mt-1 text-xs text-slate-500">eg. {samples.join(", ") || "..."}</p>
                </button>
              );
            })}
          </div>
          <div className="px-6 pb-5 text-sm text-slate-500">
            {selectedCount} selected - {readyCount} tags meet the {minTagCount}+ goal
          </div>
        </section>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-5 items-start">
          <div className="md:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-semibold text-slate-800">Rounds</label>
              <input
                type="number"
                min="3"
                max="15"
                value={roundsInput}
                onChange={(e) => setRoundsInput(e.target.value)}
                className="w-20 text-center rounded-lg border border-slate-200 px-2 py-2 font-semibold text-lg focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <span className="text-xs text-slate-500">More rounds = more spice.</span>
            </div>
            <button
              onClick={handleGenerate}
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-3 rounded-xl shadow-md"
            >
              <span>Generate rounds</span>
              {overlay.active && <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>}
            </button>
            <div className={`text-sm ${statusColor[genStatus.tone] || statusColor.muted}`}>{genStatus.msg}</div>
          </div>

          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-6 text-indigo-800 shadow-sm">
            <h3 className="font-semibold mb-2">Tips for better chaos</h3>
            <ul className="text-sm space-y-2">
              <li>- Keep at least {minTagCount} items per tag so each perspective feels full.</li>
              <li>- Mix serious (school/work/news) with weird (social/entertainment/shopping) for fun lies.</li>
              <li>- Use the preview tools to delete or swap any boring round.</li>
            </ul>
          </div>
        </section>

        <section className={`${caseState.id ? "" : "hidden"} bg-white border border-slate-200 rounded-2xl shadow-sm`} id="previewSection">
          <div className="flex flex-col md:flex-row md:items-center justify-between px-6 py-4 border-b border-slate-100 gap-3">
            <div>
              <p className="text-sm font-semibold text-slate-900">Preview &amp; edit</p>
              <p className="text-xs text-slate-500">Swap or delete rounds until you&apos;re happy. Changes save instantly.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={() => handleEdit("append_round")}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                Add round
              </button>
              <button onClick={handleRefresh} className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-100">
                Refresh preview
              </button>
            </div>
          </div>

          <div className="px-6 py-4 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">Shareable link</p>
              <div className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 font-mono text-sm text-indigo-700 break-all">
                {caseState.playUrl || "Awaiting generation..."}
              </div>
            </div>
            <button onClick={copyLink} className="text-sm px-3 py-2 rounded-lg border border-indigo-200 text-indigo-700 hover:bg-indigo-50">
              Copy
            </button>
          </div>

          <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            {(!caseState.rounds || !caseState.rounds.length) && (
              <div className="text-sm text-slate-500">No rounds yet. Generate or add one.</div>
            )}
            {(caseState.rounds || []).map((round, idx) => (
              <div key={idx} className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">Round {idx + 1}</p>
                    <p className="text-lg font-bold text-slate-900">{round.topic || `Round ${idx + 1}`}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleEdit("regenerate_round", idx)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-100"
                    >
                      Swap
                    </button>
                    <button
                      onClick={() => handleEdit("delete_round", idx)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50"
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
                          "flex items-start gap-3 rounded-lg px-3 py-2 border",
                          isLie ? "bg-rose-50 border-rose-100" : "bg-white border-slate-200",
                        ].join(" ")}
                      >
                        <div className="text-xs font-mono text-slate-500">{ci + 1}</div>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-slate-800">{c.title || "?"}</p>
                          <p className="text-xs text-slate-500">{c.host || "?"}</p>
                        </div>
                        <span
                          className={`text-[11px] px-2 py-1 rounded-full ${
                            isLie ? "bg-rose-200 text-rose-800" : "bg-emerald-100 text-emerald-700"
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

      {overlay.active && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center p-6">
          <div className="w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-indigo-500 font-semibold">Loading game</p>
                <h3 className="text-xl font-bold text-slate-900">Brewing spicy lies…</h3>
              </div>
              <span className="text-sm font-mono text-slate-500">{Math.floor(overlay.progress)}%</span>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-3 bg-indigo-600 rounded-full" style={{ width: `${overlay.progress}%` }}></div>
              </div>
              <p className="text-sm text-slate-600">{overlay.message}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-slate-700">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 space-y-2">
                  <p className="font-semibold mb-1">Mini-game</p>
                  <p className="text-xs text-slate-500">Click to nudge the progress bar or open the mini-game while you wait.</p>
                  <button
                    onClick={nudgeOverlay}
                    className="w-full bg-slate-900 text-white rounded-lg py-2 font-semibold hover:bg-slate-800"
                  >
                    Nudge progress
                  </button>
                  <button
                    onClick={() => window.open("/loading-game", "MiniGame", "width=600,height=700")}
                    className="w-full text-center bg-indigo-600 text-white rounded-lg py-2 font-semibold hover:bg-indigo-700"
                  >
                    Open mini-game
                  </button>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
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
    </div>
  );
}
