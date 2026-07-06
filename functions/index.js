/**
 * The Pink Poodle — photo upload backend (Firebase Functions v2).
 *
 * Receives a photo from the admin portal and:
 *   1. Commits the image into the website repo (assets/gallery/…)
 *   2. Prepends an entry to gallery.json so it appears on the live site
 *   3. (Optional, once tokens are set) Posts the photo to the Facebook Page
 *
 * All credentials live in Firebase secrets — never in the static site.
 *   GH_TOKEN        GitHub token with contents:write on the repo
 *   PP_ADMIN_KEY    Passphrase the portal must send
 *   PP_FB_PAGE_ID   Facebook Page ID          (optional — enables FB posting)
 *   PP_FB_PAGE_TOKEN Facebook Page access token (optional)
 */

const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");

const GH_TOKEN = defineSecret("GH_TOKEN");
const PP_ADMIN_KEY = defineSecret("PP_ADMIN_KEY");
const PP_FB_PAGE_ID = defineSecret("PP_FB_PAGE_ID");
const PP_FB_PAGE_TOKEN = defineSecret("PP_FB_PAGE_TOKEN");

// Square Appointments access token (optional — enables calendar sync when set).
const SQUARE_ACCESS_TOKEN = defineSecret("SQUARE_ACCESS_TOKEN");

const square = require("./square");

// Shared notification transport (already provisioned in this Firebase project).
const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
const TWILIO_ACCOUNT_SID = defineSecret("TWILIO_ACCOUNT_SID");
const TWILIO_AUTH_TOKEN = defineSecret("TWILIO_AUTH_TOKEN");
const TWILIO_FROM_NUMBER = defineSecret("TWILIO_FROM_NUMBER");

// Where booking alerts go. Britni's cell + salon inbox.
const BRITNI_SMS = "+13049212748";
const OWNER_EMAIL = "groomerbrit@yahoo.com";
// Backup admin (Susan) — always copied on passphrase reset links + change notices.
const BACKUP_ADMIN_EMAIL = "susanbuchanan@yahoo.com";
const FROM_EMAIL = "oracle@barkparks.dog"; // verified SendGrid sender for this project
const FROM_NAME = "The Pink Poodle — Website";

const REPO = "susanbuchanan-75287/the-pink-poodle";
const BRANCH = "main";
const GH_API = "https://api.github.com";

function gh(path, token, opts = {}) {
  return fetch(GH_API + path, {
    ...opts,
    headers: {
      Authorization: "Bearer " + token,
      Accept: "application/vnd.github+json",
      "User-Agent": "pink-poodle-uploader",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
}

exports.pinkPoodleUpload = onRequest(
  {
    secrets: [GH_TOKEN, PP_ADMIN_KEY, PP_FB_PAGE_ID, PP_FB_PAGE_TOKEN],
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/],
    memory: "512MiB",
    timeoutSeconds: 120,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const { adminKey, imageBase64, filename, contentType, caption, postToFacebook } = req.body || {};

      if (!(await verifyAdmin(adminKey))) {
        const ok = await checkRateLimit("authfail", clientIp(req), { max: 8, windowMs: 10 * 60 * 1000 });
        if (!ok) return res.status(429).json({ error: "Too many attempts. Try again later." });
        return res.status(401).json({ error: "Invalid passphrase." });
      }
      if (!imageBase64) return res.status(400).json({ error: "No image provided." });

      // Build a safe, unique path
      let ext = ((contentType || "image/jpeg").split("/")[1] || "jpg").toLowerCase();
      ext = ext === "jpeg" ? "jpg" : ext.replace(/[^a-z0-9]/g, "").slice(0, 4) || "jpg";
      const base =
        (filename || "photo")
          .toLowerCase()
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "photo";
      const path = `assets/gallery/${Date.now()}-${base}.${ext}`;
      const token = GH_TOKEN.value().trim();

      // 1) Commit the image
      let r = await gh(`/repos/${REPO}/contents/${path}`, token, {
        method: "PUT",
        body: JSON.stringify({
          message: `Add gallery photo: ${base}`,
          content: imageBase64,
          branch: BRANCH,
        }),
      });
      if (!r.ok) throw new Error("Image commit failed: " + (await r.text()).slice(0, 200));

      // 2) Update gallery.json (prepend newest)
      r = await gh(`/repos/${REPO}/contents/gallery.json?ref=${BRANCH}`, token);
      let items = [];
      let sha;
      if (r.ok) {
        const gj = await r.json();
        sha = gj.sha;
        try {
          items = JSON.parse(Buffer.from(gj.content, "base64").toString("utf8"));
        } catch (_) {
          items = [];
        }
      }
      if (!Array.isArray(items)) items = [];
      items.unshift({
        src: path,
        caption: (caption || "").slice(0, 80),
        alt: (caption || "").slice(0, 80) || "A freshly groomed pup at The Pink Poodle",
      });

      const newContent = Buffer.from(JSON.stringify(items, null, 2) + "\n", "utf8").toString("base64");
      r = await gh(`/repos/${REPO}/contents/gallery.json`, token, {
        method: "PUT",
        body: JSON.stringify({
          message: "Update gallery manifest",
          content: newContent,
          branch: BRANCH,
          ...(sha ? { sha } : {}),
        }),
      });
      if (!r.ok) throw new Error("Manifest update failed: " + (await r.text()).slice(0, 200));

      // 3) Facebook Page post (only when enabled + tokens present)
      let facebook = "skipped";
      const fbId = PP_FB_PAGE_ID.value().trim();
      const fbToken = PP_FB_PAGE_TOKEN.value().trim();
      if (postToFacebook && fbId && fbToken) {
        try {
          const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
          const fbRes = await fetch(`https://graph.facebook.com/v21.0/${fbId}/photos`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: rawUrl, caption: caption || "", access_token: fbToken }),
          });
          facebook = fbRes.ok ? "posted" : "error";
        } catch (_) {
          facebook = "error";
        }
      }

      return res.json({ ok: true, path, facebook });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || "Upload failed." });
    }
  }
);

