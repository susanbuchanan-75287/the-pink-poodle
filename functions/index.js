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
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 120,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const { adminKey, imageBase64, filename, contentType, caption, postToFacebook } = req.body || {};

      if (!adminKey || adminKey !== PP_ADMIN_KEY.value().trim()) {
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
    secrets: [GH_TOKEN, PP_ADMIN_KEY, PP_FB_PAGE_ID, PP_FB_PAGE_TOKEN],
    cors: true,
    memory: "512MiB",
    timeoutSeconds: 120,
    region: "us-central1",
  },
  async (req, res) => {
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = req.body || {};
    const { action } = body;
    if (!body.adminKey || body.adminKey !== PP_ADMIN_KEY.value().trim()) {
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

        default:
          return res.status(400).json({ error: "Unknown action: " + action });
      }
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: e.message || "Request failed." });
    }
  }
);
