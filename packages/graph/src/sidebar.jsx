// sidebar.jsx — the app's detail panel as a React island (final design from the
// sidebar labs): header → proximity-tiered next-earnings banner → Overview /
// Timeline / Relations tabs → pinned Sources inspector with real EDGAR links.
// Mounted once by main.js; main.js calls .show(props) on every selection change.
import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { fmtMetric } from "./metricFormat.js";

const fmtUSD = (n) => (n == null ? "—" : n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${n}`);
const neg = (s) => String(s).includes("-");
const pct = (s) => parseFloat(String(s).replace(/[^-\d.]/g, "")) || 0;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDate = (s) => {
 const m = String(s).match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
 return m ? (m[3] ? `${MONTHS[+m[2] - 1]} ${+m[3]}, ${m[1]}` : `${MONTHS[+m[2] - 1]} ${m[1]}`) : s;
};
const daysUntil = (d) => {
 const m = String(d).match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
 return m ? Math.ceil((new Date(+m[1], +m[2] - 1, +(m[3] || 15)) - Date.now()) / 864e5) : null;
};
const inDays = (d) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`);
const extractQuote = (t = "") => (t.match(/'([^']{12,140})'|“([^”]{12,140})”/) || [])[1] || null;

/* ---------- provenance ---------- */
const TYPE_STYLE = {
  Recorded: "gr-fill-pos gr-pos gr-line-pos",
 "SEC filing": "gr-fill-pos gr-pos gr-line-pos",
 "Market data": "gr-fill-info gr-info gr-line-info",
 "News search": "gr-fill-warn gr-warn gr-line-warn",
  Wikipedia: "gr-fill-info gr-info gr-line-info",
  Wikidata: "gr-fill-info gr-info gr-line-info",
};
const shortName = (s = "") => s.split(/,| Inc\.?| Corp| CORP| Co\b| Ltd| LTD| PLC| NV| SE|\/|\(/)[0].trim();
const shiftDate = (iso, days) => {
 const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
 if (!m) return null;
 return new Date(new Date(+m[1], +m[2] - 1, +m[3]).getTime() + days * 864e5).toISOString().slice(0, 10);
};
function srcsFor(it, node, intel, SRC) {
 const out = [];
 if (it.item?.src) out.push({ type: "Recorded", label: "Primary source recorded at research time", url: it.item.src, truth: true });
 const filing = (f, label, truth) => f && out.push({ type: "SEC filing", label: `${label} · ${f.form}, ${fmtDate(f.filed)}`, url: f.url, truth });
 const edgarAll = () => node.cik && out.push({ type: "SEC filing", label: "All company filings on EDGAR", url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${node.cik}` });
 const ir = () => SRC?.ir && out.push({ type: "Investor page", label: "Investor relations — earnings calls & materials", url: SRC.ir });
  // date-scoped news search when the claim has a date: dramatically better reproducibility
 const news = (q, aroundDate) => {
 const range = aroundDate ? ` after:${shiftDate(aroundDate, -1)} before:${shiftDate(aroundDate, 4)}` : "";
 out.push({ type: "News search", label: aroundDate ? "News coverage around that date" : "News coverage of this claim",
 url: `https://www.google.com/search?q=${encodeURIComponent(`${node.id} ${String(q).slice(0, 80)}${range}`)}&tbm=nws` });
  };
 const lq = intel?.lastQuarter?.reportDate;
 switch (it.kind) {
 case "fund":
 if (node.hasSecData) {
 out.push({ type: "SEC filing", label: "Official SEC numbers (live feed)", url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${node.cik}.json`, truth: true });
 filing(SRC?.tenK, "Annual report");
      } else { filing(SRC?.tenK, "Annual report (foreign filer — limited US data)", true); edgarAll(); }
 break;
 case "quarter": filing(SRC?.quarters?.[lq], "Results announcement", !it.item?.src); break;
 case "guide": filing(SRC?.quarters?.[lq], "Results announcement", !it.item?.src); ir(); break;
 case "mover":
 filing(SRC?.quarters?.[it.item.date], "That quarter's results");
 out.push({ type: "Market data", label: "Share-price history (basis of the move %)", url: `https://finance.yahoo.com/quote/${node.id}/history/` });
 news(it.item.driver, it.item.date);
 break;
 case "catalyst":
 if (/earnings|report/i.test(it.item.event)) { ir(); edgarAll(); }
 else { filing(SRC?.quarters?.[lq], "Disclosed in latest results / call"); news(it.item.event); }
 break;
 case "mention": ir(); filing(SRC?.tenQ, "Latest quarterly report"); news(`"${shortName(it.item.name)}"`); break;
    /* The quantitative layer. Each of these already arrives from the server
 carrying its own citation, so the inspector shows what the number was
 computed from rather than guessing a document for it. */
 case "xbrl": {
 const pt = it.item?.part || {};
 if (pt.url) out.push({ type: "SEC filing", label: `Tagged in ${pt.form || "the filing"}${pt.filed ? ` · filed ${fmtDate(pt.filed)}` : ""}`, url: pt.url, truth: true });
 if (pt.conceptUrl) out.push({ type: "SEC filing", label: `Every filing that tags ${pt.tag} (live feed)`, url: pt.conceptUrl, truth: !pt.url });
 filing(SRC?.tenK, "Annual report");
 edgarAll();
 break;
    }
 case "corr":
 out.push({ type: "Market data", label: `Daily closes — ${it.item?.priceSourceLabel || "CRSP / Compustat via synthetic sample"}`,
 url: `https://finance.yahoo.com/quote/${node.id}/history/`, truth: true });
 out.push({ type: "Method", label: `Pearson correlation of daily simple returns over ${it.item?.n ?? "?"} shared trading days${it.item?.from ? ` (${it.item.from} → ${it.item.to})` : ""}` });
 break;
 case "conc":
      // The server already resolved these: the recorded primary source first,
      // then the 10-K the disclosure lives in.
 for (const s of it.item?.sources || []) out.push({ type: s.kind, label: s.label, url: s.url, truth: s.truth });
 out.push({ type: "Method", label: "Read from the disclosure sentence shown above, not from XBRL — SEC's companyfacts feed drops the dimensional axes concentration is tagged on." });
 break;
 case "filingrel": {
 const fi = it.item.fi || {};
 if (fi.filingUrl) out.push({ type: "SEC filing", label: `Named in its ${fi.form || "10-K"} · filed ${fmtDate(fi.filed)}`, url: fi.filingUrl, truth: true });
 news(`"${shortName(it.item.name || it.item.ticker || "")}"`);
 break;
    }
 case "supply": {
      // the verification pathway: EDGAR full-text search for 10-Ks naming both companies
 const pair = `"${shortName(node.name)}" "${shortName(it.item.otherName || it.item.other)}"`;
 out.push({ type: "SEC filing",
 label: it.item.verified ? "10-K filings naming both companies (how this link was verified)"
                                : "Search 10-K filings for this relationship (not yet verified)",
 url: `https://www.sec.gov/edgar/search/#/q=${encodeURIComponent(pair)}&forms=10-K`,
 truth: !!it.item.verified });
 edgarAll();
 break;
    }
 default: news(it.claim);
  }
 if (!out.length) news(it.claim);
 return out;
}
const methodFor = (k, intel, graphDate) => (k === "fund"
  ? { m: "Pulled automatically from SEC data", asOf: graphDate }
  : { m: "Web research, checked against the documents below", asOf: intel?.asOf });

/* ---------- shared bits ---------- */
const Badge = ({ v }) => <span className={`font-bold tabular-nums ${neg(v) ? "gr-neg" : "gr-pos"}`}>{v}</span>;
const activeCls = (a) => (a ? " gr-ring " : "gr-hov-raised ");
/* Every metric that applies to THIS company, grouped as the catalogue groups
 * them. Sector-scoped by the server: a bank is not offered a gross margin and a
 * software company is not offered a loss ratio, because an empty cell invites
 * the reader to wonder what is missing when the answer is "nothing — the
 * measure does not exist here".
 *
 * A value that is null still gets its row, with the reason. "Operating income
 * not reported for CY2026Q2" is a fact about the filer; a bare dash is a bug
 * report the reader cannot file.
 */
function MetricRows({ mets }) {
  if (!mets) return null;
  if (!mets.ok) {
    return <div className="px-2 pb-2 text-[10px] gr-fainter">{mets.reason || mets.error || "Unavailable."}</div>;
  }
  const byCat = new Map();
  for (const m of mets.metrics) {
    if (!byCat.has(m.category)) byCat.set(m.category, []);
    byCat.get(m.category).push(m);
  }
  const LABEL = { scale: "Size", growth: "Growth", margin: "Margins", returns: "Returns",
                  leverage: "Leverage", valuation: "Valuation",
                  bank: "Banks", insurance: "Insurers", reit: "REITs" };

  return (
    <div>
      <div className="mb-1.5 px-2 text-[9px] gr-fainter">
        {mets.frame} · classified as {mets.sector}
        {!mets.sicKnown && " (SIC unknown — sector rules could not be applied)"}
        {!mets.hasPrice && " · no price, so the valuation measures are blank"}
      </div>
      {[...byCat.entries()].map(([cat, list]) => (
        <div key={cat} className="mb-1.5">
          <div className="px-2 pb-0.5 text-[9px] font-bold uppercase tracking-widest gr-fainter">
            {LABEL[cat] || cat}
          </div>
          {list.map((m) => (
            <div key={m.id} className="mb-0.5 flex items-baseline justify-between gap-2 rounded-md gr-recess px-2 py-1">
              <span className="min-w-0 flex-1 truncate text-[11px] gr-soft" title={m.basis}>{m.label}</span>
              <span className={`shrink-0 tabular-nums text-[11px] font-semibold ${m.value == null || m.value === "na" ? "gr-fainter" : "gr-ink"}`}
                    title={m.note || m.basis}>
                {fmtMetric(m.value, m.format)}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function Sect({ title, count, right, open: defOpen = false, children }) {
 const [open, setOpen] = useState(defOpen);
 return (
    <div className="mt-2">
      <button onClick={() => setOpen(!open)}
 className="flex w-full items-center justify-between rounded-md gr-recess px-2 py-1.5 text-left gr-hov-raised">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest gr-faint">{title}
          {count != null && <span className="font-normal normal-case tracking-normal gr-fainter">({count})</span>}</span>
        <span className="flex shrink-0 items-center gap-2">{right}<span className="text-[10px] gr-fainter">{open ? "▾" : "▸"}</span></span>
      </button>
      {open && <div className="mt-1.5">{children}</div>}
    </div>);
}
const Mini = ({ onClick, children }) => (
  <button onClick={onClick} className="rounded-md border gr-line gr-raised px-2 py-1 text-[10px] gr-soft gr-hov-line gr-hov-ink">{children}</button>
);

function Sidebar(props) {
 const { view } = props;
 if (view === "empty") return (
    <p className="text-[13px] leading-relaxed gr-faint">
      Click a company for its numbers, past earnings reactions, upcoming catalysts, and sources.
      Double-click it (or enter one above) to make it the centre of the canvas.
      Drag to rearrange, scroll to zoom.
    </p>);
 if (view === "lookup") return <LookupCard {...props} />;
 if (view === "mention") return <MentionCard {...props} />;
 if (view === "draft") return <DraftCard {...props} />;
 return <CompanyCard {...props} />;
}

/* Registry matches for a query that hit no loaded company.
 *
 * This used to be built as an HTML string and assigned to #detail.innerHTML —
 * which is the container this React root owns. React kept its own references to
 * the children that assignment detached, so the panel was left in a state where
 * the next render could wipe the results or throw. It is a component now, for
 * the same reason everything else in this file is.
 *
 * An exact ticker match never reaches here: main.js loads it directly. What is
 * left is genuinely ambiguous — a name fragment, or a prefix. */
function LookupCard({ query, matches, onPick, onResearch }) {
 const symbol = String(query || "").toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
 return (
    <div className="text-[12px] gr-soft">
      <h2 className="text-base font-semibold gr-ink">{query}</h2>
      <p className="mt-1 text-[11px] gr-faint">
        Not loaded yet. {matches.length} {matches.length === 1 ? "company" : "companies"} in the
        SEC registrant map match — pick the one you meant.
      </p>
      <div className="mt-2 flex flex-col gap-1">
        {matches.map((m) => (
          <button key={m.ticker} onClick={() => onPick(m.ticker)}
                  className="flex items-start gap-2 rounded-md gr-recess px-2 py-1.5 text-left gr-hov-raised">
            <span className="font-bold gr-ink tabular-nums">{m.ticker}</span>
            <span className="flex-1 min-w-0">
              <span className="gr-soft">{m.name}</span>
              <span className="gr-fainter"> · {m.exchange}</span>
              <span className="block text-[10px] gr-fainter">
                Loads in about a minute from its latest 10-K; full research follows automatically.
              </span>
            </span>
          </button>
        ))}
      </div>
      {symbol && !matches.some((m) => m.ticker.toUpperCase() === symbol) && (
        <div className="mt-2">
          <Mini onClick={onResearch}>⟳ Research {symbol} anyway</Mini>
        </div>)}
    </div>);
}

function HeadButtons({ node, onFocus, onJob, focusedId, onSave, onUnsave, isSaved }) {
 const savedNow = isSaved?.(node.id);
 return (
    <div className="mt-1.5 flex gap-1.5">
      {/* Saving keeps this company's graph as a toggle in the rail. The entered
          company is transient until you press this. */}
      {onSave && (savedNow
        ? <Mini onClick={() => onUnsave(node.id)} title="Remove from saved graphs"><span className="gr-warn">★</span> Saved</Mini>
        : <Mini onClick={() => onSave(node.id)} title="Keep this company's graph as a toggle in the rail">☆ Save graph</Mini>)}
      {focusedId !== node.id && <Mini onClick={() => onFocus(node.id)}>⌖ Centre on this</Mini>}
      <Mini onClick={() => onJob("refresh", node.id)}>⟳ Refresh</Mini>
    </div>);
}

/* ---------- private / unlisted companies: the web overview ---------- */

/* Mirrors tickerLike in main.js: an id that could be researched as a US
 * listing. Everything else on a mention card — "Anthropic", "SK hynix" — is
 * private or foreign-listed, and the web overview below is all there is. */
const listedLike = (id) => /^[A-Z]{1,6}(\.[A-Z])?$/.test(String(id || ""));

function useWebOverview(name, enabled) {
 const [st, setSt] = useState({ data: null, loading: !!enabled });
 useEffect(() => {
 if (!enabled || !name) return undefined;
 let live = true;
 setSt({ data: null, loading: true });
    fetch(`/api/graph/private?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => live && setSt({ data: d, loading: false }))
      .catch((e) => live && setSt({ data: { error: String(e.message || e) }, loading: false }));
 return () => { live = false; };
  }, [name, enabled]);
 return st;
}

/* One outbound source link, chip-labelled by kind — the mention card's version
 * of the Sources inspector's rows: the link IS the citation. */
const OutLink = ({ s }) => (
  <a href={s.url} target="_blank" rel="noopener"
 className="mb-1 flex items-center gap-1.5 rounded border gr-line px-2 py-1 text-[11px] gr-info gr-hov-line">
    <span className={`whitespace-nowrap rounded border px-1 text-[9px] font-bold ${TYPE_STYLE[s.type] || "gr-raised gr-soft gr-line"}`}>{s.type}</span>
    <span className="min-w-0 flex-1 truncate">{s.label}</span>
  </a>);

/* Everything this panel shows is either copied verbatim from the page linked
 * beside it, or IS a link — nothing is model-written or paraphrased, and every
 * absence is explained rather than papered over. The server (server/private.js)
 * enforces the matching rules; this only renders what survived them. */
function WebOverview({ name }) {
 const st = useWebOverview(name, true);
 if (st.loading) return <div className="mt-3 rounded-lg gr-recess px-3 py-2 text-[10px] gr-fainter">Reading public sources for {name}…</div>;
 const d = st.data;
 if (!d || d.error) return (
    <div className="mt-3 rounded-lg gr-recess px-3 py-2 text-[10px] gr-fainter">
      Web overview unavailable{d?.error ? ` — ${d.error}` : ""}.
    </div>);
 return (
    <div className="mt-3">
      <div className="text-[10px] font-bold uppercase tracking-widest gr-fainter">Company overview — public web</div>

      {d.profile ? (
        <div className="mt-1.5">
          {/* The paragraph IS the claim, verbatim; the row beneath is where it lives. */}
          <div className="rounded-lg border-l-2 gr-line-quote gr-recess p-2.5 text-[11px] leading-relaxed">{d.profile.quote}</div>
          <div className="mt-1"><OutLink s={d.profile.source} /></div>
        </div>
      ) : (
        <div className="mt-1.5 rounded-lg gr-recess px-2.5 py-2 text-[10px] leading-relaxed gr-fainter">
          {d.absent?.profile || "No reliable public profile found."} Nothing is shown rather than a lookalike.
        </div>)}

      {d.facts?.length > 0 && (
        <div className="mt-2">
          {d.facts.map((f) => (
            <div key={f.id} className="mb-0.5 flex items-baseline justify-between gap-2 rounded-md gr-recess px-2 py-1">
              <span className="shrink-0 text-[11px] gr-faint">{f.label}</span>
              <span className="min-w-0 truncate text-right text-[11px] font-semibold gr-ink" title={f.value}>
                {f.url ? <a href={f.url} target="_blank" rel="noopener" className="gr-hov-accent">{f.value}</a> : f.value}
                {f.note && <span className="ml-1 font-normal gr-fainter">({f.note})</span>}
              </span>
            </div>))}
          {d.factsSource && <OutLink s={d.factsSource} />}
        </div>)}
      {d.profile && !d.facts?.length && d.absent?.facts && (
        <div className="mt-1.5 px-2 text-[10px] leading-relaxed gr-fainter">{d.absent.facts}</div>)}

      <Sect title="Recent press" count={d.news.length} open={d.news.length > 0}>
        {d.news.length === 0
          ? <div className="px-2 pb-1 text-[10px] gr-fainter">
              {d.newsOk ? "No recent story names it in the headline." : "News search could not be reached — that is not the same as no coverage."}
            </div>
          : d.news.map((n, i) => (
            <a key={i} href={n.url} target="_blank" rel="noopener" className="mb-1 block rounded-lg gr-recess p-2 gr-hov-raised">
              <div className="text-[11px] leading-snug gr-ink">{n.title}</div>
              <div className="mt-0.5 text-[10px] gr-fainter">{n.source || "—"}{n.date ? ` · ${fmtDate(n.date)}` : ""}</div>
            </a>))}
        <div className="px-2 pb-1 text-[10px] leading-relaxed gr-fainter">
          Only stories whose headline names the company — some real coverage is dropped rather than showing someone else's.
        </div>
      </Sect>

      <Sect title="Check the record" count={3}>
        {[d.record?.fts, d.record?.edgar, d.record?.newsSearch].filter(Boolean).map((s) => <OutLink key={s.url} s={s} />)}
      </Sect>

      <div className="mt-1.5 px-1 text-[10px] leading-relaxed gr-fainter">
        Every line above is copied verbatim from, or links directly to, the pages cited — nothing is
        model-written.{d.checkedAt ? ` Checked ${fmtDate(d.checkedAt.slice(0, 10))}.` : ""}
      </div>
    </div>);
}

function MentionCard({ node, onOpen, onJob, onFocus, focusedId, inGraph }) {
  /* A mention node with a ticker-shaped id can be researched properly, so it
     keeps the research buttons and needs no web overview. One with a NAME for
     an id is private or unlisted: the refresh/scan jobs take a ticker and have
     nothing to chew on, so the buttons would only burn a research run to fail —
     the web overview is what exists for these. */
 const unlisted = !!node.mentionOnly && !listedLike(node.id);
 return (
    <div className="text-[12px] gr-soft">
      <h2 className="text-base font-semibold gr-ink">{node.name} <span className="text-[11px] gr-fainter">{unlisted ? "private / unlisted — mentioned on earnings calls" : "mentioned only"}</span></h2>
      <div className="mt-1.5 flex gap-1.5">
        {focusedId !== node.id && <Mini onClick={() => onFocus(node.id)}>⌖ Focus</Mini>}
        {!unlisted && <Mini onClick={() => onJob("refresh", node.id)}>⟳ Research &amp; add</Mini>}
        {!unlisted && <Mini onClick={() => onJob("scan", node.id)}>⚡ Quick 10-K scan</Mini>}
      </div>
      {unlisted && <WebOverview name={node.name || node.id} />}
      <div className="mt-3 text-[10px] font-bold uppercase tracking-widest gr-fainter">Named on earnings calls</div>
      {(node.mentionedBy || []).map((m, i) => (
        <button key={i} onClick={() => inGraph(m.by) && onOpen(m.by)} className="mt-1.5 block w-full rounded-lg gr-recess p-2 text-left gr-hov-raised">
          <b className="gr-ink">{m.by}</b> <span className="text-[10px] gr-fainter">{m.relationship}</span>
          <div className="mt-0.5 truncate text-[10px] gr-fainter">{m.context}</div>
        </button>))}
    </div>);
}

function DraftCard({ node, onOpen, onJob, onFocus, focusedId, inGraph }) {
 const di = node.draftInfo || {};
 return (
    <div className="text-[12px] gr-soft">
      <h2 className="text-base font-semibold gr-ink">{node.name} <span className="text-[11px] gr-warn">draft — not verified</span></h2>
      <p className="mt-0.5 text-[11px] gr-fainter">{node.id}{di.exchange ? ` · ${di.exchange}` : ""}{di.filed ? ` · from its ${di.form}, ${fmtDate(di.filed)}` : ""}</p>
      <div className="mt-1.5 flex gap-1.5">
        {focusedId !== node.id && <Mini onClick={() => onFocus(node.id)}>⌖ Focus</Mini>}
        <Mini onClick={() => onJob("refresh", node.id)}>⟳ Full research</Mini>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg gr-recess p-2"><div className="text-[9px] uppercase gr-fainter">Revenue</div><div className="font-semibold gr-ink">{fmtUSD(node.revenue)}</div></div>
        <div className="rounded-lg gr-recess p-2"><div className="text-[9px] uppercase gr-fainter">Profit</div><div className="font-semibold gr-ink">{fmtUSD(node.netIncome)}</div></div>
      </div>
      <div className="mt-3 text-[10px] font-bold uppercase tracking-widest gr-fainter">Companies named in its filing</div>
      {(di.related || []).map((r, i) => {
 const id = (r.ticker || r.name || "").trim();
 return (
          <button key={i} onClick={() => inGraph(id) && onOpen(id)} className="mt-1 flex w-full justify-between rounded-lg gr-recess p-2 text-left gr-hov-raised">
            <b className="gr-ink">{id}</b><span className="text-[10px] gr-fainter">{r.rel} · seen ×{r.count}</span>
          </button>);
      })}
      {di.filingUrl && <a href={di.filingUrl} target="_blank" rel="noopener"
 className="mt-2 block truncate rounded border gr-line-pos px-2 py-1 text-[11px] gr-pos gr-hov-line">
        Source: the {di.form}, {fmtDate(di.filed)} (SEC)</a>}
    </div>);
}


/* The quantitative layer, loaded per company. Three separate endpoints rather
 than one: financials hits SEC and is slow, correlation hits the price
 service, concentration is a local file read. Bundling them would make the
 fastest wait for the slowest, and any one failing would blank all three. */
function useFigures(ticker) {
 const [state, setState] = useState({ fin: null, corr: null, conc: null, flow: null, mets: null, loading: true });
 useEffect(() => {
 if (!ticker) return undefined;
 let live = true;
 setState({ fin: null, corr: null, conc: null, flow: null, mets: null, loading: true });
 const get = (p) => fetch(p).then((r) => r.json()).catch((e) => ({ ok: false, error: String(e.message || e) }));
    Promise.allSettled([
 get(`/api/graph/financials?ticker=${ticker}`),
 get(`/api/graph/correlation?ticker=${ticker}`),
 get(`/api/graph/concentration?ticker=${ticker}`),
 get(`/api/graph/flows?ticker=${ticker}`),
 get(`/api/graph/metrics/company?ticker=${ticker}`),
    ]).then(([fin, corr, conc, flow, mets]) => {
 if (!live) return;
 const v = (r) => (r.status === "fulfilled" ? r.value : { ok: false, error: "request failed" });
 setState({ fin: v(fin), corr: v(corr), conc: v(conc), flow: v(flow), mets: v(mets), loading: false });
    });
 return () => { live = false; };
  }, [ticker]);
 return state;
}

const corrTone = (r) => (r == null ? "gr-fainter"
  : r >= 0.6 ? "gr-pos" : r >= 0.3 ? "gr-pos-soft"
  : r > -0.1 ? "gr-soft" : "gr-neg");

function CompanyCard({ node, intel, sources: SRC, suppliers, customers, onOpen, onFocus, onJob, focusedId, inGraph, graphDate, quiet, relCount, onSave, onUnsave, isSaved }) {
 const lq = intel.lastQuarter;
 const OV = [
    { kind: "quarter", item: lq, h: lq.headline[0], claim: `${lq.headline[0].metric} was ${lq.headline[0].value} in ${lq.label}` },
    ...lq.headline.slice(1).map((h) => ({ kind: "quarter", item: lq, h, claim: `${h.metric} was ${h.value} in ${lq.label}` })),
    { kind: "guide", item: lq, h: { metric: "Guidance (company forecast)" }, claim: lq.guidance },
    { kind: "fund", item: {}, h: { metric: "Annual financials", value: fmtUSD(node.revenue) },
 claim: `Annual revenue ${fmtUSD(node.revenue)}, profit ${fmtUSD(node.netIncome)}`,
 sub: `Profit ${fmtUSD(node.netIncome)} · R&D ${fmtUSD(node.rnd)}` },
  ];
 const FUTURE = (intel.catalysts || []).map((c) => ({ kind: "catalyst", item: c, claim: `${fmtDate(c.date)}: ${c.event}` }));
 const PAST = (intel.priceMovers || []).map((m) => ({ kind: "mover", item: m,
 claim: `After the ${m.quarter} report (${fmtDate(m.date)}) the stock moved ${m.movePct} the next day` }));
 const NEXT = FUTURE.filter((it) => /earnings|report/i.test(it.item.event) && (daysUntil(it.item.date) ?? -1) >= 0)
    .sort((a, b) => daysUntil(a.item.date) - daysUntil(b.item.date))[0] || null;

 const [tab, setTab] = useState("Overview");
 const figures = useFigures(node.id);
 const [sel, setSel] = useState(OV[0]);
 const [srcOpen, setSrcOpen] = useState(true);
 const [deep, setDeep] = useState(false); // the tabbed window opens via the Supply chain button
 const maxMove = Math.max(1, ...PAST.map((it) => Math.abs(pct(it.item.movePct))));
 const srcs = sel ? srcsFor(sel, node, intel, SRC) : [];
 const truth = srcs.filter((s) => s.truth), rest = srcs.filter((s) => !s.truth);
 const q = sel && extractQuote(sel.item?.driver || sel.item?.context || "");
 const m = sel && methodFor(sel.kind, intel, graphDate);

 const Conf = ({ it }) => { const s = srcsFor(it, node, intel, SRC); const t = s.some((x) => x.truth); return (
    <span className="flex shrink-0 items-center" title={`${s.length} source${s.length === 1 ? "" : "s"} — ${t ? "backed by an official document" : "researched; click for links"}`}>
      <span className={`h-2 w-2 rounded-full ${t ? "gr-bar-pos" : "gr-dot-warn"}`} /></span>); };

  // Relations: verified supply links first, then call mentions grouped by role
 const groups = {};
 suppliers.forEach((s) => (groups.supplier ??= []).push({ id: s.id, label: s.id, note: `${s.note}${s.verified ? " ✓" : ""}`,
 kindItem: { kind: "supply", item: { other: s.id, otherName: s.name, verified: s.verified },
 claim: `${s.id} supplies ${node.id} — ${s.note}${s.verified ? " (verified in 10-K filings)" : ""}` } }));
 customers.forEach((c) => (groups.customer ??= []).push({ id: c.id, label: c.id, note: `${c.note}${c.verified ? " ✓" : ""}`,
 kindItem: { kind: "supply", item: { other: c.id, otherName: c.name, verified: c.verified },
 claim: `${node.id} supplies ${c.id} — ${c.note}${c.verified ? " (verified in 10-K filings)" : ""}` } }));
  (intel.mentions || []).forEach((mn) => {
 const g = (mn.relationship.match(/supplier|customer|competitor|partner/i) || ["related"])[0].toLowerCase();
 const id = (mn.ticker || mn.name || "").trim();
 if ((groups[g] || []).some((x) => x.id === id)) return;
    (groups[g] ??= []).push({ id, label: mn.ticker || mn.name, note: mn.context,
 kindItem: { kind: "mention", item: mn, claim: `${mn.name} — ${mn.relationship}` } });
  });
 const GROUP_ORDER = ["supplier", "customer", "competitor", "partner", "related"];
 const GROUP_LABEL = { supplier: "Suppliers", customer: "Customers", competitor: "Competitors", partner: "Partners", related: "Other" };
 const DOT = { supplier: "#0fa693", customer: "#c13584", competitor: "#c47f17", partner: "#3f8cf3", related: "#6e7681" };

 const SrcRow = ({ s }) => (
    <a href={s.url} target="_blank" rel="noopener"
 className={`mb-1 flex items-center gap-1.5 rounded border px-2 py-1 text-[11px] gr-hov-line ${s.truth ? "gr-line-pos gr-pos" : "gr-line gr-info"}`}>
      <span className={`whitespace-nowrap rounded border px-1 text-[9px] font-bold ${TYPE_STYLE[s.type] || "gr-raised gr-soft gr-line"}`}>{s.type}</span>
      <span className="min-w-0 flex-1 truncate">{s.label}</span>
    </a>);

 return (
    <div className="flex h-full flex-col text-[12px] gr-soft">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0"><h2 className="truncate text-base font-semibold gr-ink">{node.name}</h2></div>
        <span className="shrink-0 text-[12px] gr-fainter">{node.id}</span>
      </div>
      <div className="mt-0.5 text-[11px] gr-faint">
        {fmtUSD(node.revenue)} annual revenue · {lq.label}: stock <Badge v={PAST[0]?.item.movePct || "—"} /> on results
      </div>
      <HeadButtons node={node} onFocus={onFocus} onJob={onJob} focusedId={focusedId} onSave={onSave} onUnsave={onUnsave} isSaved={isSaved} />
      {quiet && (
        <div className="mt-1.5 rounded-md border gr-line gr-recess px-2 py-1 text-[10px] leading-snug gr-faint"
 title="Its earnings calls and filings name few companies — common outside tech (CPG, insurance…). The relations shown are everything publicly disclosed; deeper coverage needs a structured dataset (synthetic sample/FactSet).">
          🤫 Quiet discloser — only {relCount} companies named publicly (sparse by disclosure, not error).
        </div>
      )}

      {NEXT && (() => {
 const d = daysUntil(NEXT.item.date);
 const tier = d <= 2
          ? { box: "gr-line-neg gr-fill-neg", tag: "gr-tag-neg gr-ink animate-pulse", date: "gr-neg", label: "Earnings imminent" }
          : d <= 14
          ? { box: "gr-line-warn gr-fill-warn", tag: "gr-tag-warn gr-on-fill", date: "gr-warn", label: "Earnings soon" }
          : { box: "gr-line gr-recess", tag: "gr-raised gr-ink", date: "gr-info", label: "Next earnings" };
 return (
          <button onClick={() => { setSel(NEXT); setDeep(true); }}
 className={`${activeCls(sel === NEXT)}mt-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left ${tier.box}`}>
            <span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${tier.tag}`}>{tier.label}</span>
            <span className={`whitespace-nowrap text-[12px] font-bold ${tier.date}`}>{fmtDate(NEXT.item.date)}</span>
            <span className="min-w-0 flex-1 truncate text-[10px] gr-faint">{inDays(d)}</span>
            <Conf it={NEXT} />
          </button>);
      })()}

      <button onClick={() => { setSel(OV[0]); setDeep(true); }} className={`${activeCls(sel === OV[0])}mt-2 w-full rounded-xl gr-recess p-3 text-left`}>
        <div className="flex items-start justify-between">
          <div className="text-[10px] uppercase tracking-widest gr-fainter">{lq.label} · {OV[0].h.metric}</div><Conf it={OV[0]} /></div>
        <div className="text-[26px] font-bold leading-tight gr-ink">{OV[0].h.value}</div>
        <div className="text-[11px] gr-faint">{OV[0].h.note}</div>
      </button>


      {/* The quantitative layer, advertised where it can actually be seen.
          It was reachable only after opening "Supply chain & detail" and then
 a collapsed section — two clicks past the point anyone would look, so
 in practice it did not exist. This shows the strongest correlation on
 the card itself and jumps straight to the tab. */}
      {(() => {
 const pairs = (figures.corr?.pairs || []).filter((x) => x.correlation != null);
 const top = pairs[0];
 const nFig = Object.keys(figures.fin?.figures?.concepts || {}).length;
 const nConc = (figures.conc?.edges || []).length;
 if (figures.loading) return <div className="mt-2 rounded-lg gr-recess px-3 py-2 text-[10px] gr-fainter">Reading filings and prices…</div>;
 if (!top && !nFig && !nConc) return null;
 return (
          <button onClick={() => { setDeep(true); setTab("Figures"); }}
 className="mt-2 flex w-full items-center justify-between gap-2 rounded-lg border gr-line gr-recess px-3 py-2 text-left gr-hov-line">
            <div className="min-w-0">
              <div className="text-[10px] uppercase tracking-widest gr-fainter">Moves with</div>
              {top
                ? <div className="truncate text-[13px] font-semibold gr-ink">
                    {top.id} <span className={corrTone(top.correlation)}>{(top.correlation >= 0 ? "+" : "") + top.correlation.toFixed(2)}</span>
                    {pairs.length > 1 && <span className="ml-1.5 text-[10px] font-normal gr-fainter">+{pairs.length - 1} more</span>}
                  </div>
                : <div className="text-[12px] gr-faint">No overlapping price history</div>}
            </div>
            <span className="shrink-0 text-right text-[10px] leading-tight gr-fainter">
              {nConc ? <>{nConc} revenue share{nConc > 1 ? "s" : ""}<br /></> : null}
              {nFig ? `${nFig} filing figures` : null} ▸
            </span>
          </button>);
      })()}

      <button onClick={() => setDeep(!deep)}
 className="mt-2 flex w-full items-center justify-between rounded-lg border gr-line gr-recess px-3 py-2.5 text-left gr-hov-line">
        <span className="text-[13px] font-semibold gr-ink">⛓ Supply chain, figures &amp; correlation</span>
        <span className="text-[10px] gr-fainter">Overview · Figures · Timeline · Relations {deep ? "▾" : "▸"}</span>
      </button>

      {deep && (<>
      <div className="mt-2 flex gap-1 rounded-lg gr-recess p-1">
        {["Overview", "Figures", "Timeline", "Relations"].map((t) => (
          <button key={t} onClick={() => setTab(t)}
 className={`flex-1 rounded-md px-1 py-1 text-[11px] ${tab === t ? "gr-raised gr-ink" : "gr-faint gr-hov-soft"}`}>{t}</button>))}
      </div>

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1">
        {tab === "Overview" && (<div>
          <div className="grid grid-cols-3 gap-2">
            {OV.slice(1, 4).map((it, i) => (
              <button key={i} onClick={() => setSel(it)} className={`${activeCls(sel === it)}rounded-lg gr-recess p-2 text-left`}>
                <div className="text-[9px] leading-snug gr-fainter">{it.h.metric}</div>
                <div className="text-[12px] font-semibold gr-ink">{it.h.value || "—"}</div>
                <div className="mt-1"><Conf it={it} /></div></button>))}
          </div>
          {OV.length > 4 && (
            <Sect title="Guidance (company forecast)" right={<Conf it={OV[OV.length - 2]} />}>
              <button onClick={() => setSel(OV[OV.length - 2])}
 className={`${activeCls(sel === OV[OV.length - 2])}w-full rounded-lg border-l-2 gr-line-info gr-recess p-2.5 text-left text-[11px] leading-snug`}>
                {lq.guidance}</button>
            </Sect>)}
          <Sect title="Annual financials (SEC)" right={<Conf it={OV[OV.length - 1]} />}>
            <button onClick={() => setSel(OV[OV.length - 1])}
 className={`${activeCls(sel === OV[OV.length - 1])}w-full rounded-lg gr-recess p-2.5 text-left text-[11px]`}>
              {OV[OV.length - 1].sub}</button>
          </Sect>
        </div>)}

        {tab === "Figures" && (<div>
          {figures.loading && <div className="p-3 text-[11px] gr-fainter">Reading filings and prices…</div>}

          {/* --- share-of-revenue edges ------------------------------------ */}
          {!figures.loading && (
            <Sect title="Share of revenue" open count={(figures.conc?.edges || []).length}>
              {(figures.conc?.edges || []).length === 0
                ? <div className="px-2 pb-2 text-[10px] leading-relaxed gr-fainter">{figures.conc?.note || "No disclosure found."}</div>
                : (figures.conc.edges).map((e, i) => {
 const ki = { kind: "conc", item: e, claim: `${e.counterparty} is ${(e.share * 100).toFixed(0)}%${e.shareHigh ? `–${(e.shareHigh * 100).toFixed(0)}%` : ""} of ${node.id}'s revenue` };
 return (
                    <div key={i} className="mb-1 rounded-lg gr-recess p-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <button onClick={() => (e.ticker && inGraph(e.ticker) ? onOpen(e.ticker) : setSel(ki))}
 className="min-w-0 flex-1 text-left"><b className="gr-ink">{e.counterparty}</b>
                          <span className="ml-1.5 text-[10px] gr-fainter">{e.relationship}</span></button>
                        <span className="shrink-0 font-semibold gr-ink">
                          {e.approximate ? "~" : ""}{(e.share * 100).toFixed(0)}{e.shareHigh ? `–${(e.shareHigh * 100).toFixed(0)}` : ""}%
                        </span>
                        <button onClick={() => setSel(ki)} title="Show sources"
 className="shrink-0 rounded border gr-line px-1.5 text-[10px] gr-fainter gr-hov-ink">src</button>
                      </div>
                      <div className="mt-1 h-1 w-full rounded gr-raised">
                        <div className="h-1 rounded gr-bar-info" style={{ width: `${Math.min(100, e.share * 100)}%` }} />
                      </div>
                      {/* The sentence IS the claim; the percentage is our reading of it. */}
                      <div className="mt-1.5 text-[10px] leading-relaxed gr-faint">{e.disclosure}</div>
                    </div>);
                })}
            </Sect>)}

          {/* --- correlation with linked companies ------------------------- */}
          {!figures.loading && (
            <Sect title="Moves with" open count={(figures.corr?.pairs || []).filter((p) => p.correlation != null).length}>
              {!figures.corr?.ok
                ? <div className="px-2 pb-2 text-[10px] gr-fainter">{figures.corr?.reason || figures.corr?.error || "Unavailable."}</div>
                : <>
                  {(figures.corr.pairs || []).map((pr, i) => {
 const ki = { kind: "corr", item: { ...pr, priceSourceLabel: pr.priceSource && Object.values(pr.priceSource).join(" / ") },
 claim: pr.correlation == null ? `${pr.id}: not enough overlapping price history`
                        : `${node.id} and ${pr.id} have a daily-return correlation of ${pr.correlation.toFixed(2)} over ${pr.n} shared trading days` };
 return (
                      <div key={i} className="mb-1 flex items-center justify-between gap-2 rounded-lg gr-recess p-2">
                        <button onClick={() => (inGraph(pr.id) ? onOpen(pr.id) : setSel(ki))} className="min-w-0 flex-1 text-left">
                          <b className="gr-ink">{pr.id}</b>
                          <span className="ml-1.5 text-[10px] gr-fainter">{pr.direction}</span>
                        </button>
                        <span className={`shrink-0 font-semibold tabular-nums ${corrTone(pr.correlation)}`}>
                          {pr.correlation == null ? "—" : (pr.correlation >= 0 ? "+" : "") + pr.correlation.toFixed(2)}
                        </span>
                        <button onClick={() => setSel(ki)} title="Show sources"
 className="shrink-0 rounded border gr-line px-1.5 text-[10px] gr-fainter gr-hov-ink">src</button>
                      </div>);
                  })}
                  <div className="px-2 pb-1 text-[10px] leading-relaxed gr-fainter">
                    Daily simple returns, {figures.corr.window} sessions, over the dates both names traded.
                    {figures.corr.sourceSeam && ` Price history crosses the CRSP seam at ${figures.corr.sourceSeam}.`}
                  </div>
                </>}
            </Sect>)}

          {/* --- working capital: what actually moves along a link --------- */}
          {!figures.loading && figures.flow?.ok && (
            <Sect open title="Flows" count={4}>
              <div className="mb-1 grid grid-cols-3 gap-1">
                {[["Receivables", figures.flow.stocks.receivables, "Owed to it by customers"],
                  ["Inventory", figures.flow.stocks.inventory, "Goods bought, not yet sold"],
                  ["Payables", figures.flow.stocks.payables, "Owed by it to suppliers"]].map(([label, c, hint]) => {
 const ki = { kind: "xbrl", item: { part: c || {} }, claim: `${label} was ${fmtUSD(c?.value)}${c?.frame ? ` at ${c.frame}` : ""}` };
 return (
                    <button key={label} onClick={() => c && setSel(ki)} title={hint}
 className="rounded-lg gr-recess p-2 text-left">
                      <div className="text-[9px] uppercase gr-fainter">{label}</div>
                      <div className="font-semibold gr-ink">{fmtUSD(c?.value)}</div>
                    </button>);
                })}
              </div>
              {(() => {
 const g = figures.flow.derived;
 const d = (x) => (x == null ? "—" : `${Math.round(x)}d`);
 return (
                  <div className="mb-1 rounded-lg gr-recess p-2">
                    <div className="flex justify-between text-[11px] gr-soft">
                      <span>Days sales outstanding<b className="ml-2 gr-ink">{d(g.dso)}</b></span>
                      <span>Days inventory<b className="ml-2 gr-ink">{d(g.dio)}</b></span>
                      <span>Days payable<b className="ml-2 gr-ink">{d(g.dpo)}</b></span>
                    </div>
                    <div className="mt-1.5 flex items-baseline justify-between border-t gr-line pt-1.5">
                      <span className="text-[11px] gr-faint">Cash conversion cycle</span>
                      <b className={g.cashConversion != null && g.cashConversion < 0 ? "gr-pos" : "gr-ink"}>
                        {d(g.cashConversion)}
                      </b>
                    </div>
                    {g.cashConversion != null && g.cashConversion < 0 && (
                      <div className="mt-1 text-[10px] leading-relaxed gr-pos-soft">
                        Negative — it is paid before it pays, so its suppliers finance it.
                      </div>)}
                    <div className="mt-1 flex items-baseline justify-between">
                      <span className="text-[11px] gr-faint">Free cash flow</span>
                      <b className="gr-ink">{fmtUSD(g.freeCashFlow)}</b>
                    </div>
                  </div>);
              })()}
              <div className="px-2 pb-1 text-[10px] leading-relaxed gr-fainter">{figures.flow.note}</div>
            </Sect>)}

          {!figures.loading && (
            <Sect open title="Ratios & metrics"
                  count={figures.mets?.ok ? figures.mets.metrics.length : null}>
              <MetricRows mets={figures.mets} />
            </Sect>)}

          {/* --- traced XBRL figures --------------------------------------- */}
          {!figures.loading && (
            <Sect open title={`From the filings${figures.fin?.frame ? ` · ${figures.fin.frame}` : ""}`}
 count={Object.keys(figures.fin?.figures?.concepts || {}).length}>
              {!figures.fin?.ok
                ? <div className="px-2 pb-2 text-[10px] gr-fainter">{figures.fin?.reason || figures.fin?.error || "Unavailable."}</div>
                : Object.entries(figures.fin.figures.concepts).map(([id, c]) => {
 const part = (c.parts || [])[0] || {};
 const ki = { kind: "xbrl", item: { ...c, part },
 claim: `${c.label} was ${c.unit === "shares" ? Number(c.val).toLocaleString() : fmtUSD(c.val)} on ${figures.fin.frame} (${c.basis}${c.derived ? ", derived" : ""})` };
 return (
                    <div key={id} className="mb-1 flex items-center justify-between gap-2 rounded-lg gr-recess p-2">
                      <button onClick={() => setSel(ki)} className="min-w-0 flex-1 text-left">
                        <b className="gr-ink">{c.label}</b>
                        <div className="mt-0.5 truncate text-[10px] gr-fainter">
                          {part.tag}{part.form ? ` · ${part.form}` : ""}{c.derived ? " · derived" : ""}
                        </div>
                      </button>
                      <span className="shrink-0 tabular-nums font-semibold gr-ink">
                        {c.unit === "shares" ? Number(c.val).toLocaleString()
                          : c.unit === "USD/shares" ? `$${Number(c.val).toFixed(2)}` : fmtUSD(c.val)}
                      </span>
                      <button onClick={() => setSel(ki)} title="Show sources"
 className="shrink-0 rounded border gr-line px-1.5 text-[10px] gr-fainter gr-hov-ink">src</button>
                    </div>);
                })}
            </Sect>)}
        </div>)}

        {tab === "Timeline" && (<div>
          <Sect title="Upcoming" count={FUTURE.length} open>
          <div className="ml-2 border-l-2 gr-line pl-3">
          {FUTURE.map((it, i) => { const d = daysUntil(it.item.date); return (
            <button key={i} onClick={() => setSel(it)} className={`${activeCls(sel === it)}relative mb-2 block w-full rounded-lg gr-recess p-2 text-left`}>
              <span className="absolute -left-[19px] top-3 h-2 w-2 rounded-full border-2 gr-line-warn gr-recess" />
              <div className="flex justify-between">
                <span className="text-[10px] gr-warn">{fmtDate(it.item.date)}{d != null && d >= 0 && <span className="gr-fainter"> · {inDays(d)}</span>}</span>
                <Conf it={it} /></div>
              <div className="mt-0.5 text-[11px] leading-snug">{it.item.event}</div></button>); })}
          </div>
          </Sect>
          <Sect title="Past earnings reactions" count={PAST.length}>
          <div className="ml-2 border-l-2 gr-line pl-3">
          {PAST.map((it, i) => { const v = pct(it.item.movePct); return (
            <button key={i} onClick={() => setSel(it)} className={`${activeCls(sel === it)}relative mb-2 block w-full rounded-lg gr-recess p-2 text-left`}>
              <span className={`absolute -left-[19px] top-3 h-2 w-2 rounded-full border-2 gr-recess ${v < 0 ? "gr-line-neg" : "gr-line-pos"}`} />
              <div className="flex items-center gap-2">
                <span className="shrink-0 text-[10px] gr-fainter">{it.item.quarter} · {fmtDate(it.item.date)}</span>
                <div className="flex h-2 flex-1 overflow-hidden rounded-sm gr-recess">
                  <div className={v < 0 ? "gr-bar-neg" : "gr-bar-pos"} style={{ width: `${(Math.abs(v) / maxMove) * 100}%` }} /></div>
                <Badge v={it.item.movePct} /><Conf it={it} /></div>
              <div className="mt-1 text-[11px] leading-snug gr-soft">{it.item.driver}</div></button>); })}
          </div>
          </Sect>
        </div>)}

        {tab === "Relations" && (<div>
          {(() => {
 const fi = node.filingsInfo;
 const already = new Set(Object.values(groups).flat().map((x) => x.id));
 const extra = (fi?.related || []).filter((r) => !already.has((r.ticker || r.name || "").trim()));
 if (!extra.length) return null;
 return (
              <Sect title={`Named in its ${fi.form || "10-K"}`} count={extra.length}>
                {extra.map((r, i) => {
 const id = (r.ticker || r.name || "").trim();
 const ki = { kind: "filingrel", item: { ...r, fi }, claim: `${id} is named in ${node.id}'s ${fi.form || "10-K"} (${r.rel}, seen ×${r.count})` };
 return (
                    <div key={i} className={`${activeCls(sel === ki && false)}mb-1 flex w-full items-start justify-between gap-2 rounded-lg gr-recess p-2 text-left`}>
                      <button onClick={() => (inGraph(id) ? onOpen(id) : setSel(ki))} className="min-w-0 flex-1 text-left">
                        <b className="gr-ink">{id}</b>
                        <span className="ml-2 text-[10px] gr-fainter">{r.rel} · co-mentioned ×{r.count}</span>
                      </button>
                      <button onClick={() => setSel(ki)} title="Show sources"
 className="shrink-0 rounded border gr-line px-1.5 text-[10px] gr-fainter gr-hov-ink">src</button>
                    </div>);
                })}
              </Sect>);
          })()}
          {GROUP_ORDER.filter((g) => groups[g]?.length).map((g) => (
            <Sect key={g} count={groups[g].length}
 title={<span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: DOT[g] }} />{GROUP_LABEL[g]}</span>}>
              {groups[g].map((r, i) => (
                <div key={i} className={`${activeCls(sel === r.kindItem && r.kindItem)}mb-1 flex w-full items-start justify-between gap-2 rounded-lg gr-recess p-2 text-left`}>
                  <button onClick={() => (inGraph(r.id) ? onOpen(r.id) : r.kindItem && setSel(r.kindItem))} className="min-w-0 flex-1 text-left">
                    <b className={inGraph(r.id) ? "gr-ink gr-hov-accent" : "gr-ink"}>{r.label}</b>
                    <div className="mt-0.5 truncate text-[10px] gr-fainter">{r.note}</div>
                  </button>
                  {r.kindItem && <button onClick={() => setSel(r.kindItem)} title="Show sources"
 className="shrink-0 rounded border gr-line px-1.5 text-[10px] gr-fainter gr-hov-ink">src</button>}
                </div>))}
            </Sect>))}
        </div>)}
      </div>

      <div className="mt-2 shrink-0 rounded-xl border gr-line gr-recess p-2.5" style={{ maxHeight: srcOpen ? "36%" : undefined, overflowY: "auto" }}>
        <button onClick={() => setSrcOpen(!srcOpen)} className="flex w-full items-center justify-between">
          <span className="text-[10px] font-bold uppercase tracking-widest gr-fainter">Sources{sel && !srcOpen ? ` — ${srcs.length} for the selected item` : ""}</span>
          <span className="text-[10px] gr-fainter">{srcOpen ? "▾" : "▸"}</span>
        </button>
        {srcOpen && sel && (<div className="mt-1.5">
          <div className="mb-1.5 text-[11px] gr-soft">{sel.claim}</div>
          {q && <div className="mb-2 rounded border-l-2 gr-line-quote gr-recess p-2 text-[11px] italic">Quote: “{q}”</div>}
          <div className="mb-2 text-[10px] gr-fainter">{m.m}{m.asOf ? ` · checked ${fmtDate(m.asOf)}` : ""}</div>
          {truth.length > 0 && <><div className="mb-1 text-[9px] font-bold uppercase tracking-widest gr-pos">Official source</div>
            {truth.map((s) => <SrcRow key={s.url} s={s} />)}</>}
          {rest.length > 0 && <><div className="mb-1 mt-2 text-[9px] font-bold uppercase tracking-widest gr-fainter">Also from</div>
            {rest.map((s) => <SrcRow key={s.url} s={s} />)}</>}
        </div>)}
      </div>
      </>)}
    </div>
  );
}

export { Sidebar };

export function createSidebar(el) {
 const root = createRoot(el);
 return {
 show(props) {
 root.render(<Sidebar key={props.node?.id || props.view} {...props} />);
    },
    // The graph view unmounts when the user switches surfaces. This island owns
    // its own React root, so it has to be torn down explicitly — otherwise React
    // warns about an unmounted root on the next mount.
 destroy() {
 root.unmount();
    },
  };
}
