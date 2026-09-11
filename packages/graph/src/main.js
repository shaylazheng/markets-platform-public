// The d3 force graph, mounted by web/src/views/Graph.jsx.
//
// In company-supply-graph this file ran itself on import and read its dataset
// through import.meta.glob. Both had to change here: the view mounts and
// unmounts as the user moves between surfaces (so there is a teardown path), and
// the data now arrives from GET /api/graph/data at runtime, so a refresh landing
// in the background is visible without a rebuild.
import "./style.css";
import * as d3 from "d3";
import { createSidebar } from "./sidebar.jsx";
import { isCompanyName, NAME_KEY } from "./entity.js";

// ---- helpers ----
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fmtUSD = (n) => {
  if (n == null) return "—";
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${a}`;
};
const roleColor = (role = "") => {
  const r = role.toLowerCase();
  if (r === "mentioned" || r.includes("draft")) return "var(--mention)";
  if (r.includes("foundry") || r.includes("memory") || r.includes("materials") || r.includes("component")) return "var(--supplier)";
  if (r.includes("chip")) return "var(--chip)";
  if (r.includes("buyer") || r.includes("cloud")) return "var(--buyer)";
  return "var(--oem)";
};
const moveClass = (pct = "") => (pct.includes("-") ? "neg" : /[1-9]/.test(pct) ? "pos" : "flat");

// ---- relationship classification (focus mode) ----
// Same 4 CVD-validated hues as the role palette, remapped semantically.
const REL_COLOR = { supplier: "var(--supplier)", customer: "var(--buyer)", competitor: "var(--chip)", partner: "var(--oem)", other: "var(--mention)" };
const REL_LABEL = { supplier: "Supplier", customer: "Buyer / customer", competitor: "Competitor", partner: "Partner", other: "Other / unclassified" };
const INVERT = { supplier: "customer", customer: "supplier", competitor: "competitor", partner: "partner", other: "other" };
const classifyRel = (str = "") => {
  const s = String(str).toLowerCase();
  if (/supplier|foundry|fabricates|memory|component|cover glass|subsidiary/.test(s)) return "supplier";
  if (/customer|buyer/.test(s)) return "customer";
  if (/competitor|rival/.test(s)) return "competitor";
  if (/partner|investor|investee|acquisition|acquirer|merger|developer/.test(s)) return "partner";
  return "other";
};
// role of the node on the OTHER end of link l, relative to node xId
function relFromLink(l, xId) {
  const s = l.source.id || l.source, t = l.target.id || l.target;
  if (l.type === "supply") return s === xId ? "customer" : "supplier";
  const r = classifyRel(l.note);
  return s === xId ? r : INVERT[r];
}

/**
 * Mount the graph into `root` (the element rendered by views/Graph.jsx).
 * Returns a teardown function: stops the simulation, drops listeners, and
 * unmounts the sidebar island, so switching surfaces leaks nothing.
 */
export async function mountGraph(root, opts = {}) {
  /* The surface tells its host which company it is centred on. Graph.jsx needs
     this to show whether the canvas has drifted from the company the rest of
     the Company group is on — and it is a callback rather than shared state on
     purpose: entering a company HERE must never write to the shared company,
     or every tab switch would drag the other four surfaces along with it. */
  const onRoot = typeof opts.onRoot === "function" ? opts.onRoot : () => {};
  const onBusy = typeof opts.onBusy === "function" ? opts.onBusy : () => {};
  const $ = (sel) => root.querySelector(sel);
  const $$ = (sel) => root.querySelectorAll(sel);
  const timers = new Set();
  const every = (fn, ms) => { const t = setInterval(fn, ms); timers.add(t); return t; };
  const stop = (t) => { clearInterval(t); timers.delete(t); };

  // If the view unmounts while this is in flight, Graph.jsx calls the teardown
  // it eventually receives — cancellation is owned there, not here.
  /* Share-of-revenue edge weights, fetched beside the graph itself. Optional
     on purpose: it is a second request over local files, and a graph that
     draws with uniform lines is far better than one that does not draw. */
  const concPromise = fetch("/api/graph/concentration/all")
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

  const payload = await fetch("/api/graph/data").then((r) => {
    if (!r.ok) throw new Error(`graph data unavailable (HTTP ${r.status})`);
    return r.json();
  });

  const graph = payload.graph || { nodes: [], links: [] };
  const intel = payload.earnings || {};
  const sourcesByTicker = payload.sources || {};

  // ---- assemble nodes/links: SEC graph + mention-only companies from earnings calls ----
  const nodes = graph.nodes.map((d) => ({ ...d, intel: intel[d.id] || null }));
  const links = graph.links.map((d) => ({ ...d, type: "supply" }));
const nodeById = new Map(nodes.map((n) => [n.id, n]));
const linkedPair = new Set(links.map((l) => [l.source, l.target].sort().join("|")));

const byNameKey = new Map();   // normalised name -> node, for the dedupe above
let droppedMentions = 0;
for (const [ticker, it] of Object.entries(intel)) {
  if (!nodeById.has(ticker) || !Array.isArray(it.mentions)) continue;
  for (const m of it.mentions) {
    const id = (m.ticker || m.name || "").trim();
    if (!id || id === ticker) continue;
    // A ticker is self-evidently one company; a bare name has to earn it.
    if (!m.ticker && !isCompanyName(m.name || id)) { droppedMentions++; continue; }
    const key = m.ticker ? null : NAME_KEY(m.name || id);
    const dupe = key && byNameKey.get(key);
    if (!nodeById.has(id) && !dupe) {
      const stub = { id, name: m.name || id, role: "Mentioned", mentionOnly: true,
        revenue: null, netIncome: null, rnd: null, hasSecData: false, mentionedBy: [] };
      nodes.push(stub);
      nodeById.set(id, stub);
      if (key) byNameKey.set(key, stub);
    }
    const target = dupe && !nodeById.has(id) ? dupe : nodeById.get(id);
    if (!target) continue;
    (target.mentionedBy ??= []).push({ by: ticker, relationship: m.relationship, context: m.context });
    const tid = target.id;                       // may differ from `id` after a dedupe
    const pair = [ticker, tid].sort().join("|");
    if (!linkedPair.has(pair)) {
      linkedPair.add(pair);
      links.push({ source: ticker, target: tid, type: "mention", note: m.relationship || "mentioned" });
    }
  }
}

// ---- draft companies from 10-K quick scans (scripts/graph/scan10k.mjs) ----
let draftCount = 0;
for (const d of Object.values(payload.drafts || {})) {
  const t = (d.ticker || "").toUpperCase();
  if (!t) continue;
  const hasIntel = !!intel[t];
  let n = nodeById.get(t);
  if (!n) {
    if (hasIntel) continue; // researched but not in graph.json yet — wait for pull
    n = { id: t, name: d.name || t, role: "Draft (10-K scan)", revenue: d.revenue ?? null,
      netIncome: d.netIncome ?? null, rnd: null, fiscalEnd: d.fiscalEnd ?? null,
      hasSecData: d.revenue != null, mentionedBy: [] };
    nodes.push(n);
    nodeById.set(t, n);
  }
  n.filingsInfo = d; // filing co-mention layer: kept even for fully researched companies
  if (!hasIntel) { n.draft = true; n.draftInfo = d; draftCount++; }
  for (const r of d.related || []) {
    const rid = (r.ticker || r.name || "").trim();
    if (!rid || rid === t) continue;
    if (!r.ticker && !isCompanyName(r.name || rid)) { droppedMentions++; continue; }
    if (!nodeById.has(rid)) {
      const stub = { id: rid, name: r.name || rid, role: "Mentioned", mentionOnly: true,
        revenue: null, netIncome: null, rnd: null, hasSecData: false, mentionedBy: [] };
      nodes.push(stub);
      nodeById.set(rid, stub);
    }
    const pair = [t, rid].sort().join("|");
    if (!linkedPair.has(pair)) {
      linkedPair.add(pair);
      links.push({ source: t, target: rid, type: "mention", draft: true, note: `${r.rel || "related"} (10-K draft)` });
    }
  }
}

// node cards: informative rects, not circles. Dimensions precomputed per node;
// collision uses the card's circumscribed circle so cards can never overlap.
const nmShort = (s = "") => s.split(/,| Inc\.?| Corp| CORP| Co\b| Ltd| LTD| PLC|\/|\(/)[0].trim();
nodes.forEach((n) => {
  if (n.mentionOnly) {
    n.cardLabel = n.id.length <= 7 ? n.id : nmShort(n.name || n.id).slice(0, 14);
    n.dw = Math.max(38, n.cardLabel.length * 5.8 + 16);
    n.dh = 18;
  } else {
    n.dw = 84;
    n.dh = 22;
  }
});
const collideR = (n) => Math.hypot(n.dw, n.dh) / 2 + 6;

// neighbor lookup for highlighting
const neighbors = new Map(nodes.map((n) => [n.id, new Set([n.id])]));
links.forEach((l) => {
  neighbors.get(l.source).add(l.target);
  neighbors.get(l.target).add(l.source);
});

// disclosure verbosity: researched companies whose public calls + filings name few
// companies (sparse cluster = disclosure style, not missing data — e.g. CPG vs tech)
const neighborCount = (id) => Math.max(0, (neighbors.get(id)?.size || 1) - 1);
const QUIET_MAX = 5;
const isQuiet = (id) => !!nodeById.get(id)?.intel && neighborCount(id) <= QUIET_MAX;
const quietList = nodes.filter((n) => isQuiet(n.id)).map((n) => n.id).sort();

// ---- sidebar meta ----
const intelCount = Object.keys(intel).length;
const intelDate = Object.values(intel).map((i) => i.asOf).filter(Boolean).sort().pop();
$("#meta").innerHTML = `
  <div><b>${nodes.length}</b> companies · <b>${links.filter((l) => l.type === "supply").length}</b> supply links
  · <b>${links.filter((l) => l.type === "mention").length}</b> earnings-call mentions${draftCount ? ` · <b>${draftCount}</b> draft` : ""}</div>
  <div style="margin-top:6px">SEC XBRL fundamentals${graph.generatedAt ? ` (${graph.generatedAt.slice(0, 10)})` : ""} ·
  earnings intel for <b>${intelCount}</b> names${intelDate ? ` (as of ${intelDate})` : ""}</div>
  ${quietList.length ? `<div style="margin-top:6px">🤫 Quiet disclosers — public filings name few companies: <b>${quietList.join(", ")}</b></div>` : ""}`;
$("footer .src").textContent = graph.source || "";

// ---- first-seen ledger (scripts/graph/ledger.mjs → data/ledger.json) ----
// "new" = certain data that first appeared within NEW_DAYS (baseline import excluded)
const ledgerEntries = payload.ledger?.entries || {};
const NEW_DAYS = 7;
const isNewKey = (k) => {
  const e = ledgerEntries[k];
  return !!e && !e.baseline && Date.now() - new Date(e.firstSeen).getTime() < NEW_DAYS * 864e5;
};
const isNewNode = (d) => !d.draft && isNewKey(`n:${d.id}`);
const isNewLink = (l) => {
  if (l.draft) return false;
  const s = l.source.id || l.source, t = l.target.id || l.target;
  return isNewKey(`e:${[s, t].sort().join("|")}`);
};

// ---- signals feed (scripts/graph/signals.mjs → data/signals.json) ----
const signalsData = payload.signals || null;
function renderSignals() {
  const sec = $("#signals-sec");
  if (!signalsData?.signals?.length) return; // stays hidden until the first poll writes the file
  sec.hidden = false;
  $("#signals-title").textContent =
    `⚡ Signals (${signalsData.signals.length}) · ${signalsData.updatedAt?.slice(0, 16).replace("T", " ") || ""}`;
  $("#signals-list").innerHTML = signalsData.signals.slice(0, 30).map((s) => `
    <div class="sig${s.hot ? " hot" : ""}">
      <div class="top"><span class="tk" data-tk="${esc(s.ticker)}">${esc(s.ticker)}</span>
        <span class="ch">${esc(s.channel)}</span><span>${esc(s.ts)}</span>
        <span class="upd" data-upd="${esc(s.ticker)}" title="Re-research ${esc(s.ticker)} to fold this into the graph">↻ verify</span></div>
      <a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>
    </div>`).join("");
  $$("#signals-list .tk").forEach((el) =>
    el.addEventListener("click", () => nodeById.has(el.dataset.tk) && select(el.dataset.tk)));
  $$("#signals-list .upd").forEach((el) =>
    el.addEventListener("click", () => runJob("refresh", el.dataset.upd)));
}

function renderLegend() {
  const eline = (attrs) => `<svg viewBox="0 0 26 10"><line x1="0" y1="5" x2="26" y2="5" ${attrs}></line></svg>`;
  const swatch = (c, t) => `<div class="gk-row"><span class="dot" style="background:${c}"></span>${t}</div>`;
  const section = (title, rows) => (rows ? `<div class="gk-sec">${title}</div>${rows}` : "");

  /* RELATIONSHIP is the canvas's colour channel and always comes first: it is
     what a company is TO the one at the centre, which is the question this
     surface exists to answer. */
  const relRows = Object.keys(REL_COLOR).map((k) => swatch(REL_COLOR[k], REL_LABEL[k])).join("");

  /* SECTOR ROLE is a different question — what a company IS, irrespective of
     anyone else — so it gets its own section rather than sharing the first
     one's swatches. Only the roles actually on the canvas are listed; a key
     that names roles nothing is drawn in is a catalogue, not a key. Deduped by
     COLOUR, because roleColor() maps several roles onto one hue and repeating
     a swatch reads as a distinction that is not being drawn. */
  const seen = new Map();
  for (const id of view.roots) {
    const r = nodeById.get(id)?.role;
    if (!r) continue;
    const c = roleColor(r);
    if (!seen.has(c)) seen.set(c, r);
  }
  const roleRows = [...seen].map(([c, r]) => swatch(c, r)).join("");

  $("#graph-key .gk-body").innerHTML =
    section("Relationship to the centre", relRows) +
    section("Sector role — centre only", roleRows) +
    section("Lines",
      `<div class="gk-row">${eline('stroke="var(--edge)" stroke-width="1.6"')}supply link</div>` +
      `<div class="gk-row">${eline('stroke="var(--mention)" stroke-width="1.4" stroke-dasharray="2 4"')}mentioned / draft</div>` +
      `<div class="gk-row">${eline('stroke="var(--edge)" stroke-width="6"')}thicker = larger disclosed share of revenue</div>` +
      `<div class="gk-row">${eline(`stroke="${corrColor(0.7)}" stroke-width="3"`)}brighter = the two move together more</div>` +
      `<div class="gk-row"><span class="dot dash-demo"></span>? = unverified · <span style="color:var(--accent)">halo</span> = new</div>`) +
    (view.roots.length
      ? `<div class="gk-note">${view.roots.length === 1
          ? `Every line touches ${esc(view.roots[0])} — direct counterparties only`
          : `${view.roots.length} graphs shown — every line touches one of ${esc(view.roots.join(", "))}; companies in more than one appear once`}</div>`
      : "");
}

// ---- svg + zoom ----
const graphEl = $("#graph");
let width = graphEl.clientWidth, height = graphEl.clientHeight;
const svg = d3.select(graphEl).append("svg").attr("viewBox", [0, 0, width, height]);

svg.append("defs").html(`
  <marker id="arrow" viewBox="0 -5 10 10" refX="22" refY="0" markerWidth="6" markerHeight="6" orient="auto">
    <path d="M0,-4L8,0L0,4" fill="var(--edge)"></path>
  </marker>
  <marker id="arrow-hi" viewBox="0 -5 10 10" refX="22" refY="0" markerWidth="6.5" markerHeight="6.5" orient="auto">
    <path d="M0,-4L8,0L0,4" fill="var(--edge-hi)"></path>
  </marker>`);

const zoomG = svg.append("g");
svg.call(d3.zoom().scaleExtent([0.3, 4]).on("zoom", (e) => zoomG.attr("transform", e.transform)));

// ---- force simulation ----
// cluster force: pull nodes sharing a color group toward that group's centroid,
// so same-colored nodes bunch together (roles in full mode, relationships in focus mode)
/* Bunch the counterparties by what they are TO the entered company, so
   suppliers gather on one side and customers on another. There is only ever one
   root now, so the old cluster-membership scoping (which kept two saved graphs'
   same-coloured nodes from pulling together) has nothing left to disambiguate. */
const colorGroup = (d) => {
  if (!visNow.has(d.id) || isRoot(d.id)) return null;
  // Scope the bunching to the graph(s) a company belongs to. Same relationship
  // under two different roots must NOT pull together, or two saved graphs that
  // share nothing drift into one another; companies reached by both roots get a
  // group of their own and settle on the seam between the clusters.
  const m = view.member.get(d.id);
  return `${m ? m.join("+") : "?"}:${view.rel.get(d.id) || "other"}`;
};
function forceCluster(strength = 0.32) {
  let ns;
  function force(alpha) {
    const cents = new Map();
    for (const d of ns) {
      const g = colorGroup(d);
      if (!g) continue;
      const c = cents.get(g) || { x: 0, y: 0, n: 0 };
      c.x += d.x; c.y += d.y; c.n++;
      cents.set(g, c);
    }
    for (const c of cents.values()) { c.x /= c.n; c.y /= c.n; }
    for (const d of ns) {
      const c = cents.get(colorGroup(d));
      if (!c || c.n < 2) continue;
      d.vx += (c.x - d.x) * strength * alpha;
      d.vy += (c.y - d.y) * strength * alpha;
    }
  }
  force.initialize = (n) => (ns = n);
  return force;
}

const sim = d3.forceSimulation(nodes)
  .force("link", d3.forceLink(links).id((d) => d.id)
    .distance((l) => (l.type === "mention" ? 105 : 150))
    .strength((l) => (l.type === "mention" ? 0.25 : 0.5)))
  .force("charge", d3.forceManyBody().strength((d) => (d.mentionOnly ? -260 : -650)))
  .force("center", d3.forceCenter(width / 2, height / 2))
  .force("cluster", forceCluster())
  .force("collide", d3.forceCollide().radius(collideR).iterations(2));

/* Keyed on the disclosing company: a share is a share OF ITS revenue, so
   SWKS->AAPL 57% is Apple being 57% of Skyworks, not the reverse. */
const CONCENTRATION = await concPromise;
function shareOf(d) {
  const s = typeof d.source === "object" ? d.source.id : d.source;
  const tg = typeof d.target === "object" ? d.target.id : d.target;
  const e = CONCENTRATION?.edges?.[`${s}|${tg}`] || CONCENTRATION?.edges?.[`${tg}|${s}`];
  return e ? e.share : null;
}

const link = zoomG.append("g").selectAll("line").data(links).join("line")
  .attr("class", (d) => `link ${d.type === "mention" ? "mention" : d.verified ? "" : "unverified"}${d.draft ? " draft" : ""}${isNewLink(d) ? " new" : ""}`)
  .attr("marker-end", (d) => (d.type === "supply" ? "url(#arrow)" : null))
  .call((sel) => sel.append("title"))
  /* A supply link's width is the share of the DISCLOSING company's revenue
     that runs through it, where a filing discloses one. Most do not — the
     reporting threshold is 10%, so anything smaller is never named — and those
     keep the base width rather than being drawn as hairlines, which would read
     as "small relationship" instead of "not disclosed". */
  .attr("stroke-width", (d) => {
    if (d.type === "mention") return 1.1;
    const share = shareOf(d);
    return share == null ? 1.4 : 1.4 + Math.min(share, 0.6) * 9;
  })
  .attr("data-share", (d) => { const s = shareOf(d); return s == null ? null : s.toFixed(3); })
  /* Only verified supply links animate. A dashed "unverified" link already
     uses stroke-dasharray to mean something else, and animating a relationship
     we have not confirmed would lend it a confidence it has not earned. */
  .classed("flowing", (d) => d.type === "supply" && d.verified)
  .classed("fast", (d) => (shareOf(d) ?? 0) >= 0.25);

const node = zoomG.append("g").selectAll("g").data(nodes).join("g")
  .attr("class", (d) => `node${d.mentionOnly ? " mention-only" : ""}${d.draft ? " draft" : ""}${isNewNode(d) ? " new" : ""}`)
  .call(d3.drag()
    .on("start", (e, d) => { if (!e.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (e, d) => { d.fx = e.x; d.fy = e.y; })
    .on("end", (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null; }))
  .on("click", (e, d) => { e.stopPropagation(); select(d.id); })
  .on("dblclick", (e, d) => { e.stopPropagation(); focusOn(d.id); });

node.append("rect").attr("class", "halo").attr("rx", 10)
  .attr("x", (d) => -d.dw / 2 - 5).attr("y", (d) => -d.dh / 2 - 5)
  .attr("width", (d) => d.dw + 10).attr("height", (d) => d.dh + 10);
node.append("rect").attr("class", "card").attr("rx", (d) => (d.mentionOnly ? 9 : 7))
  .attr("x", (d) => -d.dw / 2).attr("y", (d) => -d.dh / 2)
  .attr("width", (d) => d.dw).attr("height", (d) => d.dh);
node.append("rect").attr("class", "bar")
  .attr("display", (d) => (d.mentionOnly ? "none" : null))
  .attr("x", (d) => -d.dw / 2).attr("y", (d) => -d.dh / 2)
  .attr("width", 3.5).attr("height", (d) => d.dh).attr("rx", 1.75);
node.append("text").attr("class", "tick")
  .attr("x", (d) => (d.mentionOnly ? 0 : -d.dw / 2 + 9))
  .attr("y", 3.5)
  .attr("text-anchor", (d) => (d.mentionOnly ? "middle" : "start"))
  .text((d) => (d.mentionOnly ? d.cardLabel : d.draft ? `${d.id} ?` : d.id));
node.append("text").attr("class", "nbadge")
  .attr("x", (d) => d.dw / 2 - 7).attr("y", 3.5).attr("text-anchor", "end")
  .attr("display", (d) => (d.mentionOnly ? "none" : null));
node.append("title");


/* A card is 84px wide: enough for a ticker and a "+1%" price move, uniform
   across the canvas because cards of ragged widths read as an encoding that
   means nothing. */
const BASE_DW = 84;

function resizeCards() {
  for (const n of nodes) if (!n.mentionOnly) n.dw = BASE_DW;

  node.select(".halo").attr("x", (d) => -d.dw / 2 - 5).attr("width", (d) => d.dw + 10);
  node.select(".card").attr("x", (d) => -d.dw / 2).attr("width", (d) => d.dw);
  node.select(".bar").attr("x", (d) => -d.dw / 2);
  node.select(".tick").attr("x", (d) => (d.mentionOnly ? 0 : -d.dw / 2 + 9));
  node.select(".nbadge").attr("x", (d) => d.dw / 2 - 7);

  /* Re-seat the collision radius: wider cards need more room, and without this
     they overlap until the next unrelated nudge to the simulation.
     `visNow` is empty before the first focus is applied, and an empty set must
     mean "everything counts" rather than "nothing does" — reading it the other
     way gives every node a zero radius and collapses the layout to a point. */
  sim.force("collide").radius((d) => (visNow.size && !visNow.has(d.id) ? 0 : collideR(d)));
  sim.alpha(0.3).restart();
}

/* The researched intel sometimes writes movePct as a phrase ("~-5% intraday,
   recovered next day") rather than a figure. The card is a fixed 84px, so
   anything past a bare percent paints across the canvas: keep the percent
   token on the badge and hand the full phrase to the hover title instead.
   No token at all means show nothing — decline rather than guess. */
const compactMove = (raw) => {
  const s = String(raw || "").trim();
  if (s.length <= 7) return s;
  return s.match(/[~≈+\-−]?\d+(?:\.\d+)?%/)?.[0] || "";
};

function paint() {
  /* One question, one colour channel: what is this company TO the company at
     the centre. Sector role (foundry, fabless, sponsor bank) is a different
     question and gets the root's own accent and its own section in the key,
     rather than competing for the same hue. */
  const accentOf = (d) => {
    if (isRoot(d.id)) return roleColor(d.role);
    if (view.rel.has(d.id)) return REL_COLOR[view.rel.get(d.id) || "other"];
    return roleColor(d.role);
  };
  node.select(".card")
    .attr("stroke", accentOf)
    .attr("stroke-opacity", 0.95)
    .attr("fill-opacity", (d) => (d.mentionOnly ? 0.72 : 0.94));
  node.select(".bar").attr("fill", accentOf).attr("fill-opacity", 1);
  node.select(".nbadge")
    .text((d) => compactMove(d.intel?.priceMovers?.[0]?.movePct))
    .attr("fill", (d) => (/[-−]/.test(compactMove(d.intel?.priceMovers?.[0]?.movePct)) ? "var(--neg)" : "var(--pos)"));
  node.classed("focus-center", (d) => focus && d.id === focus.id);
  node.classed("root", (d) => isRoot(d.id) && d.id !== focus?.id);
  node.select("title").text((d) => {
    const m = view.member.get(d.id) || [];
    const relLine = isRoot(d.id)
      ? `\nRoot of this graph`
      : view.rel.has(d.id)
        ? `\n${REL_LABEL[view.rel.get(d.id) || "other"]} of ${m.join(" and ")}` : "";
    const flags = (d.draft ? "\n? uncertain — 10-K scan draft, not yet verified" : "")
      + (isQuiet(d.id) ? `\n🤫 quiet discloser — names only ${neighborCount(d.id)} companies publicly` : "")
      + (isNewNode(d) ? `\n◉ NEW — first seen ${ledgerEntries[`n:${d.id}`]?.firstSeen}` : "");
    const mv = String(d.intel?.priceMovers?.[0]?.movePct || "").trim();
    const moveLine = mv && mv !== compactMove(mv) ? `\nLast print: ${mv}` : "";
    return (d.mentionOnly
      ? `${d.name}\nMentioned in: ${(d.mentionedBy || []).map((m) => m.by).join(", ")}${relLine}`
      : `${d.name}\n${d.role}\nRevenue: ${fmtUSD(d.revenue)}${relLine}`) + flags + moveLine;
  });
}

sim.on("tick", () => {
  link.attr("x1", (d) => d.source.x).attr("y1", (d) => d.source.y)
      .attr("x2", (d) => d.target.x).attr("y2", (d) => d.target.y);
  node.attr("transform", (d) => `translate(${d.x},${d.y})`);
});

// ---- focus mode: two layers around one company, colored by relationship ----
let focus = null;

// ---- roots: the entered company, plus any saved graphs switched on ----
//
// A graph is one company's ego net. The canvas shows the UNION of every visible
// one: the company entered in the sub-header (transient, replaced on the next
// entry) and each saved graph whose toggle is on.
//
// The union is over NODES and over EDGES separately, and that distinction is the
// whole correctness of the merge. A node is a Set member, so a company reached
// from two roots is stored once and both roots' edges land on that single card —
// which is what wires two graphs together where they overlap. An edge is only in
// the union if some visible root actually claims it, so two graphs that share
// nothing stay two disconnected clusters instead of being stitched together by
// links neither of them owns. The old workspace unioned nodes and then drew any
// link whose two ends were both visible, which is why one saved graph produced
// 81 lines for 23 relationships.
localStorage.removeItem("workspace");           // the pre-2026 auto-history key
sessionStorage.removeItem("currentView");
const SAVED_KEY = "graphRoots";

let saved = [];
try { saved = JSON.parse(localStorage.getItem(SAVED_KEY) || "[]").filter((r) => r && r.t); }
catch { saved = []; }
const persist = () => localStorage.setItem(SAVED_KEY, JSON.stringify(saved));
const isSaved = (id) => saved.some((r) => r.t === id);

/* The merged, currently-drawn graph. Rebuilt from (focus, saved) on every
   change; nothing else may write to it. */
let view = { roots: [], visible: new Set(), edges: new Set(), rel: new Map(), member: new Map() };
const isRoot = (id) => view.roots.includes(id);
let visNow = new Set();

function rebuildView() {
  const roots = saved.filter((r) => r.on).map((r) => r.t);
  if (focus && !roots.includes(focus.id)) roots.push(focus.id);

  const visible = new Set(), edges = new Set(), rel = new Map(), member = new Map();
  for (const rt of roots) {
    const f = rt === focus?.id ? focus : computeFocus(rt);
    for (const id of f.visible) {
      visible.add(id);
      const m = member.get(id);
      if (m) m.push(rt); else member.set(id, [rt]);
      // A company can be a supplier to one root and a customer of another. It
      // gets one card, so it gets one colour: the first root that claimed it.
      // `member` records the rest, and the rail marks it as shared.
      if (!rel.has(id) && id !== rt) rel.set(id, f.rel.get(id) || "other");
    }
    for (const l of f.edges) edges.add(l);
  }
  view = { roots, visible, edges, rel, member };
}

/**
 * The entered company and everything ONE hop from it, together with the links
 * that got them there.
 *
 * Returning `edges` rather than letting the caller re-derive them from the node
 * set is the whole fix for the hairball. `applyFocus` used to draw any link
 * whose two ends both happened to be visible, so NVDA alone drew 81 lines of
 * which only 23 touched NVDA — the other 58 were edges between NVDA's
 * counterparties, which say nothing about NVDA. Depth is 1 for the same reason:
 * the assembled graph is 227 nodes once the earnings-call mention layer and the
 * 10-K draft layer are folded in, and two hops from a hub is 59% of it.
 */
function computeFocus(id) {
  const layers = new Map([[id, 0]]);
  const rel = new Map();
  const edges = new Set();
  const rows = [];
  for (const l of links) {
    const s = l.source.id || l.source, t = l.target.id || l.target;
    const other = s === id ? t : t === id ? s : null;
    if (other == null || other === id) continue;
    edges.add(l);
    if (!layers.has(other)) {
      const r = relFromLink(l, id);
      layers.set(other, 1);
      rel.set(other, r);
      rows.push({ id: other, name: nodeById.get(other)?.name || other, rel: r,
                  type: l.type, note: l.note || "", verified: !!l.verified });
    }
  }
  const ORDER = { supplier: 0, customer: 1, partner: 2, competitor: 3, other: 4 };
  rows.sort((a, b) => (ORDER[a.rel] - ORDER[b.rel]) || a.id.localeCompare(b.id));
  return { id, layers, rel, edges, rows, visible: new Set(layers.keys()) };
}

/* ---- saved graphs -------------------------------------------------------
   Saving keeps a company's graph available as a toggle. The saved list is the
   only thing that persists; the entered company is not saved unless you say so. */
function saveGraph(id) {
  if (!id || isSaved(id)) return;
  saved.push({ t: id, on: true });
  persist();
  applyFocus();
  if (selected) renderDetail(selected);   // the ★ becomes "saved"
}
function unsaveGraph(id) {
  saved = saved.filter((r) => r.t !== id);
  persist();
  applyFocus();
  if (selected) renderDetail(selected);
}
function toggleGraph(id) {
  const r = saved.find((x) => x.t === id);
  if (!r) return;
  r.on = !r.on;
  persist();
  applyFocus();
}

/** How many companies each saved graph shares with the rest of what is shown —
 *  the count that explains why two clusters are joined. */
function sharedCount(rootId) {
  let n = 0;
  for (const [, roots] of view.member) if (roots.length > 1 && roots.includes(rootId)) n++;
  return n;
}

function renderSaved() {
  const el = $("#saved-list");
  if (!el) return;
  if (!saved.length) {
    el.innerHTML = `<div class="ws-empty">No saved graphs. Enter a company, then press ★ Save graph in its panel to keep it here.</div>`;
    return;
  }
  el.innerHTML = saved.map((r) => {
    const n = nodeById.get(r.t);
    const rels = n ? computeFocus(r.t).rows.length : 0;
    const sh = r.on ? sharedCount(r.t) : 0;
    return `<div class="ws-row${r.on ? "" : " off"}">
      <input type="checkbox" ${r.on ? "checked" : ""} data-ws-toggle="${esc(r.t)}" title="Show or hide this graph on the canvas">
      <span class="ws-name" data-ws-open="${esc(r.t)}">${esc(r.t)}<small> · ${esc((n?.name || "").slice(0, 18))} · ${rels} connections${sh ? ` · <span class="ws-shared">${sh} shared</span>` : ""}</small></span>
      <button class="ws-x" data-ws-remove="${esc(r.t)}" title="Forget this saved graph">✕</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-ws-toggle]").forEach((b) =>
    b.addEventListener("change", () => toggleGraph(b.dataset.wsToggle)));
  el.querySelectorAll("[data-ws-open]").forEach((b) =>
    b.addEventListener("click", () => focusOn(b.dataset.wsOpen)));
  el.querySelectorAll("[data-ws-remove]").forEach((b) =>
    b.addEventListener("click", () => unsaveGraph(b.dataset.wsRemove)));
}

