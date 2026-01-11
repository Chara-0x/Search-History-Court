export default function PageFrame({ children, badge = "CONFIDENTIAL", tag = "Case File #8821" }) {
  return (
    <div className="min-h-screen text-ink">
      <div className="max-w-6xl mx-auto px-6 py-8 space-y-10">
        <nav className="flex items-center justify-between shell-card px-5 py-3 rounded-xl bg-white">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 bg-neon-pink border border-ink rounded-full" />
            <span className="font-mono font-bold uppercase tracking-wider text-xs">{tag}</span>
          </div>
          <div className="font-mono text-xs bg-ink text-white px-2 py-1">{badge}</div>
        </nav>
        {children}
      </div>
    </div>
  );
}
