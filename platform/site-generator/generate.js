#!/usr/bin/env node
/**
 * Pink Poodle Platform — 4-page site generator (MVP)
 * --------------------------------------------------------------------------
 * The "$40/mo, each groomer gets their own site" product in miniature. Given
 * a single tenant JSON config (see tenants/*.json), this emits a polished,
 * responsive, brand-themed 4-page static site — Home, Services, About, Book —
 * that a groomer could host on any static host (GitHub Pages, Netlify, a
 * subfolder, or a custom domain).
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

/* ---------- helpers ---------- */
function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function money(n) {
  const v = Number(n) || 0;
  return "$" + (Math.round(v * 100) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
}
function req(cfg, field) {
  if (!cfg[field] && cfg[field] !== 0) throw new Error(`Tenant config is missing required field: "${field}"`);
}

/** Validate + normalize a tenant config, applying sensible defaults. */
function normalize(cfg) {
  ["slug", "business", "phone"].forEach((f) => req(cfg, f));
  if (!/^[a-z0-9-]+$/.test(cfg.slug)) throw new Error(`slug must be kebab-case [a-z0-9-]: "${cfg.slug}"`);
  const brand = cfg.brand || {};
  return {
    slug: cfg.slug,
    business: cfg.business,
    tagline: cfg.tagline || "Professional pet grooming",
    owner: cfg.owner || "",
    town: cfg.town || "",
    phone: cfg.phone,
    sms: String(cfg.sms || cfg.phone).replace(/[^\d]/g, ""),
    email: cfg.email || "",
    address: cfg.address || "",
    hours: cfg.hours || "By appointment",
    emoji: cfg.emoji || "🐾",
    about: cfg.about || `${cfg.business} is a locally owned pet grooming studio.`,
    services: Array.isArray(cfg.services) ? cfg.services : [],
    reviews: Array.isArray(cfg.reviews) ? cfg.reviews : [],
    bookingEndpoint: cfg.bookingEndpoint || "",
    brand: {
      primary: brand.primary || "#d6337f",
      accent: brand.accent || "#e9a23b",
      ink: brand.ink || "#221820",
      cream: brand.cream || "#fdf6fa",
    },
  };
}

/* ---------- shared shell (nav, head, footer, theme) ---------- */
function head(t, title, desc) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="${esc(t.brand.primary)}" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="${esc(t.business)}" />
<meta name="format-detection" content="telephone=yes" />
<title>${esc(title)} · ${esc(t.business)}</title>
<meta name="description" content="${esc(desc)}" />
<meta property="og:title" content="${esc(t.business)} — ${esc(t.tagline)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:type" content="website" />
<link rel="stylesheet" href="styles.css" />
<script type="application/ld+json">
${JSON.stringify({
  "@context": "https://schema.org",
  "@type": "PetGroomer",
  name: t.business,
  telephone: t.phone,
  email: t.email || undefined,
  address: t.address || undefined,
  areaServed: t.town || undefined,
  description: t.about,
}, null, 2)}
</script>
</head>
<body>`;
}
function nav(t, active) {
  const link = (href, label, key) =>
    `<a href="${href}"${active === key ? ' aria-current="page"' : ""}>${esc(label)}</a>`;
  return `<header class="site-head">
  <a class="brand" href="index.html"><span class="brand__emoji">${esc(t.emoji)}</span> ${esc(t.business)}</a>
  <nav class="site-nav">
    ${link("index.html", "Home", "home")}
    ${link("services.html", "Services", "services")}
    ${link("about.html", "About", "about")}
    ${link("book.html", "Book", "book")}
  </nav>
</header>`;
}
function footer(t) {
  const bits = [];
  if (t.address) bits.push(esc(t.address));
  if (t.phone) bits.push(`<a href="tel:${esc(t.phone)}">${esc(t.phone)}</a>`);
  if (t.email) bits.push(`<a href="mailto:${esc(t.email)}">${esc(t.email)}</a>`);
  return `<footer class="site-foot">
  <div>${bits.join(" · ")}</div>
  <div class="muted">${esc(t.hours)} · © ${new Date().getFullYear()} ${esc(t.business)}</div>
  <div class="muted tiny">Powered by the Pink Poodle grooming platform</div>
</footer>
</body>
</html>`;
}

/* ---------- pages ---------- */
function pageHome(t) {
  const desc = `${t.business} — ${t.tagline}${t.town ? " in " + t.town : ""}. Book grooming online.`;
  const reviews = t.reviews.slice(0, 2).map((r) =>
    `<figure class="quote"><blockquote>“${esc(r.text)}”</blockquote><figcaption>${esc(r.who || "")}</figcaption></figure>`).join("");
  const topServices = t.services.slice(0, 3).map((s) =>
    `<li><span>${esc(s.name)}</span><strong>${esc(money(s.price))}</strong></li>`).join("");
  return head(t, "Home", desc) + nav(t, "home") + `
<section class="hero">
  <div class="hero__inner">
    <p class="eyebrow">${esc(t.town || "Pet grooming")}</p>
    <h1>${esc(t.tagline)}</h1>
    <p class="lead">${esc(t.about.split(". ")[0])}.</p>
    <div class="cta-row">
      <a class="btn btn--primary" href="book.html">Book an appointment</a>
      <a class="btn btn--ghost" href="tel:${esc(t.phone)}">Call ${esc(t.phone)}</a>
    </div>
  </div>
</section>
<section class="band">
  <div class="cols">
    <div class="card">
      <h2>Popular services</h2>
      <ul class="pricelist">${topServices || "<li>See our full menu</li>"}</ul>
      <a class="link" href="services.html">See all services →</a>
    </div>
    <div class="card">
      <h2>Visit us</h2>
      <p>${esc(t.address || "By appointment")}</p>
      <p class="muted">${esc(t.hours)}</p>
      <a class="link" href="book.html">Request a time →</a>
    </div>
  </div>
</section>
${reviews ? `<section class="band band--tint"><h2 class="center">Happy tails</h2><div class="quotes">${reviews}</div></section>` : ""}
` + footer(t);
}

function pageServices(t) {
  const rows = t.services.length
    ? t.services.map((s) =>
        `<article class="svc">
          <div class="svc__head"><h3>${esc(s.name)}</h3><span class="price">${esc(money(s.price))}</span></div>
          ${s.desc ? `<p>${esc(s.desc)}</p>` : ""}
          <a class="link" href="book.html?service=${encodeURIComponent(s.name)}">Book this →</a>
        </article>`).join("")
    : "<p>Service menu coming soon — call for details.</p>";
  return head(t, "Services", `Grooming services & pricing at ${t.business}.`) + nav(t, "services") + `
<section class="page">
  <h1>Services &amp; pricing</h1>
  <p class="lead">Transparent pricing. Final quote depends on your pup's size, coat, and condition.</p>
  <div class="svc-grid">${rows}</div>
  <p class="muted">Prices are starting points. ${esc(t.business)} will confirm your exact quote at drop-off.</p>
</section>
` + footer(t);
}

function pageAbout(t) {
  const paras = t.about.split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join("");
  return head(t, "About", `About ${t.business}${t.owner ? " — " + t.owner : ""}.`) + nav(t, "about") + `
<section class="page">
  <h1>About ${esc(t.business)}</h1>
  ${t.owner ? `<p class="lead">Owned &amp; operated by ${esc(t.owner)}.</p>` : ""}
  ${paras}
  <div class="cols" style="margin-top:1.4rem">
    <div class="card"><h2>Hours</h2><p>${esc(t.hours)}</p></div>
    <div class="card"><h2>Find us</h2><p>${esc(t.address || "By appointment")}</p></div>
  </div>
  <div class="cta-row"><a class="btn btn--primary" href="book.html">Book with us</a></div>
</section>
` + footer(t);
}

function pageBook(t) {
  // The form POSTs JSON to bookingEndpoint when configured; otherwise it
  // composes an SMS (mobile) / mailto so the site is always actionable.
  const options = t.services.map((s) => `<option value="${esc(s.name)}">${esc(s.name)} — ${esc(money(s.price))}</option>`).join("");
  return head(t, "Book", `Request a grooming appointment at ${t.business}.`) + nav(t, "book") + `
<section class="page">
  <h1>Book an appointment</h1>
  <p class="lead">Tell us about your pup and your ideal timing — ${esc(t.owner || t.business)} will confirm.</p>
  <form id="bookForm" class="form" novalidate>
    <label>Your name<input name="ownerName" required /></label>
    <label>Mobile number<input name="phone" type="tel" required placeholder="${esc(t.phone)}" /></label>
    <label>Pet's name<input name="petName" required /></label>
    <label>Breed / size<input name="breed" placeholder="e.g. Goldendoodle, 45 lbs" /></label>
    <label>Service<select name="service">${options}<option value="Not sure">Not sure — help me choose</option></select></label>
    <label>Preferred day/time<input name="preferred" placeholder="e.g. Saturday morning" /></label>
    <label>Notes<textarea name="notes" rows="3" placeholder="Anything we should know?"></textarea></label>
    <input type="text" name="company" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true" />
    <button class="btn btn--primary" type="submit">Request appointment</button>
    <p class="form__note" id="bookNote"></p>
  </form>
</section>
<script>
(function () {
  var ENDPOINT = ${JSON.stringify(t.bookingEndpoint)};
  var SMS = ${JSON.stringify(t.sms)};
  var EMAIL = ${JSON.stringify(t.email)};
  var form = document.getElementById('bookForm');
  var note = document.getElementById('bookNote');
  var params = new URLSearchParams(location.search);
  if (params.get('service')) { var sel = form.querySelector('[name=service]'); if (sel) sel.value = params.get('service'); }
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (form.company.value) return; // honeypot
    var d = {};
    Array.prototype.forEach.call(form.elements, function (el) { if (el.name && el.name !== 'company') d[el.name] = el.value.trim(); });
    if (!d.ownerName || !d.phone || !d.petName) { note.textContent = 'Please add your name, mobile, and pet name.'; return; }
    if (ENDPOINT) {
      fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(d) })
        .then(function (r) { if (!r.ok) throw new Error(); note.textContent = 'Request sent! We\\'ll text you to confirm. 🐾'; form.reset(); })
        .catch(function () { fallback(d); });
    } else { fallback(d); }
  });
  function fallback(d) {
    var msg = 'Grooming request: ' + d.petName + ' (' + (d.breed || '') + ') for ' + d.service + '. ' + (d.preferred || '') + ' — ' + d.ownerName + ' ' + d.phone + (d.notes ? '. ' + d.notes : '');
    if (SMS) { note.innerHTML = 'Opening your text app…'; location.href = 'sms:' + SMS + '?&body=' + encodeURIComponent(msg); }
    else if (EMAIL) { location.href = 'mailto:' + EMAIL + '?subject=' + encodeURIComponent('Grooming request') + '&body=' + encodeURIComponent(msg); }
    else { note.textContent = 'Please call to book: ' + SMS; }
  }
})();
</script>
` + footer(t);
}

/* ---------- theme ---------- */
function styles(t) {
  const b = t.brand;
  return `:root{--primary:${b.primary};--accent:${b.accent};--ink:${b.ink};--cream:${b.cream};}