/* Every company currently drawn, alphabetical.
 *
 * Distinct from Connections, which only ever describes the ACTIVE root. With
 * two or three saved graphs up, most of what is on the canvas is not in that
 * list, so there was no way to read off what you were actually looking at.
 * This is the inventory: roots first, then everyone else, each marked with the
 * graph(s) it came from and what it is to them. */
function renderCompanies() {
  const el = $("#companies-list");
  if (!el) return;
  const ids = [...view.visible];
  if (!ids.length) {
    el.innerHTML = `<div class="ws-empty">Nothing on the canvas yet.</div>`;
    return;
  }
  ids.sort((a, b) => {
    const ra = isRoot(a), rb = isRoot(b);
    if (ra !== rb) return ra ? -1 : 1;       // roots first
    return a.localeCompare(b);
  });
  const researched = ids.filter((i) => nodeById.get(i)?.intel).length;
  $("#companies-sub").textContent = `${ids.length} shown · ${researched} researched`;
  el.innerHTML = ids.map((id) => {
    const n = nodeById.get(id) || { id };
    const root = isRoot(id);
    const rel = view.rel.get(id);
    const from = view.member.get(id) || [];
    const tag = root
      ? `<span class="cl-root">root</span>`
      : `<span class="cl-dot" style="background:${REL_COLOR[rel] || "var(--mention)"}"></span>`;
    const note = root
      ? `${computeFocus(id).rows.length} connections`
      : `${REL_LABEL[rel] || "Other"} of ${from.join(", ")}`;
    const state = n.intel ? "" : n.draft ? " · researching" : n.mentionOnly ? " · mention only" : " · not loaded";
    return `<div class="ws-row cl-row${root ? " cl-is-root" : ""}">
      ${tag}
      <span class="ws-name" data-cl-open="${esc(id)}">${esc(id)}<small> · ${esc((n.name || "").slice(0, 20))}</small>
        <small class="cl-note">${esc(note)}${esc(state)}</small></span>
      <button class="ws-x" data-cl-root="${esc(id)}" title="Centre the canvas on ${esc(id)}">→</button>
    </div>`;
  }).join("");
  el.querySelectorAll("[data-cl-open]").forEach((b) =>
    b.addEventListener("click", () => select(b.dataset.clOpen)));
  el.querySelectorAll("[data-cl-root]").forEach((b) =>
    b.addEventListener("click", () => focusOn(b.dataset.clRoot)));
}

