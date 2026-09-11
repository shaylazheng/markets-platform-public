import { useEffect, useMemo, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { fetchNews } from '@markets/shell/lib/api.js';
import { InsightButton } from '@markets/shell/components/InsightButton.jsx';
import { InsightPanel } from '@markets/shell/components/InsightPanel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';

export function News() {
  const { nonce } = useApp();
  const [state, setState] = useState({ items: null, error: null });
  const [theme, setTheme] = useState('All');

  useEffect(() => {
    let alive = true;
    setState({ items: null, error: null });
    fetchNews()
      .then((j) => alive && setState({ items: j.items || [], error: null }))
      .catch((e) => alive && setState({ items: [], error: e }));
    return () => { alive = false; };
  }, [nonce]);

  // Usable when the wire has resolved — including to an empty list or an
  // error, both of which the panels below render perfectly well.
  useBootGate('news', state.items !== null || !!state.error, { what: 'headlines' });

  const items = state.items || [];
  const themes = useMemo(() => ['All', ...new Set(items.flatMap((i) => i.themes || []))], [items]);
  /* Separate axis from the theme chips — "touches the book" cuts across every
     theme, so it toggles rather than joining the mutually-exclusive row. */
  const [bookOnly, setBookOnly] = useState(false);
  const bookCount = items.filter((i) => i.holdings?.length).length;
  const shown = items
    .filter((i) => theme === 'All' || i.themes?.includes(theme))
    .filter((i) => !bookOnly || i.holdings?.length);

  return (
    <section className="view is-active ws ws-news">
      <div className="col col-left">
        <Panel swatch="a" title="Filters">
          <div className="news-filters">
            {themes.map((t) => (
              <button key={t} type="button" className={'chip' + (t === theme ? ' is-active' : '')}
                      aria-pressed={t === theme} onClick={() => setTheme(t)}>{t}</button>
            ))}
          </div>
          <button type="button" className={'book-toggle' + (bookOnly ? ' is-on' : '')}
                  aria-pressed={bookOnly} disabled={!bookCount}
                  onClick={() => setBookOnly((v) => !v)}>
            <span className="book-dot" aria-hidden="true" />
            In my book
            <span className="book-toggle-n">{bookCount}</span>
          </button>
          <div className="asof">{state.items === null ? 'Loading…' : `${shown.length} of ${items.length} headlines.`}</div>
        </Panel>
        <InsightPanel />
      </div>
      <div className="col col-center">
        <Panel swatch="b" title="Newswire" flush>
          <div className="news-list">
            {state.items === null && <div className="news-loading">Loading headlines…</div>}
            {state.error && <div className="news-error">Couldn’t load the newswire: {state.error.message}</div>}
            {shown.map((it) => (
              <div className={'news-item' + (it.holdings?.length ? ' is-book' : '')} key={it.link + it.title}>
                <div className="news-meta">
                  <span className="src">{it.source}</span>
                  {it.holdings?.map((t) => (
                    <span className="hold-badge" key={t} title={`${t} is an open position in your book`}>
                      <span className="book-dot" aria-hidden="true" />{t}
                    </span>
                  ))}
                  {it.themes?.map((t) => <span className="ntag" key={t}>{t}</span>)}
                  <span className="ntime">{it.when || ''}</span>
                </div>
                <a className="news-title" href={/^https?:\/\//.test(it.link) ? it.link : '#'}
                   target="_blank" rel="noopener noreferrer">{it.title}</a>
                {it.summary && <div className="news-summary">{it.summary}</div>}
                <InsightButton
                  id={'article:' + it.link}
                  title={it.title}
                  meta={`${it.source}${it.themes?.length ? ' · ' + it.themes[0] : ''}`}
                  payload={{ kind: 'article', article: {
                    title: it.title, source: it.source, summary: it.summary, themes: it.themes,
                  } }} />
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
