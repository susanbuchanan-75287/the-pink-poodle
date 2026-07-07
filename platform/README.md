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

### `wizard/index.html` — self-service setup wizard
A single-file, zero-dependency browser wizard that lets a groomer build their
own 4-page site with a **live preview** — no CLI, no Node. It loads the same
`site-generator/templates.js` engine the CLI uses, so **what you preview is
byte-for-byte what gets published**.

Open `wizard/index.html` in any browser. Left column: a form (plan, shop info,
brand colors, services + prices, reviews, booking endpoint). Right column: a
sticky live preview (Home / Services / About / Book tabs, desktop/phone toggle)
plus three actions:

- **Publish** — POSTs the config as a `spaPlatformLead` to the Pink Poodle
  backend (lead capture only; see below). On any failure it downloads the
  request JSON and shows a text/email fallback so the groomer is never stuck.
- **Download ZIP** — builds `<slug>-website.zip` (all 5 files) client-side with
  a tiny store-mode ZIP writer — the groomer can host it anywhere.
- **Download JSON** — exports `<slug>.json`, a valid `tenants/*.json` config
  that `generate.js` can rebuild from.

### Monetization — Model B ($399 setup + $29/mo)
The chosen model: **$399 one-time setup + $29/mo hosting**, with The Pink Poodle
itself free (flagship reference). Critically, **the platform never touches
groomer money** — each groomer keeps their own Square/Stripe/SMS and takes
payments directly. There is no per-transaction cut, which is what keeps us out
of money-transmitter licensing and ASC 606 revenue-recognition complexity. The
groomer owns their domain, repo, and payment processor; we sell setup + hosting.

The `spaPlatformLead` backend action records wizard "Publish" submissions into
the Firestore `pp_platform_leads` collection (rate-limited, honeypot-guarded,
email-validated). It stores interest only — **no payment is processed** — so
Susan can follow up manually and keep onboarding a human-in-the-loop step.


## What's now built (multi-tenant trial provisioning)

The site-generation half is joined by a live, **tenant-scoped operational
backend** and instant self-serve provisioning:

- **Instant trial salons** — the wizard's "🐩 Create my salon now" button POSTs
  `spaProvisionTenant` to `pinkPoodleSpa`, which mints an isolated **trial**
  tenant (`pp_tenants/{id}/spa_tickets|spa_clients|spa_staff|config/*`), a
  4-digit owner PIN, a 30-day expiry, and a daily ticket cap. Returns live
  board + book URLs and emails Susan.
- **Hosted per-tenant pages** on thepinkpoodle.dog: `board.html?t=<id>` (staff
  console — PIN login, live board, step chips, owner check-in/pickup email +
  push notifications) and `book.html?t=<id>` (public booking + tracking + FCM
  push opt-in). Hosted centrally so the shared-project CORS + FCM config work.
- **Hard data isolation** — tenant requests carry `tenantId`; a strict
  `TENANT_ACTIONS` allowlist blocks flagship-only features (e.g. checkout) with
  a 400. Flagship (no `tenantId`) is byte-for-byte unchanged. Verified by a
  14/14 multi-tenant fire test.

## What this MVP is NOT (yet)

The board brief covers the rest of what a full launch needs — still deferred:

- **Billing** for the **$399 setup + $29/mo** (Model B) is handled manually /
  out-of-band — the platform intentionally never processes groomer customer
  payments.
- **Email verification / App Check / CAPTCHA** gating before a trial activates
  (currently guarded by honeypot + rate limit + email-format check only).
- **Trial-expiry cleanup** job and an admin **promote-to-paid / suspend**
  workflow in the Salon Console.
- Automated **custom-domain** attach/SSL per tenant — phase 1 is assist /
  affiliate (help the groomer buy/point a domain), not reselling.
- Per-state **money-transmitter / sales-tax** handling and **TCPA/10DLC** SMS
  registration per tenant (see the scaling & financial board briefs).

Treat `sites/` output as disposable build artifacts.