/* The right rail's list of what the entered company is connected to, grouped by
   relationship — a readout of the active root, not a store of anything. */
function renderConnections() {
  const el = $("#conn-list");
  if (!el) return;
  /* Deliberately says nothing when the canvas is empty. This used to read
     "245 companies indexed", which described a dataset nobody asked to see and
     counted 206 synthesised stubs among the 39 real companies. */
  /* The counts used to be repeated in a surface-level strip. They are the
     rail's facts tiles now — one place, reported from applyFocus. */
  const shownGraphs = view.roots.length;
  if (!focus) {
    el.innerHTML = shownGraphs
      ? `<div class="ws-empty">Showing ${shownGraphs} saved graph${shownGraphs === 1 ? "" : "s"}. Enter a company above to add one to the canvas.</div>`
      : `<div class="ws-empty">No company entered — type a ticker or name in the search field above.</div>`;
    return;
  }
  const { rows } = focus;
  if (!rows.length) {
    el.innerHTML = `<div class="ws-empty">${esc(focus.id)} names no other company in the data loaded so far.</div>`;
    return;
  }
  let out = "", lastRel = null;
  for (const r of rows) {
    if (r.rel !== lastRel) {
      lastRel = r.rel;
      const n = rows.filter((x) => x.rel === r.rel).length;
      out += `<div class="conn-head"><span class="conn-dot" style="background:${REL_COLOR[r.rel]}"></span>${esc(REL_LABEL[r.rel])} · ${n}</div>`;
    }
    const alsoIn = (view.member.get(r.id) || []).filter((x) => x !== focus.id);
    out += `<div class="ws-row">
      <span class="ws-name" data-ws-open="${esc(r.id)}" title="${esc(r.note)}">${esc(r.id)}<small> · ${esc((r.name || "").slice(0, 22))}${r.verified ? " · ✓" : ""}${r.type === "mention" ? " · call mention" : r.type === "draft" ? " · 10-K scan" : ""}${alsoIn.length ? ` · <span class="ws-shared">also in ${esc(alsoIn.join(", "))}</span>` : ""}</small></span>
      <button class="ws-x" data-ws-root="${esc(r.id)}" title="Make ${esc(r.id)} the entered company">→</button>
    </div>`;
  }
  el.innerHTML = out;
  el.querySelectorAll("[data-ws-open]").forEach((b) =>
    b.addEventListener("click", () => nodeById.has(b.dataset.wsOpen) && select(b.dataset.wsOpen)));
  el.querySelectorAll("[data-ws-root]").forEach((b) =>
    b.addEventListener("click", () => focusOn(b.dataset.wsRoot)));
}