*{box-sizing:border-box}html{scroll-behavior:smooth}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--cream);line-height:1.55}
a{color:var(--primary)}
.muted{color:#6b6b6b}.tiny{font-size:.78rem}.center{text-align:center}
.site-head{display:flex;justify-content:space-between;align-items:center;gap:1rem;flex-wrap:wrap;padding:1rem 1.25rem;background:#fff;border-bottom:1px solid rgba(0,0,0,.06);position:sticky;top:0;z-index:10}
.brand{font-weight:800;font-size:1.15rem;text-decoration:none;color:var(--ink)}
.brand__emoji{margin-right:.25rem}
.site-nav a{margin-left:1.1rem;text-decoration:none;color:var(--ink);font-weight:600;opacity:.8}
.site-nav a[aria-current]{color:var(--primary);opacity:1;border-bottom:2px solid var(--primary)}
.hero{background:linear-gradient(135deg,var(--primary),var(--accent));color:#fff;padding:4rem 1.25rem}
.hero__inner{max-width:820px;margin:0 auto}
.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-size:.8rem;opacity:.9;margin:0 0 .4rem}
.hero h1{font-size:2.6rem;margin:.2rem 0;line-height:1.1}
.lead{font-size:1.15rem;opacity:.95}
.cta-row{display:flex;gap:.7rem;flex-wrap:wrap;margin-top:1.4rem}
.btn{display:inline-block;padding:.8rem 1.4rem;border-radius:999px;font-weight:700;text-decoration:none;border:2px solid transparent;cursor:pointer}
.btn--primary{background:#fff;color:var(--primary)}
.hero .btn--primary{background:#fff;color:var(--primary)}
.page .btn--primary,.band .btn--primary{background:var(--primary);color:#fff}
.btn--ghost{border-color:#fff;color:#fff}
.band{max-width:960px;margin:0 auto;padding:2.6rem 1.25rem}
.band--tint{background:#fff;max-width:none}
.band--tint>*{max-width:960px;margin-left:auto;margin-right:auto}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}
.card{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:16px;padding:1.4rem;box-shadow:0 6px 24px rgba(0,0,0,.04)}
.card h2{margin-top:0}
.pricelist{list-style:none;padding:0;margin:0}
.pricelist li{display:flex;justify-content:space-between;padding:.35rem 0;border-bottom:1px dashed rgba(0,0,0,.1)}
.link{font-weight:700;text-decoration:none}
.page{max-width:900px;margin:0 auto;padding:2.6rem 1.25rem}
.page h1{font-size:2rem;margin-top:0}
.svc-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:1rem;margin:1.2rem 0}
.svc{background:#fff;border:1px solid rgba(0,0,0,.06);border-radius:16px;padding:1.2rem}
.svc__head{display:flex;justify-content:space-between;align-items:baseline;gap:.5rem}
.svc__head h3{margin:0}
.price{font-weight:800;color:var(--primary);white-space:nowrap}
.quotes{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}
.quote{margin:0;background:var(--cream);border-radius:16px;padding:1.2rem}
.quote blockquote{margin:0 0 .6rem;font-size:1.05rem}
.quote figcaption{font-weight:700;color:var(--primary)}
.form{display:grid;gap:.8rem;max-width:520px;background:#fff;padding:1.5rem;border-radius:16px;border:1px solid rgba(0,0,0,.06);margin-top:1rem}
.form label{display:grid;gap:.3rem;font-weight:600}
.form input,.form select,.form textarea{padding:.7rem;border:1px solid #ccc;border-radius:10px;font:inherit}
.form__note{margin:.2rem 0 0;color:var(--primary);font-weight:600;min-height:1.2em}
.site-foot{text-align:center;padding:2rem 1.25rem;background:#fff;border-top:1px solid rgba(0,0,0,.06);margin-top:2rem;display:grid;gap:.4rem}
@media(max-width:640px){.cols,.quotes{grid-template-columns:1fr}.hero h1{font-size:2rem}}
`;
}

/* ---------- build ---------- */
function build(cfgPath, outRoot) {
  const raw = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const t = normalize(raw);
  const outDir = path.join(outRoot, t.slug);
  fs.mkdirSync(outDir, { recursive: true });
  const files = {
    "index.html": pageHome(t),
    "services.html": pageServices(t),
    "about.html": pageAbout(t),
    "book.html": pageBook(t),
    "styles.css": styles(t),
  };
  Object.keys(files).forEach((name) => fs.writeFileSync(path.join(outDir, name), files[name]));
  return { slug: t.slug, outDir, pages: Object.keys(files) };
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
module.exports = { normalize, build, styles };
