# The Pink Poodle 🐩

Marketing website for **The Pink Poodle** — a locally owned luxury pet salon in Princeton, West Virginia, owned and operated by Britni.

**Live site:** https://thepinkpoodle.dog (canonical; `pinkpoodle.dog` 301-redirects here)

## About
Static, single-page site (no build step). Just HTML, CSS, and vanilla JS — fast, secure, and free to host on GitHub Pages.

| File | Purpose |
|------|---------|
| `index.html` | All page content & sections |
| `styles.css` | Blush/pink upscale theme, responsive layout |
| `script.js` | Nav, gallery lightbox, scroll reveals, SMS booking composer |
| `firebase-messaging-sw.js` | Root service worker: web-push (FCM) **and** spa-app offline cache |
| `assets/` | Photos of Britni, Paris, and freshly-groomed pups |
| `CNAME` | Custom domain for GitHub Pages (`thepinkpoodle.dog`) |

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

Config lives in Firestore (`pp_settings/square`); only the token is a secret. Implementation is `functions/square.js` (raw Square REST v2 — no SDK dependency, keeping the 0-vuln posture). Admin actions: `squareStatus`, `squareConnect`, `squareSaveConfig`, `squareBookings`, `squareSyncCustomer`, `squareCreateBooking`, `squareSyncVisit` (records a completed grooming visit as a Square Order + tender via `square.recordSale`).

## Spa App 🛁 (spa.html) — installable PWA, **live backend**
A web app for pet owners **and** the front desk, at `https://thepinkpoodle.dog/spa.html` (also linked in the site nav as "🛁 Spa App"). It's installable to a phone home screen (Web App Manifest + service worker) and is **fully wired to a live backend** — the `pinkPoodleSpa` Cloud Function (`https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSpa`), with all data in **Firestore**. **Nothing is stored in the browser** — no `localStorage`, no `sessionStorage`, no cookies. Bookings sync across every device (phone, kiosk, back office) in real time, and a new booking still offers a real **SMS deep-link** so the request also lands on Britni's phone.

**Customer side:**
- **Booking** — describe the pup inline (name, breed, size, notes), pick services + optional add-ons + preferred stylist (Britni / Jenefer / Hannah / no preference) + date & time; a live estimate updates as you go (with a size surcharge on grooming services).
- **Owner contact** — name, mobile, optional email (so the salon can confirm), plus a hidden honeypot for spam bots.
- **Digital consent** — vaccination, gentle-handling/de-matting, and contact OKs with a typed e-signature (required before a request is created).
- **Track by code** — after booking you get a 6-char **REF code**; enter it on the Track tab to watch the live pipeline (Requested → Checked in → Bathing → Grooming → Finishing → Ready for pickup → Picked up). Customers can self-cancel before their pup is checked in.