// ---- formation tracker: how fully formed is the visible supply graph? ----
const tickerLike = (id) => /^[A-Z]{1,6}(\.[A-Z])?$/.test(id);
function renderFormation() {
  const el = $("#formation");
  const vis = view.visible;
  if (!vis.size) { el.hidden = true; return; }
  el.hidden = false;
  let researched = 0, researching = 0, loadable = [], priv = 0;
  for (const id of vis) {
    const n = nodeById.get(id);
    if (!n) continue;
    if (n.intel) researched++;
    else if (n.draft) researching++; // the reconciler guarantees drafts are being researched
    else if (tickerLike(id)) loadable.push(id);
    else priv++;
  }
  const denom = researched + researching + loadable.length;
  const pct = denom ? Math.round((researched / denom) * 100) : 100;
  const formed = pct === 100 && researching === 0;
  $("#fm-pct").textContent = formed ? "✓ fully formed" : `${pct}%`;
  $("#fm-pct").classList.toggle("done", formed);
  $("#fm-fill").style.width = `${pct}%`;
  $("#fm-fill").classList.toggle("done", formed);
  $("#fm-detail").innerHTML = formed
    ? `Every listed company in view is fully researched${priv ? ` · ${priv} private/unlisted (as deep as public data goes)` : ""}.`
    : `${researched} researched · ${researching ? `${researching} researching now · ` : ""}${loadable.length} not yet loaded${priv ? ` · ${priv} private/unlisted` : ""}` +
      (loadable.length ? `<br><button class="mini" id="fm-load">⚡ Research all missing (${loadable.length})</button>` : "");
  $("#fm-load")?.addEventListener("click", async () => {
    setLog(`Queued research for ${loadable.length} companies — the graph fills in automatically as each lands.`);
    for (const t of loadable) {
      try { await fetch("/api/graph/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t }) }); }
      catch { setLog("Research queue needs the dev server — run `npm run dev`."); return; }
    }
  });
}

function applyFocus() {
  rebuildView();
  const vis = view.visible;
  visNow = vis;
  renderFormation();
  renderSaved();
  renderCompanies();
  renderConnections();
  node.style("display", (d) => (vis.has(d.id) ? null : "none"));
  // Only links some visible root actually claims. Showing every link between two
  // visible nodes is what turned 23 real relationships into 81 drawn lines, and
  // it is also what would fuse two unrelated saved graphs into one blob.
  link.style("display", (l) => (view.edges.has(l) ? null : "none"));
  $("#empty-hint").hidden = vis.size > 0;
  refreshLinkCorrelation();
  /* Layout.
   *
   * One graph: a radial ring around its centre — the star.
   *
   * Several: give each root its own anchor, evenly spaced on a circle, and pull
   * every other company toward the MEAN of the anchors of the graphs it belongs
   * to. Two consequences, both wanted: a company in one graph sits with that
   * graph, and a company shared by two lands on the seam between them, which is
   * the merge made visible. Leaving this to charge alone was not enough — two
   * disjoint clusters simply repel until one of them is off-canvas, which is
   * what the first NVDA+CLX capture showed. */
  const n = view.roots.length;
  if (n === 1) {
    const only = view.roots[0];
    sim.force("anchorX", null).force("anchorY", null);
    sim.force("radial", d3.forceRadial(
      (d) => (d.id === only ? 0 : 200),
      width / 2, height / 2,
    ).strength((d) => (vis.has(d.id) ? (d.id === only ? 1 : 0.55) : 0)));
  } else if (n > 1) {
    sim.force("radial", null);
    // Wide enough to read as separate clusters, tight enough that a hub with
    // two dozen counterparties still fits between its anchor and the edge.
    const R = Math.min(width * 0.20, height * 0.26);
    const anchor = new Map(view.roots.map((t, i) => {
      // Start at −90° so two graphs sit left/right rather than stacked.
      const a = (2 * Math.PI * i) / n - Math.PI / 2 + (n === 2 ? Math.PI / 2 : 0);
      return [t, [width / 2 + R * Math.cos(a), height / 2 + R * Math.sin(a)]];
    }));
    const target = (d, axis) => {
      const m = view.member.get(d.id);
      if (!m || !m.length) return axis ? height / 2 : width / 2;
      let sum = 0;
      for (const rt of m) sum += anchor.get(rt)[axis];
      return sum / m.length;
    };
    const pull = (d) => (!vis.has(d.id) ? 0 : isRoot(d.id) ? 0.45 : 0.10);
    sim.force("anchorX", d3.forceX((d) => target(d, 0)).strength(pull));
    sim.force("anchorY", d3.forceY((d) => target(d, 1)).strength(pull));
  } else {
    sim.force("radial", null).force("anchorX", null).force("anchorY", null);
  }
  // hidden nodes and undrawn links must not push/pull the visible graph
  const hidden = (d) => !vis.has(d.id);
  sim.force("link").strength((l) => (!view.edges.has(l) ? 0 : l.type === "mention" ? 0.25 : 0.5));
  sim.force("charge").strength((d) => (hidden(d) ? 0 : d.mentionOnly ? -260 : -650));
  sim.force("collide").radius((d) => (hidden(d) ? 0 : collideR(d)));
  paint();
  renderLegend();
  sim.alpha(0.7).restart();
  onRoot({
    id: focus?.id || null,
    name: focus ? nodeById.get(focus.id)?.name || "" : "",
    connections: focus ? focus.rows.length : 0,
    companies: view.visible.size,
    links: view.edges.size,
    graphs: view.roots.length,
  });
}

const focusBar = $("#focus-bar");
const focusName = $("#focus-name");
const refreshBtn = $("#refresh-btn");
const logEl = $("#refresh-log");

function focusOn(id) {
  focus = computeFocus(id);
  focusBar.hidden = false;
  focusName.textContent = `${nodeById.get(id).name} (${id})`;
  history.replaceState(null, "", `#graph&focus=${encodeURIComponent(id)}`);
  applyFocus();
  select(id);
}
function clearFocus() {
  focus = null;
  focusBar.hidden = true;
  logEl.hidden = true;
  history.replaceState(null, "", "#graph");
  applyFocus();
}
$("#clear-btn").addEventListener("click", clearFocus);

/* Entering a company. Reached from the CompanyRail in the sidebar — the ONE
   box on this surface — via the returned api, and from the lookup picker.
   
   The rail could not do this on its own: it is shell chrome and, by design,
   "renders, it does not fetch". So the whole entry path lives here and the rail
   simply hands over the string. Everything the removed top-strip box could do,
   including researching a company that is not in the graph yet, happens here. */
async function enterCompany(query) {
  const q = String(query || "").trim();
  if (!q) return;
  const lower = q.toLowerCase();
  const hit = nodeById.get(q.toUpperCase()) ||
    nodes.find((n) => n.name.toLowerCase() === lower) ||
    nodes.find((n) => n.name.toLowerCase().includes(lower));
  // Entering a company IS the view: it becomes the root and its counterparties
  // are drawn around it. No saving step, and nothing that was there before
  // survives the entry.
  if (hit) { focusOn(hit.id); return; }

  // Not in the dataset: look it up in the full NYSE/Nasdaq universe.
  const t = q.toUpperCase().replace(/[^A-Z0-9.\-]/g, "").slice(0, 12);
  startLoading(`Finding ${t || q}`, LOAD_STEPS);
  let matches = [], apiOk = true;
  try {
    const r = await fetch(`/api/graph/tickers?q=${encodeURIComponent(q)}`);
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    matches = await r.json();
    if (!Array.isArray(matches)) matches = [];
  } catch { apiOk = false; }

  if (!apiOk) {
    return failLoading("Ticker lookup is unavailable",
      "The registry search needs the gateway running — `npm start`, or `npm run dev:api` alongside the dev server.");
  }

  /* An exact ticker match loads straight away. This is the CCB bug: the query
     returns CCBG first and CCB second, the old code rendered BOTH as a picker
     and never loaded anything, so typing a ticker you knew existed appeared to
     do nothing at all. Typing an exact symbol is not an ambiguous request. */
  const exact = matches.find((m) => m.ticker.toUpperCase() === t);
  if (exact) return autoLoad(exact.ticker);

  if (!matches.length) {
    return failLoading(`No NYSE/Nasdaq match for “${q}”`,
      "Nothing in the SEC registrant map matches that. Check the symbol, or research it anyway from the company panel.");
  }

  // Genuinely ambiguous — a name fragment, or a prefix with no exact hit.
  stopLoading();
  sidebar.show({
    view: "lookup", query: q, matches,
    onPick: (tk) => autoLoad(tk),
    onResearch: () => runJob("refresh", t),
  });
}

/* ---- the loading overlay -------------------------------------------------
 *
 * Adding a company is not one action, it is three: look the ticker up in the
 * SEC registry, read its latest 10-K, then research it with Claude. The first
 * takes a moment, the second about a minute and the third several. Until this
 * existed the canvas just stayed empty for all of it, so "still working" and
 * "silently failed" looked exactly alike — which is what made CCB look broken.
 *
 * `steps` is the whole model: an ordered list of labels with one cursor. Nothing
 * here knows which pipeline it is showing, so the same overlay serves the
 * lookup, the scan, the research and the post-reload resume. */
const loadingEl = $("#graph-loading");
const LOAD_STEPS = [
  "Looking the symbol up in the SEC registrant map",
  "Reading its latest 10-K for named counterparties",
  "Researching earnings intel with Claude",
  "Drawing the graph",
];
let load = null;                 // { title, steps, step, at, tick, log, foot }

function renderLoading() {
  if (!load) { loadingEl.hidden = true; return; }
  loadingEl.hidden = false;
  $("#gl-title").textContent = load.title;
  const secs = Math.round((Date.now() - load.at) / 1000);
  $("#gl-elapsed").textContent = secs >= 1 ? `${secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`}` : "";
  $("#gl-steps").innerHTML = load.steps.map((s, i) => {
    const state = i < load.step ? "done" : i === load.step ? "active" : "todo";
    const mark = state === "done" ? "✓" : state === "active" ? "<span class='gl-dot'></span>" : "·";
    return `<li class="gl-step ${state}"><span class="gl-mark">${mark}</span>${esc(s)}</li>`;
  }).join("");
  const log = $("#gl-log");
  log.hidden = !load.log;
  if (load.log) log.textContent = load.log;
  $("#gl-foot").innerHTML = load.foot || "";
  if (load.footAction) {
    $("#gl-foot").querySelector("button")?.addEventListener("click", load.footAction);
  }
}
function startLoading(title, steps) {
  if (load?.tick) stop(load.tick);
  load = { title, steps, step: 0, at: Date.now(), log: "", foot: "" };
  load.tick = every(renderLoading, 1000);     // the elapsed counter
  onBusy(true);
  renderLoading();
}
function advanceLoading(step, patch = {}) {
  if (!load) return;
  Object.assign(load, patch);
  if (step != null) load.step = step;
  renderLoading();
}
function failLoading(title, detail) {
  if (!load) return;
  stop(load.tick);
  loadingEl.hidden = false;
  $("#gl-title").textContent = title;
  $("#gl-elapsed").textContent = "";
  $("#gl-steps").innerHTML = "";
  const log = $("#gl-log");
  log.hidden = !detail; log.textContent = detail || "";
  $("#gl-foot").innerHTML = `<button class="mini" id="gl-dismiss">Dismiss</button>`;
  $("#gl-dismiss").addEventListener("click", stopLoading);
  loadingEl.classList.add("failed");
  load = null;
  onBusy(false);
}
function stopLoading() {
  if (load?.tick) stop(load.tick);
  load = null;
  loadingEl.classList.remove("failed");
  loadingEl.hidden = true;
  onBusy(false);
}

// ---- background jobs: refresh / scan / sweep via the dev-server API ----
function setLog(msg) {
  logEl.hidden = false;
  logEl.textContent = msg;
  if (load) advanceLoading(null, { log: msg });   // mirror into the overlay
}
const JOB_LABEL = { refresh: "Headless Claude is researching", scan: "Scanning the latest 10-K", sweep: "Sweeping all data", signals: "Polling EDGAR / news channels" };
async function runJob(kind, ticker) {
  refreshBtn.disabled = true;
  setLog(`Starting ${kind}${ticker ? ` of ${ticker}` : ""}…`);
  const noTicker = kind === "sweep" || kind === "signals";
  try {
    const r = await fetch(`/api/graph/${kind}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(kind === "sweep" ? { mode: "stale" } : noTicker ? {} : { ticker }),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    await r.json();
  } catch {
    setLog("This button needs the dev server — run `npm run dev` (the built site has no API).");
    refreshBtn.disabled = false;
    return;
  }
  const statusUrl = noTicker ? `/api/graph/${kind}` : `/api/graph/${kind}?ticker=${encodeURIComponent(ticker)}`;
  const poll = every(async () => {
    try {
      const s = await (await fetch(statusUrl)).json();
      if (s.state === "running") setLog(`${JOB_LABEL[kind]}…\n${s.log || ""}`);
      else if (s.state === "done") {
        stop(poll);
        setLog("Done — reloading.");
        if (ticker) history.replaceState(null, "", `#graph&focus=${ticker}`);
        setTimeout(() => location.reload(), 800);
      } else if (s.state === "error") {
        stop(poll);
        setLog(`${kind} failed:\n${s.log || "see dev-server terminal"}`);
        refreshBtn.disabled = false;
      }
    } catch { /* dev server restarting — keep polling */ }
  }, kind === "scan" ? 2500 : 4000);
}
refreshBtn.addEventListener("click", () => focus && runJob("refresh", focus.id));
$("#sweep-btn").addEventListener("click", () => runJob("sweep"));
$("#signals-btn").addEventListener("click", () => runJob("signals"));

