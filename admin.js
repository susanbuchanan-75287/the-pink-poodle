/* The Pink Poodle — Salon Console
 * Photo gallery management, CRM, messaging (phone deep-links) & settings.
 * Messages are composed on the staff phone via sms:/mailto: links; every send
 * is logged to the backend so we can later flip on automated server delivery.
 */

const ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleApi';
const MAX_BYTES = 8 * 1024 * 1024;
const SALON = 'The Pink Poodle';
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent);

const DEFAULTS = {
  pickupTemplate: 'Hi {name}! 🐩 {dog} is all fluffed, pampered & ready for pickup at The Pink Poodle. See you soon! 🩷',
  promoTemplate: "Hi {name}! 🩷 The Pink Poodle has openings this week — text 304-921-2748 to book {dog}'s next spa day! ✨🐩",
  invoiceTemplate: 'Hi {name}! 🧾 Your grooming total for {dog} is ${amount}. Easy pay via {paytype}: {handle}. Thank you for choosing The Pink Poodle! 🩷',
};

let KEY = '';
let customers = [];
let settings = {};
let msgCtx = null; // { type, cust }

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
function setStatus(el, msg, kind) { el.className = 'status show ' + (kind || 'info'); el.innerHTML = msg; }
function clr(el) { el.className = 'status'; el.innerHTML = ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function api(action, payload = {}) {
  return fetch(ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, adminKey: KEY, ...payload }),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Request failed (' + res.status + ')'));
    return data;
  });
}

function normPhone(p) {
  const d = String(p || '').replace(/[^\d]/g, '');
  if (!d) return '';
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return '+' + d;
}
function smsLink(phone, body) { const sep = isIOS ? '&' : '?'; return 'sms:' + normPhone(phone) + sep + 'body=' + encodeURIComponent(body); }
function mailtoLink(to, subject, body) { return 'mailto:' + encodeURIComponent(to || '') + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }
function mailtoBcc(list, subject, body) { return 'mailto:?bcc=' + encodeURIComponent(list.join(',')) + '&subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body); }

function firstDog(c) { return (c.dogs && c.dogs[0] && c.dogs[0].name) || 'your pup'; }
function fill(tpl, c, amount) {
  return String(tpl || '')
    .replace(/{name}/g, (c.name || '').split(' ')[0] || 'there')
    .replace(/{dog}/g, firstDog(c))
    .replace(/{amount}/g, amount != null ? Number(amount).toFixed(2) : '{amount}')
    .replace(/{handle}/g, settings.payHandle || '')
    .replace(/{paytype}/g, settings.payType || 'us')
    .replace(/{salon}/g, SALON);
}

/* ---------- login ---------- */
const loginCard = $('loginCard');
loginCard.addEventListener('submit', async (e) => {
  e.preventDefault();
  KEY = $('adminKey').value.trim();
  if (!KEY) return setStatus($('loginStatus'), 'Enter your passphrase.', 'err');
  setStatus($('loginStatus'), '<span class="spin"></span>Unlocking…', 'info');
  try {
    const r = await api('settingsGet');
    settings = Object.assign({}, DEFAULTS, r.settings || {});
    if ($('remember').checked) localStorage.setItem('pp_key', KEY);
    loginCard.classList.add('hidden');
    $('console').classList.remove('hidden');
    initConsole();
  } catch (err) {
    setStatus($('loginStatus'), '❌ ' + err.message, 'err');
  }
});

$('logout').addEventListener('click', (e) => { e.preventDefault(); localStorage.removeItem('pp_key'); location.reload(); });

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== t.dataset.tab));
  if (t.dataset.tab === 'gallery') loadGallery();
  if (t.dataset.tab === 'customers') loadCustomers();
  if (t.dataset.tab === 'messages') loadHistory();
}));

