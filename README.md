# Markets Platform — public demo

A modular markets research dashboard with macro charts, credit and rates, a calendar, a newswire, a company relationship graph, company research views, and signal-monitoring screens.

## Run locally

Use Node 22 or later:

```sh
npm ci
npm run build
npm start
```

Open http://localhost:3778. `PORT=3900 npm start` selects another port. For development, run `npm start` and `npm run dev` in separate terminals.

**All dashboard observations are synthetic.** The demo server generates reproducible series, fictional company relationships, sample headlines, and illustrative alerts. It does not fetch market data, send notifications, or execute trades. Some deeper analyses display an explicit demo limitation instead of fabricated results. Company symbols are familiar labels, not claims about those companies.

## What is included

- Original React surfaces and shared shell, with Report and its endpoints removed.
- Deterministic sample-data server in `demo/`.
- Core calculations for ratios, financial metrics, XBRL transforms, provenance, business segments, and risk mathematics.
- Focused tests: `npm test`; calculation checks: `npm run test:math`.
- Public filing excerpts retained only as parser unit-test fixtures; they do not supply the demo dashboard.

The public edition is maintained separately from the complete private workspace. Private data, infrastructure, connection adapters, and research notes are not part of this distribution. Public updates are reviewed exports, never automatic mirrors of the private workspace.
