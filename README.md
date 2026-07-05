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
The booking form on the site does **not** need a server. When a visitor fills it out and taps **Send Booking Text**, their phone opens Messages with a pre-filled text (name, dog, breed, service, preferred time) addressed to **304-921-2748** — so the appointment request arrives on Britni's phone as a normal SMS. Click-to-call and email links are provided as fallbacks.

To change the phone number, edit `SALON_PHONE` in `script.js`.

## Photo upload portal 🖼️
Britni can add photos to the website gallery herself — no code, no commits.

- **Portal:** `admin.html` (link: `https://pinkpoodle.dog/admin.html`) — not indexed by search engines. This is now the full **Salon Console** (see below).
- **How it works:** she enters the admin passphrase, picks a photo, adds the dog's name/breed, and taps **Upload**. A Firebase Function commits the image into `assets/gallery/` and prepends it to `gallery.json`; GitHub Pages rebuilds and the photo appears on the site in about a minute. The gallery on `index.html` renders dynamically from `gallery.json`.
- **Backend:** Firebase Functions `pinkPoodleUpload` (legacy) and `pinkPoodleApi` (console) — project `binditails-da2de`, codebase `pinkpoodle`, region `us-central1`. Source in `functions/index.js`.
- **Secrets (Firebase Secret Manager):** `GH_TOKEN` (repo commit), `PP_ADMIN_KEY` (portal passphrase), `PP_FB_PAGE_ID` + `PP_FB_PAGE_TOKEN` (Facebook — placeholder `unset` until enabled).

## Salon Console 🩷 (admin.html)
A tabbed, phone-friendly operations console behind the same passphrase. Backend: `pinkPoodleApi` + Firestore (collections `pp_customers`, `pp_settings`, `pp_messages`) in project `binditails-da2de`.

- **📷 Gallery** — upload photos with dog **name + breed**, and **delete** any photo (removes the file from the repo and its entry from `gallery.json`).
- **🐾 Customers (CRM)** — add customers with phone, email, address, their **dogs (name + breed)**, and **notes/history**. Search, edit, delete. Each shows a running **balance**.
- **💬 Messaging** — from each customer card: **Ready for pickup**, **Promo**, and **Invoice**. These open Britni's own **Messages (SMS)** or **Mail** app pre-filled (free, sends from her number). The Messages tab has an email **promo blast** (all customers BCC'd) and a **history** of everything sent. Invoices add to the customer's balance automatically.
- **⚙️ Settings** — payment method + handle/link (Venmo/CashApp/PayPal/Zelle/Square/in-salon) and editable message templates. Placeholders: `{name} {dog} {amount} {handle} {paytype} {salon}`.
- **Delivery mode:** Today messages are composed on the staff phone (device mode — no cost, no carrier registration). The backend logs every message and is structured to switch to **automated server sending** (Twilio SMS / SendGrid email) later via `maybeServerSend()` — this requires paid accounts, US A2P 10DLC registration, and written customer opt-in consent.

### Deploy / update the functions
```
cd functions && npm install
firebase deploy --only functions:pinkpoodle --project binditails-da2de
```

### Change the admin passphrase
```
"new-passphrase" | firebase functions:secrets:set PP_ADMIN_KEY --project binditails-da2de --data-file=- --force
firebase deploy --only functions:pinkpoodle --project binditails-da2de
```

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
