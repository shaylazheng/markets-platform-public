/* The market snapshot the quiz and the ask-mode are seeded with: current
   levels, one-week changes, and today's headlines, assembled client-side so the
   model is grounded in the same numbers on screen. Ported from the vanilla build. */
import { fetchSeries, fetchNews } from '@markets/shell/lib/api.js';
import { fmtDate } from '@markets/shell/lib/series.js';

export async function buildQuizContext() {
  const ids = ['DGS2', 'DGS10', 'DGS30', 'T10Y2Y', 'SP500', 'NASDAQCOM', 'DJIA', 'VIXCLS', 'DFF', 'CPIAUCSL', 'UNRATE', 'DTWEXBGS', 'DEXUSEU', 'DCOILWTICO', 'DCOILBRENTEU', 'DHHNGSP', 'BAMLC0A0CM', 'BAMLH0A0HYM2'];
  const got = {};
  await Promise.all(ids.map((id) => fetchSeries(id).then((d) => { got[id] = d; }).catch(() => { got[id] = null; })));

  const val = (id, dec, pre = '', suf = '') => (got[id] ? pre + got[id].values[got[id].values.length - 1].toFixed(dec) + suf : 'n/a');
  const idx = (id) => (got[id] ? Math.round(got[id].values[got[id].values.length - 1]).toLocaleString('en-US') : 'n/a');
  const chg = (id, n, pp) => {
    const d = got[id]; if (!d || d.values.length <= n) return 'n/a';
    const now = d.values[d.values.length - 1], then = d.values[d.values.length - 1 - n];
    return pp ? `${now - then >= 0 ? '+' : ''}${(now - then).toFixed(2)}pp` : `${now / then - 1 >= 0 ? '+' : ''}${((now / then - 1) * 100).toFixed(1)}%`;
  };
  const since = (id, pp) => {
    const d = got[id]; if (!d) return 'n/a';
    const f = d.values[0], l = d.values[d.values.length - 1];
    return pp ? `${l - f >= 0 ? '+' : ''}${(l - f).toFixed(2)}pp since 2023` : `${l / f - 1 >= 0 ? '+' : ''}${((l / f - 1) * 100).toFixed(0)}% since 2023`;
  };
  let cpiYoY = 'n/a';
  if (got['CPIAUCSL']) { const v = got['CPIAUCSL'].values, L = v.length - 1; if (L >= 12) cpiYoY = ((v[L] / v[L - 12] - 1) * 100).toFixed(1) + '% YoY'; }
  const asOf = got['DGS10'] ? fmtDate(got['DGS10'].dates[got['DGS10'].dates.length - 1]) : (got['SP500'] ? fmtDate(got['SP500'].dates[got['SP500'].dates.length - 1]) : 'today');

  const lines = [
    `MARKET SNAPSHOT (latest available, as of ${asOf}). Changes are over the past week unless noted.`,
    `Rates: 2Y ${val('DGS2', 2, '', '%')} (1wk ${chg('DGS2', 5, true)}, ${since('DGS2', true)}); 10Y ${val('DGS10', 2, '', '%')} (1wk ${chg('DGS10', 5, true)}, ${since('DGS10', true)}); 30Y ${val('DGS30', 2, '', '%')} (1wk ${chg('DGS30', 5, true)}).`,
    `Yield curve: 2s10s spread ${val('T10Y2Y', 2, '', 'pp')} (1wk ${chg('T10Y2Y', 5, true)}).`,
    `Credit spreads: IG ${val('BAMLC0A0CM', 2, '', '%')} (1wk ${chg('BAMLC0A0CM', 5, true)}); HY ${val('BAMLH0A0HYM2', 2, '', '%')} (1wk ${chg('BAMLH0A0HYM2', 5, true)}).`,
    `Equities: S&P 500 ${idx('SP500')} (1wk ${chg('SP500', 5, false)}, ${since('SP500', false)}); Nasdaq ${idx('NASDAQCOM')} (1wk ${chg('NASDAQCOM', 5, false)}); Dow ${idx('DJIA')} (1wk ${chg('DJIA', 5, false)}).`,
    `Volatility: VIX ${val('VIXCLS', 2)} (1wk ${chg('VIXCLS', 5, false)}).`,
    `FX: Broad Dollar Index ${val('DTWEXBGS', 1)} (1wk ${chg('DTWEXBGS', 5, false)}); USD per EUR ${val('DEXUSEU', 4)}.`,
    `Commodities: WTI ${val('DCOILWTICO', 2, '$')} (1wk ${chg('DCOILWTICO', 5, false)}); Brent ${val('DCOILBRENTEU', 2, '$')}; Natural gas ${val('DHHNGSP', 2, '$')} per MMBtu.`,
    `Macro: Fed funds ${val('DFF', 2, '', '%')}; CPI ${cpiYoY}; Unemployment ${val('UNRATE', 1, '', '%')}.`,
  ];

  try {
    const j = await fetchNews();
    const items = j.items || [];
    const specific = items.filter((i) => i.themes.some((t) => t !== 'Markets'));
    const pick = (specific.length >= 8 ? specific : items).slice(0, 8);
    if (pick.length) {
      lines.push('', "TODAY'S TOP HEADLINES:");
      pick.forEach((it, i) => lines.push(`${i + 1}. [${it.source}] ${it.title}${it.summary ? ': ' + it.summary : ''}`));
    }
  } catch (e) { /* headlines optional */ }

  return lines.join('\n');
}