function initConsole() {
  loadGallery();
  loadCustomers();
  // settings into form
  $('payType').value = settings.payType || '';
  $('payHandle').value = settings.payHandle || '';
  $('payNote').value = settings.payNote || '';
  $('pickupTemplate').value = settings.pickupTemplate || DEFAULTS.pickupTemplate;
  $('promoTemplate').value = settings.promoTemplate || DEFAULTS.promoTemplate;
  $('invoiceTemplate').value = settings.invoiceTemplate || DEFAULTS.invoiceTemplate;
}

/* ================= GALLERY ================= */
const fileInput = $('photo'), drop = $('drop'), dropText = $('dropText'), preview = $('preview'), previewImg = $('previewImg');
let chosenFile = null;

function chooseFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) return setStatus($('uploadStatus'), 'Please choose an image file.', 'err');
  if (file.size > MAX_BYTES) return setStatus($('uploadStatus'), 'That image is over 8 MB — pick a smaller one.', 'err');
  chosenFile = file;
  const r = new FileReader();
  r.onload = () => { previewImg.src = r.result; preview.style.display = 'block'; dropText.innerHTML = '✅ <strong>' + esc(file.name) + '</strong><br />tap to choose a different photo'; };
  r.readAsDataURL(file);
  clr($('uploadStatus'));
}
fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));
['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]); });

function toBase64(file) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = rej; r.readAsDataURL(file); }); }

$('uploadForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!chosenFile) return setStatus($('uploadStatus'), 'Choose a photo first.', 'err');
  $('uploadBtn').disabled = true;
  setStatus($('uploadStatus'), '<span class="spin"></span>Uploading &amp; publishing… up to a minute.', 'info');
  try {
    const imageBase64 = await toBase64(chosenFile);
    const data = await api('uploadPhoto', {
      imageBase64, filename: chosenFile.name, contentType: chosenFile.type,
      dogName: $('dogName').value.trim(), breed: $('breed').value.trim(),
      caption: $('caption').value.trim(), postToFacebook: $('toFacebook').checked,
    });
    let msg = '🎉 <strong>Published!</strong> Live on the gallery in about a minute.';
    if (data.facebook === 'posted') msg += '<br />📘 Also posted to Facebook.';
    setStatus($('uploadStatus'), msg, 'ok');
    chosenFile = null; fileInput.value = ''; preview.style.display = 'none';
    $('dogName').value = ''; $('breed').value = ''; $('caption').value = '';
    dropText.innerHTML = '📷 <strong>Tap to choose a photo</strong><br />or drag &amp; drop it here';
    setTimeout(loadGallery, 1500);
  } catch (err) {
    setStatus($('uploadStatus'), '❌ ' + err.message, 'err');
  } finally { $('uploadBtn').disabled = false; }
});

$('reloadGallery').addEventListener('click', loadGallery);
async function loadGallery() {
  const box = $('galleryManage');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { items } = await api('listGallery');
    if (!items.length) { box.innerHTML = '<p class="muted">No photos yet.</p>'; return; }
    box.innerHTML = '';
    items.forEach((it) => {
      const fig = document.createElement('figure');
      fig.className = 'gtile';
      fig.innerHTML = '<button class="del" title="Remove">🗑</button><img loading="lazy" src="' + esc(it.src) + '" alt="' + esc(it.caption || '') + '" />' + (it.caption ? '<figcaption>' + esc(it.caption) + '</figcaption>' : '');
      fig.querySelector('.del').addEventListener('click', async () => {
        if (!confirm('Remove this photo from the website?')) return;
        fig.style.opacity = '.4';
        try { await api('deletePhoto', { src: it.src }); fig.remove(); }
        catch (err) { alert('Delete failed: ' + err.message); fig.style.opacity = '1'; }
      });
      box.appendChild(fig);
    });
  } catch (err) { box.innerHTML = '<p class="status show err">' + esc(err.message) + '</p>'; }
}

/* ================= CUSTOMERS ================= */
$('reloadGallery'); // noop guard
$('custSearch').addEventListener('input', renderCustomers);
$('newCustomer').addEventListener('click', () => openEditor(null));