/* ============================================================================
 * pinkPoodleApi — the salon operations console backend.
 *
 * One authenticated endpoint that powers the admin console:
 *   • Photo gallery: upload (with dog name + breed) / list / delete
 *   • CRM: customers, their dogs, notes  (Firestore, pp_customers)
 *   • Settings: payment handle, templates (Firestore, pp_settings/main)
 *   • Message log: pickup / promo / invoice history (Firestore, pp_messages)
 *
 * Messaging is delivered from the staff phone via sms:/mailto: deep links
 * (built client-side). This endpoint LOGS every message and is structured so
 * a future "server send" mode (Twilio/SendGrid) can be switched on without
 * touching the UI — see maybeServerSend().
 * ========================================================================== */

const admin = require("firebase-admin");
if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const CUSTOMERS = "pp_customers";
const SETTINGS = "pp_settings";
const MESSAGES = "pp_messages";
const now = () => admin.firestore.FieldValue.serverTimestamp();

// Non-secret Square config lives in Firestore (pp_settings/square); the token
// is the only secret. Assembles the cfg object square.js helpers expect.
async function loadSquareConfig() {
  let token = "";
  try {
    token = (SQUARE_ACCESS_TOKEN.value() || "").trim();
  } catch (_) {
    token = "";
  }
  // "unset" is the bootstrap sentinel so the function can deploy before Britni
  // pastes a real token (mirrors the project's other optional-secret hooks).
  if (token === "unset") token = "";
  let doc = {};
  try {
    const s = await db.collection(SETTINGS).doc("square").get();
    doc = s.exists ? s.data() : {};
  } catch (_) {
    doc = {};
  }
  return {
    token,
    env: doc.env === "sandbox" ? "sandbox" : "production",
    version: (doc.version || "").trim() || square.DEFAULT_VERSION,
    locationId: (doc.locationId || "").trim(),
    teamMemberId: (doc.teamMemberId || "").trim(),
    serviceVariationId: (doc.serviceVariationId || "").trim(),
    autoBook: doc.autoBook !== false, // default on once configured
    hasToken: !!token,
  };
}

// Placeholder for future automated (server-side) delivery. Today we always
// return device mode, so the console composes the message on the staff phone.
async function maybeServerSend(/* { channel, to, body } */) {
  return { sent: false, mode: "device" };
}

async function ghGetFileSha(token, path) {
  const r = await gh(`/repos/${REPO}/contents/${path}?ref=${BRANCH}`, token);
  if (!r.ok) return null;
  const j = await r.json();
  return j.sha;
}

async function readGallery(token) {
  const r = await gh(`/repos/${REPO}/contents/gallery.json?ref=${BRANCH}`, token);
  let items = [];
  let sha;
  if (r.ok) {
    const gj = await r.json();
    sha = gj.sha;
    try {
      items = JSON.parse(Buffer.from(gj.content, "base64").toString("utf8"));
    } catch (_) {
      items = [];
    }
  }
  if (!Array.isArray(items)) items = [];
  return { items, sha };
}

async function writeGallery(token, items, sha, message) {
  const content = Buffer.from(JSON.stringify(items, null, 2) + "\n", "utf8").toString("base64");
  const r = await gh(`/repos/${REPO}/contents/gallery.json`, token, {
    method: "PUT",
    body: JSON.stringify({ message, content, branch: BRANCH, ...(sha ? { sha } : {}) }),
  });
  if (!r.ok) throw new Error("Manifest update failed: " + (await r.text()).slice(0, 200));
}

function customerOut(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    name: d.name || "",
    phone: d.phone || "",
    email: d.email || "",
    address: d.address || "",
    dogs: Array.isArray(d.dogs) ? d.dogs : [],
    notes: Array.isArray(d.notes) ? d.notes : [],
    balance: typeof d.balance === "number" ? d.balance : 0,
    lastContacted: d.lastContacted ? d.lastContacted.toDate().toISOString() : null,
  };
}

