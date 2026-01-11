import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { fetchTypeMeta, uploadHistory } from "../api/client";
import { MAX_TAGS, classifyHistory, summarizeByTag } from "../lib/history";

const STORAGE_KEY = "hc_review_payload";

export default function ReviewPage() {
  const navigate = useNavigate();
  const [meta, setMeta] = useState({ tagDefs: [], typeMap: {}, typeToTag: {} });
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState([]);
  const [selectedTags, setSelectedTags] = useState(new Set());
  const [selectedHosts, setSelectedHosts] = useState({});
  const [status, setStatus] = useState({ msg: "", tone: "muted" });
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    fetchTypeMeta()
      .then((data) => {
        setMeta({
          tagDefs: data.tag_defs || [],
          typeMap: data.type_map || {},
          typeToTag: data.type_to_tag || {},
        });
      })
      .catch((err) => setStatus({ msg: err.message, tone: "bad" }));
  }, []);

  useEffect(() => {
    if (!meta.tagDefs.length) return;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      setMissing(true);
      setLoading(false);
      return;
    }
    let history = [];
    try {
      history = JSON.parse(raw) || [];
    } catch (e) {
      setMissing(true);
      setLoading(false);
      return;
    }
    if (!Array.isArray(history) || !history.length) {
      setMissing(true);
      setLoading(false);
      return;
    }

    const tagged = classifyHistory(history, meta);
    const sum = summarizeByTag(tagged, meta.tagDefs);
    const defaults = new Set(
      sum
        .filter((t) => t.id !== "uncategorized" && t.count > 0)
        .slice(0, MAX_TAGS)
        .map((t) => t.id),
    );
    const hostSelections = {};
    sum.forEach((t) => {
      if (defaults.has(t.id)) {
        hostSelections[t.id] = new Set((t.hosts || []).map((h) => h.host));
      }
    });

    setItems(tagged);
    setSummary(sum);
    setSelectedTags(defaults);
    setSelectedHosts(hostSelections);
    setLoading(false);
    setStatus({ msg: "Ready.", tone: "muted" });
  }, [meta]);

  const filteredItems = useMemo(() => {
    return items.filter((it) => {
      if (!selectedTags.has(it.tag)) return false;
      const hostSet = selectedHosts[it.tag];
      if (!hostSet || hostSet.size === 0) return true;
      return hostSet.has(it.host);
    });
  }, [items, selectedHosts, selectedTags]);

  const totalsText = `${items.length} total items • ${summary.length} categories`;
  const filterText = selectedTags.size
    ? `${selectedTags.size} selected categories, ${filteredItems.length} items chosen`
    : "No categories selected.";

  function toggleTag(tagId) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) {
        next.delete(tagId);
      } else {
        if (next.size >= MAX_TAGS && tagId !== "uncategorized") {
          setStatus({ msg: `You can select up to ${MAX_TAGS} categories.`, tone: "bad" });
          return prev;
        }
        next.add(tagId);
      }
      return next;
    });
  }

  function toggleHost(tagId, host, checked) {
    setSelectedHosts((prev) => {
      const next = { ...prev };
      const set = new Set(next[tagId] || []);
      if (checked) set.add(host);
      else set.delete(host);
      next[tagId] = set;
      return next;
    });
  }

  function toggleAllHosts(tagId) {
    const tag = summary.find((t) => t.id === tagId);
    if (!tag) return;
    setSelectedHosts((prev) => {
      const next = { ...prev };
      const current = new Set(next[tagId] || []);
      const allHosts = tag.hosts || [];
      const allChecked = allHosts.every((h) => current.has(h.host));
      next[tagId] = allChecked ? new Set() : new Set(allHosts.map((h) => h.host));
      return next;
    });
  }

  function selectAllTags() {
    const all = new Set(summary.map((t) => t.id));
    const hostSelections = {};
    summary.forEach((t) => {
      hostSelections[t.id] = new Set((t.hosts || []).map((h) => h.host));
    });
    setSelectedTags(all);
    setSelectedHosts(hostSelections);
  }

  function deselectAllTags() {
    setSelectedTags(new Set());
    setSelectedHosts({});
  }

  function clearCached() {
    localStorage.removeItem(STORAGE_KEY);
    setMissing(true);
    setItems([]);
    setSummary([]);
    setSelectedTags(new Set());
    setSelectedHosts({});
  }

  async function onUpload() {
    if (!filteredItems.length) {
      setStatus({ msg: "Pick at least one item to upload.", tone: "bad" });
      return;
    }
    setUploading(true);
    setStatus({ msg: "Uploading selection...", tone: "muted" });
    try {
      const res = await uploadHistory(filteredItems);
      if (!res.ok) throw new Error(res.error || "Upload failed");
      localStorage.removeItem(STORAGE_KEY);
      setStatus({ msg: "Uploaded. Redirecting...", tone: "good" });
      navigate(`/me/${encodeURIComponent(res.session_id)}`);
    } catch (err) {
      setStatus({ msg: err.message, tone: "bad" });
    } finally {
      setUploading(false);
    }
  }

  const statusColor = {
    muted: "text-slate-500",
    good: "text-emerald-600",
    bad: "text-rose-600",
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <main className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="space-y-3">
          <p className="text-xs uppercase tracking-[0.28em] text-indigo-500 font-semibold">Pre-upload review</p>
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight">Choose what to upload</h1>
          <p className="text-slate-600 max-w-3xl">
            We pulled a sanitized snapshot (host + title only). Pick which categories and domains to keep before sending to the server.
          </p>
          <div className="text-sm bg-white border border-slate-200 rounded-xl px-4 py-3 shadow-sm">
            <p>
              <span className="font-semibold">Reminder:</span> Filtering happens client side. Nothing is stored until you press Upload Selected.
            </p>
          </div>
        </header>

        {missing && (
          <section className="bg-amber-50 border border-amber-200 text-amber-800 px-4 py-3 rounded-xl text-sm">
            No cached history found. Use the extension banner on this site to fetch your history, then return here.
          </section>
        )}

        {!missing && (
          <section className={loading ? "opacity-60 pointer-events-none" : ""}>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <div className="text-sm text-slate-600">{totalsText}</div>
              <div className="flex gap-2 text-xs">
                <button
                  onClick={selectAllTags}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100"
                >
                  Select all tags
                </button>
                <button
                  onClick={deselectAllTags}
                  className="px-3 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100"
                >
                  Deselect all
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
              {summary.map((tag) => {
                const active = selectedTags.has(tag.id);
                const hostNames = (tag.hosts || []).slice(0, 3).map((h) => h.host).join(", ");
                return (
                  <button
                    key={tag.id}
                    className={[
                      "w-full text-left rounded-xl border p-4 transition shadow-sm",
                      active ? "border-indigo-300 bg-indigo-50" : "border-slate-200 bg-white hover:border-slate-300",
                    ].join(" ")}
                    onClick={() => toggleTag(tag.id)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">{tag.id}</p>
                        <p className="text-lg font-bold text-slate-900">{tag.label}</p>
                      </div>
                      <span
                        className={[
                          "text-xs px-2 py-1 rounded-full",
                          active ? "bg-indigo-200 text-indigo-800" : "bg-slate-100 text-slate-600",
                        ].join(" ")}
                      >
                        {tag.count} items
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-slate-500">Top domains: {hostNames || "..."}</p>
                  </button>
                );
              })}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-5 space-y-3">
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm font-semibold text-slate-900">Filtered domains</p>
                <p className="text-xs text-slate-500">{filterText}</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {summary
                  .filter((t) => selectedTags.has(t.id))
                  .map((tag) => (
                    <div key={tag.id} className="border border-slate-200 rounded-xl p-3 bg-white">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <p className="text-xs uppercase tracking-[0.18em] text-slate-500 font-semibold">{tag.id}</p>
                          <p className="text-sm font-semibold text-slate-800">{tag.label}</p>
                        </div>
                        <button
                          className="text-xs px-2 py-1 rounded bg-slate-100 hover:bg-slate-200"
                          onClick={() => toggleAllHosts(tag.id)}
                        >
                          Toggle all
                        </button>
                      </div>
                      <div className="space-y-1 max-h-56 overflow-y-auto">
                        {(tag.hosts || []).map((h) => {
                          const checked = selectedHosts[tag.id]?.has(h.host);
                          return (
                            <label key={h.host} className="flex items-center gap-2 text-sm text-slate-700">
                              <input
                                type="checkbox"
                                className="rounded border-slate-300"
                                checked={!!checked}
                                onChange={(e) => toggleHost(tag.id, h.host, e.target.checked)}
                              />
                              <span className="flex-1 truncate">{h.host}</span>
                              <span className="text-xs text-slate-500">{h.count}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 mt-4">
              <button
                onClick={onUpload}
                disabled={uploading}
                className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-xl shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{uploading ? "Uploading..." : "Upload selected"}</span>
                <span className="text-xs bg-white/20 px-2 py-1 rounded-full">{filteredItems.length} items</span>
              </button>
              <button
                onClick={clearCached}
                className="text-sm px-3 py-2 rounded-lg border border-slate-200 hover:bg-slate-100"
              >
                Clear cached history
              </button>
              <p className={`text-sm ${statusColor[status.tone] || statusColor.muted}`}>{status.msg}</p>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