// GRAPH zone collapse (remembered across reloads)
const zoneEl = $("#zone-graph");
const zoneApply = (collapsed) => {
  zoneEl.classList.toggle("collapsed", collapsed);
  $("#zone-caret").textContent = collapsed ? "▸" : "▾";
  localStorage.setItem("zone-graph-collapsed", collapsed ? "1" : "");
};
$("#graph-zone-toggle").addEventListener("click", () =>
  zoneApply(!zoneEl.classList.contains("collapsed")));
zoneApply(localStorage.getItem("zone-graph-collapsed") === "1");

// COMPANY zone collapses too (same pattern, separately remembered)
const czEl = $("#zone-company");
const czApply = (collapsed) => {
  czEl.classList.toggle("collapsed", collapsed);
  $("#company-zone-caret").textContent = collapsed ? "▸" : "▾";
  localStorage.setItem("zone-company-collapsed", collapsed ? "1" : "");
};
$("#company-zone-toggle").addEventListener("click", () =>
  czApply(!czEl.classList.contains("collapsed")));
czApply(localStorage.getItem("zone-company-collapsed") === "1");

// on-canvas key collapse (remembered across reloads)
const gkEl = $("#graph-key");
const gkBtn = $("#gk-toggle");
const gkApply = (collapsed) => {
  gkEl.classList.toggle("collapsed", collapsed);
  gkBtn.textContent = collapsed ? "+" : "–";
  localStorage.setItem("gk-collapsed", collapsed ? "1" : "");
};
gkBtn.addEventListener("click", () => gkApply(!gkEl.classList.contains("collapsed")));
gkApply(localStorage.getItem("gk-collapsed") === "1");

