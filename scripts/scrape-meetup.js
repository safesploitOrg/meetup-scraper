#!/usr/bin/env node

/*
  Meetup Event Radar scraper
  --------------------------
  Runs server-side in GitHub Actions or locally with `npm run scrape`.
  It fetches public Meetup event pages, extracts public event metadata, writes
  data/events.json, then the static frontend displays that JSON.
*/

import fs from "node:fs/promises";
import path from "node:path";
import { loadGroupUrls } from "./groups-config.js";

const DAYS_AHEAD = Number.parseInt(process.env.DAYS_AHEAD || "90", 10);
const OUTPUT_PATH = path.join("data", "events.json");
const MAX_EVENT_PAGES_PER_GROUP = Number.parseInt(process.env.MAX_EVENT_PAGES_PER_GROUP || "30", 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.REQUEST_DELAY_MS || "1500", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.REQUEST_TIMEOUT_MS || "25000", 10);
const USER_AGENT = process.env.USER_AGENT || "MeetupEventRadar/2.0 personal public-event dashboard (+https://github.com/)";

const CATEGORY_RULES = [
  {
    name: "Security / DevSecOps",
    emoji: "🛡️",
    weight: 42,
    keywords: [
      "devsecops", "security", "cyber", "appsec", "owasp", "threat", "vulnerability",
      "secure", "secrets", "supply chain", "sast", "dast", "zero trust", "identity", "iam"
    ]
  },
  {
    name: "Cloud / Platform / DevOps",
    emoji: "☁️",
    weight: 38,
    keywords: [
      "devops", "platform", "cloud", "aws", "azure", "gcp", "sre", "reliability",
      "infrastructure", "terraform", "ansible", "gitops", "ci/cd", "pipeline", "automation"
    ]
  },
  {
    name: "Kubernetes / Cloud Native",
    emoji: "☸️",
    weight: 36,
    keywords: [
      "kubernetes", "k8s", "cloud native", "cncf", "container", "containers", "helm",
      "istio", "service mesh", "operator", "pod", "docker"
    ]
  },
  {
    name: "Observability / SRE",
    emoji: "📈",
    weight: 34,
    keywords: [
      "observability", "grafana", "prometheus", "loki", "tempo", "opentelemetry",
      "monitoring", "logging", "tracing", "metrics", "incident", "slo", "sli"
    ]
  },
  {
    name: "Data / Kafka / Streaming",
    emoji: "🧵",
    weight: 32,
    keywords: [
      "kafka", "streaming", "event driven", "event-driven", "data pipeline", "schema registry",
      "flink", "spark", "real-time", "realtime", "pubsub", "pub/sub"
    ]
  },
  {
    name: "Linux / Open Source",
    emoji: "🐧",
    weight: 30,
    keywords: [
      "linux", "open source", "opensource", "gnu", "kernel", "debian", "ubuntu", "red hat",
      "rhel", "fedora", "shell", "bash", "systemd"
    ]
  },
  {
    name: "Professional / Conference",
    emoji: "💼",
    weight: 26,
    keywords: [
      "conference", "summit", "expo", "forum", "panel", "keynote", "workshop", "talk",
      "speaker", "networking", "roundtable", "leadership", "career", "hiring"
    ]
  },
  {
    name: "Social / Community",
    emoji: "🍻",
    weight: 24,
    keywords: [
      "social", "drinks", "pub", "mixer", "meet and greet", "community", "networking",
      "afterwards", "pizza", "beer", "coffee"
    ]
  },
  {
    name: "Other",
    emoji: "📌",
    weight: 5,
    keywords: []
  }
];

const REJECT_KEYWORDS = [
  "forex", "get rich", "passive income", "business opportunity", "mlm", "miracle cure"
];

