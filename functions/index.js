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
const STAFF = "pp_staff";
const PUSH_SUBS = "pp_push_subs";
const now = () => admin.firestore.FieldValue.serverTimestamp();

// Default roster seeded on first staffList when pp_staff is empty.
const DEFAULT_STAFF = [
  { name: "Britni", role: "Owner & Groomer", tags: "Grooms · Baths · De-Shed", phone: "+13049212748", order: 0 },
  { name: "Jenefer", role: "Groomer & Stylist", tags: "Grooms · Baths · De-Shed", phone: "+13048094041", order: 1 },
  { name: "Hannah", role: "Bath & Spa Specialist", tags: "Baths · Nails · De-Shed Treatments", phone: "+13048001778", order: 2 },
];
const MAX_STAFF = 10;

function staffOut(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    name: d.name || "",
    role: d.role || "",
    tags: d.tags || "",
    phone: d.phone || "",
    active: d.active !== false,
    order: typeof d.order === "number" ? d.order : 99,
    // Square linkage (used later when slot-booking is layered on).
    squareTeamMemberId: d.squareTeamMemberId || "",
    // Console access role + whether a personal PIN is set (hash never leaves
    // the server). Britni's row seeds as "owner"; others default to "stylist".
    accessRole: ROLE_RANK[String(d.accessRole || "").toLowerCase()] ? String(d.accessRole).toLowerCase() : "stylist",
    hasPin: !!(d.pinHash && d.pinSalt),
    // Per-stylist SMS scaffold — NOT wired to sending yet (dormant).
    sms: {
      enabled: !!(d.sms && d.sms.enabled),
      from: (d.sms && d.sms.from) || "",
    },
    // Availability model (opt-in): everyone is OFF by default.
    //  • recurring: [{days:[0-6], start:"HH:MM", end:"HH:MM", from:"YYYY-MM-DD", to:"YYYY-MM-DD"}] — normal open days
    //  • closedRanges: [{from:"YYYY-MM-DD", to:"YYYY-MM-DD", reason}] — holidays/vacations (beat recurring)
    //  • dateHours: { "YYYY-MM-DD": {on:true, start, end} | {on:false} } — single-day override (beats everything)
    // Precedence: dateHours override > closedRanges > recurring > off.
    recurring: Array.isArray(d.recurring) ? d.recurring : [],
    closedRanges: Array.isArray(d.closedRanges) ? d.closedRanges : [],
    dateHours: (d.dateHours && typeof d.dateHours === "object") ? d.dateHours : {},
  };
}

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
    phones: Array.isArray(d.phones) ? d.phones : (d.phone ? [{ type: "Mobile", number: d.phone }] : []),
    email: d.email || "",
    address: d.address || "",
    dogs: Array.isArray(d.dogs) ? d.dogs : [],
    notes: Array.isArray(d.notes) ? d.notes : [],
    balance: typeof d.balance === "number" ? d.balance : 0,
    smsOptIn: d.smsOptIn !== false,
    smsOptOutAt: d.smsOptOutAt ? (d.smsOptOutAt.toDate ? d.smsOptOutAt.toDate().toISOString() : d.smsOptOutAt) : null,
    lastContacted: d.lastContacted ? d.lastContacted.toDate().toISOString() : null,
  };
}