**Staff tools** (bottom-nav "Staff", behind a salon **PIN** — shared default `0221`, changeable in-app). The PIN is verified server-side on every staff call, and PIN guesses are brute-force rate-limited (10 / 10 min per IP). On sign-in the backend resolves an **actor** (see **Staff roles** below), so sensitive actions can be gated by role. Tabs:
- **🧼 Board** — today's pups as tickets with services, stylist, owner contact, notes, estimate. One-tap **Next / Back** along the pipeline; **Mark ready** fires a browser notification. **Walk-in** quick check-in. **Checkout** (line items + discount + tip + payment method) and **Cancel** (with optional no-show fee). Paid tickets can't be deleted — they must be **Voided** (manager+), which reverses the books instead of erasing them. Each ticket also carries **📅 Schedule/Reschedule** (set an appointment date/time), a **✓ Confirm** action + appointment badge, **💳 Deposit** (request a Square deposit link), and **🔁 Rebook** (clone the visit forward as a standing appointment).
- **📒 Ledger** — a real **double-entry**, **append-only** journal. Every checkout posts a balanced entry (DR Cash/Card = total; CR Grooming Revenue = subtotal; CR Tips = tip), a no-show fee posts DR Cash / CR Cancellation Fees, and you can add manual entries (manager+). A **paid deposit** posts DR Card/Bank / CR **Customer Deposits** (a liability) and is automatically credited against the balance at checkout. Entries are **never edited or deleted**: a **Void** posts an equal-and-opposite reversing entry (dr/cr swapped) and flags the ticket `voided`, so voided money drops out of totals, loyalty, board, and contacts while the history stays intact. Account balances roll up live; export to **CSV**.
- **📇 Clients (CRM)** — the front-desk client book: every owner who has booked, de-duplicated by phone, with **multiple phone numbers** (Mobile/Home/Work + a primary derived automatically), tap-to-call/text/email, **visits + total $ spent** (loyalty), and their pets. Each pet shows a **structured vaccination status badge** — a required-vaccine set (default **Rabies**, configurable) rolls up per pet to *missing / expired / expiring ≤30d / current / unknown* — plus breed, size, temperament, notes, a **✂️ groom cut sheet** (style, body/legs/face/ears/tail/feet clipper settings, finish, cut notes) and a **📸 before/after photo gallery** (see below). Vaccinations are stored as records `{type, expires, verifiedAt, notes}` and **status is always computed server-side** (never trusted from the client). Add/edit clients and pets in modals; an **owner-only save never wipes existing pets**. Export to **CSV** or **vCard** — both are hardened against spreadsheet **formula injection** and vCard field injection.
- **💉 Vax due** — a reminder list of pets whose required shots are missing, expired, or expiring within 30 days, so the desk can chase paperwork before the visit.
- **📅 Upcoming** — every scheduled appointment from today forward, soonest first, with a confirmed/unconfirmed badge, tap-to-call/text, one-tap **Confirm**, and CSV export.
- **📊 Reports** — a KPI dashboard for **Today / This week / This month / All time**: revenue, paid visits, average ticket, tips, deposits collected, bookings, no-shows + no-show rate, no-show fees, cancellations, returning visits, top services, and revenue by day. Export any range to CSV.
- **⚙️ Fees & PIN** — edit the checkout fee list, change the shared staff PIN (owner), set the **required-vaccine list** (manager+), configure **booking deposits** (on/off + default amount) and the **review booster** (on/off, hours-after-pickup delay, Google/Facebook URLs, message), and manage **per-stylist personal PINs & roles** (owner).

**Staff roles** — every staff member has an `accessRole` of **owner ▸ manager ▸ stylist**. The shared PIN (`0221`) resolves to **owner**. A stylist can also be given a **personal PIN** (4–8 digits, hashed with scrypt, stored `pinHash`/`pinSalt` — never returned) that logs them in as *their* role. `requireRole()` gates the sensitive actions server-side: **Void**, manual ledger entries, editing fees, deleting a client, and editing the required-vaccine list need **manager+**; managing PINs/roles needs **owner**. A stylist-level PIN hitting a gated action gets a clear 403. Manage PINs from the Salon Console (passphrase → `staffSetPin`) or the spa **Fees & PIN** tab (owner → `spaStaffPin`).

**Files:** `spa.html`, `spa.css`, `spa.js`, `spa.webmanifest`, and icons `assets/icon-192.png` / `assets/icon-512.png`. Offline caching is handled by the **single root service worker** `firebase-messaging-sw.js` (it serves the spa app offline *and* receives web-push — one worker owns scope `/` so the two never evict each other; the old `spa-sw.js` was removed). **Not indexed** (`robots: noindex`). Backend lives in `functions/index.js` (`exports.pinkPoodleSpa`); collections: `pp_spa_tickets`, `pp_spa_ledger`, `pp_spa_clients` (client/pet CRM), config in `pp_config/spa` (PIN) and `pp_config/spaFees` (fees). Public actions (book/track/cancel-by-code/menu) are rate-limited; staff actions require the PIN. **Note:** because nothing persists in the browser, customers track by REF code (no saved "my pups" list) and staff re-enter the PIN after a reload. Collections/config touched by the spa fn: `pp_spa_tickets`, `pp_spa_ledger`, `pp_spa_clients`, `pp_config/spa` (shared PIN), `pp_config/spaFees` (fees), `pp_config/spaVax` (required-vaccine list); per-stylist PIN hashes/roles live on the `pp_staff` docs. The Clients CRM exposes owner phone/email/pet vaccination info behind only the PIN — fine for a single trusted front desk, but rotate the PIN if a device is lost.

## Vaccination intake, safety contacts & booking consolidation 🩹 (this batch)
Everything below is live in `pinkPoodleSpa` (Firestore-backed, nothing local):

