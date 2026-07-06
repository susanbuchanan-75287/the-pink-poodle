#!/usr/bin/env node
/**
 * Pink Poodle Platform — 4-page site generator (MVP)
 * --------------------------------------------------------------------------
 * The "each groomer gets their own site" product in miniature. Given a single
 * tenant JSON config (see tenants/*.json), this emits a polished, responsive,
 * brand-themed 4-page static site — Home, Services, About, Book — that a
 * groomer could host on any static host (GitHub Pages, Netlify, a subfolder,
 * or a custom domain).
 *
 * The actual page/theme templates live in ./templates.js so they can be shared
 * verbatim with the browser-based setup wizard (wizard/index.html) — meaning
 * the live preview a groomer sees is byte-for-byte what gets published here.
 *
 * Design goals for the MVP:
 *   - Zero runtime dependencies (pure Node core), so it runs anywhere.
 *   - Deterministic output: same config in -> same site out.
 *   - Everything a tenant needs to differentiate lives in the JSON (brand
 *     colors, copy, services, reviews, contact) — the template is shared.
 *   - The Book page is a real, working form. If bookingEndpoint is set it
 *     POSTs JSON there; otherwise it falls back to an SMS/mailto link so the
 *     generated site is never a dead end.
 *
 * Usage:
 *   node generate.js tenants/happy-tails.json           # one tenant
 *   node generate.js --all                              # every tenant/*.json
 *   node generate.js tenants/happy-tails.json --out ../sites
 * --------------------------------------------------------------------------
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { buildFiles, normalize } = require("./templates.js");

/* ---------- build ---------- */
function build(cfgPath, outRoot) {
  const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const files = buildFiles(raw);
  const slug = normalize(raw).slug;
  const outDir = path.join(outRoot, slug);
  fs.mkdirSync(outDir, { recursive: true });
  Object.keys(files).forEach((name) => fs.writeFileSync(path.join(outDir, name), files[name]));
  return { slug, outDir, pages: Object.keys(files) };
}

function main() {
  const args = process.argv.slice(2);
  let outRoot = path.join(__dirname, "sites");
  const outIdx = args.indexOf("--out");
  if (outIdx >= 0 && args[outIdx + 1]) { outRoot = path.resolve(args[outIdx + 1]); args.splice(outIdx, 2); }
  let configs = [];
  if (args.includes("--all")) {
    const dir = path.join(__dirname, "tenants");
    configs = fs.readdirSync(dir).filter((f) => f.endsWith(".json") && !f.endsWith(".schema.json")).map((f) => path.join(dir, f));
  } else if (args[0]) {
    configs = [path.resolve(args[0])];
  } else {
    console.error("Usage: node generate.js <tenant.json> | --all [--out <dir>]");
    process.exit(1);
  }
  configs.forEach((c) => {
    try {
      const r = build(c, outRoot);
      console.log(`✓ ${r.slug} → ${path.relative(process.cwd(), r.outDir)} (${r.pages.join(", ")})`);
    } catch (e) {
      console.error(`✗ ${path.basename(c)}: ${e.message}`);
      process.exitCode = 1;
    }
  });
}

if (require.main === module) main();
module.exports = { build };
