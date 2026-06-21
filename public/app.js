/*
  Meetup Event Radar
  ------------------
  Edit GROUP_URLS to include the public Meetup groups you care about.
  The app fetches /events/ pages via a local proxy, extracts public event URLs,
  then fetches each event page and categorises events for the next N days.
*/

const GROUP_URLS = [
  // "https://www.meetup.com/YOUR-GROUP-HERE/",
  "https://www.meetup.com/london-devops/",
  "https://www.meetup.com/devsecops-london-gathering/",
  "https://www.meetup.com/ansible-london/",
  "https://www.meetup.com/apache-kafka-london/",
  "https://www.meetup.com/awsuguk/",
  "https://www.meetup.com/cloud-native-london/",
  "https://www.meetup.com/devops-exchange-london",
  "https://www.meetup.com/grafana-and-friends-london/",
  "https://www.meetup.com/londonlinux/",
  "https://www.meetup.com/london-microservices/",
  "https://www.meetup.com/platform-engineers-london/",
];

const CATEGORY_RULES = [
  {
    name: "Security / Hacker",
    emoji: "🛡️",
    weight: 35,
    keywords: ["security", "cyber", "hacker", "hack", "infosec", "owasp", "ctf", "threat", "malware", "red team", "blue team"]
  },
  {
    name: "Cloud / DevOps",
    emoji: "☁️",
    weight: 30,
    keywords: ["cloud", "aws", "azure", "gcp", "devops", "platform", "kubernetes", "k8s", "terraform", "sre", "observability", "ci/cd"]
  },
  {
    name: "Conference / Professional",
    emoji: "💼",
    weight: 26,
    keywords: ["conference", "summit", "panel", "talk", "speaker", "presentation", "workshop", "networking", "founder", "startup", "product", "leadership"]
  },
  {
    name: "Social",
    emoji: "🍻",
    weight: 28,
    keywords: ["social", "pub", "drinks", "meet and greet", "mixer", "hangout", "party", "community", "afterwards"]
  },
  {
    name: "Culture / Museum",
    emoji: "🏛️",
    weight: 25,
    keywords: ["museum", "gallery", "exhibition", "late", "walk", "tour", "art", "culture", "history"]
  },
  {
    name: "AI / Data",
    emoji: "🤖",
    weight: 24,
    keywords: ["ai", "artificial intelligence", "machine learning", "ml", "llm", "data", "analytics", "python", "prompt"]
  },
  {
    name: "Other",
    emoji: "📌",
    weight: 5,
    keywords: []
  }
];

const REJECT_KEYWORDS = [
  "forex", "crypto scheme", "get rich", "business opportunity", "mlm", "webinar only", "miracle", "passive income"
];

const state = {
  events: [],
  errors: [],
  scannedGroups: 0,
};

