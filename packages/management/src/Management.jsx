/* Management — who runs this company, how long they have been there, and what
 * changed.
 *
 * The surface is built on one honest, unglamorous idea: nobody publishes a
 * machine-readable org chart, but every officer and director must file a Form 3
 * when they arrive and a Form 4 when they trade, and both name them and state
 * their title. The roster is a by-product of an insider-trading disclosure
 * regime, which is exactly why it is trustworthy — a company that quietly
 * swaps its CFO still has to file.
 *
 * Two things it deliberately does NOT show, and says so on the page:
 *   - Pay. It lives in the proxy as prose and as `ecd:` inline XBRL that SEC's
 *     companyfacts API does not aggregate. The proxy is linked instead.
 *   - A start date for anyone we did not watch arrive. See `Tenure` below.
 *
 * Layout follows Valuation's Console, which is the chosen design for this
 * group: a sticky rail holding the input and the provenance, results to the
 * right.
 */
import { Fragment, useEffect, useState } from 'react';
import { Panel } from '@markets/shell/components/Panel.jsx';
import { useApp } from '@markets/shell/lib/store.jsx';
import { useBootGate } from '@markets/shell/lib/useBootGate.js';
import { hashParam, hashView } from '@markets/shell/lib/hash.js';
import { SourceInspector, SrcButton } from '@markets/shell/components/SourceInspector.jsx';
import { useRegistry } from '@markets/shell/lib/registry.jsx';
import { CompanyRail } from '@markets/shell/components/CompanyRail.jsx';
import { moneyShort } from '@markets/shell/lib/format.js';
import { defaultRows, describe, sourcesFor } from './managementSources.js';

function useManagement(ticker, nonce, injected) {
  const [s, setS] = useState({ data: injected || null, loading: !injected, error: null });
  useEffect(() => {
    if (injected || !ticker) return;
    let live = true;
    setS((p) => ({ ...p, loading: true }));
    fetch(`/api/management?ticker=${encodeURIComponent(ticker)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((d) => live && setS({ data: d, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [ticker, nonce, injected]);
  return s;
}

const yrs = (n) => (n == null ? null : `${n.toFixed(1)}y`);
const shares = (n) => (n == null ? '—' : Number(n).toLocaleString());

/* Career history and press for one person — fetched only when their row is
   opened, because it is a proxy fetch, a model call and a Google search, and
   nobody wants to pay for twelve of those to read a roster. */
function useBackground(ticker, cik, open) {
  const [s, setS] = useState({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!open || !ticker || !cik) return;
    let live = true;
    setS({ data: null, loading: true, error: null });
    fetch(`/api/management/background?ticker=${encodeURIComponent(ticker)}&cik=${encodeURIComponent(cik)}`)
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`); return j; })
      .then((d) => live && setS({ data: d, loading: false, error: null }))
      .catch((e) => live && setS({ data: null, loading: false, error: e.message }));
    return () => { live = false; };
  }, [ticker, cik, open]);
  return s;
}

/* Tenure is the one number here that can lie, so it is the one with a rule.
 *
 * We only claim a start date when a Form 3 was actually read — that is the
 * filing someone makes on becoming an insider, so it IS the appointment. Where
 * the fetch window did not reach back far enough, the earliest filing we happen
 * to have seen is not a start date and is labelled "seen since", with a marker
 * that says the real one is earlier. Terrence Duffy has run CME since 2002 and
 * the naive version reported him as a 2025 arrival. */
function Tenure({ p }) {
  /* Seen exactly once: a Form 3 and nothing after it. There is no span to
     measure, and the person may have served twenty years. */
  if (p.since && p.tenureYears == null) {
    return (
      <span className="mg-tenure is-censored"
            title={`Only one ownership filing of theirs was read (${p.since}), so there is no span to measure. It is not a short tenure — it is an unmeasured one.`}>
        <b>—</b>
        <span className="mg-tenure-since">one filing, {p.since}</span>
      </span>
    );
  }
  if (p.since) {
    return (
      <span className="mg-tenure"
            title={p.until
              ? `Form 3 filed ${p.since}; last ownership filing read ${p.until}. That is a LOWER BOUND on the service — they may have stayed longer without trading, and later filings may sit outside the window read.`
              : `Form 3 filed ${p.since} — the filing made on becoming an insider`}>
        <b>{p.tenureIsLowerBound ? '≥ ' : ''}{yrs(p.tenureYears)}</b>
        <span className="mg-tenure-since">
          {p.since}{p.until ? ` – ${p.until}` : ' –'}
        </span>
      </span>
    );
  }
  return (
    <span className="mg-tenure is-censored"
          title={`No Form 3 within the filings read, so the appointment date is earlier than ${p.seenSince} and unknown. This is the oldest filing of theirs on file here, not a start date.`}>
      <b>≥ {p.seenSince?.slice(0, 4)}</b>
      <span className="mg-tenure-since">seen since {p.seenSince}</span>
    </span>
  );
}