exports.pinkPoodleApi = onRequest(
  {
    secrets: [GH_TOKEN, PP_ADMIN_KEY, PP_FB_PAGE_ID, PP_FB_PAGE_TOKEN, SENDGRID_API_KEY, SQUARE_ACCESS_TOKEN],
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/],
    memory: "512MiB",
    timeoutSeconds: 120,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const { action } = body;
    if (!(await verifyAdmin(body.adminKey))) {
      // Throttle brute-force guessing: block an IP after repeated bad passphrases.
      const ok = await checkRateLimit("authfail", clientIp(req), { max: 8, windowMs: 10 * 60 * 1000 });
      if (!ok) return res.status(429).json({ error: "Too many attempts. Try again later." });
      return res.status(401).json({ error: "Invalid passphrase." });
    }

    try {
      const token = GH_TOKEN.value().trim();

      switch (action) {
        /* ---------------- Gallery ---------------- */
        case "uploadPhoto": {
          const { imageBase64, filename, contentType, dogName, breed, caption, postToFacebook } = body;
          if (!imageBase64) return res.status(400).json({ error: "No image provided." });

          const label = (caption || [dogName, breed].filter(Boolean).join(" · ")).slice(0, 80);
          let ext = ((contentType || "image/jpeg").split("/")[1] || "jpg").toLowerCase();
          ext = ext === "jpeg" ? "jpg" : ext.replace(/[^a-z0-9]/g, "").slice(0, 4) || "jpg";
          const base =
            ((dogName || filename || "photo")
              .toLowerCase()
              .replace(/\.[^.]+$/, "")
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-+|-+$/g, "")
              .slice(0, 40)) || "photo";
          const path = `assets/gallery/${Date.now()}-${base}.${ext}`;

          let r = await gh(`/repos/${REPO}/contents/${path}`, token, {
            method: "PUT",
            body: JSON.stringify({ message: `Add gallery photo: ${base}`, content: imageBase64, branch: BRANCH }),
          });
          if (!r.ok) throw new Error("Image commit failed: " + (await r.text()).slice(0, 200));

          const { items, sha } = await readGallery(token);
          items.unshift({
            src: path,
            caption: label,
            alt: label || "A freshly groomed pup at The Pink Poodle",
            ...(breed ? { breed: String(breed).slice(0, 40) } : {}),
          });
          await writeGallery(token, items, sha, "Update gallery manifest");

          let facebook = "skipped";
          const fbId = PP_FB_PAGE_ID.value().trim();
          const fbToken = PP_FB_PAGE_TOKEN.value().trim();
          if (postToFacebook && fbId && fbToken) {
            try {
              const rawUrl = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${path}`;
              const fbRes = await fetch(`https://graph.facebook.com/v21.0/${fbId}/photos`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ url: rawUrl, caption: label, access_token: fbToken }),
              });
              facebook = fbRes.ok ? "posted" : "error";
            } catch (_) {
              facebook = "error";
            }
          }
          return res.json({ ok: true, path, facebook });
        }

        case "listGallery": {
          const { items } = await readGallery(token);
          return res.json({ ok: true, items });
        }

        case "deletePhoto": {
          const { src } = body;
          if (!src || !/^assets\/gallery\//.test(src)) return res.status(400).json({ error: "Invalid photo path." });
          const fileSha = await ghGetFileSha(token, src);
          if (fileSha) {
            const dr = await gh(`/repos/${REPO}/contents/${src}`, token, {
              method: "DELETE",
              body: JSON.stringify({ message: `Remove gallery photo: ${src}`, sha: fileSha, branch: BRANCH }),
            });
            if (!dr.ok) throw new Error("Delete failed: " + (await dr.text()).slice(0, 200));
          }
          const { items, sha } = await readGallery(token);
          const next = items.filter((i) => i.src !== src);
          await writeGallery(token, next, sha, "Remove photo from manifest");
          return res.json({ ok: true, removed: src });
        }

        /* ---------------- CRM ---------------- */
        case "crmList": {
          const snap = await db.collection(CUSTOMERS).orderBy("name").limit(1000).get();
          return res.json({ ok: true, customers: snap.docs.map(customerOut) });
        }

        case "crmSave": {
          const c = body.customer || {};
          const doc = {
            name: (c.name || "").slice(0, 120),
            phone: (c.phone || "").replace(/[^\d+]/g, "").slice(0, 20),
            email: (c.email || "").slice(0, 160),
            address: (c.address || "").slice(0, 200),
            dogs: (Array.isArray(c.dogs) ? c.dogs : []).slice(0, 20).map((d) => ({
              name: (d.name || "").slice(0, 60),
              breed: (d.breed || "").slice(0, 60),
            })),
            notes: (Array.isArray(c.notes) ? c.notes : []).slice(0, 200).map((n) => ({
              text: (n.text || "").slice(0, 1000),
              ts: n.ts || new Date().toISOString(),
            })),
            balance: typeof c.balance === "number" ? c.balance : 0,
            updatedAt: now(),
          };
          let id = c.id;
          if (id) {
            await db.collection(CUSTOMERS).doc(id).set(doc, { merge: true });
          } else {
            doc.createdAt = now();
            const ref = await db.collection(CUSTOMERS).add(doc);
            id = ref.id;
          }
          const saved = await db.collection(CUSTOMERS).doc(id).get();
          return res.json({ ok: true, customer: customerOut(saved) });
        }

        case "crmDelete": {
          if (!body.id) return res.status(400).json({ error: "Missing id." });
          await db.collection(CUSTOMERS).doc(body.id).delete();
          return res.json({ ok: true });
        }

        /* ---------------- Settings ---------------- */
        case "settingsGet": {
          const s = await db.collection(SETTINGS).doc("main").get();
          return res.json({ ok: true, settings: s.exists ? s.data() : {} });
        }

        case "settingsSave": {
          const s = body.settings || {};
          const clean = {
            payType: (s.payType || "").slice(0, 30),
            payHandle: (s.payHandle || "").slice(0, 120),
            payNote: (s.payNote || "").slice(0, 200),
            promoTemplate: (s.promoTemplate || "").slice(0, 600),
            pickupTemplate: (s.pickupTemplate || "").slice(0, 600),
            invoiceTemplate: (s.invoiceTemplate || "").slice(0, 600),
            updatedAt: now(),
          };
          await db.collection(SETTINGS).doc("main").set(clean, { merge: true });
          return res.json({ ok: true, settings: clean });
        }

        /* ---------------- Messaging (logging + future server send) --------- */
        case "logMessage": {
          const { customerId, type, channel, body: text, amount } = body;
          const entry = {
            customerId: customerId || null,
            type: (type || "note").slice(0, 30),
            channel: (channel || "sms").slice(0, 20),
            body: (text || "").slice(0, 2000),
            amount: typeof amount === "number" ? amount : null,
            ts: now(),
          };
          await db.collection(MESSAGES).add(entry);
          if (customerId) {
            const patch = { lastContacted: now() };
            if (type === "invoice" && typeof amount === "number") {
              patch.balance = admin.firestore.FieldValue.increment(amount);
            }
            await db.collection(CUSTOMERS).doc(customerId).set(patch, { merge: true }).catch(() => {});
          }
          const delivery = await maybeServerSend({ channel, body: text });
          return res.json({ ok: true, delivery });
        }

        case "messageHistory": {
          let q = db.collection(MESSAGES).orderBy("ts", "desc").limit(100);
          if (body.customerId) q = db.collection(MESSAGES).where("customerId", "==", body.customerId).limit(100);
          const snap = await q.get();
          const msgs = snap.docs.map((d) => {
            const m = d.data();
            return { id: d.id, ...m, ts: m.ts && m.ts.toDate ? m.ts.toDate().toISOString() : null };
          });
          return res.json({ ok: true, messages: msgs });
        }

        /* ---------------- Admin passphrase ---------------- */
        case "changePassphrase": {
          const np = String(body.newPassphrase || "").trim();
          if (np.length < 8) return res.status(400).json({ error: "New passphrase must be at least 8 characters." });
          await setAdminPassphrase(np);
          notifyPassphraseChanged("changed from the Salon Console").catch((e) => console.error("notify failed", e && e.message));
          return res.json({ ok: true });
        }

        /* ---------------- Square Appointments ---------------- */
        case "squareStatus": {
          const cfg = await loadSquareConfig();
          return res.json({
            ok: true,
            square: {
              hasToken: cfg.hasToken,
              connected: square.enabled(cfg),
              env: cfg.env,
              version: cfg.version,
              locationId: cfg.locationId,
              teamMemberId: cfg.teamMemberId,
              serviceVariationId: cfg.serviceVariationId,
              autoBook: cfg.autoBook,
            },
          });
        }

        // Pull live locations / team / services so Britni can pick defaults.
        case "squareConnect": {
          const cfg = await loadSquareConfig();
          if (!cfg.hasToken) return res.status(400).json({ error: "No Square access token set. Add the SQUARE_ACCESS_TOKEN secret first." });
          try {
            const locations = await square.listLocations(cfg);
            // Team + services need a location; if none saved yet, use the first.
            const probe = { ...cfg, locationId: cfg.locationId || (locations[0] && locations[0].id) || "" };
            let team = [];
            let services = [];
            if (probe.locationId) {
              [team, services] = await Promise.all([
                square.listTeamMembers(probe).catch(() => []),
                square.listServices(probe).catch(() => []),
              ]);
            }
            return res.json({ ok: true, locations, team, services });
          } catch (e) {
            return res.status(502).json({ error: "Square: " + (e.message || "connection failed"), squareErrors: e.squareErrors || null });
          }
        }

        case "squareSaveConfig": {
          const s = body.square || {};
          const clean = {
            env: s.env === "sandbox" ? "sandbox" : "production",
            version: String(s.version || "").trim().slice(0, 20),
            locationId: String(s.locationId || "").trim().slice(0, 60),
            teamMemberId: String(s.teamMemberId || "").trim().slice(0, 60),
            serviceVariationId: String(s.serviceVariationId || "").trim().slice(0, 60),
            autoBook: s.autoBook !== false,
            updatedAt: now(),
          };
          await db.collection(SETTINGS).doc("square").set(clean, { merge: true });
          return res.json({ ok: true, square: clean });
        }

        case "squareBookings": {
          const cfg = await loadSquareConfig();
          if (!square.enabled(cfg)) return res.status(400).json({ error: "Square isn't connected yet (need a token and a saved location)." });
          try {
            const bookings = await square.listBookings(cfg, { limit: body.limit || 30 });
            return res.json({ ok: true, bookings });
          } catch (e) {
            return res.status(502).json({ error: "Square: " + (e.message || "could not load bookings"), squareErrors: e.squareErrors || null });
          }
        }

        // Push one CRM customer into the Square customer directory.
        case "squareSyncCustomer": {
          const cfg = await loadSquareConfig();
          if (!cfg.hasToken) return res.status(400).json({ error: "No Square access token set." });
          const c = body.customer || {};
          const name = (c.name || "").trim();
          const phone = normalizePhone((c.phone || "").trim());
          const email = (c.email || "").trim();
          if (!name || (!phone && !email)) return res.status(400).json({ error: "Customer needs a name and a phone or email." });
          try {
            const { customer, created } = await square.findOrCreateCustomer(cfg, {
              name, phone, email,
              note: "Synced from The Pink Poodle CRM",
            });
            if (c.id && customer && customer.id) {
              await db.collection(CUSTOMERS).doc(c.id).set({ squareCustomerId: customer.id, updatedAt: now() }, { merge: true }).catch(() => {});
            }
            return res.json({ ok: true, squareCustomerId: customer && customer.id, created });
          } catch (e) {
            return res.status(502).json({ error: "Square: " + (e.message || "sync failed"), squareErrors: e.squareErrors || null });
          }
        }

        // Manually create a booking on the calendar from the console.
        case "squareCreateBooking": {
          const cfg = await loadSquareConfig();
          if (!square.enabled(cfg)) return res.status(400).json({ error: "Square isn't connected yet." });
          const bk = body.booking || {};
          const startAt = square.resolveStartAt({ date: bk.date, time: bk.time, prefText: bk.prefText });
          if (!startAt) return res.status(400).json({ error: "Pick a valid future date and time." });
          const serviceVariationId = (bk.serviceVariationId || cfg.serviceVariationId || "").trim();
          const teamMemberId = (bk.teamMemberId || cfg.teamMemberId || "").trim();
          if (!serviceVariationId || !teamMemberId) return res.status(400).json({ error: "Set a default service and groomer in Square settings first." });
          try {
            let customerId = (bk.squareCustomerId || "").trim();
            if (!customerId && (bk.name || bk.phone || bk.email)) {
              const { customer } = await square.findOrCreateCustomer(cfg, {
                name: bk.name, phone: normalizePhone(bk.phone || ""), email: bk.email,
              });
              customerId = customer && customer.id;
            }
            const booking = await square.createBooking(cfg, {
              customerId,
              startAt,
              serviceVariationId,
              serviceVariationVersion: bk.serviceVariationVersion,
              teamMemberId,
              durationMinutes: bk.durationMinutes,
              customerNote: bk.notes,
              sellerNote: bk.sellerNote || "Created from the Salon Console",
            });
            return res.json({ ok: true, bookingId: booking && booking.id, status: booking && booking.status });
          } catch (e) {
            return res.status(502).json({ error: "Square: " + (e.message || "could not create booking"), squareErrors: e.squareErrors || null });
          }
        }

        default:
          return res.status(400).json({ error: "Unknown action: " + action });
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || "Request failed." });
    }
  }
);

