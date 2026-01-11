import { Link } from "react-router-dom";

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <main className="max-w-4xl mx-auto px-6 py-14 space-y-10">
        <header className="space-y-4">
          <p className="text-sm uppercase tracking-[0.25em] text-indigo-500 font-semibold">Party Game</p>
          <h1 className="text-4xl sm:text-5xl font-extrabold text-slate-900 tracking-tight">
            Search History <span className="text-indigo-600">Liar</span>
          </h1>
          <p className="text-lg text-slate-600 max-w-2xl">
            Turn your browsing history into a spicy 2-truths-and-a-lie showdown. Two cards are real searches. One is a shameless fake.
          </p>
          <div className="flex flex-wrap gap-3 pt-2">
            <Link
              to="/review"
              className="inline-flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-5 py-3 rounded-xl shadow-sm"
            >
              Review upload
            </Link>
            <Link
              to="/roulette-room"
              className="inline-flex items-center gap-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-800 font-semibold px-5 py-3 rounded-xl shadow-sm"
            >
              Create a room
            </Link>
            <Link
              to="/portal"
              className="inline-flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white font-semibold px-5 py-3 rounded-xl shadow-sm"
            >
              My portal
            </Link>
            <a
              href="https://github.com"
              className="text-sm px-4 py-2 rounded-lg border border-slate-200 bg-white hover:bg-slate-100"
            >
              Get the extension
            </a>
          </div>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900 mb-2">1) Upload &amp; Tag</h2>
            <p className="text-slate-600">
              Install the extension, upload a sanitized snapshot (host + title only), and watch the server auto-tag your history by website type.
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-900 mb-2">2) Curate &amp; Share</h2>
            <p className="text-slate-600">
              Pick which perspectives to use, preview the rounds, swap anything boring, and send the jury link to friends.
            </p>
          </div>
        </div>

        <div className="p-4 bg-indigo-50 text-indigo-800 rounded-xl border border-indigo-100 text-sm">
          <strong>Privacy note:</strong> Only domains + titles are saved for your session. No passwords, no incognito, and you can delete anything before sharing.
        </div>
      </main>
    </div>
  );
}
