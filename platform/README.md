# Pink Poodle Platform (multi-tenant experiment)

This folder is the R&D home for turning the single-salon Pink Poodle app into a
**multi-tenant product** — the "$40/mo, every groomer gets their own website"
idea. It is intentionally kept **separate** from the live single-salon app
(`/`, `spa.html`, `functions/`) so nothing here can affect thepinkpoodle.dog.

Read `platform-brief.html` (open in a browser) for the full board brief:
tenant model, pricing/unit economics, Stripe billing, provisioning, isolation,
and the legal recap.

## What's here today (MVP)

### `site-generator/` — the 4-page site product, in miniature
A zero-dependency Node generator that turns one tenant JSON config into a
polished, responsive, brand-themed **4-page static site**: Home, Services,
About, and a working Book form.

```bash
cd site-generator
node generate.js tenants/happy-tails.json     # build one tenant
node generate.js --all                         # build every tenants/*.json
node generate.js tenants/happy-tails.json --out ../sites   # custom output dir
```

Output lands in `site-generator/sites/<slug>/`. Open `index.html` to preview.

- **`tenants/*.json`** — one file per groomer. Everything that differentiates a
  site (brand colors, copy, services + prices, reviews, contact, booking
  endpoint) lives here. The template is shared.
- **`generate.js`** — validates the config, applies defaults, and emits the
  five files. Deterministic: same input → same output.
- **Book page** — a real form. If the tenant sets `bookingEndpoint`, it POSTs
  JSON there; otherwise it falls back to an SMS/mailto link so a generated site
  is never a dead end. Includes a honeypot field and schema.org `PetGroomer`
  structured data for SEO.

`happy-tails` (Happy Tails Grooming, Beckley WV) is the bundled sample tenant
that demonstrates the product with a completely different brand from the Pink
Poodle.

## What this MVP is NOT (yet)

This proves the **site-generation** half of the product. The board brief covers
the rest of what a real launch needs — and none of it is built here:

- Tenant **signup + Stripe subscription billing** ($40/mo).
- A shared, **tenant-scoped backend** (bookings, inventory, etc. keyed by
  `tenantId`) with hard data isolation between salons.
- Automated **provisioning** (create tenant → generate site → deploy → attach
  domain) and per-tenant custom domains/SSL.
- Per-state **money-transmitter / sales-tax** handling and **TCPA/10DLC** SMS
  registration per tenant (see the scaling & financial board briefs).

Treat `sites/` output as disposable build artifacts.