// ---- one-click loading of any listed company: scan first (fast draft), then
// full research continues in the background; the page upgrades itself when done ----
async function autoLoad(ticker) {
  refreshBtn.disabled = true;
  // The lookup may already have an overlay up from the search box; if this was
  // reached from the picker or a rail button, start one.
  if (!load) startLoading(`Finding ${ticker}`, LOAD_STEPS);
  advanceLoading(1, { title: `Loading ${ticker}` });
  setLog(`Loading ${ticker} — reading its latest 10-K (~1 min); full research follows automatically…`);
  try {
    const r = await fetch("/api/graph/scan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker }) });
    if (!r.ok) throw new Error();
  } catch {
    failLoading(`Couldn't start loading ${ticker}`,
      "The scan needs the gateway running — `npm start`, or `npm run dev:api` alongside the dev server.");
    refreshBtn.disabled = false;
    return;
  }
  const poll = every(async () => {
    try {
      const s = await (await fetch(`/api/graph/scan?ticker=${encodeURIComponent(ticker)}`)).json();
      if (s.state === "running") setLog(`Reading ${ticker}'s latest filing…\n${s.log || ""}`);
      else if (s.state === "done") {
        stop(poll);
        // await the research kickoff (keepalive) so the reload can't abort it mid-flight
        try {
          await fetch("/api/graph/refresh", { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ticker }), keepalive: true });
        } catch { /* resume-watcher will report if it never started */ }
        /* Deliberately NOT persisted: the reload below carries the company in
           the hash (#graph&focus=…), which is enough to reopen it once. Writing
           it to sessionStorage made it come back on every later reload too. */
        history.replaceState(null, "", `#graph&focus=${encodeURIComponent(ticker)}`);
        advanceLoading(2, { title: `Loading ${ticker}` });
        setLog("First pass ready — opening it. Full research continues in the background.");
        setTimeout(() => location.reload(), 600);
      } else if (s.state === "error") {
        stop(poll);
        failLoading(`Couldn't load ${ticker}`, s.log || "The 10-K scan failed. The symbol may not have a 10-K or 20-F on file.");
        refreshBtn.disabled = false;
      }
    } catch { /* dev server hiccup — keep polling */ }
  }, 2500);
}
// after a reload, keep watching any research still running for the focused company
(async function resumeWatch() {
  const m = location.hash.match(/focus=([^&]+)/);
  const t = m && decodeURIComponent(m[1]);
  if (!t) return;
  try {
    let s = await (await fetch(`/api/graph/refresh?ticker=${encodeURIComponent(t)}`)).json();
    // self-heal: a draft with no research running gets its research started right here
    if (s.state !== "running" && s.state !== "done" && nodeById.get(t)?.draft) {
      await fetch("/api/graph/refresh", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: t }) });
      s = { state: "running" };
    }
    if (s.state !== "running") return;
    /* The scan's draft is already on the canvas by now, so this leg is not
       blocking — the overlay sits in the corner rather than over the graph. */
    startLoading(`Researching ${t}`, LOAD_STEPS);
    advanceLoading(2, { foot: `<button class="mini" id="gl-bg">Hide</button>` });
    $("#gl-bg")?.addEventListener("click", stopLoading);
    setLog(`Full research for ${t} is running — this panel upgrades automatically when it finishes.`);
    const poll = every(async () => {
      try {
        const st = await (await fetch(`/api/graph/refresh?ticker=${encodeURIComponent(t)}`)).json();
        if (st.state === "done") { stop(poll); advanceLoading(3); setLog("Research complete — reloading."); setTimeout(() => location.reload(), 600); }
        else if (st.state === "error") { stop(poll); failLoading(`Research failed for ${t}`, st.log || ""); }
        else setLog(`Researching ${t}…\n${st.log || ""}`);
      } catch { /* keep polling */ }
    }, 5000);
  } catch { /* built site: no API */ }
})();

