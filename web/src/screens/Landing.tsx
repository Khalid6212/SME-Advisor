import { ThemeToggle } from "../components/ThemeToggle";

const FEATURES = [
  {
    title: "A structured interview",
    body: "A short conversation covers what a lender actually asks about — revenue, margins, debt, the things owners usually have to dig up for a meeting. Fifteen to twenty minutes, at your own pace.",
  },
  {
    title: "One document room",
    body: "Upload what your adviser asks for, when they ask for it — never a blanket checklist on day one. Every request comes with the reason behind it.",
  },
  {
    title: "An investor-ready plan",
    body: "Your adviser turns your answers into a full business plan — for a lender, for your own use, or both — with every figure traced back to where it came from.",
  },
];

const STEPS = [
  { title: "Answer a short set of questions", body: "About your business, its numbers, and what you need financing for." },
  { title: "Upload what's requested", body: "Only the specific documents your adviser needs to verify what you told them." },
  { title: "Your adviser reviews everything", body: "Your answers, your documents, and their own judgment go into the plan together." },
  { title: "Get a plan you can actually use", body: "For a bank, a guarantee programme, or just to know where you stand." },
];

export function Landing({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div>
      <div className="topbar">
        <span className="brand">SME Advisor</span>
        <div className="spacer" />
        <ThemeToggle />
        <button className="primary" onClick={onSignIn}>Sign in</button>
      </div>

      <div className="shell">
        <div className="hero">
          <h1>Get your business investment-ready</h1>
          <p className="sub">
            A structured assessment for Saudi SMEs — built with your adviser, backed by your
            own numbers, and ready to hand to a bank when you are.
          </p>
          <button className="primary" onClick={onSignIn}>Get started</button>
        </div>

        <div className="section">
          <h2>What you get</h2>
          <div className="feature-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="card">
                <div style={{ fontWeight: 600, marginBottom: 8 }}>{f.title}</div>
                <p className="muted" style={{ margin: 0, fontSize: 13 }}>{f.body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>How it works</h2>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className="step">
                <div className="num">{i + 1}</div>
                <div>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <p className="muted" style={{ margin: "4px 0 0", fontSize: 13 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="section">
          <h2>Built for how this actually has to work</h2>
          <div className="trust-grid">
            <div className="card">
              <strong>Hosted in Saudi Arabia.</strong>{" "}
              <span className="muted">Your data stays in the Kingdom.</span>
            </div>
            <div className="card">
              <strong>Your adviser sees your answers.</strong>{" "}
              <span className="muted">No one else does.</span>
            </div>
            <div className="card">
              <strong>Questions first, documents later.</strong>{" "}
              <span className="muted">Nothing is asked for before there's a reason for it.</span>
            </div>
            <div className="card">
              <strong>Every figure is traceable.</strong>{" "}
              <span className="muted">Back to your own words or a document you provided.</span>
            </div>
          </div>
        </div>

        <div className="cta-footer">
          <h2 style={{ marginBottom: 14 }}>Ready to see where you stand?</h2>
          <button className="primary" onClick={onSignIn}>Sign in to start</button>
        </div>
      </div>
    </div>
  );
}
