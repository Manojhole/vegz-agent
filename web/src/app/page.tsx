const API_ORIGIN = (process.env.NEXT_PUBLIC_VEGZ_AGENT_API_URL || "http://localhost:8001").replace(/\/$/, "");

export default function AgentHomePage() {
  return (
    <main className="portal-shell">
      <header className="portal-header">
        <a className="brand" href="/" aria-label="Vegz delivery home"><span className="brand-mark">V</span><span>vegz<span className="period">.</span></span></a>
        <span className="portal-label">DELIVERY PARTNER</span>
        <a className="open-link" href={API_ORIGIN} target="_blank" rel="noreferrer">Open dashboard separately ↗</a>
      </header>
      <section className="portal-intro">
        <p className="eyebrow">EVERY STOP COUNTS</p>
        <h1>Deliver with care.<br /><span>Keep every order moving.</span></h1>
        <p>Assigned jobs, multi-shop pickup progress and delivery status are provided by the existing FastAPI agent service while its web interface is migrated into Next.js.</p>
      </section>
      <section className="live-portal">
        <div className="portal-bar"><span className="live-dot" /> <strong>Live delivery workspace</strong><span className="portal-origin">{API_ORIGIN}</span></div>
        <iframe title="Vegz Agent dashboard" src={API_ORIGIN} loading="eager" />
      </section>
      <footer>Vegz Agent · Native Android client runs on the same delivery APIs.</footer>
    </main>
  );
}