async function loadCustomers() {
  const box = $('custList');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try { const r = await api('crmList'); customers = r.customers || []; renderCustomers(); }
  catch (err) { box.innerHTML = '<p class="status show err">' + esc(err.message) + '</p>'; }
}

function renderCustomers() {
  const q = $('custSearch').value.trim().toLowerCase();
  const box = $('custList');
  const list = customers.filter((c) => {
    if (!q) return true;
    const hay = [c.name, c.phone, c.email, ...(c.dogs || []).map((d) => d.name + ' ' + d.breed)].join(' ').toLowerCase();
    return hay.includes(q);
  });
  if (!list.length) { box.innerHTML = '<p class="muted">No customers ' + (q ? 'match your search.' : 'yet — tap ＋ New.') + '</p>'; return; }
  box.innerHTML = '';
  list.forEach((c) => {
    const div = document.createElement('div');
    div.className = 'cust';
    const dogs = (c.dogs || []).map((d) => '<span class="chip">🐾 ' + esc(d.name) + (d.breed ? ' · ' + esc(d.breed) : '') + '</span>').join('');
    const bal = c.balance > 0 ? '<span class="bal bal--owed">Owes $' + c.balance.toFixed(2) + '</span>' : '<span class="bal bal--clear">Paid up</span>';
    div.innerHTML =
      '<div class="cust__top"><div><div class="cust__name">' + esc(c.name || 'Unnamed') + '</div>' +
      '<div class="cust__contact">' + (c.phone ? '<a href="tel:' + esc(normPhone(c.phone)) + '">📞 ' + esc(c.phone) + '</a>' : '') + (c.email ? ' · <a href="mailto:' + esc(c.email) + '">✉️</a>' : '') + '</div></div>' + bal + '</div>' +
      (dogs ? '<div class="chips">' + dogs + '</div>' : '') +
      '<div class="cust__actions">' +
      '<button class="mini" data-a="pickup">💬 Ready</button>' +
      '<button class="mini" data-a="promo">🎀 Promo</button>' +
      '<button class="mini" data-a="invoice">🧾 Invoice</button>' +
      '<button class="mini" data-a="edit">✏️ Edit</button>' +
      '</div>';
    div.querySelector('[data-a="pickup"]').addEventListener('click', () => openMsg('pickup', c));
    div.querySelector('[data-a="promo"]').addEventListener('click', () => openMsg('promo', c));
    div.querySelector('[data-a="invoice"]').addEventListener('click', () => openMsg('invoice', c));
    div.querySelector('[data-a="edit"]').addEventListener('click', () => openEditor(c));
    box.appendChild(div);
  });
}

/* ---- customer editor modal ---- */
const custModal = $('custModal');
function dogRow(d = {}) {
  const row = document.createElement('div');
  row.className = 'dogrow';
  row.innerHTML = '<input type="text" placeholder="Name" value="' + esc(d.name || '') + '" /><input type="text" placeholder="Breed" value="' + esc(d.breed || '') + '" /><button class="mini mini--danger" type="button">✕</button>';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}
let editNotes = [];
function renderNotes() {
  const box = $('noteList'); box.innerHTML = '';
  editNotes.forEach((n, i) => {
    const el = document.createElement('div'); el.className = 'note';
    el.innerHTML = esc(n.text) + '<small>' + esc((n.ts || '').slice(0, 10)) + '</small>';
    el.addEventListener('dblclick', () => { if (confirm('Delete this note?')) { editNotes.splice(i, 1); renderNotes(); } });
    box.appendChild(el);
  });
}
function openEditor(c) {
  c = c || { dogs: [], notes: [] };
  $('custModalTitle').textContent = c.id ? 'Edit customer' : 'New customer';
  $('cId').value = c.id || '';
  $('cName').value = c.name || ''; $('cPhone').value = c.phone || ''; $('cEmail').value = c.email || ''; $('cAddress').value = c.address || '';
  $('dogRows').innerHTML = '';
  (c.dogs && c.dogs.length ? c.dogs : [{}]).forEach((d) => $('dogRows').appendChild(dogRow(d)));
  editNotes = (c.notes || []).slice();
  renderNotes();
  $('deleteCustomer').style.display = c.id ? '' : 'none';
  clr($('custModalStatus'));
  custModal.classList.add('open');
}
$('addDog').addEventListener('click', () => $('dogRows').appendChild(dogRow()));
$('addNote').addEventListener('click', () => { const v = $('newNote').value.trim(); if (!v) return; editNotes.unshift({ text: v, ts: new Date().toISOString() }); $('newNote').value = ''; renderNotes(); });
$('cancelCustomer').addEventListener('click', () => custModal.classList.remove('open'));
custModal.addEventListener('click', (e) => { if (e.target === custModal) custModal.classList.remove('open'); });

