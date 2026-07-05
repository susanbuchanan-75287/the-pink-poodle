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

This works from **any device, including desktop** (the old `sms:` deep-link only worked on phones). If the POST ever fails on a phone, it falls back to opening Messages pre-filled. A hidden `company` honeypot field blocks bots.

- **Recipients / sender:** edit `BRITNI_SMS`, `OWNER_EMAIL`, `FROM_EMAIL` in `functions/index.js`. Endpoint URL lives in `BOOK_ENDPOINT` in `script.js`.
- **To turn on real SMS to Britni:** set a live Twilio number/creds (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER`) in Secret Manager and redeploy — no code change needed. (Texting the salon owner is a transactional alert; A2P 10DLC still applies to the Twilio number.)
- **Transport is shared** with the Oracle functions in the same project (`SENDGRID_API_KEY` sender `oracle@barkparks.dog` is domain-verified).

## Photo upload portal 🖼️
Britni can add photos to the website gallery herself — no code, no commits.

- **Portal:** `admin.html` (link: `https://pinkpoodle.dog/admin.html`) — not indexed by search engines. This is now the full **Salon Console** (see below).
- **How it works:** she enters the admin passphrase, picks a photo, adds the dog's name/breed, and taps **Upload**. A Firebase Function commits the image into `assets/gallery/` and prepends it to `gallery.json`; GitHub Pages rebuilds and the photo appears on the site in about a minute. The gallery on `index.html` renders dynamically from `gallery.json`.
- **Backend:** Firebase Functions `pinkPoodleUpload` (legacy), `pinkPoodleApi` (console), and `pinkPoodleBook` (public booking) — project `binditails-da2de`, codebase `pinkpoodle`, region `us-central1`. Source in `functions/index.js`.
- **Secrets (Firebase Secret Manager):** `GH_TOKEN` (repo commit), `PP_ADMIN_KEY` (portal passphrase), `PP_FB_PAGE_ID` + `PP_FB_PAGE_TOKEN` (Facebook — placeholder `unset` until enabled), and the shared `SENDGRID_API_KEY` / `TWILIO_*` transport used by `pinkPoodleBook`.

## Salon Console 🩷 (admin.html)
A tabbed, phone-friendly operations console behind the same passphrase. Backend: `pinkPoodleApi` + Firestore (collections `pp_customers`, `pp_settings`, `pp_messages`) in project `binditails-da2de`.

- **📷 Gallery** — upload photos with dog **name + breed**, and **delete** any photo (removes the file from the repo and its entry from `gallery.json`). Add a photo three ways: **tap to choose**, **drag &amp; drop** onto the drop zone, or **📸 Take a Photo** (opens a live in-page camera via `getUserMedia`, with a flip-camera button; falls back to the phone's native camera if permission is denied).
- **🐾 Customers (CRM)** — add customers with phone, email, address, their **dogs (name + breed)**, and **notes/history**. Search, edit, delete. Each shows a running **balance**.
- **💬 Messaging** — from each customer card: **Ready for pickup**, **Promo**, and **Invoice**. These open Britni's own **Messages (SMS)** or **Mail** app pre-filled (free, sends from her number). The Messages tab has an email **promo blast** (all customers BCC'd) and a **history** of everything sent. Invoices add to the customer's balance automatically.
- **⚙️ Settings** — payment method + handle/link (Venmo/CashApp/PayPal/Zelle/Square/in-salon) and editable message templates. Placeholders: `{name} {dog} {amount} {handle} {paytype} {salon}`.
- **Delivery mode:** Today messages are composed on the staff phone (device mode — no cost, no carrier registration). The backend logs every message and is structured to switch to **automated server sending** (Twilio SMS / SendGrid email) later via `maybeServerSend()` — this requires paid accounts, US A2P 10DLC registration, and written customer opt-in consent.

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