async function main() {
  const groupUrls = await loadGroupUrls();
  const generatedAt = new Date();
  const allEvents = [];
  const errors = [];
  const seenEventUrls = new Set();

  for (const groupUrl of groupUrls) {
    try {
      console.log(`Scanning ${groupUrl}`);
      const eventUrls = await discoverEventUrls(groupUrl);
      console.log(`  Found ${eventUrls.length} candidate event URL(s)`);

      for (const eventUrl of eventUrls.slice(0, MAX_EVENT_PAGES_PER_GROUP)) {
        if (seenEventUrls.has(eventUrl)) {
          continue;
        }

        seenEventUrls.add(eventUrl);
        await sleep(REQUEST_DELAY_MS);

        try {
          const event = await fetchAndParseEvent(eventUrl, groupUrl);
          if (!isUsefulEvent(event)) {
            continue;
          }

          if (!isWithinNextDays(event.startDate, DAYS_AHEAD, generatedAt)) {
            continue;
          }

          allEvents.push(scoreAndCategorise(event));
        } catch (error) {
          errors.push({ url: eventUrl, message: error.message });
          console.warn(`  Event warning: ${eventUrl}: ${error.message}`);
        }
      }

      await sleep(REQUEST_DELAY_MS);
    } catch (error) {
      errors.push({ url: groupUrl, message: error.message });
      console.warn(`Group warning: ${groupUrl}: ${error.message}`);
    }
  }

  const dedupedEvents = dedupeEvents(allEvents)
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const payload = {
    generatedAt: generatedAt.toISOString(),
    daysAhead: DAYS_AHEAD,
    groupCount: groupUrls.length,
    groups: groupUrls.map((url) => ({ url, slug: getGroupSlug(url) })),
    categoryRules: CATEGORY_RULES.map(({ name, emoji }) => ({ name, emoji })),
    events: dedupedEvents,
    errors
  };

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`Wrote ${dedupedEvents.length} event(s) to ${OUTPUT_PATH}`);

  if (errors.length > 0) {
    console.log(`Completed with ${errors.length} warning(s).`);
  }
}

async function discoverEventUrls(groupUrl) {
  const eventsUrl = new URL("events/", groupUrl).toString();
  const html = await fetchText(eventsUrl);
  const eventUrls = new Set();

  for (const href of extractHrefValues(html)) {
    const absolute = safeAbsoluteUrl(href, groupUrl);
    if (absolute && isMeetupEventUrl(absolute, groupUrl)) {
      eventUrls.add(stripTracking(absolute));
    }
  }

  const escapedRegex = /https?:\\?\/\\?\/www\.meetup\.com\\?\/[A-Za-z0-9_-]+\\?\/events\\?\/\d+\\?\/?/gi;
  for (const match of html.matchAll(escapedRegex)) {
    eventUrls.add(stripTracking(match[0].replaceAll("\\/", "/")));
  }

  const relativeRegex = /\/[A-Za-z0-9_-]+\/events\/\d+\/?/gi;
  for (const match of html.matchAll(relativeRegex)) {
    const absolute = safeAbsoluteUrl(match[0], groupUrl);
    if (absolute && isMeetupEventUrl(absolute, groupUrl)) {
      eventUrls.add(stripTracking(absolute));
    }
  }

  return [...eventUrls];
}