- **One booking backend.** The homepage `#book` form and the spa app's "Book a spa day" both now create the same **`pp_spa_tickets`** grooming ticket via `spaBook` (the homepage previously used a separate `pp_bookings` path). The team-text "reach out to a stylist" lead form is intentionally left on `pinkPoodleBook` — it's a lead, not a grooming ticket.
- **Vaccination intake at booking.** The booking forms require the owner to either **upload proof now** (image/PDF ≤8MB) or **acknowledge they'll bring a copy** (auditable ack text + version + timestamp). Proof is stored in the **private** pet storage bucket (never public); intake shape is `vaxIntake {mode, current, ack, hasFile, file, status, verified, verifiedBy, reason}`.
  - Public action `spaVaxUpload` (rate-limited, honeypot, MIME/size-checked) attaches proof to a ticket by REF code and resets it to `pending`.
  - Staff-only (PIN-gated) `spaVaxDoc` streams the doc to the groomer (bucket stays private); `spaVaxVerify` sets **verified/rejected/pending** — it **fails closed** (an unknown/missing status is a 400, never a silent "verified").
- **Groomer sees & verifies vax on the live Board.** Each ticket shows a **💉 vax chip** (proof-to-review / upload-pending / bring-copy / verified / rejected) plus **🔍 Vax proof**, **✓ Vax OK**, and **✕ Vax reject** buttons. Rejecting prompts for a **reason** shown on the board so the desk can tell the owner what to bring. Verifying optionally takes a **rabies expiry** and **persists it to the reusable pet profile** (transactionally, so a concurrent modal edit can't clobber it) — so future visits don't re-chase proof already seen.
- **Safety contacts on the profile _and_ the board.** The client profile now holds an **🆘 emergency contact** (name/phone/relationship) and an **🤝 authorized-pickup list**; the pet profile holds a **🩺 vet contact** (name/clinic/phone). These are editable in the spa console modals, shown on the client card, exported in the clients **CSV**, and **joined onto each active board ticket** (`spaBoard`) so staff see who may collect the pet and the vet's number right at the counter — not buried in an edit screen. Guarded merges mean an owner-only save never wipes them.
- **Preferred Groomer** dropdown on `#book` (No preference / Britni / Jenefer / Hannah) → saved as the ticket `stylist`.
- **"Reserve This"** buttons on the Signature Experiences cards now route to the booking form, **preselect the package**, prefill notes, and smooth-scroll (they were dead `sms:` links on desktop).
- **Facebook share.** Salon Console upload card has a **📘 Share website to Facebook** button that opens the tokenless Facebook sharer (works today, no setup — FB scrapes the site's cover photo). The API auto-post-per-photo path remains gated behind the `PP_FB_PAGE_ID`/`PP_FB_PAGE_TOKEN` secrets (see "Enabling Facebook auto-posting"). **Note:** the Graph API can only post to a Facebook **Page**, never a personal profile — but the token can be generated from any Page **admin's** login (e.g. Susan's) and still post to The Pink Poodle Page.

This batch was hardened over an iterative **v-board review loop** (5 rounds, code-review + design passes) until convergence: fail-open verify → fail-closed; groomer vax visibility added; safety fields surfaced on the board/card/CSV; verified vax persisted to profile; lost-update race closed with a Firestore transaction.

## Virtual Tip Jar 💝 (Venmo + Cash App)
Clients asked for a cashless way to tip Britni, so the site now has a proper on-brand digital tip jar (no software fees, no card surcharge — tips go straight to the groomer):

- **Homepage section** (`index.html` `#tip`, linked from the primary + mobile nav) with two "mason jar" cards — **Venmo `@BRITNIXO`** and **Cash App `$BRITNIXO`** — each with a freshly generated crisp QR code and a tap-to-tip deep link (`venmo.com/u/BRITNIXO`, `cash.app/$BRITNIXO`).
- **Standalone shareable page** `tip.html` (→ `thepinkpoodle.dog/tip.html`) for a counter QR sign or a link in a text/receipt — larger 220px QR codes, same two options, "back to site" link. Added to `sitemap.xml`.
- **QR codes** are static SVGs (`assets/tip-venmo.svg`, `assets/tip-cashapp.svg`) generated offline with the `qrcode` lib at error-correction level H — no runtime third-party dependency and no tracking.
- Pure HTML/CSS (no JS, no backend change). Reviewed via a board round (round 6): verified the deep-link URL formats are valid/safe and the markup is well-formed; fixed two non-blocking items — the Venmo CTA now uses a solid `--pink-deep` background (passes WCAG contrast) and the standalone page renders QR at the intended 220px.


## Self-reschedule & cancellation waitlist 🔄🎟️ (competitive-gap build)
Benchmarking against the big platforms flagged two convenience gaps worth closing for a single-groomer salon. Both are fully implemented in the `pinkPoodleSpa` function, Firestore-backed, and need no new SaaS:

- **Customer self-reschedule by REF code** — on the **Track** view (`spa.html?track=REF`, or by entering the code) a client with an active booking sees a **📅 Reschedule** button that opens an inline form (new date/time + optional note). Because a one-groomer salon has no live-availability engine, a reschedule is a **customer-proposed move**: `spaRescheduleByCode` sets the new `apptDate/apptTime` + `requestedDate/Time`, flips `confirmed:false`, clears `confirmedAt`/`reminderSentAt` (so a fresh reminder re-fires), stamps `rescheduledAt/By/Note`, and texts Britni (`+1 304 921 2748`) to re-confirm. Blocked once the visit is underway (`step ≥ 2`) or cancelled/voided. The read + update run inside a Firestore **transaction** so concurrent taps can't collide.
- **Cancellation waitlist** — the home view has a **Join the waitlist 🎟️** card (name, mobile, preferred dates, pet). `spaWaitlistJoin` (public, rate-limited, honeypot-guarded, 10–11-digit phone check) stores the entry in `pp_spa_waitlist` with `status:"waiting"`. When a slot opens, staff open the **🎟️ Waitlist** pane and tap **Notify** on an entry — `spaWaitlistNotify` texts that one client "a spot just opened, first to reply gets it" (skips opted-out numbers and already booked/removed entries), marking it `notified`. **Booked** / **Remove** close the entry. Staff-triggered (not auto-blast on cancel) to avoid misfires.

**New backend actions:** `spaRescheduleByCode`, `spaWaitlistJoin` (public), `spaWaitlist`, `spaWaitlistNotify`, `spaWaitlistRemove` (staff). **New collection:** `pp_spa_waitlist` (`status` waiting/notified/booked/removed, `createdAt`, name/phone/prefDates/petName). Public no-PIN actions are gated by knowing the REF code + rate-limit + honeypot, consistent with the existing `spaCancelByCode`/`spaConfirmByCode` trust model. Validated via a board round (round 7): hardened date/time validators (round-trip + range checks), made reschedule atomic, and fixed a waitlist filter-after-limit edge case — no blocking issues.


Benchmarked against the top US grooming platforms (MoeGo, Gingr, Pawfinity, Groomer.io, DaySmart), the spa app now matches or beats the paid tools on the retention/automation layer — all built into the existing `pinkPoodleSpa` function, no new SaaS subscription. Everything is fully implemented and live:

- **Automated appointment reminders + client confirm** — a scheduled function `pinkPoodleSpaCron` (hourly, `America/New_York`) texts/emails each client the day before their appointment (once, between 9–11am ET) with a one-tap confirm link `https://thepinkpoodle.dog/spa.html?confirm=REF`. The spa app handles the `?confirm=` deep-link, calls `spaConfirmByCode`, and shows the live status. Staff also see confirmed/unconfirmed badges and can confirm manually.
- **Recurring / standing appointments** — **🔁 Rebook** clones a finished visit N weeks out (2–12) and records the cadence on the client (`rebookEveryWeeks`) so it's suggested next time.
- **Before/after photo history** — a private per-pet gallery. Photos live in a **public-access-prevented** Cloud Storage bucket (`pp-pets-binditails-da2de`) and are **served only through the function as base64 behind the PIN** (`spaPhoto`) — never a public URL. Upload validates JPEG/PNG/WebP ≤5 MB; newest photos sort first; delete is manager+. Metadata in `pp_spa_photos`.
- **Groom cut sheet** — structured clipper/style settings saved on each pet (`groom{style,body,legs,face,ears,tail,feet,finish,notes}`) so any stylist can reproduce the owner's preferred look.
- **KPI reports dashboard** — the **📊 Reports** tab (see above); `spaReport` computes everything server-side.
- **Deposits / no-show protection** — the **💳 Deposit** action creates a **Square** payment link (`createPaymentLink`) and texts/emails it to the client; `spaDepositCheck` polls Square and, on payment, books the deposit to a **Customer Deposits** liability. At checkout the paid deposit is **automatically credited** against the balance. Configurable on/off + default amount (Fees & PIN). Requires Square connected in the Salon Console; degrades gracefully (clear 400) when it isn't.
- **Auto review booster** — after pickup, `pinkPoodleSpaCron` waits the configured delay (default 3h) then texts/emails happy clients a link to leave a **Google** or **Facebook** review (once per ticket, skipped after 3 days). Off by default until the salon sets it up.

**New backend actions:** `spaSchedule`, `spaConfirm`, `spaConfirmByCode` (public), `spaRebook`, `spaUpcoming`, `spaReport`, `spaReviewConfig`/`spaReviewConfigSave` (mgr+), `spaDepositConfig`/`spaDepositConfigSave` (mgr+), `spaDepositRequest`, `spaDepositCheck`, `spaPhotoUpload`, `spaPhotos`, `spaPhoto`, `spaPhotoDelete` (mgr+). **New collections/config:** `pp_spa_photos`, `pp_config/spaReview`, `pp_config/spaDeposit`. **New scheduled function:** `pinkPoodleSpaCron` (uses the shared SendGrid + Twilio secrets). Reminders/deposit links are **transactional**; broad SMS marketing still requires **US A2P 10DLC** registration on the Twilio number.

## Photo upload portal 🖼️
Britni can add photos to the website gallery herself — no code, no commits.

- **Portal:** `admin.html` (link: `https://thepinkpoodle.dog/admin.html`) — not indexed by search engines. This is now the full **Salon Console** (see below).
- **How it works:** she enters the admin passphrase, picks a photo, adds the dog's name/breed, and taps **Upload**. A Firebase Function commits the image into `assets/gallery/` and prepends it to `gallery.json`; GitHub Pages rebuilds and the photo appears on the site in about a minute. The gallery on `index.html` renders dynamically from `gallery.json`.
- **Backend:** Firebase Functions `pinkPoodleUpload` (legacy), `pinkPoodleApi` (console), and `pinkPoodleBook` (public booking) — project `binditails-da2de`, codebase `pinkpoodle`, region `us-central1`. Source in `functions/index.js`.
- **Secrets (Firebase Secret Manager):** `GH_TOKEN` (repo commit), `PP_ADMIN_KEY` (portal passphrase), `PP_FB_PAGE_ID` + `PP_FB_PAGE_TOKEN` (Facebook — placeholder `unset` until enabled), and the shared `SENDGRID_API_KEY` / `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_FROM_NUMBER` transport used by `pinkPoodleBook` **and** the `smsBlast` promo texts.

## Salon Console 🩷 (admin.html)
A tabbed, phone-friendly operations console behind the same passphrase. Backend: `pinkPoodleApi` + Firestore (collections `pp_customers`, `pp_settings`, `pp_messages`, `pp_staff`) in project `binditails-da2de`. The inbound-SMS webhook `pinkPoodleSms` (STOP/START/HELP opt-out handling) is a separate HTTP function in the same codebase.

- **📷 Gallery** — upload photos with dog **name + breed**, and **delete** any photo (removes the file from the repo and its entry from `gallery.json`). Add a photo three ways: **tap to choose**, **drag &amp; drop** onto the drop zone, or **📸 Take a Photo** (opens a live in-page camera via `getUserMedia`, with a flip-camera button; falls back to the phone's native camera if permission is denied).
- **🐾 Customers (CRM)** — add customers with **multiple phone numbers** (Mobile 1/2, Home + a dropdown to add more; a primary is derived automatically), email, address, their **dogs (name + breed)**, **notes/history**, and an **SMS opt-in** toggle that governs promo texts. Search, edit, delete. Each shows a running **balance** and all phones (tap-to-call/text).
- **📖 Visit history (per customer & pup)** — each customer editor shows their **grooming visit history** pulled live from the real salon tickets (`pp_spa_tickets`), **matched by any of their phone numbers** — the same records the Spa Console writes on booking/checkout, so admin and the salon console never diverge. Each visit lists the **date, pup, what was done (services), groomer, amount + payment method, tip, and notes**. Staff can also **＋ Add a past / walk-in visit** (date, pup, services, groomer, $ total/tip, pay method, notes) — this writes a completed ticket that shows here, in the Spa Console, and rolls into loyalty totals + revenue reports, posting a balanced ledger entry when paid. Admin actions: `crmVisits`, `crmAddVisit`.
- **⬍ Square sync** — when Square is connected, the customer editor gains a **Sync to Square** button (pushes/links the customer into Britni's Square directory via `squareSyncCustomer`), and each visit gets a **→ Square** button that records it as a completed sale (Order + external tender) in Square's sales history via `squareSyncVisit` → `square.recordSale`. Best-effort and clearly labeled: if the Square token/plan can't create orders or record payments, the console says so instead of failing silently, and synced visits are badged **✓ Square**.
- **💬 Messaging** — from each customer card: **Ready for pickup**, **Promo**, and **Invoice**. These open Britni's own **Messages (SMS)** or **Mail** app pre-filled (free, sends from her number) — the UI is honest that it opens a *draft* to send, not an automatic send. The Messages tab has three **promo blasts**: **email** (all customers BCC'd — addresses stay private), **SMS**, and **web push** (broadcasts to everyone subscribed on the public site via `pushBlast`, with a live subscriber count). The **SMS blast is a real server-side send** when Twilio is configured (`smsBlast` texts each opted-in customer individually — numbers never exposed to each other — appends "Reply STOP to opt out.", and shows a live count of textable customers via `smsCount`). Until Twilio creds are set it returns a graceful "not configured" message and the UI falls back to the device-draft group text. **Opt-out is honored end-to-end:** each customer has an `smsOptIn` flag (editable in the CRM), and the inbound `pinkPoodleSms` webhook processes **STOP / START / HELP** replies (matching by primary or any listed phone) to set/clear their opt-out automatically. ⚠️ Real marketing texts require **US A2P 10DLC registration** on the Twilio number, and its inbound webhook must point at `https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSms`. A **history** logs everything. Invoices add to the customer's balance automatically.
- **👥 Staff & schedules** — up to **10 stylists**, each with name, **access role** (owner/manager/stylist), an optional **personal spa-console PIN** (set/clear inline via `staffSetPin` — 4–8 digits, hashed, can't reuse the shared PIN or another stylist's), phone, service tags, and an active/hidden flag. Tap **📅 Schedule** for the **opt-in availability** model: **everyone is off by default**. Add **recurring working blocks** — pick weekdays, a **From→To date range**, and **hours** (e.g. Mon/Wed/Fri, Jan 1–Jun 30, 9:00–5:00; multiple blocks allowed) — and/or tap any calendar day to set **custom hours** or close it. Add **closed date ranges** for holidays & vacations (e.g. closed Dec 24–26) with an optional reason; a closed range beats recurring hours, and a per-date override beats everything. Staff cards show today's hours ("In 9–5" / "Off today"). Data model: `recurring[]` = `{days:[0-6], start:"HH:MM", end:"HH:MM", from, to}`; `closedRanges[]` = `{from, to, reason}`; `dateHours{}` = `{ "YYYY-MM-DD": {on:true,start,end} | {on:false} }`. The backend validates times, drops bad dates, and rejects reversed hours.
- **⚙️ Settings** — payment method + handle/link (Venmo/CashApp/PayPal/Zelle/Square/in-salon) and editable message templates. Placeholders: `{name} {dog} {amount} {handle} {paytype} {salon}`.- **Delivery mode:** the customer-card **Ready/Promo/Invoice** messages are composed on the staff phone (device mode — no cost, no carrier registration); the backend logs every one. The **SMS promo blast** *does* send automatically through **Twilio** once creds are set (see Messaging above) — this requires a paid Twilio number, **US A2P 10DLC** registration, and customer opt-in. Email blasts send via the shared SendGrid transport.
- **Staff data & future hooks:** each `pp_staff` doc carries `accessRole` + hashed `pinHash`/`pinSalt` (per-stylist spa login, **live**), plus a still-**dormant** `sms:{enabled,from}` field for a future *per-stylist* outbound number and a `squareTeamMemberId` for future per-stylist Square slot-booking (both stored/shown but marked "Not active yet"). Admin actions: `staffList` (auto-seeds Britni as **owner** + Jenefer/Hannah on first run), `staffSave` (upsert incl. `accessRole`, capped at 10), `staffAvailability` (recurring + closed ranges + per-date hours), `staffSetPin` (set/clear a stylist PIN & role), `staffDelete`. Messaging actions: `smsCount`, `smsBlast`; inbound `pinkPoodleSms` (STOP/START/HELP).

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

### Stylist PIN reset & credential copies
- **Reset the stylist spa PIN without the old PIN** — Settings tab → *Reset stylist PIN* (`spaPinReset`, passphrase-protected), or via the emailed reset link (`applyReset` accepts an optional `newPin`). This is the "forgot the PIN" recovery path.
- **Credential copies to Susan** — whenever the passphrase changes or a PIN/passphrase is reset, a **plaintext copy** of the new credential is emailed **only** to the backup admin `susanbuchanan@yahoo.com` (hardcoded recipient, HTML-escaped, no request-controlled address). Each emailed value is **prefixed with a `Rex-Loves-Susan-` canary** and the email tells Susan to strip that prefix before use — so a credential copied verbatim out of a compromised inbox **fails to log in**, and the decoy prefix is a tripwire. ⚠️ *Security tradeoff (requested):* the real credential still lands in one inbox in plaintext — rotate it immediately if that mailbox is ever compromised.

### Web push (public site) 🔔
The public site has a **Get salon alerts** button (Visit section) that subscribes the visitor to FCM web push and flips to **Turn off alerts** so they can opt out anytime (`pinkPoodlePush` `subscribe`/`unsubscribe`; tokens in `pp_push_subs`, keyed by SHA-256 so subscribers can't be enumerated). The browser permission prompt is the real opt-in; copy is explicit that it's only openings & specials. Broadcasts go out from the console's **web push** blast (`pushBlast`), which prunes only genuinely dead tokens (`registration-token-not-registered` / `invalid-registration-token`). Requires the `binditails-da2de` Browser API key to allow `thepinkpoodle.dog` (and `pinkpoodle.dog`) HTTP referrers + `firebaseinstallations`/`fcmregistrations` targets.

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

After the domain is live, submit `https://thepinkpoodle.dog/sitemap.xml` in [Google Search Console](https://search.google.com/search-console) and create/claim the [Google Business Profile](https://business.google.com) for the strongest local ranking.

## Hosting (GitHub Pages)
1. Repo: `susanbuchanan-75287/the-pink-poodle`
2. Settings → Pages → Source: **Deploy from a branch** → `main` / root
3. Custom domain: `thepinkpoodle.dog` (set via the `CNAME` file)

### DNS
`thepinkpoodle.dog` is the **canonical/primary** domain (served by GitHub Pages); `pinkpoodle.dog` **redirects** to it via **registrar URL forwarding**.

> **Why forwarding, not Pages, for the old domain:** GitHub Pages serves only the single domain named in the `CNAME` file and auto-301s just the `www`↔apex pair of *that same* domain (plus `*.github.io`). A **different** registered domain (`pinkpoodle.dog` vs `thepinkpoodle.dog`) whose DNS points at the Pages IPs gets a **404**, not a redirect. So `pinkpoodle.dog` must use the registrar's URL-forwarding feature.

**Primary `thepinkpoodle.dog`** (apex) — four A records (remove any old "forward to pinkpoodle.dog"):
```
185.199.108.153
185.199.109.153
185.199.110.153
185.199.111.153
```
(and optionally AAAA records for IPv6: `2606:50c0:8000::153`, `8001::153`, `8002::153`, `8003::153`.)

**`www.thepinkpoodle.dog`** — CNAME → `susanbuchanan-75287.github.io`

**Redirecting domain `pinkpoodle.dog`** — at the registrar, set **URL forwarding / redirect** (301, permanent, forward path + subdomains) to `https://thepinkpoodle.dog`. This replaces its GitHub Pages A records — remove the `185.199.x` A records so the registrar's forwarder answers instead of Pages (which 404s). Point `www.pinkpoodle.dog` at the same forward.

> **⚠️ Order of operations:** point `thepinkpoodle.dog`'s DNS at Pages (and remove its old forward) **before** changing the `CNAME` file to `thepinkpoodle.dog`. Flipping `CNAME` first, while `thepinkpoodle.dog` still forwards to `pinkpoodle.dog`, creates an infinite redirect loop.

## Updating content
- **Text/services/reviews:** edit `index.html`
- **Colors/fonts:** edit the `:root` variables at the top of `styles.css`
- **Photos:** drop new images in `assets/` and reference them in `index.html`

_Made with 🩷_