/* ============================================================================
 * pinkPoodleBook — public booking endpoint (no passphrase).
 *
 * The website booking form POSTs here so a request reaches Britni from ANY
 * device (desktop included, where sms: links don't work). It:
 *   1. Logs the request to Firestore (pp_bookings)
 *   2. Emails the salon inbox (SendGrid) — lands on Britni's phone instantly
 *   3. Texts Britni (Twilio) automatically once Twilio creds are configured
 *      (today the Twilio secret is a placeholder, so SMS is skipped gracefully)
 *
 * Spam guard: a hidden "company" honeypot field (bots fill it, humans don't).
 * ========================================================================== */

function esc(s) {
  return String(s || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function normalizePhone(p) {
  const digits = String(p || "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return "+1" + digits;
  if (digits.length === 11 && digits[0] === "1") return "+" + digits;
  return "+" + digits;
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  const sgMail = require("@sendgrid/mail");
  sgMail.setApiKey(SENDGRID_API_KEY.value().trim());
  await sgMail.send({
    to,
    from: { email: FROM_EMAIL, name: FROM_NAME },
    ...(replyTo ? { replyTo } : {}),
    subject,
    text,
    html,
    trackingSettings: { clickTracking: { enable: false } },
  });
}

async function sendOwnerEmail({ subject, html, text, replyTo }) {
  return sendEmail({ to: OWNER_EMAIL, subject, html, text, replyTo });
}

/* -------- Admin passphrase: Firestore-backed hash + reset, with the original
 * PP_ADMIN_KEY secret as a bootstrap fallback until it's changed once. -------- */
function hashPass(pass, salt) {
  const crypto = require("crypto");
  const s = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(String(pass), s, 32).toString("hex");
  return { salt: s, hash };
}

async function verifyAdmin(adminKey) {
  const key = String(adminKey || "").trim();
  if (!key) return false;
  try {
    const snap = await db.collection("pp_config").doc("admin").get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.hash && d.salt) {
      const crypto = require("crypto");
      const cand = Buffer.from(hashPass(key, d.salt).hash, "hex");
      const stored = Buffer.from(d.hash, "hex");
      return cand.length === stored.length && crypto.timingSafeEqual(cand, stored);
    }
  } catch (e) {
    console.error("verifyAdmin read failed", e && e.message);
  }
  // Bootstrap: no custom passphrase set yet — accept the original secret.
  return timingSafeEqualStr(key, PP_ADMIN_KEY.value().trim());
}

async function setAdminPassphrase(newPass) {
  const { salt, hash } = hashPass(newPass);
  await db.collection("pp_config").doc("admin").set({ salt, hash, updatedAt: now() });
}

async function notifyPassphraseChanged(how) {
  const when = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  await sendEmail({
    to: [OWNER_EMAIL, BACKUP_ADMIN_EMAIL],
    subject: "🔐 Pink Poodle admin passphrase was changed",
    text:
      `The Pink Poodle Salon Console passphrase was ${how} on ${when} (ET).\n\n` +
      `If this wasn't you, request a fresh reset at https://pinkpoodle.dog/admin.html and contact Susan.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;color:#2c1c26">` +
      `<h2 style="color:#b83372">🔐 Admin passphrase changed</h2>` +
      `<p>The Pink Poodle Salon Console passphrase was <strong>${esc(how)}</strong> on <strong>${esc(when)} ET</strong>.</p>` +
      `<p style="color:#6a5560;font-size:13px">If this wasn't you, go to <a href="https://pinkpoodle.dog/admin.html">the console</a>, request a reset, and contact Susan.</p></div>`,
  });
}

function twilioReady() {
  const sid = (TWILIO_ACCOUNT_SID.value() || "").trim();
  const authToken = (TWILIO_AUTH_TOKEN.value() || "").trim();
  const from = (TWILIO_FROM_NUMBER.value() || "").trim();
  return !!(sid && /^AC[0-9a-fA-F]{32}$/.test(sid) && authToken && from && /^\+[1-9]\d{6,}$/.test(from));
}

async function sendOwnerSms(bodyText) {
  const twilio = require("twilio");
  const client = twilio(TWILIO_ACCOUNT_SID.value().trim(), TWILIO_AUTH_TOKEN.value().trim());
  await client.messages.create({ to: BRITNI_SMS, from: TWILIO_FROM_NUMBER.value().trim(), body: bodyText });
}

/**
 * Firestore-backed fixed-window rate limiter. Protects the public booking
 * endpoint from abuse (email/SMS quota drain, inbox spam). Returns true when
 * the request is allowed, false when the caller has exceeded `max` in `windowMs`.
 * Fails OPEN on transaction error so a Firestore hiccup never blocks a real
 * customer's booking.
 */
async function checkRateLimit(bucket, key, { max, windowMs }) {
  const safeKey = String(key || "unknown").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 80) || "unknown";
  const ref = db.collection("pp_ratelimit").doc(`${bucket}__${safeKey}`);
  const nowMs = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      let count = 0;
      let windowStart = nowMs;
      if (snap.exists) {
        const d = snap.data() || {};
        if (nowMs - (d.windowStart || 0) < windowMs) {
          count = d.count || 0;
          windowStart = d.windowStart;
        }
      }
      if (count >= max) return false;
      tx.set(ref, { count: count + 1, windowStart, updated: nowMs }, { merge: true });
      return true;
    });
  } catch (e) {
    console.error("rate limit check failed (allowing)", e && e.message);
    return true;
  }
}

