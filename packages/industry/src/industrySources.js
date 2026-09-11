/* Source composition for the Industry surface — the pure half of the source
 * inspector.
 *
 * Kept out of the component for the same reason peerSources.js is: deciding
 * which documents back a claim is logic, and logic inside a render body can
 * only be checked by looking at pixels. Everything here takes data and returns
 * data.
 *
 * The payload already names its documents — the route's `sources[]` block is
 * the surface-grain answer, so the default view maps it into inspector rows
 * rather than restating it. The per-selection work is the member row: the
 * frame fact now carries its accession, so a company's measured revenue links
 * to the filing it was actually stated in, not just to the frame that
 * aggregated it.
 */
import { fmtDate, filingIndexUrl } from '@markets/shell/lib/sourceRows.js';

/* Shared with the component — the claims quote the same figures the table
   prints, so the two must round identically. */
export const fmtMoney = (n) => {
  if (!Number.isFinite(n)) return null;
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  return `${s}$${Math.round(a).toLocaleString()}`;
};
export const fmtPct = (x, dp = 1) => (Number.isFinite(x) ? `${(x * 100).toFixed(dp)}%` : null);


/* How the route's source kinds print as row types. The route's vocabulary is
   its own; unknown kinds pass through as-is rather than being misfiled. */
const KIND_TYPE = {
  'SEC filing': 'SEC filing',
  'SEC feed': 'Live feed',
  'Market data': 'Market data',
  Derived: 'Computed here',
};
const asRow = (s) => (s ? {
  type: KIND_TYPE[s.kind] || s.kind,
  truth: s.kind === 'SEC filing',
  label: s.label,
  detail: s.detail || null,
  url: s.url || null,
} : null);

const srcRow = (data, id) => asRow((data?.sources || []).find((s) => s.id === id));

/** The no-selection view: the payload's own source block, as inspector rows. */
export function defaultRows(data) {
  return (data?.sources || []).map(asRow).filter(Boolean);
}

const SHARE_CAVEAT = 'a share of MEASURED revenue among listed US-GAAP calendar-frame filers, '
  + 'never a market share';

/**
 * Every selectable thing on the surface reduces to the graph inspector's three
 * questions: what is claimed, how was it arrived at, and — via the rows —
 * which documents back it.
 */
