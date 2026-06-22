#!/usr/bin/env node

/*
  Static site builder
  -------------------
  Creates the GitHub Pages artifact from the static frontend and the latest
  scraper output. Run this after `npm run scrape`.
*/

import fs from "node:fs/promises";
import path from "node:path";

const ROOT_DIR = process.cwd();
const OUTPUT_DIR = path.join(ROOT_DIR, "public");
const DATA_FILE = path.join("data", "events.json");
const STATIC_FILES = [
  "index.html",
  "styles.css",
  "app.js",
  ".nojekyll"
];

async function main() {
  await assertFileExists(DATA_FILE);

  await fs.rm(OUTPUT_DIR, { recursive: true, force: true });
  await fs.mkdir(path.join(OUTPUT_DIR, "data"), { recursive: true });

  for (const file of STATIC_FILES) {
    await copyToOutput(file);
  }

  await copyToOutput(DATA_FILE);
  console.log(`Built static site in ${path.relative(ROOT_DIR, OUTPUT_DIR)}`);
}

async function assertFileExists(relativePath) {
  try {
    await fs.access(path.join(ROOT_DIR, relativePath));
  } catch {
    throw new Error(`Missing ${relativePath}. Run \`npm run scrape\` before \`npm run build\`.`);
  }
}

async function copyToOutput(relativePath) {
  const source = path.join(ROOT_DIR, relativePath);
  const destination = path.join(OUTPUT_DIR, relativePath);

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(source, destination);
  console.log(`Copied ${relativePath}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
