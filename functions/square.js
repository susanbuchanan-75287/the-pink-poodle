/**
 * The Pink Poodle — Square Appointments integration (raw REST, no SDK).
 *
 * Keeps the integration dependency-free (matches the GitHub/Facebook style in
 * index.js) and gated entirely on a single secret + Firestore config, so it
 * auto-enables the moment Britni pastes her Square access token — exactly like
 * the Twilio/Facebook hooks.
 *
 * cfg shape (assembled in index.js from the SQUARE_ACCESS_TOKEN secret + the
 * pp_settings/square Firestore doc):
 *   { token, env, version, locationId, teamMemberId, serviceVariationId, autoBook }
 *
 * All calls FAIL SOFT: a Square outage or misconfig must never block a booking
 * request from reaching Britni by email/SMS.
 */

const crypto = require("crypto");

// Overridable per-account via pp_settings/square.version. Any real released
// Square version works; older versions are always accepted by newer accounts.
const DEFAULT_VERSION = "2025-04-16";

function baseUrl(env) {
  return env === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

function enabled(cfg) {
  return !!(cfg && cfg.token && cfg.locationId);
}

async function sq(cfg, path, { method = "GET", body } = {}) {
  const res = await fetch(baseUrl(cfg.env) + path, {
    method,
    headers: {
      Authorization: "Bearer " + cfg.token,
      "Square-Version": cfg.version || DEFAULT_VERSION,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let json = null;
  try {
    json = await res.json();
  } catch (_) {
    json = null;
  }
  if (!res.ok) {
    const msg =
      (json && json.errors && json.errors[0] && (json.errors[0].detail || json.errors[0].code)) ||
      `Square API ${res.status}`;
    const err = new Error(msg);
    err.status = res.status;
    err.squareErrors = (json && json.errors) || null;
    throw err;
  }
  return json || {};
}

const uuid = () => crypto.randomUUID();

/* --------------------------------------------------------------- Locations */
async function listLocations(cfg) {
  const j = await sq(cfg, "/v2/locations");
  return (j.locations || []).map((l) => ({
    id: l.id,
    name: l.name || "",
    status: l.status || "",
    timezone: l.timezone || "",
  }));
}

/* ------------------------------------------------------------- Team members */
async function listTeamMembers(cfg) {
  const filter = { status: "ACTIVE" };
  if (cfg.locationId) filter.location_ids = [cfg.locationId];
  const j = await sq(cfg, "/v2/team-members/search", {
    method: "POST",
    body: { query: { filter } },
  });
  return (j.team_members || []).map((t) => ({
    id: t.id,
    name: [t.given_name, t.family_name].filter(Boolean).join(" ").trim() || t.email_address || t.id,
    isOwner: !!t.is_owner,
  }));
}

/* ---------------------------------------------------------- Catalog services */
async function listServices(cfg) {
  const j = await sq(cfg, "/v2/catalog/search", {
    method: "POST",
    body: { object_types: ["ITEM"], limit: 200 },
  });
  const out = [];
  for (const obj of j.objects || []) {
    const item = obj.item_data;
    if (!item || item.product_type !== "APPOINTMENTS_SERVICE") continue;
    for (const v of item.variations || []) {
      const vd = v.item_variation_data || {};
      out.push({
        variationId: v.id,
        variationVersion: v.version,
        serviceName: item.name || "",
        variationName: vd.name || "",
        label: [item.name, vd.name && vd.name !== "Regular" ? vd.name : ""].filter(Boolean).join(" — "),
        durationMinutes: vd.service_duration ? Math.round(Number(vd.service_duration) / 60000) : null,
      });
    }
  }
  return out;
}

/* --------------------------------------------------------------- Customers */
async function findCustomer(cfg, { phone, email }) {
  // Prefer phone match, fall back to email. Exact filters only.
  if (phone) {
    try {
      const j = await sq(cfg, "/v2/customers/search", {
        method: "POST",
        body: { query: { filter: { phone_number: { exact: phone } } }, limit: 1 },
      });
      if (j.customers && j.customers[0]) return j.customers[0];
    } catch (_) {
      /* fall through to email */
    }
  }
  if (email) {
    const j = await sq(cfg, "/v2/customers/search", {
      method: "POST",
      body: { query: { filter: { email_address: { exact: email } } }, limit: 1 },
    });
    if (j.customers && j.customers[0]) return j.customers[0];
  }
  return null;
}

async function createCustomer(cfg, { name, phone, email, note }) {
  const parts = String(name || "").trim().split(/\s+/);
  const given = parts.shift() || "";
  const family = parts.join(" ");
  const j = await sq(cfg, "/v2/customers", {
    method: "POST",
    body: {
      idempotency_key: uuid(),
      given_name: given || undefined,
      family_name: family || undefined,
      email_address: email || undefined,
      phone_number: phone || undefined,
      note: note ? String(note).slice(0, 500) : undefined,
    },
  });
  return j.customer;
}

async function findOrCreateCustomer(cfg, person) {
  const found = await findCustomer(cfg, person);
  if (found) return { customer: found, created: false };
  const customer = await createCustomer(cfg, person);
  return { customer, created: true };
}

/* ---------------------------------------------------------------- Bookings */
async function createBooking(cfg, { customerId, startAt, serviceVariationId, serviceVariationVersion, teamMemberId, durationMinutes, customerNote, sellerNote }) {
  const segment = {
    team_member_id: teamMemberId,
    service_variation_id: serviceVariationId,
    duration_minutes: durationMinutes || 60,
  };
  if (serviceVariationVersion) segment.service_variation_version = serviceVariationVersion;
  const j = await sq(cfg, "/v2/bookings", {
    method: "POST",
    body: {
      idempotency_key: uuid(),
      booking: {
        location_id: cfg.locationId,
        start_at: startAt,
        customer_id: customerId || undefined,
        customer_note: customerNote ? String(customerNote).slice(0, 1500) : undefined,
        seller_note: sellerNote ? String(sellerNote).slice(0, 1500) : undefined,
        appointment_segments: [segment],
      },
    },
  });
  return j.booking;
}

async function listBookings(cfg, { limit = 30 } = {}) {
  const params = new URLSearchParams({
    location_id: cfg.locationId,
    limit: String(Math.min(Math.max(Number(limit) || 30, 1), 100)),
    start_at_min: new Date().toISOString(),
  });
  const j = await sq(cfg, "/v2/bookings?" + params.toString());
  return (j.bookings || []).map((b) => {
    const seg = (b.appointment_segments || [])[0] || {};
    return {
      id: b.id,
      status: b.status || "",
      startAt: b.start_at || null,
      customerId: b.customer_id || null,
      customerNote: b.customer_note || "",
      sellerNote: b.seller_note || "",
      durationMinutes: seg.duration_minutes || null,
    };
  });
}

/* ----------------------------------------------- Free-text time → RFC3339 */
/**
 * Resolve a concrete UTC start time from an optional exact date + time, or a
 * best-effort parse of the free-text "preferred day/time". Returns an RFC3339
 * string in the future, or null if nothing usable/valid was provided.
 */
function resolveStartAt({ date, time, prefText }) {
  // 1) Structured date (+ optional time) from the exact-time picker.
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const t = /^\d{2}:\d{2}$/.test(time || "") ? time : "10:00";
    const d = new Date(`${date}T${t}:00`);
    if (!isNaN(d.getTime()) && d.getTime() > Date.now()) return d.toISOString();
  }
  // 2) Best-effort parse of the free-text field (handles "2025-07-10 2pm", ISO,
  //    "July 10 2025", etc. that Date can understand). Vague text yields null.
  if (prefText) {
    const d = new Date(prefText);
    if (!isNaN(d.getTime()) && d.getTime() > Date.now()) return d.toISOString();
  }
  return null;
}

/**
 * Create a hosted Square Checkout payment link for a deposit / no-show hold.
 * PCI stays entirely with Square — we only ever hold a URL. Returns the link
 * URL, the Square order id (to poll for payment), and the payment-link id.
 */
async function createPaymentLink(cfg, { amount, name, note, redirectUrl }) {
  const cents = Math.round(Math.max(0.5, Number(amount) || 0) * 100);
  const body = {
    idempotency_key: crypto.randomUUID(),
    quick_pay: {
      name: String(name || "Grooming deposit").slice(0, 255),
      price_money: { amount: cents, currency: "USD" },
      location_id: cfg.locationId,
    },
    description: String(note || "").slice(0, 255),
  };
  if (redirectUrl) body.checkout_options = { redirect_url: String(redirectUrl).slice(0, 800) };
  const out = await sq(cfg, "/v2/online-checkout/payment-links", { method: "POST", body });
  const pl = out.payment_link || {};
  return { url: pl.url || "", orderId: pl.order_id || "", id: pl.id || "" };
}

/**
 * Poll a Square order to see whether the deposit link has been paid.
 * Returns { paid, state, paidAmount } — paid is true once Square marks the
 * order COMPLETED or the balance due reaches zero on a non-zero order.
 */
async function getOrderPaid(cfg, orderId) {
  if (!orderId) return { paid: false, state: "", paidAmount: 0 };
  const out = await sq(cfg, "/v2/orders/batch-retrieve", {
    method: "POST",
    body: { order_ids: [orderId] },
  });
  const order = (out.orders && out.orders[0]) || {};
  const total = (order.total_money && order.total_money.amount) || 0;
  const due = order.net_amount_due_money ? order.net_amount_due_money.amount : total;
  const tenderPaid = (order.tenders || []).reduce((s, t) => s + ((t.amount_money && t.amount_money.amount) || 0), 0);
  const paid = order.state === "COMPLETED" || (total > 0 && due === 0) || (total > 0 && tenderPaid >= total);
  const paidCents = tenderPaid || (paid ? total : 0);
  return { paid, state: order.state || "", paidAmount: Math.round(paidCents) / 100 };
}

module.exports = {
  DEFAULT_VERSION,
  enabled,
  listLocations,
  listTeamMembers,
  listServices,
  findCustomer,
  createCustomer,
  findOrCreateCustomer,
  createBooking,
  listBookings,
  resolveStartAt,
  createPaymentLink,
  getOrderPaid,
};