export function describe(sel, data) {
  if (!sel || !data) return null;
  const cls = data.classification || {};
  const ms = data.measures || {};
  switch (sel.kind) {
    case 'member': {
      const m = sel.m;
      return {
        claim: `${m.name || m.ticker} — #${m.rank} of ${ms.measuredCount} measured under `
          + `SIC ${cls.sic}, with ${fmtMoney(m.revenue) ?? '—'} revenue on the ${ms.period} frame`
          + (m.share != null ? `: ${fmtPct(m.share)} of measured revenue, ${SHARE_CAVEAT}.` : '.'),
        method: `Measured by the first us-gaap revenue tag the frame saw it under — ${m.tag}`
          + (m.frameEnd ? `, period ended ${fmtDate(m.frameEnd)}` : '')
          + '. Off-calendar fiscal years and IFRS filers are counted in the membership but never '
          + 'measured, so absence from this table is not absence from the industry.',
      };
    }
    case 'classification':
      return {
        claim: `${cls.description || `SIC ${cls.sic}`} — SIC ${cls.sic}, the industry code on `
          + `${data.identity?.name || data.identity?.ticker}'s SEC registrant record.`,
        method: 'SEC\'s own staff assign the code and state it, with its description, on the '
          + 'submissions record — the registrant\'s filed industry, not a vendor\'s opinion of it. '
          + 'One four-digit code, last revised 1987.',
      };
    case 'division': {
      const dv = cls.division || {};
      return {
        claim: `Division ${dv.letter} — ${dv.label}.`,
        method: 'Not stated per registrant by SEC: the 1987 SIC manual\'s division ranges, applied '
          + `to the code here (${dv.from}–${dv.to} → ${dv.letter}).`,
      };
    }
    case 'membership': {
      const mb = data.membership || {};
      return {
        claim: `${mb.listedCount} listed compan${mb.listedCount === 1 ? 'y' : 'ies'} among `
          + `${mb.registrants}${mb.truncated ? '+' : ''} registrants filing under SIC ${cls.sic}.`,
        method: 'browse-edgar\'s company search by SIC, paged, filtered to CIKs in SEC\'s ticker '
          + 'map — a registrant with no listed ticker is counted, never shown.',
        note: mb.truncated ? data.absent?.membership : null,
      };
    }
    case 'medians':
      return {
        claim: `Measured revenue ${fmtMoney(ms.totalRevenue) ?? '—'} across ${ms.measuredCount} `
          + `members on the ${ms.period} frame; median member ${fmtMoney(ms.medianRevenue) ?? '—'}, `
          + `median net margin ${fmtPct(ms.medianNetMargin) ?? '—'}.`,
        method: 'Computed here — packages/industry/server/sic.js over the frame values. Medians '
          + 'are over measured members only; a member the frame cannot see is left out rather '
          + 'than zeroed.',
      };
    case 'concentration': {
      const c = data.concentration || {};
      return {
        claim: `Top firm ${fmtPct(c.cr1, 0) ?? '—'}, CR4 ${fmtPct(c.cr4, 0) ?? '—'}, `
          + `CR8 ${fmtPct(c.cr8, 0) ?? '—'}, HHI ${c.hhi != null ? c.hhi.toLocaleString() : '—'}`
          + (c.equivalent != null ? ` (reads like ${c.equivalent.toFixed(1)} equal firms)` : '')
          + (c.gini != null ? `, Gini ${c.gini.toFixed(2)}.` : '.'),
        method: 'Computed here — packages/industry/server/sic.js over measured-revenue shares, '
          + 'with HHI on the DOJ/FTC 0–10,000 scale (above 2,500 reads as highly concentrated); '
          + '"reads like" is 10,000/HHI, the count of equal-sized firms producing the same '
          + 'index, and the Gini (0 equal → 1 one-firm) adds the dispersion among the small '
          + 'members that HHI ignores. '
          + `Each input share is ${SHARE_CAVEAT} — private companies and foreign listings are `
          + 'invisible to it, so an industry can be fragmented in reality and read concentrated here.',
      };
    }
    case 'aggregates': {
      const a = data.aggregates || {};
      return {
        claim: `Aggregate net margin ${fmtPct(a.aggregateNetMargin) ?? '—'} `
          + `(total net income ${fmtMoney(a.totalNetIncome) ?? '—'} over the revenue of the `
          + `${a.profitReporters ?? 0} members reporting it); `
          + `${a.profitableCount ?? '—'} of ${a.profitReporters ?? '—'} profitable`
          + (a.aggregateGrowth != null
            ? `; matched-member revenue grew ${fmtPct(a.aggregateGrowth)} year over year, `
              + `with ${fmtPct(a.grewShare, 0)} of the ${a.growthMatched} matched members growing.`
            : '.'),
        method: 'Computed here — packages/industry/server/sic.js over the same frame values as '
          + 'the medians, but dollar-weighted: the aggregate margin sums income over summed '
          + 'revenue where the median takes the typical member, so the gap between the two is '
          + 'itself a reading. Growth is over members measured in BOTH years\' frames only — '
          + 'the industry\'s own growth, free of the composition effect a raw total-over-total '
          + 'comparison bakes in. Every denominator is the reporting population, never the '
          + 'membership: a member the frame cannot see is left out, counted.',
      };
    }
    case 'majorGroup': {
      const g = cls.hierarchy?.majorGroup || {};
      return {
        claim: `Major group ${g.code} — ${g.title}: the two-digit scope above the filed code.`,
        method: 'The 1987 SIC manual\'s own major-group titles, applied to the code\'s first '
          + 'two digits. SEC states nothing at this level per registrant, so the name comes '
          + 'from the manual (embedded here; the manual\'s last revision is 1987, so the table '
          + 'cannot go stale) rather than from a filing.',
      };
    }
    case 'industryGroup': {
      const g = cls.hierarchy?.industryGroup || {};
      return {
        claim: `Industry group ${g.code} — the ${g.codeCount} four-digit code`
          + `${g.codeCount === 1 ? '' : 's'} sharing the code's first three digits.`,
        method: 'Enumerated from SEC\'s own SIC code list by prefix — the scope between the '
          + 'filed code and the manual\'s major group. The neighborhood table measures each '
          + 'of these codes on the same frame.',
      };
    }
    case 'office':
      return {
        claim: `Filings under SIC ${cls.sic} are read by SEC's ${cls.hierarchy?.office}.`,
        method: 'SEC\'s SIC code list assigns every four-digit code to one Disclosure Review '
          + 'Office in the Division of Corporation Finance — the staff whose comment letters '
          + 'a filer under this code answers to.',
      };
    case 'selfDerived': {
      const s = data.selfDerived || {};
      const t = data.identity?.ticker;
      return {
        claim: `${t} — ≈#${s.rank} with ${fmtMoney(s.revenue) ?? '—'} revenue`
          + (s.share != null ? ` and ≈${fmtPct(s.share)} of measured-plus-self revenue` : '')
          + (s.netMargin != null ? `, net margin ${fmtPct(s.netMargin)}` : '')
          + ` — every figure ƒ: COMPUTED HERE, not read from the ${ms.period} frame.`,
        method: `The frame missed ${t} (off-calendar fiscal year, IFRS, or unusual tagging), `
          + 'so the deterministic alignment formula ran instead: from its own companyfacts, '
          + `the filed annual period ending nearest Dec 31 of the frame year (±6 months) — `
          + `here ${s.end}, tagged ${s.taxonomy}/${s.tag}`
          + (s.form ? ` on a ${s.form}` : '') + '. '
          + `rank = 1 + members with more frame revenue; share = revenue ÷ (measured total + `
          + 'revenue), since its figure is not in the total. Its period is NOT everyone '
          + 'else\'s — the reason the frame refused, the reason for the ƒ and ≈ marks, and '
          + 'the reason no percentile is computed from it.',
      };
    }
    case 'metric': {
      const r = sel.row || {};
      const fv = (v) => (v == null ? '—' : r.kind === 'mult' ? `${v.toFixed(2)}×` : fmtPct(v));
      const INPUTS = {
        growth: `revenue on the ${ms.period} and ${ms.priorPeriod} frames — only members `
          + 'measured in BOTH years enter, and growth over a non-positive prior year is declined',
        grossMargin: 'GrossProfit over the member\'s frame revenue',
        opMargin: 'OperatingIncomeLoss over the member\'s frame revenue',
        netMargin: 'NetIncomeLoss over the member\'s frame revenue',
        rndIntensity: 'ResearchAndDevelopmentExpense over revenue, only for members that '
          + 'REPORT the line — a filer with no R&D fact has not said "zero R&D", so nothing '
          + 'is imputed and the reporter count is the honest denominator',
        roa: `NetIncomeLoss over Assets (the ${ms.period}Q4I instant frame), members with `
          + 'positive assets',
        roe: 'NetIncomeLoss over StockholdersEquity, members with POSITIVE book equity — '
          + 'income over negative equity has a sign nobody can read, so those members are '
          + 'left out, counted',
        assetTurnover: 'frame revenue over Assets, members with positive assets',
      };
      return {
        claim: `${r.label}: industry median ${fv(r.median)} (P25 ${fv(r.p25)}, P75 ${fv(r.p75)}) `
          + `over ${r.reporters} reporting member${r.reporters === 1 ? '' : 's'}`
          + (r.derivedCount > 0
            ? ` — ${r.derivedCount} of them ƒ, i.e. computed here by identity where the standard tag was absent`
            : '')
          + (r.self != null
            ? `; ${data.identity?.ticker} at ${fv(r.self)} — the P${Math.round((r.selfPct ?? 0) * 100)} `
              + 'of its industry.'
            : `. ${data.identity?.ticker} is not measured on this row.`),
        method: `Computed here from ${INPUTS[r.id] || 'the frame values'}. The percentile is `
          + `${data.identity?.ticker}'s rank among the same reporters, ties split evenly.`,
      };
    }
    case 'sizes': {
      const counts = (data.sizes || []).map((b) => `${b.count} ${b.label}`).join(', ');
      return {
        claim: `The measured members by revenue bracket: ${counts}.`,
        method: `Frame revenue binned on fixed dollar brackets — the shape a median cannot `
          + `show. Only measured members are binned; the unmeasured are counted in the `
          + `absences, not guessed into a bracket.`,
      };
    }
    case 'sibling': {
      const s = sel.s || {};
      return {
        claim: `SIC ${s.sic} — ${s.title}: ${s.listedCount} listed of ${s.registrants}`
          + `${s.truncated ? '+' : ''} registrants`
          + (s.revenue != null
            ? `, ${fmtMoney(s.revenue)} measured revenue on the ${ms.period} frame`
              + (s.top ? `, led by ${s.top.ticker} at ${fmtMoney(s.top.revenue)}.` : '.')
            : '; none of its members is measured on the frame.'),
        method: 'The same pipeline as the main code, per sibling: browse-edgar membership, '
          + 'ticker-map filter, revenue from the shared frames — so the codes in the group '
          + 'are comparable column for column.',
      };
    }
    case 'history': {
      const h = data.history || [];
      const first = h[0]; const last = h[h.length - 1];
      return {
        claim: `Across ${h.length} calendar frames (${first?.period}–${last?.period}), the `
          + `current membership's measured revenue went ${fmtMoney(first?.totalRevenue) ?? '—'} `
          + `→ ${fmtMoney(last?.totalRevenue) ?? '—'}.`,
        method: 'The same revenue tags, one set of frame documents per year, folded to '
          + 'TODAY\'S members. That framing is the caveat: a company that left the code, '
          + 'delisted or merged since is missing from the early years, so the early totals '
          + 'skew low and the growth of the total skews high — survivors\' history, not the '
          + 'industry\'s.',
      };
    }
    case 'unlistedGroup': {
      const u = data.unlisted || {};
      return {
        claim: `${u.count} registrant${u.count === 1 ? '' : 's'} under SIC ${cls.sic} with no `
          + `listed ticker whose revenue the ${ms.period} frame still measures — `
          + `${fmtMoney(u.totalRevenue) ?? '—'} outside every rank and share on this page.`,
        method: 'The same membership list and the same frame documents as the main table, '
          + 'with the ticker-map filter simply not applied. The rows are a MIXTURE: '
          + 'genuinely private companies reporting because their bonds are SEC-registered '
          + '(Publix, Jones Financial), and financing or operating subsidiaries of listed '
          + 'parents filing under their own CIK (Ford Motor Credit). SEC\'s data does not '
          + 'distinguish the two, so neither does this table.',
      };
    }
    case 'unlisted': {
      const m = sel.m;
      return {
        claim: `${m.name || `CIK ${m.cik}`} — ${fmtMoney(m.revenue) ?? '—'} revenue on the `
          + `${ms.period} frame, filed under SIC ${cls.sic} with no listed ticker.`,
        method: `Measured under ${m.tag} on the same calendar frame as the listed members; `
          + 'the name is the frame\'s own entityName (the ticker map cannot know an '
          + 'unlisted filer). It may be a private company or a subsidiary of a listed '
          + 'one — the filing behind the src row says which.',
      };
    }
    case 'naicsMap': {
      const n = data.privateSide?.naics || {};
      const names = (n.industries || []).map((x) => `${x.title || x.code} (${x.code})`).join('; ');
      return {
        claim: `SIC ${cls.sic} corresponds to ${names} under NAICS 2022.`,
        method: 'The Census concordance chain: 1987 SIC → 2002 NAICS, then through every '
          + 'NAICS revision to 2022. Many-to-many and unweighted — every target is kept — '
          + 'except that a code a revision redistributed across more than six industries '
          + '(e-commerce back into every retail line) is dropped and the mapping marked '
          + 'partial, because following it would sum half the economy.'
          + (n.partial ? ' This mapping IS partial: its totals are floors.' : ''),
      };
    }
    case 'privateScale': {
      const q = data.privateSide?.qcew || {};
      return {
        claim: `${q.estabs?.toLocaleString?.() ?? '—'} private-sector establishments and `
          + `${q.emp?.toLocaleString?.() ?? '—'} jobs in ${q.period}, across the NAICS `
          + `industr${(data.privateSide?.naics?.industries || []).length === 1 ? 'y' : 'ies'} `
          + 'this SIC corresponds to.',
        method: 'BLS\'s Quarterly Census of Employment and Wages — an administrative count '
          + 'of every employer covered by unemployment insurance (~95% of US jobs), not a '
          + 'survey. Private ownership only; employment is the quarter\'s third month; the '
          + 'weekly wage is employment-weighted across the mapped codes. Self-employment '
          + 'and most agriculture sit outside UI coverage and therefore outside these counts.',
      };
    }
    case 'censusScale': {
      const c = data.privateSide?.census || {};
      return {
        claim: `${c.firms?.toLocaleString?.() ?? '—'} firms with `
          + `${fmtMoney(c.receipts) ?? '—'}${c.receiptsSuppressed ? '+' : ''} in receipts in `
          + `${c.year} — every firm in the industry, public or private.`,
        method: 'The Economic Census (ecnbasic), Census\'s five-yearly measurement of every '
          + 'firm with paid employees. Receipts arrive in $1,000s and are converted here; a '
          + 'cell Census withheld under disclosure rules leaves the total a floor, marked +. '
          + 'The "listed filers ≈" tile divides the SEC frame\'s measured revenue by these '
          + 'receipts across different years — a reading of scale, not a ratio.',
      };
    }
    case 'formd': {
      const f = data.privateSide?.formd || {};
      return {
        claim: `${f.companies?.offerings ?? 0} private offering${(f.companies?.offerings ?? 0) === 1 ? '' : 's'} `
          + `by ${f.companies?.companies ?? 0} compan${(f.companies?.companies ?? 0) === 1 ? 'y' : 'ies'} under `
          + `SIC ${cls.sic} across quarters ${(f.quarters || []).join(', ')}, `
          + `${fmtMoney(f.companies?.sold) ?? '$0'} sold as last reported`
          + (f.funds?.offerings ? `; ${f.funds.offerings} pooled-fund offering${f.funds.offerings === 1 ? '' : 's'} kept separate.` : '.'),
        method: 'SEC\'s Form D quarterly structured data sets, joined on the SIC code the '
          + 'filing itself carries. The latest filing per offering file number wins every '
          + 'dollar figure — an amendment restates, never adds — and offerings stating an '
          + '"Indefinite" amount are counted, never summed. Pooled investment funds are '
          + 'split out: a fund filing under an industry code is capital ABOUT the industry, '
          + 'not a company in it.',
      };
    }
    case 'formdFiling': {
      const r = sel.r || {};
      return {
        claim: `${r.name || `CIK ${r.cik}`}${r.ticker ? ` (${r.ticker} — a LISTED issuer raising privately)` : ''} `
          + `— Form D${r.amended ? '/A' : ''} filed ${r.date}: `
          + `${fmtMoney(r.sold) ?? 'an undisclosed amount'} sold`
          + (r.offering ? ` of a ${fmtMoney(r.offering)} offering` : r.offeringIndefinite ? ' of an indefinite offering' : '')
          + (r.revenueRange ? `; stated revenue range "${r.revenueRange}".` : '.'),
        method: 'As filed on the Form D — issuer identity, amounts and revenue range are '
          + 'the filer\'s own statements, unaudited. Most private issuers decline to state '
          + 'revenue, and Form D reports the exempt offering, not the company\'s accounts.',
      };
    }
    case 'insider': {
      const ip = data.insider || {};
      return {
        claim: `Last ${ip.windowDays} days across the code: ${fmtMoney(ip.buys?.total) ?? '$0'} `
          + `of open-market buying (${ip.buys?.companies ?? 0} companies) against `
          + `${fmtMoney(ip.sells?.total) ?? '$0'} of selling (${ip.sells?.companies ?? 0}).`,
        method: 'The platform\'s own Form 4 database (polled from EDGAR every 60s), filtered '
          + 'to issuers whose filings carry this SIC code. Transaction codes P and S only — '
          + 'the house rule: a grant is not a decision, so awards and tax withholding never '
          + 'enter the totals. Dollar values as stated on the filings; joint filings are '
          + 'counted once per filing, not once per co-filer.',
      };
    }
    default:
      return { claim: sel.claim || '', method: '' };
  }
}