$('saveCustomer').addEventListener('click', async () => {
  const dogs = Array.from($('dogRows').querySelectorAll('.dogrow')).map((r) => {
    const [n, b] = r.querySelectorAll('input'); return { name: n.value.trim(), breed: b.value.trim() };
  }).filter((d) => d.name || d.breed);
  const customer = {
    id: $('cId').value || undefined,
    name: $('cName').value.trim(), phone: $('cPhone').value.trim(), email: $('cEmail').value.trim(), address: $('cAddress').value.trim(),
    dogs, notes: editNotes,
  };
  if (!customer.name && !customer.phone) return setStatus($('custModalStatus'), 'Add at least a name or phone.', 'err');
  setStatus($('custModalStatus'), '<span class="spin"></span>Saving…', 'info');
  try { await api('crmSave', { customer }); custModal.classList.remove('open'); loadCustomers(); }
  catch (err) { setStatus($('custModalStatus'), '❌ ' + err.message, 'err'); }
});
$('deleteCustomer').addEventListener('click', async () => {
  const id = $('cId').value; if (!id) return;
  if (!confirm('Delete this customer permanently?')) return;
  try { await api('crmDelete', { id }); custModal.classList.remove('open'); loadCustomers(); }
  catch (err) { setStatus($('custModalStatus'), '❌ ' + err.message, 'err'); }
});

/* ================= COMPOSE MESSAGE ================= */
const msgModal = $('msgModal');
const amountWrap = $('msgAmount').closest('.field');
function composeBody() {
  const c = msgCtx.cust, t = msgCtx.type;
  const amt = t === 'invoice' ? parseFloat($('msgAmount').value || '0') : null;
  const tpl = t === 'pickup' ? (settings.pickupTemplate || DEFAULTS.pickupTemplate)
    : t === 'promo' ? (settings.promoTemplate || DEFAULTS.promoTemplate)
      : (settings.invoiceTemplate || DEFAULTS.invoiceTemplate);
  return fill(tpl, c, amt);
}
function openMsg(type, cust) {
  msgCtx = { type, cust };
  $('msgTitle').textContent = { pickup: '💬 Ready for pickup', promo: '🎀 Promo', invoice: '🧾 Invoice' }[type] + ' · ' + (cust.name || '');
  amountWrap.style.display = type === 'invoice' ? '' : 'none';
  $('msgAmount').value = cust.balance > 0 ? cust.balance.toFixed(2) : '';
  $('msgBody').value = composeBody();
  clr($('msgStatus'));
  msgModal.classList.add('open');
}
$('msgAmount').addEventListener('input', () => { $('msgBody').value = composeBody(); });
$('closeMsg').addEventListener('click', () => msgModal.classList.remove('open'));
msgModal.addEventListener('click', (e) => { if (e.target === msgModal) msgModal.classList.remove('open'); });