const els = {
  proxyBase: document.querySelector("#proxyBase"),
  daysAhead: document.querySelector("#daysAhead"),
  searchBox: document.querySelector("#searchBox"),
  scanButton: document.querySelector("#scanButton"),
  exportButton: document.querySelector("#exportButton"),
  summaryGrid: document.querySelector("#summaryGrid"),
  eventList: document.querySelector("#eventList"),
  resultMeta: document.querySelector("#resultMeta"),
  categoryFilter: document.querySelector("#categoryFilter"),
  groupList: document.querySelector("#groupList"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  template: document.querySelector("#eventCardTemplate"),
};

function main() {
  renderConfiguredGroups();
  populateCategoryFilter();
  renderSummary();
  renderEvents();

  els.scanButton.addEventListener("click", scanGroups);
  els.exportButton.addEventListener("click", exportCsv);
  els.searchBox.addEventListener("input", renderEvents);
  els.categoryFilter.addEventListener("change", renderEvents);
}

async function scanGroups() {
  setStatus("running", "Scanning groups...");
  els.scanButton.disabled = true;
  els.exportButton.disabled = true;
  state.events = [];
  state.errors = [];
  state.scannedGroups = 0;
  renderEvents();
  renderSummary();

  const daysAhead = Number.parseInt(els.daysAhead.value, 10) || 90;
  const seenEventUrls = new Set();

  for (const groupUrl of GROUP_URLS) {
    try {
      const normalisedGroupUrl = normaliseGroupUrl(groupUrl);
      const eventsUrl = `${normalisedGroupUrl}events/`;
      const groupHtml = await fetchViaProxy(eventsUrl);
      const eventLinks = extractEventLinks(groupHtml, normalisedGroupUrl);

      state.scannedGroups += 1;
      setStatus("running", `Found ${eventLinks.length} links in ${getGroupSlug(groupUrl)}`);

      for (const eventUrl of eventLinks) {
        if (seenEventUrls.has(eventUrl)) continue;
        seenEventUrls.add(eventUrl);

        try {
          await sleep(250);
          const eventHtml = await fetchViaProxy(eventUrl);
          const event = parseEventPage(eventHtml, eventUrl, groupUrl);

          if (!event.title || !event.startDate) continue;
          if (!isWithinDays(event.startDate, daysAhead)) continue;
          if (containsRejectedKeyword(event)) continue;

          state.events.push(scoreAndCategorise(event));
          renderEvents();
          renderSummary();
        } catch (error) {
          state.errors.push(`${eventUrl}: ${error.message}`);
        }
      }
    } catch (error) {
      state.errors.push(`${groupUrl}: ${error.message}`);
    }
  }

  state.events.sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
  renderEvents();
  renderSummary();
  els.scanButton.disabled = false;
  els.exportButton.disabled = state.events.length === 0;
  setStatus(state.errors.length ? "error" : "done", state.errors.length ? `Done with ${state.errors.length} warning(s)` : "Scan complete");
}

async function fetchViaProxy(targetUrl) {
  const proxyBase = els.proxyBase.value.trim();
  const response = await fetch(`${proxyBase}${encodeURIComponent(targetUrl)}`);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

function extractEventLinks(html, groupUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const links = new Set();

  doc.querySelectorAll("a[href]").forEach((anchor) => {
    const href = anchor.getAttribute("href") || "";
    const absolute = new URL(href, groupUrl).toString();

    if (/meetup\.com\/.+\/events\/\d+\/?/i.test(absolute)) {
      links.add(stripTracking(absolute));
    }
  });

  // Meetup often embeds route data in scripts; catch event URLs in raw HTML too.
  const regex = /https?:\\?\/\\?\/www\.meetup\.com\\?\/[A-Za-z0-9_-]+\\?\/events\\?\/\d+\\?\/?/gi;
  for (const match of html.matchAll(regex)) {
    const cleaned = match[0].replaceAll("\\/", "/");
    links.add(stripTracking(cleaned));
  }

  return [...links];
}

function parseEventPage(html, eventUrl, groupUrl) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const jsonLdEvents = extractJsonLdEvents(doc);
  const jsonLd = jsonLdEvents[0] || {};
  const title = cleanText(jsonLd.name || getMeta(doc, "og:title") || doc.querySelector("h1")?.textContent || "");
  const description = cleanText(jsonLd.description || getMeta(doc, "description") || getMeta(doc, "og:description") || "");
  const startDate = jsonLd.startDate || extractDateFromText(doc.body?.textContent || "");
  const location = normaliseLocation(jsonLd.location) || extractLocationFallback(doc);
  const groupName = cleanText(getMeta(doc, "og:site_name") || getGroupSlug(groupUrl));

  return {
    title,
    description,
    startDate,
    location,
    url: eventUrl,
    groupUrl: normaliseGroupUrl(groupUrl),
    groupName,
    source: "public Meetup page",
  };
}

function extractJsonLdEvents(doc) {
  const events = [];

  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const parsed = JSON.parse(script.textContent);
      const candidates = Array.isArray(parsed) ? parsed : [parsed];

      for (const item of candidates) {
        if (item?.["@type"] === "Event" || item?.["@type"]?.includes?.("Event")) {
          events.push(item);
        }
        if (Array.isArray(item?.["@graph"])) {
          events.push(...item["@graph"].filter((graphItem) => graphItem?.["@type"] === "Event"));
        }
      }
    } catch (_) {
      // Ignore malformed/irrelevant JSON-LD blocks.
    }
  });

  return events;
}

function scoreAndCategorise(event) {
  const text = `${event.title} ${event.description} ${event.location}`.toLowerCase();
  let bestCategory = CATEGORY_RULES[CATEGORY_RULES.length - 1];
  let bestScore = 0;

  for (const category of CATEGORY_RULES) {
    let score = 0;
    for (const keyword of category.keywords) {
      if (text.includes(keyword.toLowerCase())) score += category.weight;
    }
    if (score > bestScore) {
      bestScore = score;
      bestCategory = category;
    }
  }

  const eventDate = new Date(event.startDate);
  const day = eventDate.getDay();
  const hour = eventDate.getHours();
  let score = bestScore;

  if ([5, 6, 0].includes(day)) score += 12;
  if (hour >= 17 && hour <= 21) score += 10;
  if (text.includes("free")) score += 5;
  if (text.includes("afterwards") || text.includes("drinks")) score += 8;

  return {
    ...event,
    category: `${bestCategory.emoji} ${bestCategory.name}`,
    score,
  };
}

