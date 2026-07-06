# The Pink Poodle 🐩

Marketing website for **The Pink Poodle** — a locally owned luxury pet salon in Princeton, West Virginia, owned and operated by Britni.

**Live site:** https://pinkpoodle.dog

## About
Static, single-page site (no build step). Just HTML, CSS, and vanilla JS — fast, secure, and free to host on GitHub Pages.

| File | Purpose |
|------|---------|
| `index.html` | All page content & sections |
| `styles.css` | Blush/pink upscale theme, responsive layout |
| `script.js` | Nav, gallery lightbox, scroll reveals, SMS booking composer |
| `assets/` | Photos of Britni, Paris, and freshly-groomed pups |
| `CNAME` | Custom domain for GitHub Pages (`pinkpoodle.dog`) |

## Booking → text notification
When a visitor fills out the booking form and taps **Request My Appointment**, the form POSTs to the `pinkPoodleBook` Firebase Function, which:

1. Logs the request to Firestore (`pp_bookings`).
2. **Emails the salon inbox** (`groomerbrit@yahoo.com`) via SendGrid — lands on Britni's phone as a notification instantly. The email has tap-to-text / tap-to-call buttons for the customer.
3. **Texts Britni** at 304-921-2748 via Twilio — *auto-enables the moment real Twilio creds are set*. Today `TWILIO_FROM_NUMBER` is a placeholder, so SMS is skipped gracefully and email carries the request.
4. **Syncs to Square Appointments** (when connected) — finds or creates the customer in her Square directory and, if an exact date/time is given and defaults are set, drops a pending appointment on her Square calendar to confirm. See below.

This works from **any device, including desktop** (the old `sms:` deep-link only worked on phones). If the POST ever fails on a phone, it falls back to opening Messages pre-filled. A hidden `company` honeypot field blocks bots.

- **Recipients / sender:** edit `BRITNI_SMS`, `OWNER_EMAIL`, `FROM_EMAIL` in `functions/index.js`. Endpoint URL lives in `BOOK_ENDPOINT` in `script.js`.
- **To turn on real SMS to Britni:** set a live Twilio number/creds (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) in Secret Manager and redeploy — no code change needed. (Texting the salon owner is a transactional alert; A2P 10DLC still applies to the Twilio number.)
- **Transport is shared** with the Oracle functions in the same project (`SENDGRID_API_KEY` sender `oracle@barkparks.dog` is domain-verified).

## Square Appointments sync 📅
The booking form keeps its friendly "request a time" flow, but every request can also flow into Square:

- **Customer sync** — the booker is found (by phone, then email) or created in Britni's Square customer directory, with the dog/breed saved as a note.
- **Calendar booking** — if the visitor picks an exact date **and** time (the optional pickers under "Have an exact time in mind?"), *and* a default location + groomer + service are configured, a **pending appointment is created on her Square calendar** with a "please confirm" seller note. Free-text-only ("this week, mornings") requests still create/attach the customer and land in her email/SMS to schedule by hand.
- **Fail-soft:** Square is best-effort. A Square outage or misconfig never blocks the email/SMS — the request always reaches Britni.