async function fetchAndParseEvent(eventUrl, groupUrl) {
  const html = await fetchText(eventUrl);
  const jsonLdEvents = extractJsonLdEvents(html);
  const jsonLd = jsonLdEvents[0] || {};
  const metadata = extractMetadata(html);
  const groupSlug = getGroupSlug(groupUrl);

  const title = cleanText(
    jsonLd.name ||
    metadata["og:title"] ||
    extractTagText(html, "h1") ||
    ""
  ).replace(/ \| Meetup$/, "");

  const description = cleanText(
    jsonLd.description ||
    metadata.description ||
    metadata["og:description"] ||
    ""
  );

  const startDate = normaliseDate(
    jsonLd.startDate ||
    metadata["event:start_time"] ||
    metadata["startDate"] ||
    extractDateFromHtml(html)
  );

  const location = normaliseLocation(jsonLd.location) || extractLocationFromText(html) || "TBC";
  const groupName = cleanText(metadata["og:site_name"] || titleFromSlug(groupSlug));
  const rsvpCount = extractRsvpCount(html);
  const isOnline = /online event|isOnline["':\s]+true|"eventAttendanceMode"\s*:\s*"https:\/\/schema\.org\/OnlineEventAttendanceMode"/i.test(html);

  return {
    id: makeEventId(eventUrl),
    title,
    description,
    startDate,
    location,
    rsvpCount,
    isOnline,
    eventUrl: stripTracking(eventUrl),
    groupUrl: normaliseGroupUrl(groupUrl),
    groupSlug,
    groupName,
    source: "public Meetup page",
    scrapedAt: new Date().toISOString()
  };
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-GB,en;q=0.9",
        "User-Agent": USER_AGENT
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function extractHrefValues(html) {
  const hrefs = [];
  const regex = /href=["']([^"']+)["']/gi;
  for (const match of html.matchAll(regex)) {
    hrefs.push(decodeHtml(match[1]));
  }
  return hrefs;
}

function extractJsonLdEvents(html) {
  const events = [];
  const scripts = extractScriptContents(html, "application/ld+json");

  for (const script of scripts) {
    for (const candidate of parseJsonCandidates(script)) {
      collectJsonLdEvents(candidate, events);
    }
  }

  return events;
}

function collectJsonLdEvents(value, events) {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLdEvents(item, events));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const type = value["@type"];
  const types = Array.isArray(type) ? type : [type];
  if (types.some((item) => String(item).toLowerCase() === "event")) {
    events.push(value);
  }

  if (value["@graph"]) {
    collectJsonLdEvents(value["@graph"], events);
  }
}

function parseJsonCandidates(text) {
  const cleaned = decodeHtml(text.trim());
  const candidates = [];

  try {
    candidates.push(JSON.parse(cleaned));
  } catch {
    // Some pages include more than one object; fall through to lightweight recovery.
  }

  const objectRegex = /\{[\s\S]*?"@type"[\s\S]*?\}/g;
  for (const match of cleaned.matchAll(objectRegex)) {
    try {
      candidates.push(JSON.parse(match[0]));
    } catch {
      // Ignore partial JSON fragments.
    }
  }

  return candidates;
}

function extractScriptContents(html, type) {
  const scripts = [];
  const regex = new RegExp(`<script[^>]+type=["']${escapeRegex(type)}["'][^>]*>([\\s\\S]*?)<\\/script>`, "gi");
  for (const match of html.matchAll(regex)) {
    scripts.push(match[1]);
  }
  return scripts;
}

function extractMetadata(html) {
  const metadata = {};
  const regex = /<meta\s+([^>]+)>/gi;
  for (const match of html.matchAll(regex)) {
    const attrs = parseAttributes(match[1]);
    const key = attrs.property || attrs.name || attrs.itemprop;
    if (key && attrs.content) {
      metadata[key] = decodeHtml(attrs.content);
    }
  }
  return metadata;
}

function parseAttributes(raw) {
  const attrs = {};
  const regex = /([A-Za-z_:.-]+)=["']([^"']*)["']/g;
  for (const match of raw.matchAll(regex)) {
    attrs[match[1]] = match[2];
  }
  return attrs;
}

function extractTagText(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = html.match(regex);
  return match ? stripTags(match[1]) : "";
}

function extractDateFromHtml(html) {
  const patterns = [
    /"startDate"\s*:\s*"([^"\\]+)"/i,
    /"dateTime"\s*:\s*"([^"\\]+)"/i,
    /datetime=["']([^"']+)["']/i,
    /(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[^"'\s<]+)/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return match[1];
    }
  }

  return "";
}

function extractLocationFromText(html) {
  const text = cleanText(stripTags(html));
  const venueMatch = text.match(/(?:Location|Venue)\s+([^|]{3,120}?)(?:\s+(?:Details|About|Hosted|RSVP|Attend)|$)/i);
  return cleanText(venueMatch?.[1] || "");
}