// ---- selection / highlight ----
let selected = null;
function select(id) {
  selected = id;
  const nb = neighbors.get(id);
  node.classed("sel", (d) => d.id === id).classed("dim", (d) => !focus && !nb.has(d.id));
  link.classed("hi", (l) => l.source.id === id || l.target.id === id)
      .classed("dim", (l) => !focus && l.source.id !== id && l.target.id !== id)
      .attr("marker-end", (l) => (l.type !== "supply" ? null : l.source.id === id || l.target.id === id ? "url(#arrow-hi)" : "url(#arrow)"));
  renderDetail(id);
}
svg.on("click", () => {
  selected = null;
  node.classed("sel", false).classed("dim", false);
  link.classed("hi", false).classed("dim", false)
      .attr("marker-end", (l) => (l.type === "supply" ? "url(#arrow)" : null));
  showEmpty();
});
svg.on("dblclick.zoom", null);



/* ---- correlation on the pathways ----------------------------------------
 *
 * The link already carries one number in its WIDTH — the share of revenue the
 * disclosing company says runs through it. Colour carries a second, and an
 * independent one: how much the two names actually move together. Thick and
 * pale is a large relationship between companies the market prices apart;
 * thin and saturated is the reverse. Both come from real data, neither is a
 * restatement of the other.
 *
 * Same ramp as the grid, deliberately, so a colour means one thing on this
 * surface.
 */
let linkCorrKey = null;

function pairKey(a, b) { return a < b ? `${a}|${b}` : `${b}|${a}`; }

async function refreshLinkCorrelation() {
  const shown = [...visNow].filter((id) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(id));
  const key = shown.slice().sort().join(",");
  if (key === linkCorrKey) return;
  linkCorrKey = key;

  const paint = (get) => {
    link.each(function (d) {
      const a = d.source.id || d.source, b = d.target.id || d.target;
      const r = d.type === "supply" ? get(a, b) : null;
      this.style.setProperty("--corr", r == null ? "" : corrColor(Math.max(r, 0.02)));
      this.classList.toggle("has-corr", r != null);
      const share = shareOf(d);
      const q = this.querySelector("title");
      if (q) {
        q.textContent = `${a} → ${b}`
          + (d.note ? `\n${d.note}` : "")
          + (share == null ? "" : `\n${(share * 100).toFixed(0)}% of ${a}'s revenue (disclosed)`)
          + (r == null ? "\nNo usable shared price history" : `\nMoves together: ${r >= 0 ? "+" : ""}${r.toFixed(2)} daily-return correlation`);
      }
    });
  };

  if (shown.length < 2) { paint(() => null); return; }
  try {
    const d = await (await fetch(`/api/graph/correlation/matrix?tickers=${encodeURIComponent(shown.join(","))}`)).json();
    if (linkCorrKey !== key) return;               // a newer view won the race
    if (!d.ok) return paint(() => null);
    paint((a, b) => d.matrix?.[a]?.[b] ?? null);
  } catch {
    paint(() => null);                              // a flat graph beats a wrong one
  }
}

/* ---- correlation grid ----------------------------------------------------
 *
 * The per-company "Moves with" list answers "does this pair move together".
 * This answers the question that only makes sense across the whole graph: does
 * the supply chain move as one block, or are there separate ones? Ordered by
 * average correlation, so the block shows up in the top-left rather than being
 * scattered alphabetically.
 */
