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