function containsRejectedKeyword(event) {
  const text = `${event.title} ${event.description}`.toLowerCase();
  return REJECT_KEYWORDS.some((keyword) => text.includes(keyword.toLowerCase()));
}

function isWithinDays(dateValue, daysAhead) {
  const now = new Date();
  const max = new Date();
  max.setDate(max.getDate() + daysAhead);
  const date = new Date(dateValue);
  return date >= startOfToday(now) && date <= max;
}

function renderEvents() {
  const category = els.categoryFilter.value;
  const search = els.searchBox.value.trim().toLowerCase();
  const filtered = state.events
    .filter((event) => category === "all" || event.category === category)
    .filter((event) => !search || `${event.title} ${event.description} ${event.location} ${event.groupName}`.toLowerCase().includes(search))
    .sort((a, b) => b.score - a.score || new Date(a.startDate) - new Date(b.startDate));

  els.eventList.innerHTML = "";
  els.resultMeta.textContent = `${filtered.length} visible event(s), ${state.events.length} total, ${state.scannedGroups}/${GROUP_URLS.length} group(s) scanned.`;

  if (!filtered.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = state.events.length ? "No events match the current filters." : "Run a scan to populate events.";
    els.eventList.appendChild(empty);
    return;
  }

  for (const event of filtered) {
    const node = els.template.content.cloneNode(true);
    node.querySelector(".category-pill").textContent = event.category;
    node.querySelector(".score-pill").textContent = `Score ${event.score}`;
    node.querySelector("h3").textContent = event.title;
    node.querySelector(".event-meta").textContent = `${formatDate(event.startDate)} · ${event.location || "Location TBC"}`;
    node.querySelector(".event-description").textContent = truncate(event.description || "No public description found.", 180);
    node.querySelector("a").href = event.url;
    node.querySelector(".group-name").textContent = event.groupName;
    els.eventList.appendChild(node);
  }
}

function renderSummary() {
  const categories = countBy(state.events, "category");
  const cards = [
    [state.events.length, "events found"],
    [state.scannedGroups, "groups scanned"],
    [Object.keys(categories).length, "active categories"],
    [state.errors.length, "warnings"],
  ];

  els.summaryGrid.innerHTML = cards.map(([value, label]) => `
    <article class="summary-card"><strong>${value}</strong><span>${label}</span></article>
  `).join("");
}

function populateCategoryFilter() {
  const categories = CATEGORY_RULES.map((category) => `${category.emoji} ${category.name}`);
  for (const category of categories) {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    els.categoryFilter.appendChild(option);
  }
}

function renderConfiguredGroups() {
  els.groupList.innerHTML = "";
  for (const groupUrl of GROUP_URLS) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = normaliseGroupUrl(groupUrl);
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = getGroupSlug(groupUrl);
    li.appendChild(a);
    els.groupList.appendChild(li);
  }
}

function exportCsv() {
  const rows = [
    ["title", "category", "score", "startDate", "location", "groupName", "url"],
    ...state.events.map((event) => [event.title, event.category, event.score, event.startDate, event.location, event.groupName, event.url])
  ];

  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `meetup-events-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function setStatus(status, text) {
  els.statusDot.className = `status-dot ${status}`;
  els.statusText.textContent = text;
}

function getMeta(doc, name) {
  return doc.querySelector(`meta[property="${name}"]`)?.content || doc.querySelector(`meta[name="${name}"]`)?.content || "";
}

function normaliseLocation(location) {
  if (!location) return "";
  if (typeof location === "string") return cleanText(location);
  if (location.name) return cleanText(location.name);
  if (location.address) {
    const address = location.address;
    return cleanText([address.name, address.streetAddress, address.addressLocality, address.postalCode].filter(Boolean).join(", "));
  }
  return "";
}

function extractLocationFallback(doc) {
  const text = doc.body?.textContent || "";
  const match = text.match(/(?:Location|Venue)\s+([^\n]{6,120})/i);
  return cleanText(match?.[1] || "");
}

function extractDateFromText(text) {
  const iso = text.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)?.[0];
  return iso || "";
}

function normaliseGroupUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  return parsed.toString().replace(/\/?$/, "/");
}

function getGroupSlug(url) {
  return new URL(normaliseGroupUrl(url)).pathname.split("/").filter(Boolean)[0] || url;
}

function stripTracking(url) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/?$/, "/");
}

function startOfToday(date) {
  const cloned = new Date(date);
  cloned.setHours(0, 0, 0, 0);
  return cloned;
}

function formatDate(dateValue) {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(dateValue));
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 1).trim()}…`;
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function countBy(items, key) {
  return items.reduce((acc, item) => {
    acc[item[key]] = (acc[item[key]] || 0) + 1;
    return acc;
  }, {});
}

function csvEscape(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main();
