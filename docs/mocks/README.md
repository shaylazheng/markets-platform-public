# Original market dashboard mocks

Ten visual designs share the original deterministic sample-data generator and browser interactions. Frost Desk is the featured design. All HTML files are self-contained and use system font fallbacks; no feeds or server are needed. They cover Markets, Credit & Rates, Calendar, Newswire, Learn, and Alerts. Report is absent.

Download a file and open it in your browser. GitHub source pages display HTML code rather than executing the dashboard.

| Design | Download |
| --- | --- |
| Krypton Desk | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/01-krypton.html) |
| Frost Desk — featured | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/02-frost.html) |
| Amber Tape | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/03-amber.html) |
| Swiss Tape | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/04-swiss.html) |
| Nordic Dusk | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/05-nordic.html) |
| Bento Desk | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/06-bento.html) |
| Field Ledger | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/07-notebook.html) |
| Violet Signal | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/08-oled.html) |
| Morning Sheet | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/09-dataink.html) |
| Brass & Espresso | [HTML](https://github.com/shaylazheng/markets-platform-public/raw/refs/heads/main/docs/mocks/out/10-brass.html) |

## Rebuild

From the repository root:

```sh
node docs/mocks/build.mjs
```

The builder inlines `base.css`, one stylesheet from `styles/`, and `core.js` into each `out/*.html` file. Example headlines, prices, insights, and tutoring responses are illustrative content, not live services.