function extractRsvpCount(html) {
  const text = cleanText(stripTags(html));
  const match = text.match(/(\d{1,5})\s+(?:attendees|going|people going)/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

function normaliseLocation(location) {
  if (!location) {
    return "";
  }

  if (typeof location === "string") {
    return cleanText(location);
  }

  const pieces = [];
  if (location.name) pieces.push(location.name);

  const address = location.address || location["address"];
  if (typeof address === "string") {
    pieces.push(address);
  } else if (address) {
    for (const key of ["streetAddress", "addressLocality", "addressRegion", "postalCode", "addressCountry"]) {
      if (address[key]) pieces.push(address[key]);
    }
  }

  return cleanText([...new Set(pieces)].join(", "));
}

function scoreAndCategorise(event) {
  const text = `${event.title} ${event.description} ${event.groupName} ${event.groupSlug}`.toLowerCase();
  const matchedCategories = [];
  let bestCategory = CATEGORY_RULES.at(-1);
  let bestScore = bestCategory.weight;

  for (const category of CATEGORY_RULES) {
    if (category.name === "Other") {
      continue;
    }

    const hits = category.keywords.filter((keyword) => text.includes(keyword.toLowerCase()));
    if (hits.length === 0) {
      continue;
    }

    const categoryScore = category.weight + hits.length * 8;
    matchedCategories.push({ name: category.name, emoji: category.emoji, hits });

    if (categoryScore > bestScore) {
      bestCategory = category;
      bestScore = categoryScore;
    }
  }

  let score = bestScore;
  if (event.rsvpCount && event.rsvpCount >= 20) score += 8;
  if (/london/i.test(event.location)) score += 5;
  if (event.isOnline) score -= 10;
  if (/workshop|hands-on|demo|deep dive|technical/i.test(`${event.title} ${event.description}`)) score += 8;
  if (/social|drinks|pub|pizza|networking/i.test(`${event.title} ${event.description}`)) score += 5;

  return {
    ...event,
    category: bestCategory.name,
    categoryEmoji: bestCategory.emoji,
    matchedCategories,
    score: Math.max(0, Math.min(100, score))
  };
}

function isUsefulEvent(event) {
  if (!event.title || !event.eventUrl || !event.startDate) {
    return false;
  }

  const text = `${event.title} ${event.description}`.toLowerCase();
  return !REJECT_KEYWORDS.some((keyword) => text.includes(keyword));
}

function isWithinNextDays(dateValue, daysAhead, now = new Date()) {
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) {
    return false;
  }

  const horizon = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  return date >= startOfDay(now) && date <= endOfDay(horizon);
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = event.eventUrl || `${event.groupSlug}:${event.title}:${event.startDate}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function isMeetupEventUrl(url, groupUrl) {
  try {
    const parsed = new URL(url);
    const groupSlug = getGroupSlug(groupUrl).toLowerCase();
    return parsed.hostname.endsWith("meetup.com") &&
      parsed.pathname.toLowerCase().startsWith(`/${groupSlug}/events/`) &&
      /\/events\/\d+\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function safeAbsoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function normaliseGroupUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = `/${getGroupSlug(parsed.toString())}/`;
  return parsed.toString();
}

function stripTracking(url) {
  const parsed = new URL(url);
  parsed.search = "";
  parsed.hash = "";
  parsed.pathname = parsed.pathname.replace(/\/+$/, "/");
  return parsed.toString();
}

function getGroupSlug(url) {
  const parsed = new URL(url);
  return parsed.pathname.split("/").filter(Boolean)[0] || "unknown-group";
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function makeEventId(url) {
  const match = url.match(/\/events\/(\d+)/i);
  return match?.[1] || Buffer.from(url).toString("base64url").slice(0, 16);
}

function normaliseDate(value) {
  if (!value) {
    return "";
  }

  const decoded = decodeHtml(String(value));
  const date = new Date(decoded);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function endOfDay(date) {
  const copy = new Date(date);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function cleanText(value) {
  return decodeHtml(stripTags(String(value || "")))
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\\u002F/g, "/");
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
