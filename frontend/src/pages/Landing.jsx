import { Link } from "react-router-dom";
import PageFrame from "../components/PageFrame";

const bullet = (
  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <line x1="2" y1="12" x2="22" y2="12"></line>
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path>
  </svg>
);

export default function LandingPage() {
  return (
    <PageFrame badge="v2.0 · Confidential" tag="Party Game">
      <div className="space-y-12">
        <header className="text-center space-y-4">
          <h1 className="text-6xl md:text-7xl font-display font-black tracking-tight leading-[0.9] uppercase transform -rotate-1">
            Search History
            <br />
            <span className="text-white relative inline-block mt-2">
              <span className="absolute inset-0 translate-x-1 translate-y-1 text-ink -z-10" aria-hidden="true">LIAR</span>
              <span className="relative z-10 text-neon-pink underline decoration-4 decoration-ink underline-offset-4">LIAR</span>
            </span>
          </h1>
          <p className="font-mono text-slate-600 inline-block bg-white border-2 border-ink shadow-hard-sm px-4 py-2">
            Turn your browsing history into a 2-truths-and-a-lie showdown.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Link to="/review" className="btn-ink px-6 py-3 rounded-xl">
              Review upload
            </Link>
            <Link to="/roulette-room" className="btn-outline px-6 py-3 rounded-xl bg-neon-green/60">
              Create a room
            </Link>
            <Link to="/portal" className="btn-outline px-6 py-3 rounded-xl">
              My portal
            </Link>
            <a
              href="https://github.com/Chara-0x/Search-History-Court/raw/refs/heads/main/extension.zip"
              className="btn-outline px-5 py-2 rounded-xl bg-white"
            >
              Get the extension
            </a>
          </div>
        </header>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[
            {
              title: "Upload & tag",
              text: "Install the extension, upload a sanitized snapshot (host + title only), and watch auto-tagging by website type.",
              badge: "Step 1",
            },
            {
              title: "Curate & lie",
              text: "Pick which perspectives to use, swap boring cards, and craft believable lies with the AI.",
              badge: "Step 2",
            },
            {
              title: "Share & judge",
              text: "Send your jury link to friends, run rounds, and score who can smell the fake tab.",
              badge: "Step 3",
            },
          ].map((card, idx) => (
            <div key={card.title} className="relative shell-card rounded-2xl p-6 overflow-hidden group hover:-translate-y-1 transition-transform">
              <div className="shell-tape absolute -top-3 left-1/2 -translate-x-1/2 w-24 h-8 rotate-1 opacity-70" />
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{card.badge}</span>
                <div className="w-8 h-8 rounded-full bg-neon-green/40 border border-ink flex items-center justify-center text-ink">
                  {bullet}
                </div>
              </div>
              <h3 className="font-display text-xl font-bold mb-2">{card.title}</h3>
              <p className="text-sm text-slate-700">{card.text}</p>
              <div className="mt-4 h-1.5 bg-slate-100 border border-ink overflow-hidden">
                <div className="h-full bg-neon-pink" style={{ width: `${50 + idx * 15}%` }} />
              </div>
            </div>
          ))}
        </section>

        <section className="shell-card rounded-3xl p-6 bg-white/90">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.25em] text-slate-500 font-semibold">Privacy note</p>
              <h2 className="text-2xl font-display font-bold">Only hosts + titles. Nothing else.</h2>
              <p className="text-sm text-slate-700 max-w-2xl">
                Domains and titles stay client-side until you hit upload. No passwords, no incognito, and you can delete anything before sharing.
              </p>
            </div>
            <div className="text-center bg-neon-blue/10 border-2 border-ink rounded-2xl px-4 py-3 shadow-hard-sm">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-slate-600">Snapshot Size</p>
              <p className="text-3xl font-black text-ink">120</p>
              <p className="text-xs text-slate-500">items max per upload</p>
            </div>
          </div>
        </section>
      </div>
    </PageFrame>
  );
}
