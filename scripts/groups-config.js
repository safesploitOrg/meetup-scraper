import fs from "node:fs/promises";

export const DEFAULT_GROUPS_CONFIG_PATH = "groups.yml";

export async function loadGroupUrls(configPath = process.env.GROUPS_PATH || DEFAULT_GROUPS_CONFIG_PATH) {
  let contents;

  try {
    contents = await fs.readFile(configPath, "utf8");
  } catch (error) {
    throw new Error(`Could not read ${configPath}: ${error.message}`);
  }

  const urls = parseGroupUrlsYaml(contents);
  if (urls.length === 0) {
    throw new Error(`${configPath} does not contain any Meetup group URLs.`);
  }

  return normaliseAndDedupeGroupUrls(urls);
}

export function parseGroupUrlsYaml(contents) {
  const urls = [];
  let inGroups = false;
  let sawGroupsKey = false;
  let groupsIndent = 0;

  for (const rawLine of contents.split(/\r?\n/)) {
    const line = stripYamlComment(rawLine);
    const trimmed = line.trim();

    if (!trimmed || trimmed === "---" || trimmed === "...") {
      continue;
    }

    const indent = line.match(/^\s*/)[0].length;
    const groupsMatch = trimmed.match(/^groups\s*:\s*(.*)$/i);

    if (indent === 0 && groupsMatch) {
      sawGroupsKey = true;
      inGroups = true;
      groupsIndent = indent;
      collectInlineListValues(groupsMatch[1], urls);
      continue;
    }

    if (inGroups && indent <= groupsIndent && /^[A-Za-z0-9_-]+\s*:/.test(trimmed)) {
      inGroups = false;
    }

    if ((inGroups || !sawGroupsKey) && trimmed.startsWith("- ")) {
      urls.push(parseYamlScalar(trimmed.slice(2)));
    }
  }

  return urls.filter(Boolean);
}

function collectInlineListValues(value, urls) {
  const trimmed = value.trim();
  if (!trimmed) {
    return;
  }

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    urls.push(parseYamlScalar(trimmed));
    return;
  }

  for (const item of splitInlineList(trimmed.slice(1, -1))) {
    urls.push(parseYamlScalar(item));
  }
}

function splitInlineList(value) {
  const items = [];
  let current = "";
  let quote = "";

  for (const char of value) {
    if (quote) {
      current += char;
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }

    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current);
  }

  return items;
}

function parseYamlScalar(value) {
  let scalar = value.trim();

  if ((scalar.startsWith('"') && scalar.endsWith('"')) || (scalar.startsWith("'") && scalar.endsWith("'"))) {
    scalar = scalar.slice(1, -1);
  }

  if (scalar.startsWith("<") && scalar.endsWith(">")) {
    scalar = scalar.slice(1, -1);
  }

  return scalar.trim();
}

function stripYamlComment(line) {
  let quote = "";

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (quote) {
      if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return line.slice(0, index).trimEnd();
    }
  }

  return line;
}

function normaliseAndDedupeGroupUrls(urls) {
  const normalisedUrls = [];
  const seen = new Set();

  for (const rawUrl of urls) {
    const url = normaliseGroupUrl(rawUrl);
    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    normalisedUrls.push(url);
  }

  return normalisedUrls;
}

function normaliseGroupUrl(rawUrl) {
  let parsed;

  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid group URL in groups.yml: ${rawUrl}`);
  }

  if (!parsed.hostname.endsWith("meetup.com")) {
    throw new Error(`Expected a meetup.com group URL in groups.yml, got: ${rawUrl}`);
  }

  const groupSlug = parsed.pathname.split("/").filter(Boolean)[0];
  if (!groupSlug) {
    throw new Error(`Meetup group URL is missing a group slug in groups.yml: ${rawUrl}`);
  }

  parsed.hash = "";
  parsed.search = "";
  parsed.pathname = `/${groupSlug}/`;
  return parsed.toString();
}