/** All source rows for a selection. */
export function sourcesFor(sel, data) {
  if (!sel || !data) return [];
  switch (sel.kind) {
    case 'member': {
      const m = sel.m;
      const out = [];
      if (m.accn) {
        out.push({ type: 'SEC filing', truth: true,
          label: `Revenue as filed · period ended ${fmtDate(m.frameEnd)}`,
          detail: m.accn, url: filingIndexUrl(m.cik, m.accn) });
      }
      const frames = srcRow(data, 'frames');
      if (frames) out.push({ ...frames, type: 'XBRL fact', truth: false });
      out.push({ type: 'SEC filing',
        label: `All ${m.ticker} annual reports on EDGAR`,
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${m.cik}&type=10-K` });
      return out;
    }
    case 'classification':
      return [srcRow(data, 'submissions'), srcRow(data, 'sicmanual')].filter(Boolean);
    case 'division':
      return [srcRow(data, 'sicmanual'), srcRow(data, 'submissions')].filter(Boolean);
    case 'membership':
      return [srcRow(data, 'siclist')].filter(Boolean);
    case 'medians':
    case 'concentration':
    case 'aggregates':
    case 'sizes':
    case 'history':
      return [srcRow(data, 'stats'), srcRow(data, 'frames')].filter(Boolean);
    case 'metric':
      return [srcRow(data, 'stats'),
        ...(sel.row?.derivedCount > 0 ? [srcRow(data, 'derivations')] : []),
        srcRow(data, 'frames')].filter(Boolean);
    case 'selfDerived': {
      const s = data.selfDerived || {};
      const out = [];
      if (s.accn) {
        out.push({ type: 'SEC filing', truth: true,
          label: `The aligned filing itself · period ended ${fmtDate(s.end)}`,
          detail: s.accn, url: filingIndexUrl(data.identity?.cik, s.accn) });
      }
      const drv = srcRow(data, 'derivations');
      if (drv) out.push(drv);
      out.push({ type: 'Live feed',
        label: `SEC companyfacts — CIK ${data.identity?.cik}`,
        detail: 'The company\'s own every-fact record, where the aligned annual period was read from.',
        url: `https://data.sec.gov/api/xbrl/companyfacts/CIK${data.identity?.cik}.json` });
      return out;
    }
    case 'insider':
      return [srcRow(data, 'form4')].filter(Boolean);
    case 'unlistedGroup':
      return [srcRow(data, 'frames'), srcRow(data, 'siclist')].filter(Boolean);
    case 'unlisted': {
      const m = sel.m;
      const out = [];
      if (m.accn) {
        out.push({ type: 'SEC filing', truth: true,
          label: `Revenue as filed · period ended ${fmtDate(m.frameEnd || m.end)}`,
          detail: m.accn, url: filingIndexUrl(m.cik, m.accn) });
      }
      const frames = srcRow(data, 'frames');
      if (frames) out.push({ ...frames, type: 'XBRL fact', truth: false });
      out.push({ type: 'SEC filing',
        label: 'All of this filer\'s annual reports on EDGAR',
        url: `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${m.cik}&type=10-K` });
      return out;
    }
    case 'naicsMap':
      return [srcRow(data, 'sicnaics'), srcRow(data, 'submissions')].filter(Boolean);
    case 'privateScale':
      return [srcRow(data, 'qcew'), srcRow(data, 'sicnaics')].filter(Boolean);
    case 'censusScale':
      return [srcRow(data, 'ecn'), srcRow(data, 'sicnaics')].filter(Boolean);
    case 'formd':
      return [srcRow(data, 'formd')].filter(Boolean);
    case 'formdFiling': {
      const r = sel.r || {};
      const out = [];
      if (r.accn && r.cik) {
        out.push({ type: 'SEC filing', truth: true,
          label: `The Form D${r.amended ? '/A' : ''} itself · filed ${r.date}`,
          detail: r.accn, url: filingIndexUrl(r.cik, r.accn) });
      }
      const ds = srcRow(data, 'formd');
      if (ds) out.push(ds);
      return out;
    }
    case 'majorGroup':
      return [srcRow(data, 'sicmanual')].filter(Boolean);
    case 'industryGroup':
    case 'office':
      return [srcRow(data, 'sicpage')].filter(Boolean);
    default:
      return [];
  }
}