function clientIp(req) {
  const fwd = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return (fwd || req.ip || "unknown").slice(0, 45);
}

/** Constant-time string compare to avoid leaking the passphrase via timing. */
function timingSafeEqualStr(a, b) {
  const crypto = require("crypto");
  const ba = Buffer.from(String(a || ""), "utf8");
  const bb = Buffer.from(String(b || ""), "utf8");
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

exports.pinkPoodleBook = onRequest(
  {
    secrets: [SENDGRID_API_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, SQUARE_ACCESS_TOKEN],
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/],
    memory: "256MiB",
    timeoutSeconds: 30,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // Rate limit: max 6 requests / 10 min per IP (fails open on Firestore error).
    const allowed = await checkRateLimit("book", clientIp(req), { max: 6, windowMs: 10 * 60 * 1000 });
    if (!allowed) {
      return res.status(429).json({ error: "Too many requests. Please text 304-921-2748 to book." });
    }

    try {
      const b = req.body || {};

      // Honeypot: silently accept bots without notifying anyone.
      if (b.company) return res.json({ ok: true, delivered: false });

      const name = String(b.ownerName || b.name || "").trim().slice(0, 80);
      const phoneRaw = String(b.phone || "").trim().slice(0, 30);
      const phone = normalizePhone(phoneRaw);
      const email = String(b.email || "").trim().slice(0, 120);
      const dog = String(b.dogName || b.dog || "").trim().slice(0, 60);
      const breed = String(b.breed || "").trim().slice(0, 60);
      const service = String(b.service || "").trim().slice(0, 60);
      const stylist = String(b.stylist || "").trim().slice(0, 40);
      const source = String(b.source || "").trim().slice(0, 30);
      const when = String(b.prefDate || b.when || "").trim().slice(0, 120);
      const bookDate = String(b.bookDate || "").trim().slice(0, 10);
      const bookTime = String(b.bookTime || "").trim().slice(0, 5);
      const notes = String(b.notes || "").trim().slice(0, 1000);
      const testMode = b.test === true;

      if (!name || (!phone && !email)) {
        return res.status(400).json({ error: "Please include your name and a phone number or email." });
      }
      if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
        return res.status(400).json({ error: "That email doesn't look right." });
      }

      // 1) Log the request
      try {
        await db.collection("pp_bookings").add({
          name, phone, email, dog, breed, service, stylist, source, prefDate: when, notes,
          test: testMode,
          ua: String(req.headers["user-agent"] || "").slice(0, 300),
          ts: now(),
        });
      } catch (e) {
        console.error("booking log failed", e);
      }

      // 1b) Best-effort Square Appointments sync — never blocks the request.
      //     Always tries to add/find the customer; creates a calendar booking
      //     when a concrete time can be resolved and defaults are configured.
      let square_ = { attempted: false };
      if (!testMode) {
        try {
          const cfg = await loadSquareConfig();
          if (square.enabled(cfg) && cfg.autoBook) {
            square_.attempted = true;
            const { customer, created } = await square.findOrCreateCustomer(cfg, {
              name, phone, email,
              note: [dog && `Dog: ${dog}`, breed && `Breed: ${breed}`].filter(Boolean).join(" · ") || "Booked via pinkpoodle.dog",
            });
            square_.customerId = customer && customer.id;
            square_.customerCreated = created;
            const startAt = square.resolveStartAt({ date: bookDate, time: bookTime, prefText: when });
            if (startAt && cfg.serviceVariationId && cfg.teamMemberId) {
              const booking = await square.createBooking(cfg, {
                customerId: square_.customerId,
                startAt,
                serviceVariationId: cfg.serviceVariationId,
                teamMemberId: cfg.teamMemberId,
                customerNote: [service, notes].filter(Boolean).join(" — ").slice(0, 1500),
                sellerNote: `Web request via pinkpoodle.dog — please confirm${service ? " · " + service : ""}`,
              });
              square_.bookingId = booking && booking.id;
              square_.status = booking && booking.status;
              square_.startAt = startAt;
            } else {
              square_.reason = !startAt ? "no-exact-time" : "no-default-service-or-groomer";
            }
          }
        } catch (e) {
          square_.error = (e && e.message) || "square sync failed";
          console.error("square sync failed", square_.error);
        }
      }

      let squareLine = "";
      if (square_.bookingId) {
        squareLine = `✅ Added to your Square calendar${square_.startAt ? " for " + new Date(square_.startAt).toLocaleString("en-US", { timeZone: "America/New_York" }) : ""} — open Square to confirm.`;
      } else if (square_.customerId) {
        squareLine = square_.reason === "no-exact-time"
          ? "👤 Customer saved to Square (no exact time given — add to the calendar manually)."
          : "👤 Customer saved to Square (set a default service & groomer to auto-book).";
      }

      const tag = testMode ? "🧪 TEST — please ignore — " : "";
      const contactLine = [phone ? `📱 ${phoneRaw}` : "", email ? `✉️ ${email}` : ""].filter(Boolean).join("  ·  ");
      const exactWhen = bookDate ? `${bookDate}${bookTime ? " " + bookTime : ""}` : "";
      const rows = [
        ["Name", name],
        ["Phone", phoneRaw],
        ["Email", email],
        ["Requested stylist", stylist],
        ["Dog", [dog, breed].filter(Boolean).join(" · ")],
        ["Service", service],
        ["Preferred", when],
        ["Requested time", exactWhen],
        ["Notes", notes],
      ].filter(([, v]) => v);

      const textBody =
        `${tag}New booking request from pinkpoodle.dog\n\n` +
        rows.map(([k, v]) => `${k}: ${v}`).join("\n") +
        (squareLine ? `\n\n${squareLine}` : "") +
        (phone ? `\n\nTap to text ${name}: sms:${phone}` : "");

      const html =
        `<div style="font-family:Nunito,Arial,sans-serif;max-width:560px;margin:0 auto;color:#2c1c26;">` +
        `<h2 style="color:#b83372;margin-bottom:4px;">🐩 ${esc(tag)}New Booking Request</h2>` +
        `<p style="color:#6a5560;margin-top:0;">Sent from the booking form on pinkpoodle.dog</p>` +
        `<table style="border-collapse:collapse;width:100%;margin:14px 0;">` +
        rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:7px 10px;background:#fdf0f6;font-weight:700;border:1px solid #f7c9dd;white-space:nowrap;">${esc(k)}</td>` +
              `<td style="padding:7px 10px;border:1px solid #f7c9dd;">${esc(v)}</td></tr>`
          )
          .join("") +
        `</table>` +
        (squareLine ? `<p style="background:#fdf0f6;border:1px solid #f7c9dd;border-radius:10px;padding:10px 12px;color:#8a2560;font-weight:700;">${esc(squareLine)}</p>` : "") +
        (phone
          ? `<p><a href="sms:${esc(phone)}" style="background:linear-gradient(135deg,#e75a9c,#b83372);color:#fff;padding:11px 20px;border-radius:100px;text-decoration:none;font-weight:700;">📲 Text ${esc(name)} back</a>` +
            `&nbsp;&nbsp;<a href="tel:${esc(phone)}" style="color:#b83372;font-weight:700;">Call</a></p>`
          : "") +
        `<p style="font-size:12px;color:#999;">${esc(contactLine)}</p>` +
        `</div>`;

      // 2) Email the salon inbox
      let emailed = false;
      try {
        await sendOwnerEmail({
          subject: `${tag}🐩 New booking: ${name}${stylist ? " → " + stylist : ""}${service ? " — " + service : ""}`,
          html,
          text: textBody,
          replyTo: email ? { email, name } : undefined,
        });
        emailed = true;
      } catch (e) {
        console.error("SendGrid send failed", e && e.message);
      }

      // 3) Text Britni (auto-enables when Twilio creds are set)
      let texted = false;
      if (twilioReady()) {
        try {
          await sendOwnerSms(
            `${tag}🐩 New booking: ${name}` +
              (phoneRaw ? ` (${phoneRaw})` : "") +
              (stylist ? ` → wants ${stylist}` : "") +
              (service ? ` — ${service}` : "") +
              (when ? `, ${when}` : "") +
              ` · via pinkpoodle.dog` +
              (square_.bookingId ? ` · ✅ on Square calendar` : "")
          );
          texted = true;
        } catch (e) {
          console.error("Twilio send failed", e && e.message);
        }
      }

      if (!emailed && !texted) {
        return res.status(502).json({ error: "Could not deliver right now. Please text 304-921-2748." });
      }
      return res.json({
        ok: true,
        delivered: true,
        emailed,
        texted,
        square: {
          customerSynced: !!square_.customerId,
          booked: !!square_.bookingId,
        },
      });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || "Booking failed." });
    }
  }
);