**Turning it on** (Salon Console → **📅 Square** tab):
1. Add the `SQUARE_ACCESS_TOKEN` secret (Britni's Square access token) and redeploy — until then the integration is dormant and everything else works unchanged.
2. In the Square tab, click **Load from Square**, pick the **location**, **default groomer**, and **default service**, choose Production/Sandbox, and **Save**.
3. Upcoming Square appointments show right in the console; toggle **Auto-add web bookings** to pause/resume calendar sync.

Config lives in Firestore (`pp_settings/square`); only the token is a secret. Implementation is `functions/square.js` (raw Square REST v2 — no SDK dependency, keeping the 0-vuln posture). Admin actions: `squareStatus`, `squareConnect`, `squareSaveConfig`, `squareBookings`, `squareSyncCustomer`, `squareCreateBooking`.

## Spa App 🛁 (spa.html) — installable PWA, **live backend**
A web app for pet owners **and** the front desk, at `https://pinkpoodle.dog/spa.html` (also linked in the site nav as "🛁 Spa App"). It's installable to a phone home screen (Web App Manifest + service worker) and is **fully wired to a live backend** — the `pinkPoodleSpa` Cloud Function (`https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSpa`), with all data in **Firestore**. **Nothing is stored in the browser** — no `localStorage`, no `sessionStorage`, no cookies. Bookings sync across every device (phone, kiosk, back office) in real time, and a new booking still offers a real **SMS deep-link** so the request also lands on Britni's phone.

**Customer side:**
- **Booking** — describe the pup inline (name, breed, size, notes), pick services + optional add-ons + preferred stylist (Britni / Jenefer / Hannah / no preference) + date & time; a live estimate updates as you go (with a size surcharge on grooming services).
- **Owner contact** — name, mobile, optional email (so the salon can confirm), plus a hidden honeypot for spam bots.
- **Digital consent** — vaccination, gentle-handling/de-matting, and contact OKs with a typed e-signature (required before a request is created).
- **Track by code** — after booking you get a 6-char **REF code**; enter it on the Track tab to watch the live pipeline (Requested → Checked in → Bathing → Grooming → Finishing → Ready for pickup → Picked up). Customers can self-cancel before their pup is checked in.

**Staff tools** (bottom-nav "Staff", behind a salon **PIN** — default `0221`, changeable in-app). The PIN is verified server-side on every staff call, and PIN guesses are brute-force rate-limited (10 / 10 min per IP). Four tabs:
- **🧼 Board** — today's pups as tickets with services, stylist, owner contact, notes, estimate. One-tap **Next / Back** along the pipeline; **Mark ready** fires a browser notification. **Walk-in** quick check-in. **Checkout** (line items + discount + tip + payment method) and **Cancel** (with optional no-show fee).
- **📒 Ledger** — a real **double-entry** journal. Every checkout posts a balanced entry (DR Cash/Card = total; CR Grooming Revenue = subtotal; CR Tips = tip), a no-show fee posts DR Cash / CR Cancellation Fees, and you can add manual entries. Account balances roll up live; export to **CSV**.
- **📇 Contacts** — everyone who has booked, de-duplicated by phone/email, with their pups and visit count; export to **CSV** or **vCard**.
- **⚙️ Fees & PIN** — edit the checkout fee list and change the staff PIN.

**Files:** `spa.html`, `spa.css`, `spa.js`, `spa.webmanifest`, `spa-sw.js`, and icons `assets/icon-192.png` / `assets/icon-512.png`. **Not indexed** (`robots: noindex`). Backend lives in `functions/index.js` (`exports.pinkPoodleSpa`); collections: `pp_spa_tickets`, `pp_spa_ledger`, config in `pp_config/spa` (PIN) and `pp_config/spaFees` (fees). Public actions (book/track/cancel-by-code/menu) are rate-limited; staff actions require the PIN. **Note:** because nothing persists in the browser, customers track by REF code (no saved "my pups" list) and staff re-enter the PIN after a reload. The Contacts export exposes owner phone/email behind only the 4-digit PIN — fine for a single trusted front desk, but rotate the PIN if a device is lost.

## Photo upload portal 🖼️
Britni can add photos to the website gallery herself — no code, no commits.

- **Portal:** `admin.html` (link: `https://pinkpoodle.dog/admin.html`) — not indexed by search engines. This is now the full **Salon Console** (see below).
- **How it works:** she enters the admin passphrase, picks a photo, adds the dog's name/breed, and taps **Upload**. A Firebase Function commits the image into `assets/gallery/` and prepends it to `gallery.json`; GitHub Pages rebuilds and the photo appears on the site in about a minute. The gallery on `index.html` renders dynamically from `gallery.json`.
- **Backend:** Firebase Functions `pinkPoodleUpload` (legacy), `pinkPoodleApi` (console), and `pinkPoodleBook` (public booking) — project `binditails-da2de`, codebase `pinkpoodle`, region `us-central1`. Source in `functions/index.js`.
- **Secrets (Firebase Secret Manager):** `GH_TOKEN` (repo commit), `PP_ADMIN_KEY` (portal passphrase), `PP_FB_PAGE_ID` + `PP_FB_PAGE_TOKEN` (Facebook — placeholder `unset` until enabled), and the shared `SENDGRID_API_KEY` / `TWILIO_*` transport used by `pinkPoodleBook`.

## Salon Console 🩷 (admin.html)
A tabbed, phone-friendly operations console behind the same passphrase. Backend: `pinkPoodleApi` + Firestore (collections `pp_customers`, `pp_settings`, `pp_messages`, `pp_staff`) in project `binditails-da2de`.

- **📷 Gallery** — upload photos with dog **name + breed**, and **delete** any photo (removes the file from the repo and its entry from `gallery.json`). Add a photo three ways: **tap to choose**, **drag &amp; drop** onto the drop zone, or **📸 Take a Photo** (opens a live in-page camera via `getUserMedia`, with a flip-camera button; falls back to the phone's native camera if permission is denied).
- **🐾 Customers (CRM)** — add customers with phone, email, address, their **dogs (name + breed)**, and **notes/history**. Search, edit, delete. Each shows a running **balance**.
- **💬 Messaging** — from each customer card: **Ready for pickup**, **Promo**, and **Invoice**. These open Britni's own **Messages (SMS)** or **Mail** app pre-filled (free, sends from her number). The Messages tab has an email **promo blast** (all customers BCC'd) and a **history** of everything sent. Invoices add to the customer's balance automatically.
- **👥 Staff & schedules** — up to **10 stylists**, each with name, role, phone, service tags, and an active/hidden flag. Tap **📅 Schedule** to set recurring days off (e.g. always off Sun/Mon) and tap individual days on a month calendar to flip them **available ↔ off**. Availability model: `weeklyOff[]` (recurring weekday numbers) + `datesOff[]`/`datesOn[]` (specific `YYYY-MM-DD` overrides; a `datesOn` date beats a recurring day off). Managed from the single shared Salon Console login — no per-stylist accounts.
- **⚙️ Settings** — payment method + handle/link (Venmo/CashApp/PayPal/Zelle/Square/in-salon) and editable message templates. Placeholders: `{name} {dog} {amount} {handle} {paytype} {salon}`.- **Delivery mode:** Today messages are composed on the staff phone (device mode — no cost, no carrier registration). The backend logs every message and is structured to switch to **automated server sending** (Twilio SMS / SendGrid email) later via `maybeServerSend()` — this requires paid accounts, US A2P 10DLC registration, and written customer opt-in consent.
- **Staff data & future hooks:** each `pp_staff` doc carries a **scaffolded (dormant)** `sms:{enabled,from}` field for a future per-stylist outbound number and a `squareTeamMemberId` for future per-stylist Square slot-booking — both are stored and shown in the editor (visibly disabled / marked "Not active yet") but **not wired to any sending or booking**. Admin actions: `staffList` (auto-seeds Britni/Jenefer/Hannah on first run), `staffSave` (upsert, capped at 10), `staffAvailability`, `staffDelete`.

### Deploy / update the functions
```
cd functions && npm install
firebase deploy --only functions:pinkpoodle --project binditails-da2de
```

### Change / reset the admin passphrase
The passphrase is now stored as a salted **scrypt hash** in Firestore (`pp_config/admin`). The `PP_ADMIN_KEY` secret is only the **bootstrap** value, used until the passphrase is changed once. Three ways to manage it:

1. **From the console** — Settings tab → *Change passphrase* (must be signed in).
2. **Forgot it** — the login screen's *"Forgot passphrase? Email me a reset link"* link (`pinkPoodleReset` → `requestReset`) emails a one-time, 30-minute link to **both** Britni (`groomerbrit@yahoo.com`) and the **backup admin** Susan (`susanbuchanan@yahoo.com`). Opening the link (`admin.html?reset=TOKEN`) sets a new passphrase (`applyReset`).
3. **Reset the bootstrap secret** (rarely needed):
   ```
   "new-passphrase" | firebase functions:secrets:set PP_ADMIN_KEY --project binditails-da2de --data-file=- --force
   firebase deploy --only functions:pinkpoodle --project binditails-da2de
   ```
   Note: this only takes effect if no Firestore passphrase has been set yet. To force it, also delete the `pp_config/admin` doc.

**Backup admin:** `susanbuchanan@yahoo.com` is always emailed the reset link **and** a confirmation whenever the passphrase changes, so Susan can always recover access. Every wrong passphrase is rate-limited (8 tries / 10 min per IP) and reset-link requests are capped (3 / hour per IP).

### Security note
The fire test used the CLI's GitHub OAuth token for `GH_TOKEN`. For production, replace it with a **fine-grained PAT** scoped to only this repo's *Contents: read & write*, then re-set `GH_TOKEN` and redeploy.


## Enabling Facebook auto-posting (later)
The code is already written (`functions/index.js`, guarded by the FB secrets). To turn it on:
1. Create an app at **developers.facebook.com** → add the **Facebook Login** and **Pages** products.
2. Request permissions **`pages_manage_posts`** and **`pages_read_engagement`** (requires Meta App Review for public use).
3. Generate a **long-lived Page access token** for The Pink Poodle page and note the **Page ID**.
4. Store them and redeploy:
   ```
   "<PAGE_ID>"    | firebase functions:secrets:set PP_FB_PAGE_ID    --project binditails-da2de --data-file=- --force
   "<PAGE_TOKEN>" | firebase functions:secrets:set PP_FB_PAGE_TOKEN --project binditails-da2de --data-file=- --force
   firebase deploy --only functions:pinkpoodle --project binditails-da2de
   ```
5. In `admin.html`, remove the `disabled` attribute on the "Also post to the Facebook page" checkbox.

## SEO
The site is optimized for local search ("dog grooming Princeton WV" and similar):
- Descriptive title, meta description & keywords, canonical URL, and `robots` directives
- **Geo meta tags** (region, placename, coordinates) targeting Princeton / Mercer County, WV
- **Open Graph + Twitter Card** tags for rich link previews on Facebook, iMessage, etc.
- **Schema.org structured data** — `PetGroomer`/`LocalBusiness` (address, geo, hours-ready, services, areaServed, sameAs) and a `FAQPage` for rich results
- `sitemap.xml` (with image sitemap) and `robots.txt`
- Semantic headings, descriptive `alt` text, and explicit image `width`/`height` for Core Web Vitals

After the domain is live, submit `https://pinkpoodle.dog/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) and create/claim the [Google Business Profile](https://business.google.com) for the strongest local ranking.

## Hosting (GitHub Pages)
1. Repo: `susanbuchanan-75287/the-pink-poodle`
2. Settings → Pages → Source: **Deploy from a branch** → `main` / root
3. Custom domain: `pinkpoodle.dog` (set via the `CNAME` file)

### DNS
Point the domain's DNS at GitHub Pages:

**Apex `pinkpoodle.dog`** — four A records:
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
(and optionally AAAA records for IPv6.)

**`www.pinkpoodle.dog`** — CNAME → `susanbuchanan-75287.github.io`

**Second domain `thepinkpoodle.dog`** — set up a forward/redirect at your registrar to `https://pinkpoodle.dog` (most registrars offer free domain forwarding).

## Updating content
- **Text/services/reviews:** edit `index.html`
- **Colors/fonts:** edit the `:root` variables at the top of `styles.css`
- **Photos:** drop new images in `assets/` and reference them in `index.html`

_Made with 🩷_
