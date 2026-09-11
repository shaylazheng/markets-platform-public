import { useEffect, useRef, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { postJSON } from '@markets/shell/lib/api.js';
import { buildQuizContext } from './quizContext.js';
import { absorbMarkers, currentStreak, loadResults, loadReviewTopics } from './progress.js';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';

const GLOSSARY = [
  ['Yield curve', 'Treasury yields across maturities (3M to 30Y). Its slope hints at growth and Fed expectations.'],
  ['Basis point (bp)', 'One hundredth of a percentage point. 0.25% equals 25 basis points.'],
  ['Inverted curve', 'Short-term yields above long-term yields. Historically a recession warning.'],
  ['2s10s spread', 'The 10-year yield minus the 2-year yield. Negative means inverted.'],
  ['Credit spread', 'The extra yield corporate bonds pay over Treasuries. Wider means more perceived risk.'],
  ['IG vs high yield', 'IG is higher-rated and safer; HY (junk) is lower-rated, riskier, higher-yielding.'],
  ['VIX', "Expected 30-day volatility for the S&P 500. Low is calm, high is fear."],
  ['Real yield', 'A Treasury yield after subtracting expected inflation, read from TIPS.'],
  ['Breakeven inflation', "The bond market's expected average inflation: nominal yield minus real yield."],
  ['Fed funds rate', 'The overnight rate the Fed sets; the anchor for short-term rates.'],
];

/* ---------------- conversation ---------------- */
function Thread({ messages, thinking }) {
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest' }); }, [messages, thinking]);
  return (
    <div className="thread">
      {messages.map((m, i) => (
        <div key={i} className={'bubble ' + (m.role === 'user' ? 'me' : 'tutor')}>
          <span className="who">{m.role === 'user' ? 'You' : 'Claude'}</span>{m.text ?? m.content}
        </div>
      ))}
      {thinking && <div className="thinking">Claude is thinking
        <span className="dots"><span /><span /><span /></span></div>}
      <div ref={endRef} />
    </div>
  );
}

/* The seed message is the market snapshot; it primes the model but is never
   shown, so the transcript starts with Claude's first question. */
function Conversation({ endpoint, seed, greeting, placeholder, onProgress, onReset }) {
  const [wire, setWire] = useState(seed);          // what the API sees
  const [shown, setShown] = useState(greeting ? [{ role: 'assistant', text: greeting }] : []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const started = useRef(false);

  const exchange = async (nextWire) => {
    setBusy(true);
    try {
      const j = await postJSON(endpoint, { messages: nextWire });
      const { text, changed } = absorbMarkers(j.content);
      setWire([...nextWire, { role: 'assistant', content: j.content }]);
      setShown((s) => [...s, { role: 'assistant', text }]);
      if (changed) onProgress?.();
    } catch (e) {
      setShown((s) => [...s, { role: 'assistant', text: 'Something went wrong: ' + e.message }]);
    } finally { setBusy(false); }
  };

  // A quiz opens with Claude's first question; ask-mode opens with a greeting.
  useEffect(() => {
    if (started.current || greeting) return;
    started.current = true;
    exchange(seed);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const send = (e) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    const nextWire = [...wire, { role: 'user', content: text }];
    setWire(nextWire);
    setShown((s) => [...s, { role: 'user', text }]);
    setInput('');
    exchange(nextWire);
  };

  return <>
    <Thread messages={shown} thinking={busy} />
    <form className="chat-form" onSubmit={send}>
      <textarea rows={2} value={input} placeholder={placeholder} disabled={busy}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) send(e); }} />
      <button type="submit" className="btn" disabled={busy || !input.trim()}>Send</button>
    </form>
    <button className="btn ghost small" style={{ marginTop: 10 }} onClick={onReset}>End session</button>
  </>;
}

/* ---------------- left rail ---------------- */
function ProgressPanel({ tick }) {
  const results = loadResults();
  const review = loadReviewTopics();
  const streak = currentStreak(results);
  const last = results[results.length - 1];
  const best = results.reduce((b, r) => (r.total && r.score / r.total > b ? r.score / r.total : b), 0);

  if (!results.length) {
    return <p className="muted small">No quizzes yet. Your streak, scores and the topics
      you keep missing will show up here once you finish one.</p>;
  }
  return <>
    <div className="tiles">
      <div className="stat"><span className="label">Streak</span><span className="num">{streak}</span>
        <span className="delta flat">{streak === 1 ? 'day' : 'days'}</span></div>
      <div className="stat"><span className="label">Last score</span>
        <span className="num">{last.score}/{last.total}</span><span className="delta flat">{last.date}</span></div>
      <div className="stat"><span className="label">Taken</span><span className="num">{results.length}</span>
        <span className="delta flat">quizzes</span></div>
      <div className="stat"><span className="label">Best</span>
        <span className="num">{Math.round(best * 100)}%</span><span className="delta flat">accuracy</span></div>
    </div>
    {review.length > 0 && <>
      <div className="kicker" style={{ marginTop: 12 }}>Reviewing</div>
      <div className="quiz-progress">
        {review.slice(0, 8).map((t) => <span className="qp-item qp-review" key={t}>{t}</span>)}
      </div>
      <p className="muted small note">These get woven into your next quiz automatically.</p>
    </>}
  </>;
}