/* ==========================================================================
 * pinkPoodleReset — public passphrase-recovery endpoint (no passphrase).
 *
 *   action "requestReset": emails a one-time, 30-minute reset link to BOTH the
 *     salon owner (Britni) and the backup admin (Susan). Rate-limited so it
 *     can't be used to spam those inboxes. Always returns a generic success.
 *   action "applyReset": consumes the token from the link and sets a brand-new
 *     passphrase, then notifies both admins that it changed.
 * ========================================================================== */
exports.pinkPoodleReset = onRequest(
  {
    secrets: [SENDGRID_API_KEY, PP_ADMIN_KEY],
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/],
    memory: "256MiB",
    timeoutSeconds: 30,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const b = req.body || {};
    const action = b.action;
    const crypto = require("crypto");
    const RESET_DOC = db.collection("pp_config").doc("adminReset");

    try {
      if (action === "requestReset") {
        // Cap reset emails to protect the owner/backup inboxes.
        const ok = await checkRateLimit("reset", clientIp(req), { max: 3, windowMs: 60 * 60 * 1000 });
        if (!ok) return res.status(429).json({ error: "Too many reset requests. Please try again later." });

        const token = crypto.randomBytes(24).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
        await RESET_DOC.set({
          tokenHash,
          expires: Date.now() + 30 * 60 * 1000,
          used: false,
          createdAt: now(),
        });

        const link = "https://pinkpoodle.dog/admin.html?reset=" + token;
        // testOnly restricts delivery to the fixed backup-admin address only —
        // never an arbitrary recipient, so it can't be abused to spam others.
        const recipients = b.testOnly === true ? [BACKUP_ADMIN_EMAIL] : [OWNER_EMAIL, BACKUP_ADMIN_EMAIL];
        try {
          await sendEmail({
            to: recipients,
            subject: "🔐 Reset your Pink Poodle admin passphrase",
            text:
              `A passphrase reset was requested for The Pink Poodle Salon Console.\n\n` +
              `Set a new passphrase here (expires in 30 minutes, one-time use):\n${link}\n\n` +
              `If you didn't request this, you can ignore this email — nothing changes until the link is used.`,
            html:
              `<div style="font-family:Arial,sans-serif;max-width:520px;color:#2c1c26">` +
              `<h2 style="color:#b83372">🐩 Reset your admin passphrase</h2>` +
              `<p>A passphrase reset was requested for <strong>The Pink Poodle Salon Console</strong>.</p>` +
              `<p><a href="${link}" style="background:linear-gradient(135deg,#e75a9c,#b83372);color:#fff;padding:12px 22px;border-radius:100px;text-decoration:none;font-weight:700">Set a new passphrase</a></p>` +
              `<p style="color:#6a5560;font-size:13px">This link expires in 30 minutes and can be used once. If you didn't request it, ignore this email — nothing changes until the link is used.</p>` +
              `<p style="color:#999;font-size:11px;word-break:break-all">Or paste this link: ${esc(link)}</p></div>`,
          });
        } catch (e) {
          console.error("reset email failed", e && e.message);
          return res.status(502).json({ error: "Couldn't send the reset email right now. Please try again shortly." });
        }
        return res.json({ ok: true });
      }

      if (action === "applyReset") {
        const token = String(b.token || "");
        const np = String(b.newPassphrase || "").trim();
        if (!token) return res.status(400).json({ error: "Missing reset token." });
        if (np.length < 8) return res.status(400).json({ error: "New passphrase must be at least 8 characters." });

        const th = crypto.createHash("sha256").update(token).digest("hex");
        const snap = await RESET_DOC.get();
        const d = snap.exists ? snap.data() : null;
        const valid =
          d && !d.used && typeof d.expires === "number" && d.expires > Date.now() && d.tokenHash && timingSafeEqualStr(th, d.tokenHash);
        if (!valid) {
          return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
        }

        await setAdminPassphrase(np);
        await RESET_DOC.set({ used: true, usedAt: now() }, { merge: true });
        notifyPassphraseChanged("reset via an emailed link").catch((e) => console.error("notify failed", e && e.message));
        return res.json({ ok: true });
      }

      return res.status(400).json({ error: "Unknown action." });
    } catch (e) {
      console.error("reset error", e);
      return res.status(500).json({ error: "Reset failed. Please try again." });
    }
  }
);