async function afterSend(channel) {
  const c = msgCtx.cust, t = msgCtx.type;
  const amount = t === 'invoice' ? parseFloat($('msgAmount').value || '0') : null;
  try { await api('logMessage', { customerId: c.id, type: t, channel, body: $('msgBody').value, amount }); } catch (_) {}
  setStatus($('msgStatus'), '✅ Opened in your ' + (channel === 'sms' ? 'Messages' : 'Mail') + ' app & logged.', 'ok');
  loadCustomers();
}
$('sendText').addEventListener('click', () => {
  const c = msgCtx.cust;
  if (!c.phone) return setStatus($('msgStatus'), 'No phone number on file for this customer.', 'err');
  window.location.href = smsLink(c.phone, $('msgBody').value);
  afterSend('sms');
});
$('sendEmail').addEventListener('click', () => {
  const c = msgCtx.cust;
  if (!c.email) return setStatus($('msgStatus'), 'No email on file for this customer.', 'err');
  const subj = { pickup: SALON + ' — ' + firstDog(c) + ' is ready! 🐩', promo: SALON + ' — a little treat for you 🩷', invoice: SALON + ' — your grooming invoice 🧾' }[msgCtx.type];
  window.location.href = mailtoLink(c.email, subj, $('msgBody').value);
  afterSend('email');
});

/* ================= MESSAGES TAB ================= */
$('blastEmail').addEventListener('click', async () => {
  const body = $('blastBody').value.trim();
  if (!body) return setStatus($('blastStatus'), 'Write your message first.', 'err');
  const emails = customers.map((c) => c.email).filter(Boolean);
  if (!emails.length) return setStatus($('blastStatus'), 'No customer emails on file yet.', 'err');
  window.location.href = mailtoBcc(emails, SALON + ' 🩷', body);
  try { await api('logMessage', { customerId: null, type: 'promo', channel: 'email', body }); } catch (_) {}
  setStatus($('blastStatus'), '✅ Opened your Mail app to ' + emails.length + ' customers (BCC) & logged.', 'ok');
});
$('reloadHistory').addEventListener('click', loadHistory);
async function loadHistory() {
  const box = $('historyList'); box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { messages } = await api('messageHistory');
    if (!messages.length) { box.innerHTML = '<p class="muted">No messages sent yet.</p>'; return; }
    const nameById = {}; customers.forEach((c) => nameById[c.id] = c.name);
    box.innerHTML = messages.map((m) => {
      const icon = { pickup: '💬', promo: '🎀', invoice: '🧾' }[m.type] || '•';
      const who = m.customerId ? (nameById[m.customerId] || 'Customer') : 'Everyone';
      return '<div class="note">' + icon + ' <strong>' + esc(who) + '</strong> · ' + esc(m.channel) + (m.amount ? ' · $' + Number(m.amount).toFixed(2) : '') + '<br />' + esc((m.body || '').slice(0, 120)) + '<small>' + esc((m.ts || '').slice(0, 16).replace('T', ' ')) + '</small></div>';
    }).join('');
  } catch (err) { box.innerHTML = '<p class="status show err">' + esc(err.message) + '</p>'; }
}

/* ================= SETTINGS ================= */
$('settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const s = {
    payType: $('payType').value, payHandle: $('payHandle').value.trim(), payNote: $('payNote').value.trim(),
    pickupTemplate: $('pickupTemplate').value.trim(), promoTemplate: $('promoTemplate').value.trim(), invoiceTemplate: $('invoiceTemplate').value.trim(),
  };
  $('settingsBtn').disabled = true;
  setStatus($('settingsStatus'), '<span class="spin"></span>Saving…', 'info');
  try { const r = await api('settingsSave', { settings: s }); settings = Object.assign({}, DEFAULTS, r.settings); setStatus($('settingsStatus'), '✅ Saved.', 'ok'); }
  catch (err) { setStatus($('settingsStatus'), '❌ ' + err.message, 'err'); }
  finally { $('settingsBtn').disabled = false; }
});

/* ---------- auto sign-in ---------- */
(function () {
  const saved = localStorage.getItem('pp_key');
  if (saved) { $('adminKey').value = saved; loginCard.requestSubmit(); }
})();
