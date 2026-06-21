#!/usr/bin/env node

/*
  Tiny local proxy for Meetup Event Radar.
  Why this exists: browser JavaScript cannot usually read meetup.com pages
  directly because of CORS. This proxy fetches public Meetup pages locally and
  passes the HTML back to the browser app.
*/

const http = require("node:http");
const { URL } = require("node:url");

const HOST = "127.0.0.1";
const PORT = Number.parseInt(process.env.PORT || "8787", 10);
const CACHE_TTL_MS = Number.parseInt(process.env.CACHE_TTL_MS || "900000", 10);
const ALLOWED_HOSTS = new Set(["www.meetup.com", "meetup.com"]);
const cache = new Map();

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function isAllowedUrl(target) {
  if (!ALLOWED_HOSTS.has(target.hostname)) return false;
  if (target.protocol !== "https:") return false;
  if (!target.pathname.includes("/events")) return false;
  return true;
}

async function fetchTarget(targetUrl) {
  const cached = cache.get(targetUrl);
  if (cached && Date.now() - cached.createdAt < CACHE_TTL_MS) {
    return cached.body;
  }

  const response = await fetch(targetUrl, {
    headers: {
      "User-Agent": "MeetupEventRadar/1.0 local personal event monitor",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (!response.ok) {
    throw new Error(`Target returned HTTP ${response.status}`);
  }

  const body = await response.text();
  cache.set(targetUrl, { body, createdAt: Date.now() });
  return body;
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, "");
    return;
  }

  const requestUrl = new URL(req.url, `http://${HOST}:${PORT}`);

  if (requestUrl.pathname === "/") {
    send(res, 200, "Meetup Event Radar proxy is running. Use /fetch?url=https%3A%2F%2Fwww.meetup.com%2Fgroup%2Fevents%2F");
    return;
  }

  if (requestUrl.pathname !== "/fetch") {
    send(res, 404, "Not found");
    return;
  }

  const rawTarget = requestUrl.searchParams.get("url");
  if (!rawTarget) {
    send(res, 400, "Missing url query parameter");
    return;
  }

  let target;
  try {
    target = new URL(rawTarget);
  } catch (_) {
    send(res, 400, "Invalid target URL");
    return;
  }

  if (!isAllowedUrl(target)) {
    send(res, 403, "Only public https://www.meetup.com/.../events... URLs are allowed");
    return;
  }

  try {
    const html = await fetchTarget(target.toString());
    send(res, 200, html, { "Content-Type": "text/html; charset=utf-8" });
  } catch (error) {
    send(res, 502, error.message);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Meetup Event Radar proxy listening on http://${HOST}:${PORT}`);
});
