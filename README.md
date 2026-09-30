# Dublin Club Fixtures

A one-page site listing this week's fixtures (Monday to Sunday) for any Dublin GAA, camogie or ladies football club. Pick a club from the dropdown; the choice is remembered, and a link like `/#ballinteer-st-johns` opens straight to that club.

## How it works

- `scripts/fetch-fixtures.mjs` reads the five Dublin SportsManager fixture feeds used by dublingaa.ie and writes `fixtures.json` for the current week.
- `.github/workflows/update-fixtures.yml` runs that script every two hours (07:07–21:07 UTC), on every push to `main`, and on demand, then publishes `index.html` and `fixtures.json` to GitHub Pages.
- `index.html` loads `fixtures.json` and does everything else in the browser.

No n8n or server is involved.

## Setup

1. Upload these files to the repository, keeping the folder structure (including `.github/workflows/`).
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. In **Actions**, open **Update fixtures** and click **Run workflow** for the first build.

## Note on the data

The fixtures come from SportsManager's public data feed. SportLoMo's terms (clause 10.2) restrict harvesting data from their services, and permission has been requested. To stop pulling data, disable the **Update fixtures** workflow in the Actions tab.