exports.pinkPoodleApi = onRequest(
  {
    secrets: [GH_TOKEN, PP_ADMIN_KEY, PP_FB_PAGE_ID, PP_FB_PAGE_TOKEN, SENDGRID_API_KEY, SQUARE_ACCESS_TOKEN, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER],
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
          const phones = (Array.isArray(c.phones) ? c.phones : [])
            .map((p) => ({
              type: String(p.type || "Mobile").slice(0, 20),
              number: String(p.number || "").replace(/[^\d+]/g, "").slice(0, 20),
            }))
            .filter((p) => p.number)
            .slice(0, 8);
          // Primary phone = first entered number (falls back to legacy c.phone) — keeps
          // messaging / tap-to-call working off a single canonical field.
          const primary = (phones[0] && phones[0].number) || (c.phone || "").replace(/[^\d+]/g, "").slice(0, 20);
          const doc = {
            name: (c.name || "").slice(0, 120),
            phone: primary,
            phones,
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
            smsOptIn: c.smsOptIn !== false,
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

        /* ---------------- Web push blast ---------------- */
        case "pushCount": {
          const snap = await db.collection(PUSH_SUBS).count().get();
          return res.json({ ok: true, count: snap.data().count });
        }

        case "pushBlast": {
          const title = String(body.title || "The Pink Poodle 🐩").slice(0, 80);
          const text = String(body.body || "").trim().slice(0, 300);
          if (!text) return res.status(400).json({ error: "Write your message first." });
          const snap = await db.collection(PUSH_SUBS).limit(2000).get();
          if (snap.empty) return res.json({ ok: true, sent: 0, failed: 0, count: 0, note: "No push subscribers yet." });
          const messaging = admin.messaging();
          const dead = ["messaging/registration-token-not-registered", "messaging/invalid-registration-token"];
          let sent = 0, failed = 0;
          for (const d of snap.docs) {
            const tok = d.data().token || d.data().value;
            if (!tok) { await d.ref.delete().catch(() => {}); continue; }
            try {
              await messaging.send({
                token: tok,
                notification: { title, body: text },
                webpush: {
                  fcmOptions: { link: "https://pinkpoodle.dog/" },
                  notification: { icon: "https://pinkpoodle.dog/assets/paris.jpg", tag: "pp-promo" },
                },
              });
              sent++;
            } catch (err) {
              failed++;
              if (dead.includes(err.code)) await d.ref.delete().catch(() => {});
            }
          }
          await db.collection(MESSAGES).add({
            customerId: null, type: "promo", channel: "push",
            body: title + " — " + text, amount: null, ts: now(),
          }).catch(() => {});
          return res.json({ ok: true, sent, failed, count: snap.size });
        }

        /* ---------------- SMS promo blast (Twilio, opt-in only) ---------------- */
        case "smsCount": {
          // How many customers can legally receive a promo text right now.
          const snap = await db.collection(CUSTOMERS).limit(2000).get();
          let eligible = 0;
          snap.docs.forEach((d) => {
            const c = d.data() || {};
            if (c.smsOptIn === false || c.smsOptOutAt) return;
            if (normalizePhone(c.phone)) eligible++;
          });
          return res.json({ ok: true, count: eligible, twilioReady: twilioReady() });
        }

        case "smsBlast": {
          const text = String(body.body || "").trim().slice(0, 320);
          if (!text) return res.status(400).json({ error: "Write your message first." });
          if (!twilioReady()) {
            return res.status(400).json({ error: "Text sending isn't configured yet. Add your Twilio number & keys, or use the device-draft blast." });
          }
          // Only registered A2P/10DLC traffic should run through this path; the
          // footer gives the legally-required opt-out instruction on every send.
          const footer = " Reply STOP to opt out.";
          const bodyText = (text.length + footer.length > 320 ? text.slice(0, 320 - footer.length) : text) + footer;
          const snap = await db.collection(CUSTOMERS).limit(2000).get();
          const seen = new Set();
          let sent = 0, failed = 0, skipped = 0;
          for (const d of snap.docs) {
            const c = d.data() || {};
            if (c.smsOptIn === false || c.smsOptOutAt) { skipped++; continue; }
            const to = normalizePhone(c.phone);
            if (!to || seen.has(to)) { skipped++; continue; }
            seen.add(to);
            try {
              await sendSms(to, bodyText);
              sent++;
              await db.collection(MESSAGES).add({ customerId: d.id, type: "promo", channel: "sms", body: bodyText, amount: null, ts: now() }).catch(() => {});
              await d.ref.set({ lastContacted: now() }, { merge: true }).catch(() => {});
            } catch (err) {
              failed++;
              console.error("smsBlast send failed", to.slice(0, 6), err && err.message);
            }
          }
          return res.json({ ok: true, sent, failed, skipped });
        }

        /* ---------------- Admin passphrase ---------------- */
        case "changePassphrase": {
          const np = String(body.newPassphrase || "").trim();
          if (np.length < 8) return res.status(400).json({ error: "New passphrase must be at least 8 characters." });
          await setAdminPassphrase(np);
          notifyPassphraseChanged("changed from the Salon Console").catch((e) => console.error("notify failed", e && e.message));
          emailCredentialCopy({ passphrase: np, how: "changed from the Salon Console" }).catch((e) => console.error("cred copy failed", e && e.message));
          return res.json({ ok: true });
        }

        /* Reset the stylist spa PIN from the passphrase-protected console —
         * no old PIN needed (the admin passphrase is the higher credential),
         * so it doubles as the "forgot the stylist PIN" recovery path. */
        case "spaPinReset": {
          const np = String(body.newPin || "").trim();
          if (!/^\d{4,8}$/.test(np)) return res.status(400).json({ error: "PIN must be 4–8 digits." });
          await db.collection("pp_config").doc("spa").set({ pin: np, updatedAt: now() }, { merge: true });
          emailCredentialCopy({ pin: np, how: "reset from the Salon Console" }).catch((e) => console.error("cred copy failed", e && e.message));
          return res.json({ ok: true });
        }

        /* ---------------- Staff & schedules ---------------- */
        case "staffList": {
          let snap = await db.collection(STAFF).get();
          if (snap.empty) {
            // First run — seed the known roster so nothing starts blank.
            const batch = db.batch();
            for (const s of DEFAULT_STAFF) {
              const ref = db.collection(STAFF).doc();
              batch.set(ref, {
                name: s.name, role: s.role, tags: s.tags, phone: s.phone, order: s.order,
                active: true, squareTeamMemberId: "",
                accessRole: s.order === 0 ? "owner" : "stylist",
                sms: { enabled: false, from: "" },
                weeklyOff: [], datesOff: [], datesOn: [],
                createdAt: now(), updatedAt: now(),
              });
            }
            await batch.commit();
            snap = await db.collection(STAFF).get();
          }
          const staff = snap.docs.map(staffOut).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
          return res.json({ ok: true, staff });
        }

        case "staffSave": {
          const s = body.staff || {};
          const clean = {
            name: (s.name || "").slice(0, 60),
            role: (s.role || "").slice(0, 80),
            tags: (s.tags || "").slice(0, 120),
            phone: (s.phone || "").replace(/[^\d+]/g, "").slice(0, 20),
            active: s.active !== false,
            order: typeof s.order === "number" ? s.order : 99,
            squareTeamMemberId: (s.squareTeamMemberId || "").slice(0, 60),
            accessRole: ROLE_RANK[String(s.accessRole || "").toLowerCase()] ? String(s.accessRole).toLowerCase() : "stylist",
            // Scaffold only — a per-stylist "from" number for future Twilio use.
            sms: {
              enabled: !!(s.sms && s.sms.enabled),
              from: (s.sms && s.sms.from ? String(s.sms.from) : "").replace(/[^\d+]/g, "").slice(0, 20),
            },
            updatedAt: now(),
          };
          if (!clean.name) return res.status(400).json({ error: "A stylist needs a name." });
          let id = s.id;
          if (id) {
            await db.collection(STAFF).doc(id).set(clean, { merge: true });
          } else {
            const count = (await db.collection(STAFF).count().get()).data().count;
            if (count >= MAX_STAFF) return res.status(400).json({ error: `You can have up to ${MAX_STAFF} stylists.` });
            clean.weeklyOff = []; clean.datesOff = []; clean.datesOn = [];
            clean.createdAt = now();
            const ref = await db.collection(STAFF).add(clean);
            id = ref.id;
          }
          const saved = await db.collection(STAFF).doc(id).get();
          return res.json({ ok: true, staff: staffOut(saved) });
        }

        case "staffDelete": {
          if (!body.id) return res.status(400).json({ error: "Missing id." });
          await db.collection(STAFF).doc(body.id).delete();
          return res.json({ ok: true });
        }

        case "staffAvailability": {
          if (!body.id) return res.status(400).json({ error: "Missing id." });
          const dateRe = /^\d{4}-\d{2}-\d{2}$/;
          const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
          const t = (v, def) => (timeRe.test(String(v)) ? String(v) : def);
          // Recurring working blocks: weekdays within a date range, with hours.
          const recurring = (Array.isArray(body.recurring) ? body.recurring : []).slice(0, 30).map((r) => {
            const days = Array.from(new Set((Array.isArray(r.days) ? r.days : []).map(Number).filter((n) => n >= 0 && n <= 6)));
            let start = t(r.start, "09:00");
            let end = t(r.end, "17:00");
            if (end <= start) end = start; // UI enforces; clamp defensively
            const from = dateRe.test(String(r.from)) ? String(r.from) : "";
            const to = dateRe.test(String(r.to)) ? String(r.to) : "";
            return { days, start, end, from, to };
          }).filter((r) => r.days.length && r.from && r.to && r.from <= r.to && r.end > r.start);
          // Closed ranges: holidays / vacations (beat recurring open blocks).
          const closedRanges = (Array.isArray(body.closedRanges) ? body.closedRanges : []).slice(0, 60).map((r) => ({
            from: dateRe.test(String(r.from)) ? String(r.from) : "",
            to: dateRe.test(String(r.to)) ? String(r.to) : "",
            reason: String(r.reason || "").trim().slice(0, 80),
          })).filter((r) => r.from && r.to && r.from <= r.to);
          // Per-date overrides: {on:true,start,end} to open a specific day, {on:false} to close it.
          const dateHours = {};
          const src = (body.dateHours && typeof body.dateHours === "object") ? body.dateHours : {};
          Object.keys(src).slice(0, 366).forEach((iso) => {
            if (!dateRe.test(iso)) return;
            const v = src[iso] || {};
            if (v.on === false || v.off === true) { dateHours[iso] = { on: false }; return; }
            const start = t(v.start, "09:00");
            let end = t(v.end, "17:00");
            if (end <= start) return; // skip zero/negative-length open days
            dateHours[iso] = { on: true, start, end };
          });
          await db.collection(STAFF).doc(body.id).set({
            recurring,
            closedRanges,
            dateHours,
            updatedAt: now(),
          }, { merge: true });
          const saved = await db.collection(STAFF).doc(body.id).get();
          return res.json({ ok: true, staff: staffOut(saved) });
        }

        case "staffSetPin": {
          // Passphrase-gated (owner) management of a stylist's personal spa-console
          // PIN + access role. Mirrors the spa-side spaStaffPin, but reachable
          // from the Salon Console where the roster already lives. clear:true
          // removes the PIN (that stylist then can't sign in with their own PIN).
          const staffId = String(body.staffId || "").slice(0, 60);
          if (!staffId) return res.status(400).json({ error: "Pick a stylist." });
          const ref = db.collection(STAFF).doc(staffId);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Stylist not found." });
          const role = ROLE_RANK[String(body.role || "").toLowerCase()] ? String(body.role).toLowerCase() : "stylist";
          if (body.clear === true) {
            await ref.set({ pinHash: "", pinSalt: "", accessRole: role, updatedAt: now() }, { merge: true });
            return res.json({ ok: true, cleared: true, staff: staffOut(await ref.get()) });
          }
          const np = String(body.newPin || "").trim();
          if (!/^\d{4,8}$/.test(np)) return res.status(400).json({ error: "PIN must be 4–8 digits." });
          const spaPin = await spaPinValue();
          if (timingSafeEqualStr(np, spaPin)) return res.status(400).json({ error: "That's the shared salon PIN — choose a different personal PIN." });
          const crypto = require("crypto");
          const all = await db.collection(STAFF).get();
          for (const s2 of all.docs) {
            if (s2.id === staffId) continue;
            const sd = s2.data() || {};
            if (!sd.pinHash || !sd.pinSalt) continue;
            const cand = Buffer.from(hashPass(np, sd.pinSalt).hash, "hex");
            const stored = Buffer.from(sd.pinHash, "hex");
            if (cand.length === stored.length && crypto.timingSafeEqual(cand, stored)) {
              return res.status(400).json({ error: "Another stylist already uses that PIN." });
            }
          }
          const { salt, hash } = hashPass(np);
          await ref.set({ pinHash: hash, pinSalt: salt, accessRole: role, updatedAt: now() }, { merge: true });
          return res.json({ ok: true, staff: staffOut(await ref.get()) });
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

/**
 * Normalize a list of {type,number} phones (dedup by normalized number,
 * preserve order). Falls back to a single legacy `phone` string. Returns
 * { phones, primary } where primary is the canonical tap-to-call number.
 */
function cleanPhones(list, legacy) {
  const out = [];
  const seen = new Set();
  (Array.isArray(list) ? list : []).forEach((p) => {
    const number = normalizePhone(p && p.number);
    if (!number || seen.has(number)) return;
    seen.add(number);
    out.push({ type: String((p && p.type) || "Mobile").slice(0, 20), number });
  });
  if (!out.length && legacy) {
    const n = normalizePhone(legacy);
    if (n) out.push({ type: "Mobile", number: n });
  }
  return { phones: out.slice(0, 8), primary: (out[0] && out[0].number) || "" };
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

/* Email a private copy of the actual credential(s) to the backup admin (Susan)
 * whenever they change — an explicit "cc me the passphrase/PIN" convenience.
 * Goes ONLY to the fixed BACKUP_ADMIN_EMAIL, never an arbitrary recipient. */
async function emailCredentialCopy({ passphrase, pin, how }) {
  // Canary prefix: the email shows each credential with this decoy prefix in
  // front. Susan strips "Rex-Loves-Susan-" to get the real value; anyone who
  // copies the emailed string verbatim (e.g. after an inbox compromise) will
  // fail to log in, so a leaked copy is useless without the shared secret.
  const CANARY = "Rex-Loves-Susan-";
  const items = [];
  if (passphrase) items.push({ label: "Admin passphrase", value: CANARY + passphrase });
  if (pin) items.push({ label: "Stylist spa PIN", value: CANARY + pin });
  if (!items.length) return;
  const when = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  const heads =
    `IMPORTANT: each value below is shown with the decoy prefix "${CANARY}". ` +
    `Remove that prefix to get the real credential — the prefix is NOT part of it. ` +
    `This way a copied/leaked value won't work.`;
  await sendEmail({
    to: BACKUP_ADMIN_EMAIL,
    subject: "🔑 Your Pink Poodle credential copy (keep private)",
    text:
      `As requested, here ${items.length > 1 ? "are" : "is"} the Pink Poodle credential${items.length > 1 ? "s" : ""} ` +
      `(${how}) as of ${when} ET:\n\n` +
      `${heads}\n\n` +
      items.map((i) => `${i.label}: ${i.value}`).join("\n") +
      `\n\nKeep this email private. If you didn't make this change, reset it right away at https://pinkpoodle.dog/admin.html.`,
    html:
      `<div style="font-family:Arial,sans-serif;max-width:520px;color:#2c1c26">` +
      `<h2 style="color:#b83372">🔑 Your Pink Poodle credential copy</h2>` +
      `<p>As requested, here ${items.length > 1 ? "are" : "is"} the credential${items.length > 1 ? "s" : ""} ` +
      `(<strong>${esc(how)}</strong>) as of <strong>${esc(when)} ET</strong>:</p>` +
      `<p style="background:#fff3d6;border:1px solid #e8c766;border-radius:8px;padding:8px 10px;font-size:13px;color:#6a4b00">` +
      `⚠️ Each value is shown with the decoy prefix <code>${esc(CANARY)}</code>. <strong>Remove that prefix</strong> to get the real credential — the prefix is not part of it. A copied/leaked value won't work.</p>` +
      `<ul style="font-size:15px">` +
      items.map((i) => `<li>${esc(i.label)}: <code style="background:#fbe6ef;padding:2px 6px;border-radius:5px">${esc(i.value)}</code></li>`).join("") +
      `</ul>` +
      `<p style="color:#6a5560;font-size:13px">Keep this email private. If you didn't make this change, <a href="https://pinkpoodle.dog/admin.html">reset it</a> right away.</p></div>`,
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

/** Send a single SMS to any recipient (used by the opt-in promo blast). */
async function sendSms(to, bodyText) {
  const twilio = require("twilio");
  const client = twilio(TWILIO_ACCOUNT_SID.value().trim(), TWILIO_AUTH_TOKEN.value().trim());
  return client.messages.create({ to, from: TWILIO_FROM_NUMBER.value().trim(), body: bodyText });
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
        const npin = String(b.newPin || "").trim();
        if (!token) return res.status(400).json({ error: "Missing reset token." });
        if (np.length < 8) return res.status(400).json({ error: "New passphrase must be at least 8 characters." });
        if (npin && !/^\d{4,8}$/.test(npin)) return res.status(400).json({ error: "Stylist PIN must be 4–8 digits." });

        const th = crypto.createHash("sha256").update(token).digest("hex");
        const snap = await RESET_DOC.get();
        const d = snap.exists ? snap.data() : null;
        const valid =
          d && !d.used && typeof d.expires === "number" && d.expires > Date.now() && d.tokenHash && timingSafeEqualStr(th, d.tokenHash);
        if (!valid) {
          return res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
        }

        await setAdminPassphrase(np);
        if (npin) await db.collection("pp_config").doc("spa").set({ pin: npin, updatedAt: now() }, { merge: true });
        await RESET_DOC.set({ used: true, usedAt: now() }, { merge: true });
        notifyPassphraseChanged("reset via an emailed link").catch((e) => console.error("notify failed", e && e.message));
        emailCredentialCopy({ passphrase: np, pin: npin || "", how: "reset via an emailed link" }).catch((e) => console.error("cred copy failed", e && e.message));
        return res.json({ ok: true, pinReset: !!npin });
      }

      return res.status(400).json({ error: "Unknown action." });
    } catch (e) {
      console.error("reset error", e);
      return res.status(500).json({ error: "Reset failed. Please try again." });
    }
  }
);

/* =====================================================================
   Pink Poodle Spa app — LIVE backend.
   Customer actions (spaBook / spaTrack / spaCancelByCode / spaMenu) are
   public + rate-limited. Staff actions require the salon spa PIN
   (pp_config/spa.pin, default "0221"). ALL state is server-side
   (Firestore) — the app persists nothing in the browser.
   ===================================================================== */
const SPA_TICKETS = "pp_spa_tickets";
const SPA_LEDGER = "pp_spa_ledger";
const SPA_CLIENTS = "pp_spa_clients";
const SPA_PIN_DEFAULT = "0221";
const SPA_STEPS = ["Requested", "Checked in", "Bathing", "Grooming", "Finishing", "Ready for pickup", "Picked up"];
const DEFAULT_FEES = [
  { label: "De-matting fee", amount: 15 },
  { label: "Late pickup fee", amount: 10 },
  { label: "No-show fee", amount: 25 },
  { label: "Special handling", amount: 10 },
  { label: "Nail grind", amount: 8 },
  { label: "Flea & tick bath", amount: 12 },
];

function todayET() {
  // YYYY-MM-DD in America/New_York (en-CA formats as ISO-like).
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function spaPinValue() {
  try {
    const snap = await db.collection("pp_config").doc("spa").get();
    const d = snap.exists ? snap.data() : null;
    if (d && d.pin) return String(d.pin);
  } catch (e) {
    console.error("spaPin read failed", e && e.message);
  }
  return SPA_PIN_DEFAULT;
}
async function verifySpaPin(pin) {
  const p = String(pin || "").trim();
  if (!p) return false;
  return timingSafeEqualStr(p, await spaPinValue());
}

/* ---- Staff identity + roles (spa console) ---------------------------------
 * The shared spa PIN still works and maps to the "owner" role (Britni), so
 * nothing breaks on day one. In addition, each stylist can be given their own
 * PIN + accessRole. Every non-public spa request resolves the caller to an
 * actor {role,name,id,kind} and sensitive actions are gated by role.
 *   Roles (rank): owner(3) > manager(2) > stylist(1).
 * ------------------------------------------------------------------------- */
const ROLE_RANK = { owner: 3, manager: 2, stylist: 1 };
function normRole(r) {
  const v = String(r || "").toLowerCase();
  return ROLE_RANK[v] ? v : "stylist";
}

/** Resolve a PIN to an actor, or null if it matches nothing. */
async function resolveSpaActor(pin) {
  const p = String(pin || "").trim();
  if (!p) return null;
  // 1) Shared spa PIN → owner (backward compatible).
  if (timingSafeEqualStr(p, await spaPinValue())) {
    return { kind: "shared", role: "owner", name: "Salon", id: "" };
  }
  // 2) Per-stylist PIN (hashed) — timing-safe compare against each stylist.
  try {
    const crypto = require("crypto");
    const snap = await db.collection(STAFF).get();
    for (const d of snap.docs) {
      const s = d.data() || {};
      if (s.active === false || !s.pinHash || !s.pinSalt) continue;
      const cand = Buffer.from(hashPass(p, s.pinSalt).hash, "hex");
      const stored = Buffer.from(s.pinHash, "hex");
      if (cand.length === stored.length && crypto.timingSafeEqual(cand, stored)) {
        return { kind: "staff", role: normRole(s.accessRole), name: s.name || "Stylist", id: d.id };
      }
    }
  } catch (e) {
    console.error("resolveSpaActor failed", e && e.message);
  }
  return null;
}

/** Gate: ensures actor is at least `min` role, else sends 403 and returns false. */
function requireRole(actor, min, res) {
  if (actor && (ROLE_RANK[actor.role] || 0) >= (ROLE_RANK[min] || 99)) return true;
  res.status(403).json({ error: "That action needs a manager or owner PIN." });
  return false;
}

async function loadFees() {
  try {
    const snap = await db.collection("pp_config").doc("spaFees").get();
    if (snap.exists && Array.isArray(snap.data().fees)) return snap.data().fees;
  } catch (e) {
    console.error("loadFees failed", e && e.message);
  }
  return DEFAULT_FEES;
}

function genCode() {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I
  let s = "";
  for (let i = 0; i < 6; i++) s += c[Math.floor(Math.random() * c.length)];
  return s;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/* ---- Vaccinations (structured, multi-type) --------------------------------
 * Each pet carries vaccinations:[{type,expires,verifiedAt,notes}]. Status is
 * always computed from `expires` vs today (never trusted from the client) so a
 * stale stored badge can't mask an expired shot. Required types are
 * configurable (pp_config/spaVax); anything required but absent reads "missing".
 * ------------------------------------------------------------------------- */
const DEFAULT_REQUIRED_VAX = ["Rabies"];
const KNOWN_VAX = ["Rabies", "DHPP", "Bordetella", "Canine Influenza", "Leptospirosis"];
const VAX_SOON_DAYS = 30;

function cleanVax(v) {
  v = v || {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  return {
    type: String(v.type || "").trim().slice(0, 40),
    expires: dateRe.test(String(v.expires || "")) ? v.expires : "",
    verifiedAt: dateRe.test(String(v.verifiedAt || "")) ? v.verifiedAt : "",
    notes: String(v.notes || "").trim().slice(0, 160),
  };
}

/** Worst-case status for one vaccination record given today's ISO date. */
function vaxRecordStatus(rec, today) {
  if (!rec.expires) return "unknown";
  if (rec.expires < today) return "expired";
  const soon = new Date(today + "T00:00:00Z");
  soon.setUTCDate(soon.getUTCDate() + VAX_SOON_DAYS);
  const soonIso = soon.toISOString().slice(0, 10);
  return rec.expires <= soonIso ? "expiring" : "ok";
}

/** Roll a pet's vaccination list + required set into one worst-case status. */
function petVaxStatus(pet, required, today) {
  today = today || todayET();
  required = Array.isArray(required) && required.length ? required : DEFAULT_REQUIRED_VAX;
  const vax = Array.isArray(pet && pet.vaccinations) ? pet.vaccinations : [];
  const byType = {};
  vax.forEach((v) => { if (v.type) byType[v.type.toLowerCase()] = v; });
  const order = { missing: 4, expired: 3, expiring: 2, unknown: 1, ok: 0 };
  let worst = "ok";
  const bump = (s) => { if (order[s] > order[worst]) worst = s; };
  required.forEach((t) => {
    const rec = byType[String(t).toLowerCase()];
    if (!rec) bump("missing");
    else bump(vaxRecordStatus(rec, today));
  });
  // Non-required shots on file still surface expiry, but never as "missing".
  vax.forEach((v) => { if (v.type) bump(vaxRecordStatus(v, today)); });
  return worst;
}

async function loadRequiredVax() {
  try {
    const snap = await db.collection("pp_config").doc("spaVax").get();
    if (snap.exists && Array.isArray(snap.data().required) && snap.data().required.length) {
      return snap.data().required.map((s) => String(s).slice(0, 40)).filter(Boolean).slice(0, 20);
    }
  } catch (e) {
    console.error("loadRequiredVax failed", e && e.message);
  }
  return DEFAULT_REQUIRED_VAX.slice();
}

/** Sanitize a single pet profile (staff CRM). */
function cleanPet(p) {
  p = p || {};
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  // Migrate the legacy single rabiesExpires field into the structured list the
  // first time a pet is touched, so no historical rabies date is ever lost.
  let vaccinations = Array.isArray(p.vaccinations) ? p.vaccinations.map(cleanVax).filter((v) => v.type).slice(0, 20) : [];
  const legacyRabies = dateRe.test(String(p.rabiesExpires || "")) ? p.rabiesExpires : "";
  if (legacyRabies && !vaccinations.some((v) => v.type.toLowerCase() === "rabies")) {
    vaccinations.unshift(cleanVax({ type: "Rabies", expires: legacyRabies }));
  }
  return {
    id: String(p.id || "").slice(0, 40) || genId(),
    name: String(p.name || "").trim().slice(0, 40),
    breed: String(p.breed || "").trim().slice(0, 40),
    size: String(p.size || "").trim().slice(0, 40),
    temperament: String(p.temperament || "").trim().slice(0, 60),
    notes: String(p.notes || "").trim().slice(0, 400),
    // Kept for backward compatibility / one-line display; the source of truth
    // is now vaccinations[].
    rabiesExpires: (vaccinations.find((v) => v.type.toLowerCase() === "rabies") || {}).expires || "",
    vaxNotes: String(p.vaxNotes || "").trim().slice(0, 200),
    vaccinations,
  };
}

/** Shape a client doc for the CRM (with computed visits/spent merged in later). */
function clientOut(doc) {
  const d = doc.data() || {};
  const { phones, primary } = cleanPhones(d.phones, d.phone);
  return {
    id: doc.id,
    name: d.name || "",
    phone: primary || d.phone || "",
    phones,
    email: d.email || "",
    notes: d.notes || "",
    pets: Array.isArray(d.pets) ? d.pets.map(cleanPet) : [],
    createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0,
    updatedAt: d.updatedAt && d.updatedAt.toMillis ? d.updatedAt.toMillis() : 0,
  };
}

/**
 * Upsert a client record from an incoming booking, keyed by normalized phone.
 * Creates the client if new and appends the pet if we haven't seen that pet
 * name for them before — so the staff CRM auto-populates from every booking
 * without the customer needing an account.
 */
async function upsertClientFromBooking(rec) {
  const owner = rec.owner || {};
  const phone = owner.phone || "";
  if (!phone) return ""; // no reliable key — skip (still lives on the ticket)
  try {
    const snap = await db.collection(SPA_CLIENTS).where("phone", "==", phone).limit(1).get();
    const petName = (rec.pet && rec.pet.name) || "";
    if (snap.empty) {
      const ref = await db.collection(SPA_CLIENTS).add({
        name: owner.name || "",
        phone,
        phones: [{ type: "Mobile", number: phone }],
        email: owner.email || "",
        notes: "",
        pets: petName ? [cleanPet({ name: petName, breed: rec.pet.breed, size: rec.pet.size, notes: rec.pet.notes })] : [],
        createdAt: now(),
        updatedAt: now(),
      });
      return ref.id;
    } else {
      const ref = snap.docs[0].ref;
      const d = snap.docs[0].data() || {};
      const pets = Array.isArray(d.pets) ? d.pets.slice() : [];
      const exists = pets.some((p) => (p.name || "").toLowerCase() === petName.toLowerCase());
      if (petName && !exists) pets.push(cleanPet({ name: petName, breed: rec.pet.breed, size: rec.pet.size, notes: rec.pet.notes }));
      const patch = { updatedAt: now(), pets };
      if (!d.name && owner.name) patch.name = owner.name;
      if (!d.email && owner.email) patch.email = owner.email;
      if (!Array.isArray(d.phones) || !d.phones.length) patch.phones = [{ type: "Mobile", number: phone }];
      await ref.set(patch, { merge: true });
      return ref.id;
    }
  } catch (e) {
    console.error("upsertClientFromBooking failed", e && e.message);
    return "";
  }
}

/** Aggregate visits + dollars spent per owner phone from paid tickets. */
async function ticketTotalsByPhone() {
  const map = {};
  try {
    const snap = await db.collection(SPA_TICKETS).orderBy("createdAt", "desc").limit(2000).get();
    snap.docs.forEach((d) => {
      const x = d.data();
      if (x.cancelled || x.voided) return;
      const phone = (x.owner && x.owner.phone) || "";
      if (!phone) return;
      const ft = Number(x.finalTotal) || 0;
      if (!map[phone]) map[phone] = { visits: 0, spent: 0, lastVisit: 0 };
      if (x.paid || ft > 0) { map[phone].visits++; map[phone].spent += ft; }
      const ts = x.createdAt && x.createdAt.toMillis ? x.createdAt.toMillis() : 0;
      if (ts > map[phone].lastVisit) map[phone].lastVisit = ts;
    });
    Object.keys(map).forEach((k) => { map[k].spent = Math.round(map[k].spent * 100) / 100; });
  } catch (e) {
    console.error("ticketTotalsByPhone failed", e && e.message);
  }
  return map;
}


function spaTicketPublic(doc) {
  const d = doc.data() || {};
  const step = typeof d.step === "number" ? d.step : 0;
  return {
    id: doc.id,
    code: d.code || "",
    petName: (d.pet && d.pet.name) || "",
    services: d.services || [],
    stylist: d.stylist || "",
    step,
    status: SPA_STEPS[step] || "Requested",
    cancelled: !!d.cancelled,
    voided: !!d.voided,
    requestedDate: d.requestedDate || "",
    requestedTime: d.requestedTime || "",
  };
}
function spaTicketFull(doc) {
  const d = doc.data() || {};
  return Object.assign(spaTicketPublic(doc), {
    date: d.date || "",
    pet: d.pet || {},
    owner: d.owner || {},
    petNotes: (d.pet && d.pet.notes) || "",
    est: d.est || 0,
    items: d.items || [],
    paid: !!d.paid,
    payMethod: d.payMethod || "",
    tip: d.tip || 0,
    discount: d.discount || 0,
    finalTotal: d.finalTotal || 0,
    cancelReason: d.cancelReason || "",
    voidReason: d.voidReason || "",
    clientId: d.clientId || "",
    createdAt: d.createdAt && d.createdAt.toMillis ? d.createdAt.toMillis() : 0,
  });
}

/** Post a balanced double-entry journal record. Throws if debits != credits. */
async function postLedger({ date, memo, ref, lines }) {
  let dr = 0;
  let cr = 0;
  const clean = (lines || [])
    .map((l) => {
      const d = Math.max(0, Number(l.dr) || 0);
      const c = Math.max(0, Number(l.cr) || 0);
      dr += d;
      cr += c;
      return { acct: String(l.acct || "Uncategorized").slice(0, 40), dr: Math.round(d * 100) / 100, cr: Math.round(c * 100) / 100 };
    })
    .filter((l) => l.dr || l.cr);
  if (!clean.length) return null;
  if (Math.abs(dr - cr) > 0.005) throw new Error("Ledger entry not balanced");
  const rec = { date: date || todayET(), memo: String(memo || "").slice(0, 120), ref: String(ref || "").slice(0, 20), lines: clean, at: now() };
  const r = await db.collection(SPA_LEDGER).add(rec);
  return r.id;
}

/**
 * Post a reversing (contra) entry for an existing ledger record: same accounts,
 * dr/cr swapped. This keeps the journal immutable — nothing is ever edited or
 * deleted; a correction is a new, balanced, offsetting record that references
 * the original. Returns the new entry id (or null if the original is missing).
 */
async function reverseLedger(ledgerId, memo) {
  if (!ledgerId) return null;
  try {
    const snap = await db.collection(SPA_LEDGER).doc(ledgerId).get();
    if (!snap.exists) return null;
    const orig = snap.data() || {};
    const lines = (orig.lines || []).map((l) => ({ acct: l.acct, dr: l.cr || 0, cr: l.dr || 0 }));
    if (!lines.length) return null;
    return await postLedger({ memo: memo || `Reversal of ${orig.memo || ledgerId}`, ref: orig.ref, lines });
  } catch (e) {
    console.error("reverseLedger failed", e && e.message);
    return null;
  }
}

exports.pinkPoodleSpa = onRequest(
  {
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/, /^http:\/\/127\.0\.0\.1(:\d+)?$/],
    memory: "256MiB",
    timeoutSeconds: 30,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const b = req.body || {};
    const action = b.action;
    const ip = clientIp(req);
    const PUBLIC = ["spaMenu", "spaBook", "spaTrack", "spaCancelByCode"];
    let actor = null;

    try {
      if (PUBLIC.indexOf(action) < 0) {
        actor = await resolveSpaActor(b.pin);
        if (!actor) {
          const ok = await checkRateLimit("spaauth", ip, { max: 10, windowMs: 10 * 60 * 1000 });
          if (!ok) return res.status(429).json({ error: "Too many attempts. Try again later." });
          return res.status(401).json({ error: "Wrong PIN." });
        }
      }

      switch (action) {
        /* ---------------- public / customer ---------------- */
        case "spaMenu":
          return res.json({ ok: true, fees: await loadFees() });

        case "spaLogin":
          // Confirms the PIN and returns who it belongs to + their role, so the
          // console can hide privileged controls from a stylist-level PIN.
          return res.json({ ok: true, actor: { name: actor.name, role: actor.role, id: actor.id } });

        case "spaBook": {
          const ok = await checkRateLimit("spabook", ip, { max: 8, windowMs: 10 * 60 * 1000 });
          if (!ok) return res.status(429).json({ error: "Too many requests. Please text 304-921-2748 to book." });
          if (b.company) return res.json({ ok: true, code: "" }); // honeypot
          const pet = b.pet || {};
          const owner = b.owner || {};
          const petName = String(pet.name || "").trim().slice(0, 40);
          if (!petName) return res.status(400).json({ error: "Please add your pet's name." });
          const services = (Array.isArray(b.services) ? b.services : []).map((s) => String(s).slice(0, 60)).slice(0, 20);
          if (!services.length) return res.status(400).json({ error: "Choose at least one service." });
          const items = (Array.isArray(b.items) ? b.items : []).map((it) => ({ label: String(it.label || "").slice(0, 60), amount: Math.max(0, Number(it.amount) || 0) })).slice(0, 30);
          const rec = {
            code: genCode(),
            step: 0,
            cancelled: false,
            paid: false,
            date: todayET(),
            pet: { name: petName, breed: String(pet.breed || "").slice(0, 40), size: String(pet.size || "").slice(0, 40), notes: String(pet.notes || "").slice(0, 300) },
            owner: { name: String(owner.name || "").slice(0, 80), phone: normalizePhone(owner.phone), email: String(owner.email || "").slice(0, 120) },
            services,
            items,
            stylist: String(b.stylist || "No preference").slice(0, 40),
            requestedDate: String(b.requestedDate || "").slice(0, 40),
            requestedTime: String(b.requestedTime || "").slice(0, 40),
            est: Math.max(0, Number(b.est) || 0),
            createdAt: now(),
          };
          const r = await db.collection(SPA_TICKETS).add(rec);
          const clientId = await upsertClientFromBooking(rec);
          if (clientId) await r.set({ clientId }, { merge: true });
          return res.json({ ok: true, code: rec.code, id: r.id });
        }

        case "spaTrack": {
          const codeUp = String(b.code || "").trim().toUpperCase().slice(0, 10);
          if (!codeUp) return res.status(400).json({ error: "Enter your booking code." });
          const snap = await db.collection(SPA_TICKETS).where("code", "==", codeUp).limit(1).get();
          if (snap.empty) return res.status(404).json({ error: "No booking found for that code." });
          const doc = snap.docs[0];
          // Loyalty: lifetime visits + dollars spent for this pup's owner.
          // Matched on the owner's phone/email attached to the booking they
          // already hold the code for — no PII is returned, only the totals.
          const owner = doc.data().owner || {};
          const phone = owner.phone || "";
          const email = (owner.email || "").toLowerCase();
          const loyalty = { visits: 0, spent: 0 };
          try {
            let hist = null;
            if (phone) hist = await db.collection(SPA_TICKETS).where("owner.phone", "==", phone).limit(500).get();
            else if (email) hist = await db.collection(SPA_TICKETS).where("owner.email", "==", owner.email).limit(500).get();
            if (hist) {
              hist.docs.forEach((d) => {
                const x = d.data();
                if (x.cancelled || x.voided) return;
                const ft = Number(x.finalTotal) || 0;
                if (x.paid || ft > 0) { loyalty.visits++; loyalty.spent += ft; }
              });
              loyalty.spent = Math.round(loyalty.spent * 100) / 100;
            }
          } catch (e) {
            console.error("loyalty calc failed", e && e.message);
          }
          return res.json({ ok: true, ticket: spaTicketPublic(doc), loyalty });
        }

        case "spaCancelByCode": {
          const ok = await checkRateLimit("spacancel", ip, { max: 10, windowMs: 10 * 60 * 1000 });
          if (!ok) return res.status(429).json({ error: "Too many requests." });
          const codeUp = String(b.code || "").trim().toUpperCase().slice(0, 10);
          const snap = await db.collection(SPA_TICKETS).where("code", "==", codeUp).limit(1).get();
          if (snap.empty) return res.status(404).json({ error: "No booking found for that code." });
          const doc = snap.docs[0];
          if ((doc.data().step || 0) >= 2) return res.status(400).json({ error: "This spa day is already underway — please call the salon." });
          await doc.ref.set({ cancelled: true, cancelReason: "Cancelled by customer", cancelledAt: now() }, { merge: true });
          return res.json({ ok: true });
        }

        /* ---------------- staff (PIN required) ---------------- */
        case "spaBoard": {
          const snap = await db.collection(SPA_TICKETS).orderBy("createdAt", "desc").limit(200).get();
          const today = todayET();
          const tickets = snap.docs.map(spaTicketFull).filter((t) => !t.voided && (t.date === today || (t.step < 6 && !t.cancelled)));
          return res.json({ ok: true, tickets, steps: SPA_STEPS });
        }

        case "spaAdvance": {
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          const step = Math.max(0, Math.min(6, Number(b.step)));
          await db.collection(SPA_TICKETS).doc(b.id).set({ step, cancelled: false }, { merge: true });
          return res.json({ ok: true });
        }

        case "spaWalkin": {
          const petName = String(b.petName || "").trim().slice(0, 40);
          if (!petName) return res.status(400).json({ error: "Pet name required." });
          const rec = { code: genCode(), step: 1, cancelled: false, paid: false, date: todayET(), pet: { name: petName }, owner: {}, services: ["Walk-in"], items: [], stylist: String(b.stylist || "Britni").slice(0, 40), requestedTime: "now", est: 0, createdAt: now() };
          const r = await db.collection(SPA_TICKETS).add(rec);
          return res.json({ ok: true, id: r.id, code: rec.code });
        }

        case "spaCheckout": {
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          const ref = db.collection(SPA_TICKETS).doc(b.id);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Ticket not found." });
          const t = doc.data();
          const items = (Array.isArray(b.items) ? b.items : []).map((it) => ({ label: String(it.label || "").slice(0, 60), amount: Math.max(0, Number(it.amount) || 0) })).slice(0, 40);
          const discount = Math.max(0, Number(b.discount) || 0);
          const tip = Math.max(0, Number(b.tip) || 0);
          const payMethod = String(b.payMethod || "Cash").slice(0, 30);
          const gross = items.reduce((s, it) => s + it.amount, 0);
          const subtotal = Math.max(0, Math.round((gross - discount) * 100) / 100);
          const total = Math.round((subtotal + tip) * 100) / 100;
          const assetAcct = /card|credit|square/i.test(payMethod) ? "Card / Bank" : /venmo|cash ?app|paypal|zelle/i.test(payMethod) ? payMethod : "Cash";
          const lines = [{ acct: assetAcct, dr: total }, { acct: "Grooming Revenue", cr: subtotal }];
          if (tip > 0) lines.push({ acct: "Tips", cr: tip });
          const ledgerId = total > 0 ? await postLedger({ memo: `${(t.pet && t.pet.name) || "Client"} — ${payMethod}`, ref: t.code, lines }) : null;
          await ref.set({ paid: true, payMethod, items, discount, tip, finalTotal: total, ledgerId, paidAt: now(), step: Math.max(t.step || 0, 6) }, { merge: true });
          return res.json({ ok: true, total });
        }

        case "spaCancel": {
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          const ref = db.collection(SPA_TICKETS).doc(b.id);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Ticket not found." });
          const t = doc.data();
          const fee = Math.max(0, Number(b.noShowFee) || 0);
          let ledgerId = null;
          if (fee > 0) {
            ledgerId = await postLedger({ memo: `${(t.pet && t.pet.name) || "Client"} — cancellation/no-show fee`, ref: t.code, lines: [{ acct: "Cash", dr: fee }, { acct: "Cancellation Fees", cr: fee }] });
          }
          await ref.set({ cancelled: true, cancelReason: String(b.reason || "Cancelled").slice(0, 120), noShowFee: fee, cancelLedgerId: ledgerId, cancelledAt: now() }, { merge: true });
          return res.json({ ok: true });
        }

        case "spaVoid": {
          if (!requireRole(actor, "manager", res)) return;
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          const ref = db.collection(SPA_TICKETS).doc(b.id);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Ticket not found." });
          const t = doc.data();
          if (t.voided) return res.json({ ok: true, already: true });
          const reason = String(b.reason || "Voided").slice(0, 120);
          // Reverse any money this ticket posted — the payment and any
          // cancellation/no-show fee — so the books self-correct without ever
          // deleting history.
          const reversals = [];
          if (t.ledgerId) { const id = await reverseLedger(t.ledgerId, `Void — ${(t.pet && t.pet.name) || "Client"} (${t.code || ""})`); if (id) reversals.push(id); }
          if (t.cancelLedgerId) { const id = await reverseLedger(t.cancelLedgerId, `Void fee — ${(t.pet && t.pet.name) || "Client"} (${t.code || ""})`); if (id) reversals.push(id); }
          await ref.set({ voided: true, voidReason: reason, voidReversals: reversals, voidedAt: now() }, { merge: true });
          return res.json({ ok: true, reversals: reversals.length });
        }

        case "spaDelete": {
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          const ref = db.collection(SPA_TICKETS).doc(b.id);
          const doc = await ref.get();
          if (!doc.exists) return res.json({ ok: true });
          const t = doc.data() || {};
          // Never hard-delete a ticket that touched the books — that would break
          // the immutable ledger. Force those through "Void" instead.
          if (t.paid || t.ledgerId || t.finalTotal > 0 || t.cancelLedgerId) {
            return res.status(400).json({ error: "This ticket has payment history — use Void, which reverses the entries and keeps the record." });
          }
          await ref.delete();
          return res.json({ ok: true });
        }

        case "spaLedger": {
          const snap = await db.collection(SPA_LEDGER).orderBy("at", "desc").limit(500).get();
          const entries = snap.docs.map((d) => {
            const x = d.data();
            return { id: d.id, date: x.date, memo: x.memo, ref: x.ref, lines: x.lines || [] };
          });
          const bal = {};
          entries.forEach((e) => e.lines.forEach((l) => { bal[l.acct] = (bal[l.acct] || 0) + (l.dr || 0) - (l.cr || 0); }));
          const balances = Object.keys(bal).map((k) => ({ acct: k, balance: Math.round(bal[k] * 100) / 100 })).sort((a, c) => a.acct.localeCompare(c.acct));
          return res.json({ ok: true, entries, balances });
        }

        case "spaLedgerAdd": {
          if (!requireRole(actor, "manager", res)) return;
          const amount = Math.max(0, Number(b.amount) || 0);
          if (!amount) return res.status(400).json({ error: "Enter an amount." });
          const debit = String(b.debit || "").slice(0, 40);
          const credit = String(b.credit || "").slice(0, 40);
          if (!debit || !credit) return res.status(400).json({ error: "Pick a debit and a credit account." });
          const id = await postLedger({ date: b.date, memo: b.memo, ref: b.ref, lines: [{ acct: debit, dr: amount }, { acct: credit, cr: amount }] });
          return res.json({ ok: true, id });
        }

        case "spaFees":
          return res.json({ ok: true, fees: await loadFees() });

        case "spaFeesSave": {
          if (!requireRole(actor, "manager", res)) return;
          const fees = (Array.isArray(b.fees) ? b.fees : []).map((f) => ({ label: String(f.label || "").slice(0, 40), amount: Math.max(0, Number(f.amount) || 0) })).filter((f) => f.label).slice(0, 40);
          await db.collection("pp_config").doc("spaFees").set({ fees, updatedAt: now() });
          return res.json({ ok: true, fees });
        }

        case "spaContacts": {
          const snap = await db.collection(SPA_TICKETS).orderBy("createdAt", "desc").limit(1000).get();
          const map = {};
          snap.docs.forEach((d) => {
            const x = d.data();
            if (x.voided) return;
            const o = x.owner || {};
            const key = (o.phone || o.email || o.name || "").toLowerCase();
            if (!key) return;
            if (!map[key]) map[key] = { name: o.name || "", phone: o.phone || "", email: o.email || "", pets: [], visits: 0 };
            map[key].visits++;
            const pn = (x.pet && x.pet.name) || "";
            if (pn && map[key].pets.indexOf(pn) < 0) map[key].pets.push(pn);
          });
          return res.json({ ok: true, contacts: Object.values(map) });
        }

        /* ---------------- Client CRM (staff) ---------------- */
        case "spaClients": {
          const totals = await ticketTotalsByPhone();
          const required = await loadRequiredVax();
          const today = todayET();
          const stamp = (client) => {
            client.pets = (client.pets || []).map((p) => Object.assign({}, p, { vaxStatus: petVaxStatus(p, required, today) }));
            const order = { missing: 4, expired: 3, expiring: 2, unknown: 1, ok: 0 };
            client.vaxStatus = client.pets.reduce((w, p) => (order[p.vaxStatus] > order[w] ? p.vaxStatus : w), "ok");
            return client;
          };
          const snap = await db.collection(SPA_CLIENTS).orderBy("updatedAt", "desc").limit(1000).get();
          const savedPhones = {};
          const clients = snap.docs.map((d) => {
            const c = clientOut(d);
            const t = totals[c.phone] || {};
            // Any of a client's numbers should suppress a duplicate derived row.
            (c.phones.length ? c.phones.map((p) => p.number) : [c.phone]).forEach((n) => { if (n) savedPhones[n] = true; });
            return stamp(Object.assign(c, { visits: t.visits || 0, spent: t.spent || 0, lastVisit: t.lastVisit || 0 }));
          });
          // Fold in owners seen only on tickets (legacy / not yet saved as a client).
          const derived = {};
          const tsnap = await db.collection(SPA_TICKETS).orderBy("createdAt", "desc").limit(2000).get();
          tsnap.docs.forEach((d) => {
            const x = d.data();
            if (x.voided) return;
            const o = x.owner || {};
            const phone = o.phone || "";
            if (!phone || savedPhones[phone]) return;
            if (!derived[phone]) {
              const t = totals[phone] || {};
              derived[phone] = { id: "", name: o.name || "", phone, phones: [{ type: "Mobile", number: phone }], email: o.email || "", notes: "", pets: [], visits: t.visits || 0, spent: t.spent || 0, lastVisit: t.lastVisit || 0, derived: true };
            }
            const pn = (x.pet && x.pet.name) || "";
            if (pn && !derived[phone].pets.some((p) => (p.name || "").toLowerCase() === pn.toLowerCase())) {
              derived[phone].pets.push(cleanPet({ name: pn, breed: x.pet.breed, size: x.pet.size, notes: x.pet.notes }));
            }
          });
          const all = clients.concat(Object.values(derived).map(stamp));
          return res.json({ ok: true, clients: all, requiredVax: required, knownVax: KNOWN_VAX });
        }

        case "spaVaxConfig":
          return res.json({ ok: true, required: await loadRequiredVax(), known: KNOWN_VAX });

        case "spaVaxConfigSave": {
          if (!requireRole(actor, "manager", res)) return;
          const required = (Array.isArray(b.required) ? b.required : []).map((s) => String(s).trim().slice(0, 40)).filter(Boolean).slice(0, 20);
          await db.collection("pp_config").doc("spaVax").set({ required, updatedAt: now() }, { merge: true });
          return res.json({ ok: true, required });
        }

        case "spaVaxDue": {
          // Reminder list: every pet whose required/expiring shots need attention.
          const required = await loadRequiredVax();
          const today = todayET();
          const snap = await db.collection(SPA_CLIENTS).orderBy("updatedAt", "desc").limit(1000).get();
          const rows = [];
          snap.docs.forEach((d) => {
            const c = clientOut(d);
            (c.pets || []).forEach((p) => {
              const st = petVaxStatus(p, required, today);
              if (st === "ok") return;
              const byType = {};
              (p.vaccinations || []).forEach((v) => { if (v.type) byType[v.type.toLowerCase()] = v; });
              const details = required.map((t) => {
                const rec = byType[t.toLowerCase()];
                return { type: t, expires: (rec && rec.expires) || "", status: rec ? vaxRecordStatus(rec, today) : "missing" };
              }).filter((x) => x.status !== "ok");
              rows.push({ clientId: c.id, client: c.name, phone: c.phone, pet: p.name, status: st, details });
            });
          });
          const rank = { missing: 4, expired: 3, expiring: 2, unknown: 1 };
          rows.sort((a, z) => (rank[z.status] || 0) - (rank[a.status] || 0));
          return res.json({ ok: true, due: rows, required });
        }

        case "spaClientSave": {
          const c = b.client || {};
          const name = String(c.name || "").trim().slice(0, 80);
          const { phones, primary } = cleanPhones(c.phones, c.phone);
          if (!name && !primary) return res.status(400).json({ error: "Add a name or phone number." });
          const data = {
            name,
            phone: primary,
            phones,
            email: String(c.email || "").trim().slice(0, 120),
            notes: String(c.notes || "").trim().slice(0, 500),
            updatedAt: now(),
          };
          // Only touch pets when an explicit array is supplied, so an owner-only
          // save (or a truncated payload) can't silently wipe vaccination records.
          if (Array.isArray(c.pets)) data.pets = c.pets.map(cleanPet).slice(0, 20);
          let id = String(c.id || "").slice(0, 60);
          if (!id && primary) {
            const ex = await db.collection(SPA_CLIENTS).where("phone", "==", primary).limit(1).get();
            if (!ex.empty) id = ex.docs[0].id;
          }
          let ref;
          if (id) {
            ref = db.collection(SPA_CLIENTS).doc(id);
            await ref.set(data, { merge: true });
          } else {
            if (!Array.isArray(data.pets)) data.pets = [];
            data.createdAt = now();
            ref = await db.collection(SPA_CLIENTS).add(data);
          }
          return res.json({ ok: true, client: clientOut(await ref.get()) });
        }

        case "spaClientDelete": {
          if (!requireRole(actor, "manager", res)) return;
          if (!b.id) return res.status(400).json({ error: "Missing id." });
          await db.collection(SPA_CLIENTS).doc(b.id).delete();
          return res.json({ ok: true });
        }

        case "spaPetSave": {
          const clientId = String(b.clientId || "").slice(0, 60);
          if (!clientId) return res.status(400).json({ error: "Missing client." });
          const ref = db.collection(SPA_CLIENTS).doc(clientId);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Client not found." });
          const pet = cleanPet(b.pet);
          if (!pet.name) return res.status(400).json({ error: "Pet name required." });
          const pets = Array.isArray(doc.data().pets) ? doc.data().pets.map(cleanPet) : [];
          const idx = pets.findIndex((p) => p.id === pet.id);
          if (idx >= 0) pets[idx] = pet;
          else pets.push(pet);
          await ref.set({ pets, updatedAt: now() }, { merge: true });
          return res.json({ ok: true, client: clientOut(await ref.get()) });
        }

        case "spaPetDelete": {
          const clientId = String(b.clientId || "").slice(0, 60);
          const petId = String(b.petId || "");
          if (!clientId || !petId) return res.status(400).json({ error: "Missing ids." });
          const ref = db.collection(SPA_CLIENTS).doc(clientId);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Client not found." });
          const pets = (Array.isArray(doc.data().pets) ? doc.data().pets.map(cleanPet) : []).filter((p) => p.id !== petId);
          await ref.set({ pets, updatedAt: now() }, { merge: true });
          return res.json({ ok: true, client: clientOut(await ref.get()) });
        }

        case "spaSetPin": {
          if (!requireRole(actor, "owner", res)) return;
          const np = String(b.newPin || "").trim();
          if (!/^\d{4,8}$/.test(np)) return res.status(400).json({ error: "PIN must be 4–8 digits." });
          await db.collection("pp_config").doc("spa").set({ pin: np, updatedAt: now() }, { merge: true });
          return res.json({ ok: true });
        }

        case "spaStaffPin": {
          // Owner assigns/updates a stylist's personal PIN + access role, or
          // clears their PIN (clear:true). Enforces PIN uniqueness so two people
          // can't collide, and blocks reusing the shared salon PIN.
          if (!requireRole(actor, "owner", res)) return;
          const staffId = String(b.staffId || "").slice(0, 60);
          if (!staffId) return res.status(400).json({ error: "Pick a stylist." });
          const ref = db.collection(STAFF).doc(staffId);
          const doc = await ref.get();
          if (!doc.exists) return res.status(404).json({ error: "Stylist not found." });
          const role = normRole(b.role);
          if (b.clear === true) {
            await ref.set({ pinHash: "", pinSalt: "", accessRole: role, updatedAt: now() }, { merge: true });
            return res.json({ ok: true, cleared: true });
          }
          const np = String(b.newPin || "").trim();
          if (!/^\d{4,8}$/.test(np)) return res.status(400).json({ error: "PIN must be 4–8 digits." });
          if (timingSafeEqualStr(np, await spaPinValue())) return res.status(400).json({ error: "That's the shared salon PIN — choose a different personal PIN." });
          // Reject collision with another stylist's PIN.
          const crypto = require("crypto");
          const all = await db.collection(STAFF).get();
          for (const s2 of all.docs) {
            if (s2.id === staffId) continue;
            const sd = s2.data() || {};
            if (!sd.pinHash || !sd.pinSalt) continue;
            const cand = Buffer.from(hashPass(np, sd.pinSalt).hash, "hex");
            const stored = Buffer.from(sd.pinHash, "hex");
            if (cand.length === stored.length && crypto.timingSafeEqual(cand, stored)) {
              return res.status(400).json({ error: "Another stylist already uses that PIN." });
            }
          }
          const { salt, hash } = hashPass(np);
          await ref.set({ pinHash: hash, pinSalt: salt, accessRole: role, updatedAt: now() }, { merge: true });
          return res.json({ ok: true });
        }

        default:
          return res.status(400).json({ error: "Unknown action." });
      }
    } catch (e) {
      console.error("spa error", action, e && e.message);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }
);

/* ==========================================================================
 * pinkPoodlePush — public web-push subscribe/unsubscribe (no auth).
 *   action "subscribe":   stores an FCM web token in pp_push_subs.
 *   action "unsubscribe": removes a token.
 * Rate-limited + honeypot; the browser's notification-permission prompt is
 * the real opt-in. Broadcasts are sent from the console via admin "pushBlast".
 * ========================================================================== */
exports.pinkPoodlePush = onRequest(
  {
    cors: [/^https?:\/\/([a-z0-9-]+\.)*pinkpoodle\.dog$/, /^http:\/\/localhost(:\d+)?$/],
    memory: "256MiB",
    timeoutSeconds: 30,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    try {
      const b = req.body || {};
      // Honeypot — bots fill hidden fields; feign success, store nothing.
      if (b.company) return res.json({ ok: true });

      const tok = String(b.token || "").trim();
      if (tok.length < 20) return res.status(400).json({ error: "Invalid token." });
      const docId = require("crypto").createHash("sha256").update(tok).digest("hex").slice(0, 40);

      if (b.action === "unsubscribe") {
        await db.collection(PUSH_SUBS).doc(docId).delete().catch(() => {});
        return res.json({ ok: true });
      }

      // subscribe (default)
      const allowed = await checkRateLimit("push", clientIp(req), { max: 20, windowMs: 10 * 60 * 1000 });
      if (!allowed) return res.status(429).json({ error: "Too many requests. Please try again shortly." });
      await db.collection(PUSH_SUBS).doc(docId).set({
        token: tok,
        source: String(b.source || "pinkpoodle").slice(0, 40),
        createdAt: now(),
        updatedAt: now(),
      }, { merge: true });
      return res.json({ ok: true });
    } catch (e) {
      console.error("push error", e && e.message);
      return res.status(500).json({ error: "Something went wrong. Please try again." });
    }
  }
);

/* ==========================================================================
 * pinkPoodleSms — Twilio inbound SMS webhook (compliance: STOP / START / HELP).
 * Twilio POSTs form-encoded {From, Body}. We honor opt-out/opt-in against the
 * customer records (pp_customers) matched by phone, and always answer with
 * TwiML. Set this URL as the "A Message Comes In" webhook on the Twilio number.
 * Requires A2P 10DLC registration before any marketing traffic goes live.
 * ========================================================================== */
exports.pinkPoodleSms = onRequest(
  {
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER],
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30,
    invoker: "public",
  },
  async (req, res) => {
    const twiml = (msg) => {
      res.set("Content-Type", "text/xml");
      res.status(200).send(`<?xml version="1.0" encoding="UTF-8"?><Response>${msg ? `<Message>${esc(msg)}</Message>` : ""}</Response>`);
    };
    try {
      const from = normalizePhone((req.body && req.body.From) || "");
      const text = String((req.body && req.body.Body) || "").trim().toUpperCase();
      if (!from) return twiml("");
      const STOP = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "QUIT", "END"];
      const START = ["START", "YES", "UNSTOP"];
      // Match every customer record carrying this phone (primary or in phones[]).
      const [byPrimary, all] = await Promise.all([
        db.collection(CUSTOMERS).where("phone", "==", from).limit(50).get(),
        db.collection(CUSTOMERS).limit(2000).get(),
      ]);
      const refs = new Map();
      byPrimary.docs.forEach((d) => refs.set(d.id, d.ref));
      all.docs.forEach((d) => {
        const ph = Array.isArray(d.data().phones) ? d.data().phones : [];
        if (ph.some((p) => normalizePhone(p.number) === from)) refs.set(d.id, d.ref);
      });

      if (STOP.includes(text)) {
        await Promise.all([...refs.values()].map((r) => r.set({ smsOptOutAt: now(), smsOptIn: false }, { merge: true }).catch(() => {})));
        await db.collection(MESSAGES).add({ customerId: null, type: "optout", channel: "sms", body: `STOP from ${from}`, amount: null, ts: now() }).catch(() => {});
        return twiml("You're unsubscribed from The Pink Poodle texts. It can take up to 24 hours to fully stop. Reply START to rejoin.");
      }
      if (START.includes(text)) {
        await Promise.all([...refs.values()].map((r) => r.set({ smsOptOutAt: admin.firestore.FieldValue.delete(), smsOptIn: true }, { merge: true }).catch(() => {})));
        return twiml("You're re-subscribed to The Pink Poodle 🐩. Reply STOP anytime to opt out, HELP for help.");
      }
      if (text === "HELP" || text === "INFO") {
        return twiml("The Pink Poodle: appointment & promo texts. Msg&data rates may apply. Reply STOP to cancel. Call (304) 921-2748.");
      }
      // Any other inbound text just acknowledges softly (Britni reads replies).
      return twiml("");
    } catch (e) {
      console.error("sms inbound error", e && e.message);
      res.set("Content-Type", "text/xml");
      return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }
);
