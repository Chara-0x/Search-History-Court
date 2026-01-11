import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { deleteUser } from "../api/client";
import PageFrame from "../components/PageFrame";

const SESSION_KEY = "hc_session_id";

export default function PortalPage() {
  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState("");
  const [status, setStatus] = useState({ msg: "", tone: "muted" });

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SESSION_KEY);
      if (stored) setSessionId(stored);
    } catch (e) {
      /* ignore */
    }
  }, []);

  function goToPortal() {
    if (!sessionId.trim()) {
      setStatus({ msg: "Enter your session id.", tone: "bad" });
      return;
    }
    try {
      localStorage.setItem(SESSION_KEY, sessionId.trim());
    } catch (e) {
      /* ignore */
    }
    navigate(`/me/${encodeURIComponent(sessionId.trim())}`);
  }

  async function handleDelete() {
    if (!sessionId.trim()) {
      setStatus({ msg: "Enter your session id first.", tone: "bad" });
      return;
    }
    if (!confirm("Delete all your uploaded data (server + local)?")) return;
    setStatus({ msg: "Deleting...", tone: "muted" });
    try {
      await deleteUser(sessionId.trim());
      try {
        localStorage.removeItem(SESSION_KEY);
        localStorage.removeItem("hc_review_payload");
      } catch (e) {
        /* ignore */
      }
      setStatus({ msg: "Deleted. You can upload again anytime.", tone: "good" });
    } catch (err) {
      setStatus({ msg: err.message, tone: "bad" });
    }
  }

  const statusColor = {
    muted: "text-slate-500",
    good: "text-emerald-600",
    bad: "text-rose-600",
  };

  return (
    <PageFrame badge="User Portal" tag="Data Control">
      <main className="max-w-3xl space-y-6">
        <header className="space-y-2">
          <p className="text-xs uppercase tracking-[0.28em] font-mono text-slate-600">User portal</p>
          <h1 className="text-4xl font-display font-black tracking-tight">Manage your History Court data</h1>
          <p className="text-slate-700">Jump to your case builder or delete everything tied to your session id.</p>
        </header>

        <section className="shell-card bg-white rounded-3xl p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-ink">Session ID</label>
            <input
              type="text"
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              placeholder="e.g. AbC123xyz789"
              className="w-full rounded-lg border-2 border-ink px-3 py-2 text-sm bg-white focus:outline-none"
            />
          </div>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={goToPortal}
              className="btn-ink px-4 py-2 rounded-lg"
            >
              Open my portal
            </button>
            <button
              onClick={handleDelete}
              className="px-4 py-2 rounded-lg border-2 border-alert-red text-alert-red font-semibold bg-white hover:-translate-y-0.5 transition-transform"
            >
              Delete all data
            </button>
          </div>
          <div className={`text-sm ${statusColor[status.tone] || statusColor.muted}`}>{status.msg}</div>
        </section>
      </main>
    </PageFrame>
  );
}
