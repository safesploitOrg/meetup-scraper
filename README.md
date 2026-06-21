# Meetup Event Radar

A small HTML/CSS/JS application for monitoring public Meetup group event pages and categorising events for the next 90 days.

## What it does

- Keeps group URLs in `GROUP_URLS` inside `app.js`.
- Fetches each group's `/events/` page.
- Extracts public Meetup event URLs.
- Fetches each event page.
- Parses public event metadata from the page.
- Categorises events into Social, Conference/Professional, Cloud/DevOps, Security/Hacker, AI/Data, Culture/Museum, or Other.
- Filters to the next N days, default 90.
- Exports CSV.

## Important limitation

A browser-only app cannot usually fetch `meetup.com` pages directly because of CORS. This project includes a tiny local proxy for personal, read-only use against public event pages.

Meetup's own terms restrict commercial data extraction and automated scraping. Keep this personal, low-rate, and public-data-only.

## Run locally

Terminal 1:

```bash
cd public
npm start
```

Terminal 2:

```bash
cd public
python3 -m http.server 8080
```

Open:

```text
http://localhost:8080
```

Then click **Scan groups**.

## Add groups

Edit `app.js`:

```js
const GROUP_URLS = [
  "https://www.meetup.com/hackernewslondon/",
  "https://www.meetup.com/another-group/",
];
```

The app automatically turns each group URL into:

```text
https://www.meetup.com/<group>/events/
```

## Tune categories

Edit `CATEGORY_RULES` in `app.js`.

For example, to make professional events score more strongly, add keywords under:

```js
{
  name: "Conference / Professional",
  keywords: ["conference", "summit", "panel", "talk"]
}
```

## Security notes

- No Meetup username/password is used.
- No OAuth token is used.
- The proxy only allows `https://www.meetup.com/.../events...` URLs.
- The proxy caches responses briefly to avoid hammering Meetup.
- Avoid collecting attendee/member data.