/* ---------------- view ---------------- */
export function Learn() {
  // Nothing to wait for: the tutor is conversational and every panel renders
  // from local state. Reported anyway, so the cover lifts on this surface
  // rather than sitting until the ceiling.
  useBootGate('learn', true);
  const [mode, setMode] = useState('quiz');
  const [session, setSession] = useState(null);     // { kind, seed, greeting }
  const [loading, setLoading] = useState('');
  const [article, setArticle] = useState('');
  const [tick, setTick] = useState(0);

  const start = async (kind) => {
    setLoading('Gathering today’s market data and headlines…');
    try {
      let context = await buildQuizContext();
      const review = loadReviewTopics();
      if (kind === 'quiz' && review.length) {
        context += `\n\nREVIEW FROM LAST TIME (weave in one or two questions on these, the person has struggled with them): ${review.join('; ')}.`;
      }
      setSession(kind === 'quiz'
        ? { kind, endpoint: '/api/quiz', seed: [{ role: 'user', content: context }] }
        : { kind, endpoint: '/api/ask', seed: [{ role: 'user', content: context }],
            greeting: 'Ask me anything about today’s markets, the indicators, or the headlines. What would you like to know?' });
    } catch (e) {
      setLoading('Couldn’t gather data: ' + e.message);
      return;
    }
    setLoading('');
  };

  const reset = () => { setSession(null); setArticle(''); setTick((n) => n + 1); };

  const centre = () => {
    if (mode === 'tutor') {
      if (session?.kind === 'tutor') {
        return <Conversation endpoint="/api/claude" seed={session.seed}
                             placeholder="Type your answer…" onReset={reset} />;
      }
      return <>
        <label className="field-label" htmlFor="article-input">Paste an article or newsletter</label>
        <textarea id="article-input" rows={12} value={article} onChange={(e) => setArticle(e.target.value)}
                  placeholder="Paste the full text here and Claude will work through it with you…" />
        <button className="btn" disabled={!article.trim()}
                onClick={() => setSession({ kind: 'tutor', endpoint: '/api/claude', seed: [{ role: 'user', content: article.trim() }] })}>
          Start walkthrough
        </button>
      </>;
    }
    if (session) {
      return <Conversation endpoint={session.endpoint} seed={session.seed} greeting={session.greeting}
                           placeholder={session.kind === 'ask' ? 'Ask a question…' : 'Type your answer…'}
                           onProgress={() => setTick((n) => n + 1)} onReset={reset} />;
    }
    return <>
      <p className="muted small">Both modes are built live from the data on screen — the same levels,
        weekly changes and headlines the rest of the dashboard is showing.</p>
      <div className="quiz-actions">
        <button className="btn" disabled={!!loading} onClick={() => start('quiz')}>Start today's quiz</button>
        <button className="btn ghost" disabled={!!loading} onClick={() => start('ask')}>Ask a question</button>
      </div>
      {loading && <div className="muted small" style={{ marginTop: 10 }}>{loading}</div>}
    </>;
  };

  return (
    <section className="view is-active ws ws-learn">
      <div className="col col-left">
        <Panel swatch="a" title="Progress" compact><ProgressPanel tick={tick} /></Panel>
        <Panel swatch="a" title="What the session sees">
          <p className="muted small">A market snapshot is assembled and sent as context each time you
            start: rates and the curve, credit spreads, equities and volatility, FX, commodities and
            macro — each with its one-week change — plus today's top headlines.</p>
          <p className="muted small note">Runs on the Claude Agent SDK using your Claude Max plan.</p>
        </Panel>
      </div>

      <div className="col col-center">
        <Panel swatch="b" title={mode === 'quiz' ? 'Daily quiz' : 'Article tutor'} tools={
          <div className="seg">
            <button className={mode === 'quiz' ? 'is-active' : ''}
                    onClick={() => { setMode('quiz'); setSession(null); }}>Quiz</button>
            <button className={mode === 'tutor' ? 'is-active' : ''}
                    onClick={() => { setMode('tutor'); setSession(null); }}>Tutor</button>
          </div>}>
          {centre()}
        </Panel>
      </div>

      <div className="col col-right">
        <Panel swatch="c" title="Key terms">
          {GLOSSARY.map(([term, def]) => (
            <div className="gloss-item" key={term}>
              <span className="gloss-term">{term}</span><span className="gloss-def">{def}</span>
            </div>
          ))}
        </Panel>
      </div>
    </section>
  );
}