const corrOverlay = $("#corr-overlay");
let corrLoaded = null;   // the ticker set the rendered grid was built from

/* Zero is white and only positive correlation gains weight: a supply chain is
   overwhelmingly positively correlated, so a red/blue diverging ramp would
   spend most of its range on values that never occur. Negative goes amber so
   the rare genuine hedge is still visible. */
function corrColor(v) {
  if (v == null) return "transparent";
  if (v < 0) return `rgba(245,158,11,${Math.min(0.75, Math.abs(v) * 1.4)})`;
  return `rgba(56,189,248,${Math.min(0.85, v * 0.95)})`;
}

async function openCorrGrid() {
  corrOverlay.hidden = false;

  /* Scoped to what is actually on screen — the companies in the graph you are
     looking at, not every company in the dataset. A grid of all 34 answers a
     question nobody asked; the useful one is whether THIS supply chain moves
     as a block. Recomputed on each open because the shown set changes. */
  const shown = [...visNow].filter((id) => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(id));
  const key = shown.slice().sort().join(",");
  if (!shown.length) {
    $("#co-sub").textContent = "";
    $("#co-foot").textContent = "";
    $("#co-grid").innerHTML = `<div style="padding:14px;color:var(--muted);font-size:11px">`
      + `No graph is shown. Search a company above — the grid covers the companies in that company's supply graph.</div>`;
    return;
  }
  if (corrLoaded === key) return;

  $("#co-grid").innerHTML = `<div style="padding:14px;color:var(--muted);font-size:11px">Pricing ${shown.length} companies…</div>`;
  let d;
  try {
    d = await (await fetch(`/api/graph/correlation/matrix?tickers=${encodeURIComponent(shown.join(","))}`)).json();
  } catch (e) {
    $("#co-grid").innerHTML = `<div style="padding:14px;color:var(--muted);font-size:11px">Could not load: ${e.message}</div>`;
    return;
  }
  if (!d.ok || !d.tickers?.length) {
    $("#co-grid").innerHTML = `<div style="padding:14px;color:var(--muted);font-size:11px">${d.error || "No priceable companies in the graph."}</div>`;
    return;
  }

  const ts = d.tickers;
  const head = `<tr><th class="co-corner"></th>${ts.map((x) => `<th>${x}</th>`).join("")}<th class="co-corner">avg</th></tr>`;
  const rows = ts.map((a) => {
    const cells = ts.map((b) => {
      const v = d.matrix[a][b];
      if (a === b) return `<td class="co-self">·</td>`;
      if (v == null) return `<td class="co-na" title="${a}/${b}: fewer than 20 shared sessions">—</td>`;
      return `<td style="background:${corrColor(v)}" title="${a} / ${b}: ${v.toFixed(2)} over the days both traded">${v.toFixed(1).replace(/^0/, "").replace(/^-0/, "-")}</td>`;
    }).join("");
    const avg = d.average[a];
    return `<tr><th>${a}</th>${cells}<td class="co-na">${avg == null ? "—" : avg.toFixed(2)}</td></tr>`;
  }).join("");
  $("#co-grid").innerHTML = `<table class="co-tbl"><thead>${head}</thead><tbody>${rows}</tbody></table>`;

  $("#co-sub").textContent = `${ts.length} companies · ${d.window} sessions · ${d.spine.from} → ${d.spine.to}`;
  $("#co-foot").innerHTML =
    `Pearson correlation of daily simple returns, each pair computed over the days BOTH names traded; `
    + `a pair with fewer than 20 shared sessions is left blank rather than estimated. `
    + `Closes from CRSP and Compustat via synthetic sample with a yfinance tail`
    + (d.sourceSeam ? `, crossing the CRSP seam at ${d.sourceSeam}` : "") + `. `
    + (d.missing?.length ? `No price history for: ${d.missing.join(", ")}.` : "")
    + `<div class="co-legend"><i style="background:${corrColor(-0.5)}"></i>−0.5`
    + `<i style="background:transparent;border:1px solid var(--border)"></i>0`
    + `<i style="background:${corrColor(0.5)}"></i>+0.5<i style="background:${corrColor(1)}"></i>+1</div>`;
  corrLoaded = key;
}

$("#corr-btn")?.addEventListener("click", openCorrGrid);
$("#co-close")?.addEventListener("click", () => { corrOverlay.hidden = true; });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !corrOverlay.hidden) corrOverlay.hidden = true; });
if ($("#corr-hint")) $("#corr-hint").textContent = "Pairwise correlation across the companies currently shown, over the last year of daily returns.";

// ---- detail panel: React island (src/sidebar.jsx) ----
const sidebar = createSidebar($("#detail"));
const sidebarCommon = () => ({
  onOpen: (t) => nodeById.has(t) && select(t),
  onFocus: (t) => focusOn(t),
  onJob: (k, t) => runJob(k, t),
  inGraph: (t) => nodeById.has(t),
  onSave: (t) => saveGraph(t),
  onUnsave: (t) => unsaveGraph(t),
  isSaved: (t) => isSaved(t),
  focusedId: focus?.id || null,
  graphDate: graph.generatedAt?.slice(0, 10),
});
function showEmpty() {
  const czSub = $("#company-zone-sub");
  if (czSub) czSub.textContent = "";
  sidebar.show({ view: "empty", ...sidebarCommon() });
}
function renderDetail(id) {
  const d = nodeById.get(id);
  const czSub = $("#company-zone-sub");
  if (czSub) czSub.textContent = d ? `${d.id} · ${(d.name || "").slice(0, 26)}` : "";
  if (!d) return showEmpty();
  if (d.draft && !d.intel) return sidebar.show({ view: "draft", node: d, ...sidebarCommon() });
  if (d.mentionOnly || !d.intel) return sidebar.show({ view: "mention", node: d, ...sidebarCommon() });
  const supply = links.filter((l) => l.type === "supply");
  const suppliers = supply.filter((l) => (l.target.id || l.target) === id)
    .map((l) => { const sid = l.source.id || l.source; return { id: sid, name: nodeById.get(sid)?.name, note: l.note, verified: l.verified }; });
  const customers = supply.filter((l) => (l.source.id || l.source) === id)
    .map((l) => { const tid = l.target.id || l.target; return { id: tid, name: nodeById.get(tid)?.name, note: l.note, verified: l.verified }; });
  sidebar.show({ view: "company", node: d, intel: d.intel, sources: sourcesByTicker[id] || null,
    suppliers, customers, quiet: isQuiet(id), relCount: neighborCount(id), ...sidebarCommon() });
}

// ---- init ----
paint();
renderLegend();
renderSignals();
showEmpty();
applyFocus();
{
  const m = location.hash.match(/focus=([^&]+)/);
  const id = m && decodeURIComponent(m[1]);
  if (id && nodeById.has(id)) focusOn(id);
}

// resize
const onResize = () => {
  width = graphEl.clientWidth; height = graphEl.clientHeight;
  svg.attr("viewBox", [0, 0, width, height]);
  sim.force("center", d3.forceCenter(width / 2, height / 2));
  if (focus) applyFocus(); else sim.alpha(0.3).restart();
};
window.addEventListener("resize", onResize);

  // ---- teardown ----
  // The view unmounts whenever the user switches surfaces. Without this the
  // simulation keeps ticking against a detached DOM and every remount adds
  // another resize listener and another set of pollers.
  const destroy = () => {
    window.removeEventListener("resize", onResize);
    for (const t of timers) clearInterval(t);
    timers.clear();
    sim.stop();
    sidebar.destroy?.();
    svg.remove();
  };

  /* The company rail drives this. It focuses a company that is ALREADY in the
     loaded graph and returns false for one that is not — it deliberately does
     not fall through to the search field's path, which scans EDGAR, kicks off a
     headless-Claude research run and reloads the page. That is the right
     behaviour for someone who typed a ticker into a box labelled "research
     this"; it is emphatically not the right behaviour for arriving from
     Valuation with a company already selected, which would start a paid job
     nobody asked for on every tab switch. */
  const focusIfPresent = (t) => {
    const id = String(t || "").toUpperCase();
    if (!id || !nodeById.has(id)) return false;
    focusOn(id);
    return true;
  };

  return {
    destroy, focus: focusIfPresent,
    /* The sidebar's CompanyRail submits through this. Unlike `focus`, it is
       allowed to research and add a company that is not in the graph — the rail
       is now the only box on this surface, so it has to carry the whole path
       the removed top-strip search used to. */
    enter: enterCompany,
    has: (t) => nodeById.has(String(t || "").toUpperCase()),
  };
}