/* What this person did with the shares, split by what the transaction MEANS.
 *
 * The split is the point. An officer who is granted 40,000 shares and has
 * 18,000 withheld to pay the tax on them has made no decision — that is payroll
 * paid in stock. An officer who buys in the open market with their own money
 * has made the one insider trade the literature has ever found predictive.
 * A single "net shares" figure blends the two and is read as the second.
 */
function Movement({ t, ticker, name, srcBtn }) {
  if (!t?.hasAny) {
    return <p className="mg-foot">No Table I share movement in the filings read for this person. {srcBtn}</p>;
  }
  const om = t.openMarket;
  const net = t.netOpenMarket;

  return (
    <div className="mg-move">
      <div className="mg-move-grid">
        <div className="mg-move-cell">
          <span className="mg-move-k">Open market {srcBtn}</span>
          {om.trades ? (
            <>
              <b className={net > 0 ? 'is-buy' : net < 0 ? 'is-sell' : ''}>
                {net === 0 ? '—' : `${net > 0 ? '+' : '−'}${moneyShort(Math.abs(net))}`}
              </b>
              <span className="mg-move-sub">
                {om.boughtShares ? `${shares(om.boughtShares)} bought` : null}
                {om.boughtShares && om.soldShares ? ' · ' : null}
                {om.soldShares ? `${shares(om.soldShares)} sold` : null}
                {!om.boughtShares && !om.soldShares ? `${om.trades} trades` : null}
              </span>
            </>
          ) : (
            <>
              <b className="mg-dim">none</b>
              <span className="mg-move-sub">bought and sold nothing on their own account</span>
            </>
          )}
        </div>

        <div className="mg-move-cell">
          <span className="mg-move-k" title="Grants, option exercises and shares withheld to cover the tax on them. Compensation mechanics, not decisions.">
            Compensation
          </span>
          <b>{t.comp.received ? `+${shares(t.comp.received)}` : '—'}</b>
          <span className="mg-move-sub">
            {t.comp.withheld ? `${shares(t.comp.withheld)} withheld for tax` : `${t.comp.trades} filings`}
          </span>
        </div>

        <div className="mg-move-cell">
          <span className="mg-move-k">Holding after last filing</span>
          <b>{shares(t.sharesAfter)}</b>
          <span className="mg-move-sub">
            {t.lastTrade ? `as at ${t.lastTrade}` : 'not stated'}
            {t.sharesAfter != null && ' · directly held'}
          </span>
        </div>
      </div>

      {t.jointTrades > 0 && (
        <p className="mg-foot">
          <b>{t.jointTrades}</b> transaction{t.jointTrades === 1 ? '' : 's'} across{' '}
          {t.jointFilings} joint filing{t.jointFilings === 1 ? '' : 's'} are excluded from
          the totals above. A Form 4 naming several related parties reports one set of
          trades made collectively, and splitting those shares between the co-filers would
          be inventing an attribution the filing does not make.
        </p>
      )}

      {t.recent.length > 0 && (
        <table className="mg-table mg-trades">
          <thead>
            <tr>
              <th className="mg-l">Date</th><th className="mg-l">What</th>
              <th>Shares</th><th>Price</th><th>Value</th><th className="mg-l">Filing</th>
            </tr>
          </thead>
          <tbody>
            {t.recent.map((x, i) => (
              <tr key={`${x.accn}-${i}`} className={`is-${x.kind}`}>
                <td className="mg-l mg-num">{x.date || x.filed}</td>
                <td className="mg-l">
                  <span className={`mg-code is-${x.kind}`} title={`Transaction code ${x.code}`}>{x.code}</span>
                  {x.label}
                  {x.acquired === false ? ' (disposed)' : x.acquired === true ? ' (acquired)' : ''}
                  {!x.direct && <span className="mg-badge" title="Held indirectly — in a trust or family partnership">indirect</span>}
                </td>
                <td className="mg-num">{shares(x.shares)}</td>
                {/* A missing price is blank, never $0 — several codes carry no
                    price at all and a zero would value a real transfer at zero. */}
                <td className="mg-num">{x.price == null ? <span className="mg-dim">—</span> : `$${x.price.toFixed(2)}`}</td>
                <td className="mg-num">{x.value == null ? <span className="mg-dim">—</span> : moneyShort(x.value)}</td>
                <td className="mg-l"><a href={x.url} target="_blank" rel="noreferrer">{x.form || '4'}</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="mg-foot">
        These are the Table I movements in the ownership filings this surface read —
        the same filings the roster was built from, so the window is the one stated in
        the rail. Derivative transactions (Table II) are excluded: an option grant and
        its later exercise both appear there, and counting them alongside the share
        movement reports the same award twice.{' '}
        <a className="mg-link" href={`#insider&ticker=${encodeURIComponent(ticker)}&insider_name=${encodeURIComponent(name)}`}>
          Every filing of theirs, on the Insider screener →
        </a>{' '}
        That surface reads the full Form 4 database rather than this window, so it is
        the place to check whether anything sits outside it.
      </p>
    </div>
  );
}

/** Career history and press. Renders nothing at all when neither is found. */
function Background({ ticker, person, open, sel, setSel }) {
  const { data, loading, error } = useBackground(ticker, person.cik, open);

  if (loading) return <p className="mg-foot">Reading the proxy and searching for coverage…</p>;
  if (error) return <p className="mg-foot">Background unavailable: {error}</p>;
  if (!data) return null;

  const hasBio = !!data.bio;
  const hasNews = data.news?.length > 0;
  if (!hasBio && !hasNews) {
    return (
      <p className="mg-foot">
        No career history found for them in the proxy, and no coverage naming them.
        {!data.newsOk && ' (The headline search did not answer, so that half is unknown rather than empty.)'}
      </p>
    );
  }

  return (
    <div className="mg-bg">
      {hasBio && (
        <div className="mg-bio">
          <h4 className="mg-bg-h">Before this role</h4>
          {data.bio.roles?.length > 0 && (
            <ul className="mg-roles">
              {data.bio.roles.map((r, i) => (
                <li key={i}>
                  <b>{r.org}</b>
                  {r.role && <span className="mg-role-t"> — {r.role}</span>}
                  {r.period && <span className="mg-role-p"> · {r.period}</span>}
                </li>
              ))}
            </ul>
          )}
          {/* The quote is the evidence, not decoration: it is checked to be a
              verbatim substring of the filing server-side, and anything that
              fails that check never reaches here. */}
          <blockquote className="mg-quote">{data.bio.quote}</blockquote>
          <p className="mg-foot">
            {data.bio.kind === 'proxy'
              ? <>Quoted verbatim from <a href={data.bio.source.url} target="_blank" rel="noreferrer">{data.bio.source.label}</a>.
                  Nothing here is paraphrased — a passage that could not be matched back to
                  the filing word for word is discarded rather than shown.</>
              : <>From <a href={data.bio.source.url} target="_blank" rel="noreferrer">{data.bio.source.label}</a>,
                  used only because the proxy carried no career history for them. Shown only
                  because that article names this company independently, which is the check
                  that stops a namesake being presented as this person.</>}
            {' '}
            <SrcButton sel={{ kind: 'bio', key: `bio:${person.cik}`, person, bio: data.bio }}
                       current={sel} onSelect={setSel} />
          </p>
        </div>
      )}

      {hasNews && (
        <div className="mg-news">
          <h4 className="mg-bg-h">In the press</h4>
          <ul className="mg-stories">
            {data.news.map((n, i) => (
              <li key={i}>
                <a href={n.url} target="_blank" rel="noreferrer">{n.title}</a>
                <span className="mg-story-m">
                  {n.source}{n.date ? ` · ${String(n.date).slice(0, 10)}` : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="mg-foot">
            Headline search for “{data.searchedAs}” alongside the company name, filtered to
            stories that name them in the headline. A search engine's guess at which person
            you meant is not a disclosure — treat these as leads, not as facts about them.
          </p>
        </div>
      )}
    </div>
  );
}

/* What this person did in the last 60 days: net open-market dollars, and the
 * change in the shares they hold outright.
 *
 * The two are deliberately different measures and are shown as such. Dollars
 * are open-market ONLY — a grant is not a decision and a tax withholding is not
 * a sale, so folding either in would report someone who bought and sold nothing
 * as having moved six figures. The percentage is the whole balance, grants
 * included, because a grant genuinely changes what they own.
 *
 * A person with no filings in the window gets a dash, not a zero. "Did nothing"
 * and "we have no record" look identical as 0 and are not the same claim.
 */
function Window60({ p, covered }) {
  const w = p.window;
  if (!w || !w.trades) {
    return <span className="mg-w-none" title="No ownership filing from this person in the window.">—</span>;
  }
  const dirn = (v) => (v > 0 ? 'up' : v < 0 ? 'down' : 'flat');
  const money = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${moneyShort(Math.abs(v))}`;

  return (
    <span className="mg-w">
      <span className={'mg-w-val is-' + dirn(w.netValue)}
            title={w.openMarketTrades
              ? `${w.openMarketTrades} open-market trade(s): bought ${moneyShort(w.bought)}, sold ${moneyShort(w.sold)}.`
              : 'No open-market trade in the window — the filings here are grants, withholdings or exercises, which carry no decision.'}>
        {w.openMarketTrades ? money(w.netValue) : <span className="mg-dim">no trade</span>}
        {w.valueIsMostlyIndirect && (
          <span className="mg-w-ind"
                title="Most of this moved through an indirect holding — a trust or a family partnership. Still their money, but reported on its own running balance, so the percentage beside it does not see it. The two figures are measuring different pools.">
            ind
          </span>
        )}
      </span>
      <span className={'mg-w-pct is-' + dirn(w.ownPct)}
            title={w.ownPct == null
              ? (w.sharesStart === 0
                  ? 'They held nothing directly at the start of the window, so there is no base to take a percentage of.'
                  : 'No directly-held balance stated in the window — the filings are indirect holdings, which are reported on their own running total.')
              : `${w.sharesStart.toLocaleString()} → ${w.sharesEnd.toLocaleString()} shares held directly.`}>
        {w.ownPct == null
          ? <span className="mg-dim">—</span>
          : `${w.ownPct > 0 ? '+' : ''}${w.ownPct.toFixed(1)}%`}
      </span>
      {!covered && <span className="mg-w-partial" title="More ownership filings were made in this window than the pipeline reads, so this is a floor, not a total.">≥</span>}
    </span>
  );
}

function Roster({ title, people, empty, swatch, covered = true, expandable = false, ticker, open = null, setOpen, sel, setSel }) {
  return (
    <Panel title={title} swatch={swatch} flush
           headExtra={<span className="mg-head-meta">{people.length}</span>}>
      {people.length ? (
        <table className="mg-table">
          <thead>
            <tr>
              <th className="mg-l">Name</th>
              <th className="mg-l">Title as filed</th>
              <th>Tenure</th>
              <th title="Net open-market value, and change in directly-held shares, over the last 60 days">
                Last 60d
              </th>
              <th>Filings</th>
              <th className="mg-l">Status</th>
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const id = p.cik || p.name;
              const isOpen = expandable && open === id;
              return (
              <Fragment key={id}>
              <tr
                  className={`${p.status === 'lapsed' ? 'is-lapsed' : ''}${expandable ? ' is-openable' : ''}${isOpen ? ' is-open' : ''}`}>
                <td className="mg-l mg-name">
                  {expandable ? (
                    <button type="button" className="mg-disclose"
                            aria-expanded={isOpen}
                            onClick={() => setOpen(isOpen ? null : id)}>
                      <span className="mg-caret" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>
                      {p.name}
                    </button>
                  ) : p.name}
                  {p.isTenPercent && <span className="mg-badge" title="Also a 10% owner">10%</span>}
                  <SrcButton sel={{ kind: 'person', key: `person:${id}`, p }}
                             current={sel} onSelect={setSel} />
                </td>
                <td className="mg-l mg-title">{p.title || <span className="mg-dim">—</span>}</td>
                <td><Tenure p={p} /></td>
                <td className="mg-num">
                  <Window60 p={p} covered={covered} />
                  <SrcButton sel={{ kind: 'window', key: `window:${id}`, p }}
                             current={sel} onSelect={setSel} />
                </td>
                <td className="mg-num" title={`${p.filings} ownership filings read · forms ${p.forms.join(', ')}`}>
                  {p.filings}
                </td>
                <td className="mg-l">
                  {p.status === 'current'
                    ? <span className="mg-status is-current">current</span>
                    : <span className="mg-status is-lapsed"
                            title={`No ownership filing for ${p.monthsSinceFiling} months. They have probably left — but a director who simply has not traded also stops filing, so this is an inference, not a fact.`}>
                        quiet {Math.round(p.monthsSinceFiling)}m
                      </span>}
                </td>
              </tr>
              {isOpen && (
                <tr className="mg-detail-row">
                  <td colSpan={6}>
                    <div className="mg-detail">
                      <Movement t={p.trades} ticker={ticker} name={p.name}
                                srcBtn={<SrcButton sel={{ kind: 'movement', key: `movement:${id}`, p }}
                                                   current={sel} onSelect={setSel} />} />
                      <Background ticker={ticker} person={p} open={isOpen} sel={sel} setSel={setSel} />
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            );})}
          </tbody>
        </table>
      ) : <div className="mg-empty">{empty}</div>}
    </Panel>
  );
}

export function Management({ injected }) {
  const { nonce, company: ticker, setCompany: setTicker } = useApp();
  const registry = useRegistry();
  const { data, loading, error } = useManagement(ticker, nonce, injected);
  useBootGate('management', !!data || !!error, { what: 'ownership filings' });

  /* One selection for the whole surface, as Competitors keeps one — a roster
     row, a 60-day cell and an 8-K row all drive the same inspector. Cleared
     when the company changes, because a selection naming the old company would
     otherwise sit there looking current. */
  const [sel, setSel] = useState(null);
  useEffect(() => { setSel(null); }, [ticker]);

  /* Which officer's row is open lives in the hash, not in component state
     alone: it makes a person linkable ("look at the CFO's trades"), it survives
     a reload, and it is the only way the headless screenshotter — which cannot
     click — can photograph an expanded row. */
  const [openPerson, setOpenPerson] = useState(() => hashParam('who'));

  // A different company's roster does not contain this person.
  useEffect(() => { setOpenPerson(hashView() === 'management' ? hashParam('who') : null); }, [ticker]);

  useEffect(() => {
    if (hashView() !== 'management') return;
    const who = openPerson ? `&who=${encodeURIComponent(openPerson)}` : '';
    history.replaceState(null, '', `#management&ticker=${encodeURIComponent(ticker)}${who}`);
  }, [ticker, openPerson]);

  const rail = (
    <div className="mg-rail">
      <CompanyRail
        view="management"
        ticker={data?.ticker || ''}
        name={data?.name}
        sub={data?.sic}
        busy={loading}
        onSubmit={setTicker}
        facts={data ? [
          { label: 'Officers', value: data.counts.officers,
            sub: `${data.officers.length} seen`, title: 'Currently filing' },
          { label: 'Board', value: data.counts.directors,
            sub: `${data.directors.length} seen` },
          { label: '5.02 events', value: data.turnover.length,
            sub: `${data.turnoverWindowYears}y window`,
            title: 'Departure or appointment of directors and principal officers' },
        ] : []}
        note={data && (
          <>
            Read <b>{data.coverage.ownershipFilingsRead}</b> of{' '}
            <b>{data.coverage.ownershipFilingsTotal}</b> ownership filings
            {data.coverage.oldestRead && <> — back to {data.coverage.oldestRead}</>}.
            {data.coverage.truncated && <> Anyone who arrived before that shows a censored start.</>}
            {data.coverage.unreadable > 0 && <> {data.coverage.unreadable} could not be parsed.</>}
          </>
        )}
      />
      {data && (
        <Panel swatch="c" title="Sources" flush>
          <SourceInspector
            sel={sel} onClose={() => setSel(null)}
            d={describe(sel, data)} sources={sourcesFor(sel, data)}
            defaults={defaultRows(data, registry.sources.management || [])} />
        </Panel>
      )}
    </div>
  );

  const shell = (b) => (
    <section className="view is-active mg-surface">
      {rail}
      <div className="mg-main">{b}</div>
    </section>
  );

  if (error) return shell(<Panel title="Management" swatch="a"><div className="mg-empty"><p>{error}</p></div></Panel>);
  if (loading && !data) return shell(<Panel title="Management" swatch="a"><div className="mg-empty"><p>Reading ownership filings…</p></div></Panel>);
  if (!data) return shell(null);

  return shell(
    <>
      {/* Officers alone are expandable. A board of twelve non-executives would
          add twelve proxy extractions and twelve headline searches to a surface
          whose question is "who runs this company", and the answer to that is
          the officer list. */}
      <Roster title="Officers" swatch="a" people={data.officers} covered={data.window?.covered !== false} expandable ticker={data.ticker}
              open={openPerson} setOpen={setOpenPerson} sel={sel} setSel={setSel}
              empty="No officer has filed an ownership form in the window read." />

      <Roster title="Board" swatch="b" people={data.directors} covered={data.window?.covered !== false}
              sel={sel} setSel={setSel}
              empty="No director has filed an ownership form in the window read." />

      {data.others.length > 0 && (
        <Roster title="Other reporting owners" swatch="c" people={data.others} covered={data.window?.covered !== false}
                sel={sel} setSel={setSel}
                empty="" />
      )}

      <Panel title={`Management changes — 8-K Item 5.02, last ${data.turnoverWindowYears} years`} swatch="c" flush>
        {data.turnover.length ? (
          <>
            <table className="mg-table">
              <thead><tr><th className="mg-l">Filed</th><th className="mg-l">Items</th><th className="mg-l">Filing</th></tr></thead>
              <tbody>
                {data.turnover.map((t) => (
                  <tr key={t.accn}>
                    <td className="mg-l mg-num">{t.filed}</td>
                    <td className="mg-l">
                      <span className="mg-item">5.02</span>
                      {t.alsoFinancial && <span className="mg-item is-alt" title="Reported alongside results">+ results</span>}
                      <SrcButton sel={{ kind: 'turnover', key: `turnover:${t.accn}`, t }}
                                 current={sel} onSelect={setSel} />
                    </td>
                    <td className="mg-l">
                      <a href={t.url} target="_blank" rel="noreferrer">{t.accn}</a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mg-foot">
              Item 5.02 is "Departure of Directors or Certain Officers; Election of
              Directors; Appointment of Certain Officers". SEC's index carries the
              item number but not the sub-item, so <b>whether each of these is an
              arrival or a departure is not machine-readable</b> — the filing is
              linked rather than guessed at. A cluster of them is the signal worth
              having either way.
            </p>
          </>
        ) : <div className="mg-empty">No Item 5.02 filings in the window.</div>}
      </Panel>

      <Panel title="What is not here" swatch="b">
        <p className="mg-foot">
          <b>Compensation.</b> It is disclosed in the proxy, partly as prose and
          partly as <code>ecd:</code> inline XBRL — a namespace SEC's companyfacts
          API does not aggregate, so there is no structured feed to read it from.
          Pulling a dollar figure out of proxy prose is the same class of guess the
          graph's concentration parser was rewritten to refuse, and it was wrong on
          three of four real sentences before it was made to decline. So:{' '}
          {data.documents.proxy
            ? <>
                <a href={data.documents.proxy.url} target="_blank" rel="noreferrer">
                  the {data.documents.proxy.form} filed {data.documents.proxy.filed}
                </a>
                {' '}
                <SrcButton sel={{ kind: 'doc', key: 'doc:proxy', doc: data.documents.proxy, which: 'proxy' }}
                           current={sel} onSelect={setSel} />
              </>
            : 'no proxy on file'}, where the number actually is.
        </p>
        <p className="mg-foot">
          <b>Board independence, committee seats and skills.</b> Proxy prose, same
          reasoning. <b>Departures.</b> Not a filing — inferred from silence above,
          and marked as an inference.
        </p>
        <p className="mg-foot">
          <b>Career history is the one exception, and it is fenced.</b> Opening an
          officer's row reads the proxy for the passage describing their previous
          roles. That is prose, so it is quoted rather than summarised: the passage is
          checked to be a word-for-word substring of the filing before it is shown, and
          a model answer that fails that check is discarded whole rather than displayed
          with a caveat. The same rule kills invented employers — an organisation is
          listed only if it appears inside the quote. Where the proxy carries no such
          passage, nothing is shown; a Wikipedia article is used only when it names this
          company independently, which is what stops a namesake being presented as them.
        </p>
      </Panel>
    </>
  );
}
