# Meetup Event Radar

A static GitHub Pages dashboard for tracking public Meetup events across selected London tech groups.

The browser app does **not** scrape Meetup directly. Instead:

1. `scripts/scrape-meetup.js` runs in GitHub Actions or locally.
2. It fetches public `/events/` pages and public event pages.
3. It writes `data/events.json`.
4. `index.html` + `app.js` load that local JSON file and render the dashboard.

This avoids browser CORS issues and means GitHub Pages can host the app without a live Node server.

## Watched Meetup groups

The scraper reads the watched groups from `groups.yml`:

```yaml
groups:
  - https://www.meetup.com/london-devops/
  - https://www.meetup.com/devsecops-london-gathering/
```

Add or remove one public Meetup group URL per line.

## Local usage

```bash
npm run scrape
npm run build
npm run serve
```

`npm run serve` hosts the rebuilt `public/` artifact.

Then open:

```text
http://localhost:8080
```

## GitHub Pages usage

1. Push this folder to a GitHub repository.
2. In GitHub, go to **Settings → Pages**.
3. Set the Pages source to **GitHub Actions**.
4. Go to **Actions → Update Meetup Events → Run workflow** to generate the first `data/events.json`.
5. The scheduled workflow then refreshes the JSON and deploys the rebuilt static site every 12 hours.

## How the scheduled refresh works

`.github/workflows/update-events.yml` runs:

```bash
npm run scrape
npm run build
```

It writes `data/events.json`, builds a fresh `public/` artifact containing the static frontend and updated JSON, commits `data/events.json` back to the repository if it changed, and deploys the artifact to GitHub Pages.

## Configuration

Environment variables supported by the scraper:

| Variable | Default | Purpose |
|---|---:|---|
| `DAYS_AHEAD` | `90` | Only include events within this many days |
| `MAX_EVENT_PAGES_PER_GROUP` | `30` | Limit event page fetches per group |
| `GROUPS_PATH` | `groups.yml` | YAML file containing watched Meetup group URLs |
| `REQUEST_DELAY_MS` | `1500` | Delay between requests |
| `REQUEST_TIMEOUT_MS` | `25000` | HTTP timeout per request |
| `USER_AGENT` | built-in | User-Agent header for requests |

## Notes and limitations

- This only uses public Meetup pages.
- It does not use Meetup OAuth or Meetup Pro API access.
- It does not collect attendee emails, member details, private comments, or private group data.
- Meetup can change its frontend markup, so the scraper may need occasional maintenance.
- Keep request volume low and respectful.

## Files

```text
meetup-event-radar/
├── index.html
├── styles.css
├── app.js
├── data/
│   └── events.json
├── scripts/
│   ├── build-static.js
│   ├── groups-config.js
│   └── scrape-meetup.js
├── .github/
│   └── workflows/
│       └── update-events.yml
├── groups.yml
├── .gitignore
├── .nojekyll
├── package-lock.json
├── package.json
└── README.md
```
