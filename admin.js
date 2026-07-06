/* The Pink Poodle — Salon Console
 * Photo gallery management, CRM, messaging (phone deep-links) & settings.
 * Messages are composed on the staff phone via sms:/mailto: links; every send
 * is logged to the backend so we can later flip on automated server delivery.
 */

const ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleApi';
const RESET_ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleReset';
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
let editCust = null; // customer currently open in the editor
let squareConnected = null; // cached Square connection status (null = unknown)

/* ---------- helpers ---------- */
const $ = (id) => document.getElementById(id);
function setStatus(el, msg, kind) { el.className = 'status show ' + (kind || 'info'); el.innerHTML = msg; }
function clr(el) { el.className = 'status'; el.innerHTML = ''; }
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg) {
  let el = $('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:1.2rem;transform:translateX(-50%);z-index:200;background:#3a2230;color:#fff;padding:.75rem 1rem;border-radius:999px;box-shadow:var(--shadow);font:600 .86rem var(--sans);max-width:min(92vw,520px);text-align:center;opacity:0;transition:opacity .2s ease';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.opacity = '0'; }, 4200);
}

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

function resetApi(action, payload = {}) {
  return fetch(RESET_ENDPOINT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
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

/* ---------- forgot / reset passphrase ---------- */
$('forgotLink').addEventListener('click', async (e) => {
  e.preventDefault();
  if (!confirm('Email a reset link to the salon owner and backup admin?')) return;
  setStatus($('loginStatus'), '<span class="spin"></span>Sending reset link…', 'info');
  try {
    await resetApi('requestReset');
    setStatus($('loginStatus'), '✅ A reset link is on its way to the salon &amp; backup admin email. It expires in 30 minutes.', 'ok');
  } catch (err) {
    setStatus($('loginStatus'), '❌ ' + err.message, 'err');
  }
});

// If opened from an emailed reset link (?reset=TOKEN), show the reset form.
const resetToken = new URLSearchParams(location.search).get('reset');
if (resetToken) {
  loginCard.classList.add('hidden');
  $('resetCard').classList.remove('hidden');
  $('resetCard').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p1 = $('newPass').value.trim(), p2 = $('newPass2').value.trim();
    const pin = $('resetPin').value.trim();
    if (p1.length < 8) return setStatus($('resetStatus'), 'Passphrase must be at least 8 characters.', 'err');
    if (p1 !== p2) return setStatus($('resetStatus'), 'The two passphrases don\'t match.', 'err');
    if (pin && !/^\d{4,8}$/.test(pin)) return setStatus($('resetStatus'), 'Stylist PIN must be 4–8 digits (or leave it blank).', 'err');
    setStatus($('resetStatus'), '<span class="spin"></span>Saving…', 'info');
    try {
      await resetApi('applyReset', { token: resetToken, newPassphrase: p1, newPin: pin });
      localStorage.removeItem('pp_key');
      setStatus($('resetStatus'), '✅ Updated' + (pin ? ' (passphrase + stylist PIN)' : '') + '! Redirecting to sign in…', 'ok');
      setTimeout(() => { location.href = 'admin.html'; }, 1800);
    } catch (err) {
      setStatus($('resetStatus'), '❌ ' + err.message, 'err');
    }
  });
}

/* ---------- tabs ---------- */
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((x) => x.classList.remove('active'));
  t.classList.add('active');
  document.querySelectorAll('[data-panel]').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== t.dataset.tab));
  if (t.dataset.tab === 'gallery') loadGallery();
  if (t.dataset.tab === 'customers') loadCustomers();
  if (t.dataset.tab === 'messages') { loadHistory(); loadPushCount(); loadSmsCount(); }
  if (t.dataset.tab === 'staff') loadStaff();
  if (t.dataset.tab === 'square') loadSquare();
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
  loadSmsCount();
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

/* Camera capture — live in-page camera (getUserMedia) with native-camera fallback */
const cam = $('cam'), camVideo = $('camVideo'), camCanvas = $('camCanvas'), cameraInput = $('cameraInput');
let camStream = null, camFacing = 'environment';
function stopCamera() {
  if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; }
  camVideo.srcObject = null;
  cam.classList.remove('open');
}
async function openCamera() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { cameraInput.click(); return; }
  try {
    stopCamera();
    camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: camFacing }, audio: false });
    camVideo.srcObject = camStream;
    cam.classList.add('open');
    clr($('uploadStatus'));
  } catch (err) {
    setStatus($('uploadStatus'), 'Camera unavailable — opening your photo picker instead.', 'info');
    cameraInput.click();
  }
}
function snapPhoto() {
  const w = camVideo.videoWidth, h = camVideo.videoHeight;
  if (!w || !h) return;
  camCanvas.width = w; camCanvas.height = h;
  camCanvas.getContext('2d').drawImage(camVideo, 0, 0, w, h);
  camCanvas.toBlob((blob) => {
    if (!blob) return;
    stopCamera();
    chooseFile(new File([blob], 'camera-' + Date.now() + '.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.9);
}
$('cameraBtn').addEventListener('click', openCamera);
$('camSnap').addEventListener('click', snapPhoto);
$('camCancel').addEventListener('click', stopCamera);
$('camFlip').addEventListener('click', () => { camFacing = camFacing === 'environment' ? 'user' : 'environment'; openCamera(); });
cameraInput.addEventListener('change', () => chooseFile(cameraInput.files[0]));

// Share the live site to Facebook (no token/app needed — Facebook scrapes the
// site's Open Graph cover photo + description). Lets Britni pick The Pink Poodle
// Page or her timeline in the dialog. Auto-post via API is the toFacebook toggle.
const shareFacebook = $('shareFacebook');
if (shareFacebook) shareFacebook.addEventListener('click', () => {
  const url = 'https://thepinkpoodle.dog/?utm_source=facebook&utm_medium=share&utm_campaign=admin_share';
  const share = 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(url);
  window.open(share, 'ppFbShare', 'width=680,height=640,menubar=no,toolbar=no');
});

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
    const textOptedOut = !!c.smsOptOutAt || c.smsOptIn === false;
    const textBadge = textOptedOut ? '<span class="chip chip--muted">opted out of texts</span>' : '';
    const bal = c.balance > 0 ? '<span class="bal bal--owed">Owes $' + c.balance.toFixed(2) + '</span>' : '<span class="bal bal--clear">Paid up</span>';
    const phoneList = (c.phones && c.phones.length) ? c.phones : (c.phone ? [{ type: 'Mobile', number: c.phone }] : []);
    const phoneLinks = phoneList.map((p) => '<a href="tel:' + esc(normPhone(p.number)) + '">📞 ' + esc(p.number) + '<span class="muted"> ' + esc(p.type || '') + '</span></a>').join(' · ');
    div.innerHTML =
      '<div class="cust__top"><div><div class="cust__name">' + esc(c.name || 'Unnamed') + '</div>' +
      '<div class="cust__contact">' + phoneLinks + (c.email ? (phoneLinks ? ' · ' : '') + '<a href="mailto:' + esc(c.email) + '">✉️</a>' : '') + '</div></div>' + bal + '</div>' +
      (dogs || textBadge ? '<div class="chips">' + dogs + textBadge + '</div>' : '') +
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
const PHONE_TYPES = ['Mobile', 'Mobile 2', 'Home', 'Work', 'Other'];
function phoneRow(p = {}) {
  const row = document.createElement('div');
  row.className = 'phonerow';
  row.style.cssText = 'display:flex;gap:.4rem;margin-bottom:.4rem;align-items:center';
  const type = p.type || 'Mobile';
  const opts = PHONE_TYPES.concat(PHONE_TYPES.indexOf(type) < 0 && type ? [type] : [])
    .map((t) => '<option' + (t === type ? ' selected' : '') + '>' + esc(t) + '</option>').join('');
  row.innerHTML = '<select style="flex:0 0 auto;min-width:96px">' + opts + '</select>' +
    '<input type="tel" placeholder="304-555-1234" value="' + esc(p.number || '') + '" style="flex:1" />' +
    '<button class="mini mini--danger" type="button" title="Remove">✕</button>';
  row.querySelector('button').addEventListener('click', () => row.remove());
  return row;
}
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
  editCust = c;
  $('custModalTitle').textContent = c.id ? 'Edit customer' : 'New customer';
  $('cId').value = c.id || '';
  $('cName').value = c.name || ''; $('cEmail').value = c.email || ''; $('cAddress').value = c.address || '';
  $('cSmsOptIn').checked = c.id ? (!c.smsOptOutAt && c.smsOptIn !== false) : true;
  $('cSmsOptNote').dataset.hardOpt = c.smsOptOutAt ? '1' : '';
  $('cSmsOptNote').textContent = c.smsOptOutAt
    ? 'This customer opted out by text on ' + String(c.smsOptOutAt).slice(0, 10) + '. Check the box only if they explicitly asked to opt back in.'
    : (c.smsOptIn === false ? 'This customer is marked not OK for promo texts.' : 'Promo blasts only go to opted-in customers.');
  $('phoneRows').innerHTML = '';
  const ph = (c.phones && c.phones.length) ? c.phones
    : (c.phone ? [{ type: 'Mobile', number: c.phone }] : [{ type: 'Mobile' }, { type: 'Mobile 2' }, { type: 'Home' }]);
  ph.forEach((p) => $('phoneRows').appendChild(phoneRow(p)));
  $('dogRows').innerHTML = '';
  (c.dogs && c.dogs.length ? c.dogs : [{}]).forEach((d) => $('dogRows').appendChild(dogRow(d)));
  editNotes = (c.notes || []).slice();
  renderNotes();
  $('deleteCustomer').style.display = c.id ? '' : 'none';
  resetVisitForm(c);
  loadVisits(c);
  updateSquareBtn();
  clr($('custModalStatus'));
  custModal.classList.add('open');
}
$('addDog').addEventListener('click', () => $('dogRows').appendChild(dogRow()));
$('addPhone').addEventListener('click', () => $('phoneRows').appendChild(phoneRow()));
$('addNote').addEventListener('click', () => { const v = $('newNote').value.trim(); if (!v) return; editNotes.unshift({ text: v, ts: new Date().toISOString() }); $('newNote').value = ''; renderNotes(); });
$('cancelCustomer').addEventListener('click', () => custModal.classList.remove('open'));
custModal.addEventListener('click', (e) => { if (e.target === custModal) custModal.classList.remove('open'); });

$('saveCustomer').addEventListener('click', async () => {
  const dogs = Array.from($('dogRows').querySelectorAll('.dogrow')).map((r) => {
    const [n, b] = r.querySelectorAll('input'); return { name: n.value.trim(), breed: b.value.trim() };
  }).filter((d) => d.name || d.breed);
  const phones = Array.from($('phoneRows').querySelectorAll('.phonerow')).map((r) => {
    return { type: r.querySelector('select').value, number: r.querySelector('input').value.trim() };
  }).filter((p) => p.number);
  const customer = {
    id: $('cId').value || undefined,
    name: $('cName').value.trim(), phones, email: $('cEmail').value.trim(), address: $('cAddress').value.trim(),
    dogs, notes: editNotes, smsOptIn: $('cSmsOptIn').checked,
  };
  if (!customer.name && !phones.length) return setStatus($('custModalStatus'), 'Add at least a name or phone.', 'err');
  if ($('cSmsOptNote').dataset.hardOpt === '1' && customer.smsOptIn && !confirm('This customer previously opted out by text. Re-enable promo texts only if they explicitly asked to opt back in.\n\nMark OK to text promotions?')) return;
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

/* ---------- visit history (from real grooming tickets, matched by phone) ---------- */
function custPhones(c) {
  const list = (c && c.phones && c.phones.length) ? c.phones.map((p) => p.number) : [];
  if (c && c.phone) list.push(c.phone);
  return [...new Set(list.filter(Boolean))];
}
function resetVisitForm(c) {
  $('vDate').value = new Date().toISOString().slice(0, 10);
  $('vPet').value = (c && c.dogs && c.dogs[0] && c.dogs[0].name) || '';
  $('vServices').value = ''; $('vStylist').value = ''; $('vTotal').value = ''; $('vTip').value = '';
  $('vPay').value = ''; $('vNotes').value = '';
  clr($('visitStatus'));
  const wrap = $('addVisitWrap'); if (wrap) wrap.open = false;
  const noPhone = !custPhones(c).length;
  $('saveVisit').disabled = noPhone;
  $('saveVisit').title = noPhone ? 'Add a phone number and save the customer first' : '';
}
function stepLabel(v) {
  if (v.voided) return '<span class="chip chip--muted">voided</span>';
  if (v.cancelled) return '<span class="chip chip--muted">cancelled</span>';
  if (v.step >= 6 || v.paid) return '';
  return '<span class="chip">in progress</span>';
}
function renderVisits(visits) {
  const box = $('visitList');
  const active = visits.filter((v) => !v.voided);
  $('visitCount').textContent = active.length ? '· ' + active.length + ' visit' + (active.length === 1 ? '' : 's') : '';
  if (!visits.length) { box.innerHTML = '<p class="muted">No grooming visits on file yet for this customer.</p>'; return; }
  box.innerHTML = visits.map((v) => {
    const dollars = v.total || v.est || 0;
    const money = dollars ? '$' + dollars.toFixed(2) + (v.paid ? '' : ' <span class="muted">(est)</span>') : '';
    const svc = (v.services || []).join(', ');
    const sqBtn = squareConnected && !v.squareOrderId && !v.voided && !v.cancelled
      ? '<button class="mini vSquare" data-id="' + esc(v.id) + '" title="Push this sale to Square">→ Square</button>'
      : (v.squareOrderId ? '<span class="chip chip--muted" title="Synced to Square">✓ Square</span>' : '');
    return '<div class="visit" style="border:1px solid var(--line,#f0d3e4);border-radius:12px;padding:.55rem .7rem;margin:.4rem 0">' +
      '<div class="inline" style="justify-content:space-between;gap:.5rem">' +
        '<div><b>' + esc(v.date || '—') + '</b>' + (v.pet && v.pet.name ? ' · 🐾 ' + esc(v.pet.name) : '') + ' ' + stepLabel(v) + '</div>' +
        '<div class="inline" style="gap:.4rem">' + (money ? '<b>' + money + '</b>' : '') + sqBtn + '</div>' +
      '</div>' +
      (svc ? '<div class="muted" style="font-size:.85rem;margin-top:.2rem">' + esc(svc) + '</div>' : '') +
      '<div class="muted" style="font-size:.8rem;margin-top:.15rem">' +
        (v.stylist ? '💇 ' + esc(v.stylist) + ' · ' : '') +
        (v.paid && v.payMethod ? esc(v.payMethod) : '') +
        (v.tip ? ' · tip $' + v.tip.toFixed(2) : '') +
      '</div>' +
      (v.notes ? '<div class="muted" style="font-size:.8rem;margin-top:.15rem">📝 ' + esc(v.notes) + '</div>' : '') +
    '</div>';
  }).join('');
  box.querySelectorAll('.vSquare').forEach((btn) => btn.addEventListener('click', () => syncVisitToSquare(btn.dataset.id, btn)));
}
async function loadVisits(c) {
  const box = $('visitList');
  const phones = custPhones(c);
  if (!c || !c.id || !phones.length) {
    box.innerHTML = '<p class="muted">Save the customer (with a phone number) to see their grooming visits.</p>';
    $('visitCount').textContent = '';
    return;
  }
  box.innerHTML = '<p class="muted"><span class="spin"></span> Loading visits…</p>';
  try {
    const r = await api('crmVisits', { phones });
    renderVisits(r.visits || []);
  } catch (err) {
    box.innerHTML = '<p class="muted">Could not load visits: ' + esc(err.message) + '</p>';
  }
}
$('saveVisit').addEventListener('click', async () => {
  const c = editCust || {};
  const phone = custPhones(c)[0];
  if (!phone) return setStatus($('visitStatus'), 'Add a phone number and save the customer first.', 'err');
  const visit = {
    ownerName: c.name || '', phone, email: c.email || '',
    date: $('vDate').value, petName: $('vPet').value.trim(),
    services: $('vServices').value.trim(), stylist: $('vStylist').value.trim(),
    total: parseFloat($('vTotal').value || '0') || 0, tip: parseFloat($('vTip').value || '0') || 0,
    payMethod: $('vPay').value, notes: $('vNotes').value.trim(),
  };
  if (!visit.petName && !visit.services) return setStatus($('visitStatus'), 'Add at least the pup or what was done.', 'err');
  setStatus($('visitStatus'), '<span class="spin"></span>Saving visit…', 'info');
  try {
    await api('crmAddVisit', { visit });
    setStatus($('visitStatus'), '✅ Visit added to history.', 'ok');
    resetVisitForm(c);
    loadVisits(c);
  } catch (err) { setStatus($('visitStatus'), '❌ ' + err.message, 'err'); }
});

/* ---------- Square sync ---------- */
async function ensureSquare() {
  if (squareConnected !== null) return squareConnected;
  try { const r = await api('squareStatus'); squareConnected = !!(r.square && r.square.connected); }
  catch (_) { squareConnected = false; }
  return squareConnected;
}
async function updateSquareBtn() {
  const btn = $('syncSquareCust');
  const connected = await ensureSquare();
  const show = connected && editCust && editCust.id;
  btn.style.display = show ? '' : 'none';
  // Re-render visits so the per-visit → Square buttons appear once we know status.
  if (connected && editCust && editCust.id) loadVisits(editCust);
}
$('syncSquareCust').addEventListener('click', async () => {
  const c = editCust; if (!c || !c.id) return;
  setStatus($('custModalStatus'), '<span class="spin"></span>Syncing to Square…', 'info');
  try {
    const r = await api('squareSyncCustomer', { customer: { id: c.id, name: c.name, phone: custPhones(c)[0] || '', email: c.email } });
    setStatus($('custModalStatus'), r.created ? '✅ Added to your Square customer directory.' : '✅ Matched an existing Square customer.', 'ok');
  } catch (err) { setStatus($('custModalStatus'), '❌ ' + err.message, 'err'); }
});
async function syncVisitToSquare(id, btn) {
  if (!id) return;
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  try {
    const r = await api('squareSyncVisit', { id });
    setStatus($('visitStatus'), r.warn ? '⚠️ Sale recorded in Square, but ' + r.warn : '✅ Visit pushed to Square.', r.warn ? 'info' : 'ok');
    loadVisits(editCust);
  } catch (err) {
    if (btn) { btn.disabled = false; btn.textContent = '→ Square'; }
    setStatus($('visitStatus'), '❌ ' + err.message, 'err');
  }
}

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
  setStatus($('msgStatus'), '✅ Draft opened in your ' + (channel === 'sms' ? 'Messages' : 'Mail') + ' app — tap Send there to deliver it. (Saved to history.)', 'ok');
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
let smsEligibleCount = 0;
let smsTwilioReady = false;

$('blastEmail').addEventListener('click', async () => {
  const body = $('blastBody').value.trim();
  if (!body) return setStatus($('blastStatus'), 'Write your message first.', 'err');
  const emails = customers.map((c) => c.email).filter(Boolean);
  if (!emails.length) return setStatus($('blastStatus'), 'No customer emails on file yet.', 'err');
  window.location.href = mailtoBcc(emails, SALON + ' 🩷', body);
  try { await api('logMessage', { customerId: null, type: 'promo', channel: 'email', body }); } catch (_) {}
  setStatus($('blastStatus'), '✅ Draft opened in Mail to ' + emails.length + ' customers (BCC — addresses stay private). Tap Send there.', 'ok');
});
$('blastSms').addEventListener('click', async () => {
  const body = $('blastBody').value.trim();
  if (!body) return setStatus($('blastStatus'), 'Write your message first.', 'err');
  const nums = [];
  customers.forEach((c) => {
    const list = (c.phones && c.phones.length) ? c.phones.map((p) => p.number) : (c.phone ? [c.phone] : []);
    list.forEach((n) => { const nn = normPhone(n); if (nn && nums.indexOf(nn) < 0) nums.push(nn); });
  });
  if (!nums.length) return setStatus($('blastStatus'), 'No customer phone numbers on file yet.', 'err');
  // Privacy: a multi-recipient sms: opens ONE group text, so every customer would
  // see each other's numbers. Confirm, and prefer push/BCC-email for real blasts.
  if (nums.length > 1 && !confirm('Heads up: texting ' + nums.length + ' numbers at once opens a single group message, so customers can see each other\u2019s numbers. For a private blast, use Push or Email (BCC) instead.\n\nOpen a group text anyway?')) return;
  // Group texts cap out on most phones (~10–20 recipients); warn past that.
  const sep = isIOS ? '&' : '?';
  window.location.href = 'sms:' + nums.join(',') + sep + 'body=' + encodeURIComponent(body);
  try { await api('logMessage', { customerId: null, type: 'promo', channel: 'sms', body }); } catch (_) {}
  const warn = nums.length > 15 ? ' (⚠️ ' + nums.length + ' numbers — your phone may split this into batches)' : '';
  setStatus($('blastStatus'), '✅ Group-text draft opened to ' + nums.length + ' customers — tap Send there.' + warn, 'ok');
});
$('blastPush').addEventListener('click', async () => {
  const body = $('blastBody').value.trim();
  if (!body) return setStatus($('blastStatus'), 'Write your message first.', 'err');
  if (!confirm('Send this as a push notification to everyone subscribed on the website?')) return;
  setStatus($('blastStatus'), '<span class="spin"></span>Sending push…', 'info');
  try {
    const r = await api('pushBlast', { title: SALON + ' 🩷', body });
    if (!r.count) setStatus($('blastStatus'), 'No push subscribers yet — customers subscribe via “🔔 Get alerts” on the site.', 'info');
    else setStatus($('blastStatus'), '✅ Pushed to ' + r.sent + ' device' + (r.sent === 1 ? '' : 's') + (r.failed ? ' (' + r.failed + ' failed/expired)' : '') + ' & logged.', 'ok');
    loadPushCount();
  } catch (err) { setStatus($('blastStatus'), '❌ ' + err.message, 'err'); }
});
async function loadSmsCount() {
  if (!$('smsCount')) return;
  try {
    const r = await api('smsCount');
    smsEligibleCount = Number(r.count) || 0;
    smsTwilioReady = !!r.twilioReady;
    $('smsCount').textContent = smsEligibleCount;
    $('blastSmsNow').disabled = !smsTwilioReady || !smsEligibleCount;
    $('smsReady').textContent = smsEligibleCount + ' customer' + (smsEligibleCount === 1 ? '' : 's') + ' can receive a text. ' +
      (smsTwilioReady ? 'Twilio text sending is ready.' : "Text sending isn't set up yet — using the device draft instead.");
  } catch (err) {
    smsEligibleCount = 0;
    smsTwilioReady = false;
    $('smsCount').textContent = '0';
    $('blastSmsNow').disabled = true;
    $('smsReady').textContent = 'Text count unavailable: ' + err.message;
  }
}
$('blastSmsNow').addEventListener('click', async () => {
  const body = $('blastBody').value.trim();
  if (!body) return setStatus($('blastStatus'), 'Write your message first.', 'err');
  if (!smsTwilioReady) return setStatus($('blastStatus'), "Text sending isn't set up yet — using the device draft instead.", 'err');
  if (!smsEligibleCount) return setStatus($('blastStatus'), 'No opted-in customers can receive a text right now.', 'err');
  if (!confirm('Send this text to ' + smsEligibleCount + ' opted-in customers? Standard rates apply.')) return;
  $('blastSmsNow').disabled = true;
  setStatus($('blastStatus'), '<span class="spin"></span>Sending texts…', 'info');
  try {
    const r = await api('smsBlast', { body });
    const msg = 'Texts sent: ' + (r.sent || 0) + ', failed: ' + (r.failed || 0) + ', skipped: ' + (r.skipped || 0) + '.';
    toast(msg);
    setStatus($('blastStatus'), '✅ ' + esc(msg), 'ok');
    loadHistory();
    loadSmsCount();
  } catch (err) {
    toast(err.message);
    setStatus($('blastStatus'), '❌ ' + err.message, 'err');
    loadSmsCount();
  }
});
async function loadPushCount() {
  try { const r = await api('pushCount'); if ($('pushCount')) $('pushCount').textContent = r.count || 0; } catch (_) {}
}
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

$('passForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('chNewPass').value.trim(), p2 = $('chNewPass2').value.trim();
  if (p1.length < 8) return setStatus($('passStatus'), 'Passphrase must be at least 8 characters.', 'err');
  if (p1 !== p2) return setStatus($('passStatus'), 'The two passphrases don\'t match.', 'err');
  $('passBtn').disabled = true;
  setStatus($('passStatus'), '<span class="spin"></span>Updating…', 'info');
  try {
    await api('changePassphrase', { newPassphrase: p1 });
    KEY = p1;
    if (localStorage.getItem('pp_key')) localStorage.setItem('pp_key', p1);
    $('chNewPass').value = ''; $('chNewPass2').value = '';
    setStatus($('passStatus'), '✅ Passphrase updated. Britni &amp; Susan have been emailed a confirmation, and Susan a private copy.', 'ok');
  } catch (err) {
    setStatus($('passStatus'), '❌ ' + err.message, 'err');
  } finally { $('passBtn').disabled = false; }
});

$('spaPinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('spaNewPin').value.trim();
  if (!/^\d{4,8}$/.test(pin)) return setStatus($('spaPinStatus'), 'PIN must be 4–8 digits.', 'err');
  $('spaPinBtn').disabled = true;
  setStatus($('spaPinStatus'), '<span class="spin"></span>Resetting…', 'info');
  try {
    await api('spaPinReset', { newPin: pin });
    $('spaNewPin').value = '';
    setStatus($('spaPinStatus'), '✅ Stylist spa PIN reset. A private copy was emailed to Susan.', 'ok');
  } catch (err) {
    setStatus($('spaPinStatus'), '❌ ' + err.message, 'err');
  } finally { $('spaPinBtn').disabled = false; }
});

/* ================= STAFF & SCHEDULES ================= */
let staffCache = [];

async function loadStaff() {
  const box = $('staffList');
  box.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const r = await api('staffList');
    staffCache = r.staff || [];
    renderStaff();
  } catch (err) {
    box.innerHTML = '<p class="status show err">❌ ' + esc(err.message) + '</p>';
  }
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function isoLocal(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fmtTime(t) {
  const m = /^(\d{2}):(\d{2})$/.exec(t || ''); if (!m) return t || '';
  let h = Number(m[1]); const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return h + (m[2] === '00' ? '' : ':' + m[2]) + ap;
}
// Opt-in availability: returns {start,end} if the stylist works that date, else null.
// Precedence: single-day override > closed range (holiday/vacation) > recurring open > off.
function availFor(s, iso, wd) {
  const ov = (s.dateHours || {})[iso];
  if (ov) return ov.on ? { start: ov.start, end: ov.end } : null;
  const closed = s.closedRanges || [];
  for (let j = 0; j < closed.length; j++) {
    if (closed[j].from && closed[j].to && closed[j].from <= iso && iso <= closed[j].to) return null;
  }
  const rules = s.recurring || [];
  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];
    if (r.from <= iso && iso <= r.to && (r.days || []).indexOf(wd) >= 0) return { start: r.start, end: r.end };
  }
  return null;
}
function offToday(s) {
  const d = new Date();
  return !availFor(s, isoLocal(d), d.getDay());
}
function hoursToday(s) {
  const d = new Date();
  return availFor(s, isoLocal(d), d.getDay());
}
function roleLabel(role) {
  return { owner: 'Owner', manager: 'Manager', stylist: 'Stylist' }[role] || 'Stylist';
}

function renderStaff() {
  const box = $('staffList');
  $('staffAddBtn').disabled = staffCache.length >= 10;
  if (!staffCache.length) { box.innerHTML = '<p class="muted">No stylists yet — add one.</p>'; return; }
  box.innerHTML = staffCache.map((s) => {
    const initial = (s.name || '?').trim().charAt(0).toUpperCase();
    const hrs = s.active ? hoursToday(s) : null;
    const status = !s.active ? '<span class="chip">Hidden</span>'
      : (hrs ? '<span class="chip">In ' + esc(fmtTime(hrs.start) + '–' + fmtTime(hrs.end)) + '</span>' : '<span class="chip">Off today</span>');
    const pin = s.hasPin ? '<span class="chip">PIN set</span>' : '<span class="chip chip--muted">No PIN</span>';
    return `<div class="staff${s.active ? '' : ' staff__off'}">
      <div class="staff__av">${esc(initial)}</div>
      <div class="staff__main">
        <div class="staff__name">${esc(s.name)} ${status} <span class="chip">${esc(roleLabel(s.accessRole))}</span> ${pin}</div>
        <div class="staff__role">${esc(s.role || '')}${s.phone ? ' · ' + esc(s.phone) : ''}</div>
      </div>
      <div class="staff__actions">
        <button class="mini" data-sched="${esc(s.id)}" type="button">📅 Schedule</button>
        <button class="mini" data-edit="${esc(s.id)}" type="button">Edit</button>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openStaffModal(b.dataset.edit)));
  box.querySelectorAll('[data-sched]').forEach((b) => b.addEventListener('click', () => openSchedModal(b.dataset.sched)));
}

/* ---- stylist editor ---- */
function setStaffPinControls(s, id) {
  $('sfPin').value = '';
  $('sfPinState').textContent = id
    ? (s.hasPin ? 'Personal PIN is set.' : 'No personal PIN set.')
    : 'Save this stylist before setting a personal PIN.';
  $('staffSetPin').disabled = !id;
  $('staffClearPin').disabled = !id || !s.hasPin;
}
function openStaffModal(id) {
  const s = staffCache.find((x) => x.id === id) || {};
  $('staffModalTitle').textContent = id ? ('Edit ' + (s.name || 'stylist')) : 'New stylist';
  $('sfId').value = id || '';
  $('sfName').value = s.name || '';
  $('sfRole').value = s.role || '';
  $('sfPhone').value = s.phone || '';
  $('sfAccessRole').value = s.accessRole || 'stylist';
  $('sfTags').value = s.tags || '';
  $('sfActive').checked = s.active !== false;
  $('sfSquareId').value = s.squareTeamMemberId || '';
  $('sfSmsFrom').value = (s.sms && s.sms.from) || '';
  $('sfSmsEnabled').checked = !!(s.sms && s.sms.enabled);
  setStaffPinControls(s, id);
  $('staffDelete').style.display = id ? '' : 'none';
  clr($('staffModalStatus'));
  $('staffModal').classList.add('open');
}
function closeStaffModal() { $('staffModal').classList.remove('open'); }

$('staffAddBtn').addEventListener('click', () => openStaffModal(''));
$('staffCancel').addEventListener('click', closeStaffModal);
$('staffSave').addEventListener('click', async () => {
  const staff = {
    id: $('sfId').value || undefined,
    name: $('sfName').value.trim(),
    role: $('sfRole').value.trim(),
    accessRole: $('sfAccessRole').value,
    phone: $('sfPhone').value.trim(),
    tags: $('sfTags').value.trim(),
    active: $('sfActive').checked,
    squareTeamMemberId: $('sfSquareId').value.trim(),
    sms: { enabled: $('sfSmsEnabled').checked, from: $('sfSmsFrom').value.trim() },
  };
  if (!staff.name) return setStatus($('staffModalStatus'), 'Please add a name.', 'err');
  $('staffSave').disabled = true;
  setStatus($('staffModalStatus'), '<span class="spin"></span>Saving…', 'info');
  try {
    await api('staffSave', { staff });
    closeStaffModal();
    loadStaff();
  } catch (err) { setStatus($('staffModalStatus'), '❌ ' + err.message, 'err'); }
  finally { $('staffSave').disabled = false; }
});
$('staffDelete').addEventListener('click', async () => {
  const id = $('sfId').value;
  if (!id || !confirm('Remove this stylist?')) return;
  try { await api('staffDelete', { id }); closeStaffModal(); loadStaff(); }
  catch (err) { setStatus($('staffModalStatus'), '❌ ' + err.message, 'err'); }
});
async function saveStaffPin(clear) {
  const id = $('sfId').value;
  if (!id) return setStatus($('staffModalStatus'), 'Save this stylist before setting a personal PIN.', 'err');
  const payload = { staffId: id, role: $('sfAccessRole').value };
  if (clear) {
    if (!confirm('Clear this stylist\'s personal spa-console PIN?')) return;
    payload.clear = true;
  } else {
    const pin = $('sfPin').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return setStatus($('staffModalStatus'), 'PIN must be 4–8 digits.', 'err');
    payload.newPin = pin;
  }
  $('staffSetPin').disabled = true;
  $('staffClearPin').disabled = true;
  setStatus($('staffModalStatus'), '<span class="spin"></span>' + (clear ? 'Clearing PIN…' : 'Setting PIN…'), 'info');
  try {
    await api('staffSetPin', payload);
    toast(clear ? 'Personal PIN cleared.' : 'Personal PIN set.');
    await loadStaff();
    const updated = staffCache.find((x) => x.id === id) || {};
    setStaffPinControls(updated, id);
    setStatus($('staffModalStatus'), '✅ ' + (clear ? 'Personal PIN cleared.' : 'Personal PIN set.'), 'ok');
  } catch (err) {
    toast(err.message);
    setStatus($('staffModalStatus'), '❌ ' + err.message, 'err');
    const current = staffCache.find((x) => x.id === id) || {};
    setStaffPinControls(current, id);
  }
}
$('staffSetPin').addEventListener('click', () => saveStaffPin(false));
$('staffClearPin').addEventListener('click', () => saveStaffPin(true));

/* ---- schedule (opt-in availability with hours + recurring blocks) ---- */
let schedState = null; // { id, name, recurring:[], dateHours:{}, viewY, viewM, editIso }

function isoOf(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

// Effective availability for a date inside the editor. Returns {start,end}, or
// null (off). Also exposes the closing reason via schedClosedReason().
function schedAvail(iso, wd) {
  const ov = schedState.dateHours[iso];
  if (ov) return ov.on ? { start: ov.start, end: ov.end } : null;
  if (schedClosedReason(iso) !== null) return null;
  for (let i = 0; i < schedState.recurring.length; i++) {
    const r = schedState.recurring[i];
    if (r.from && r.to && r.from <= iso && iso <= r.to && (r.days || []).indexOf(wd) >= 0) return { start: r.start, end: r.end };
  }
  return null;
}
// Returns the closed-range reason string (may be '') if iso falls in a closed range, else null.
function schedClosedReason(iso) {
  for (let j = 0; j < schedState.closedRanges.length; j++) {
    const c = schedState.closedRanges[j];
    if (c.from && c.to && c.from <= iso && iso <= c.to) return c.reason || '';
  }
  return null;
}

function openSchedModal(id) {
  const s = staffCache.find((x) => x.id === id);
  if (!s) return;
  const nowD = new Date();
  const dh = {};
  Object.keys(s.dateHours || {}).forEach((k) => { dh[k] = Object.assign({}, s.dateHours[k]); });
  schedState = {
    id, name: s.name,
    recurring: (s.recurring || []).map((r) => ({ days: (r.days || []).slice(), start: r.start || '09:00', end: r.end || '17:00', from: r.from || '', to: r.to || '' })),
    closedRanges: (s.closedRanges || []).map((c) => ({ from: c.from || '', to: c.to || '', reason: c.reason || '' })),
    dateHours: dh,
    viewY: nowD.getFullYear(), viewM: nowD.getMonth(),
    editIso: null,
  };
  $('schedTitle').textContent = s.name + ' — schedule';
  document.querySelector('#schedModal .cal__dow').innerHTML = DOW.map((d) => `<span>${d.slice(0, 2)}</span>`).join('');
  renderRecur();
  renderClosed();
  hideDayEditor();
  renderCal();
  clr($('schedStatus'));
  $('schedModal').classList.add('open');
}
function closeSchedModal() { $('schedModal').classList.remove('open'); }

/* --- recurring blocks --- */
function renderRecur() {
  const box = $('recurRows');
  if (!schedState.recurring.length) { box.innerHTML = '<p class="muted" style="margin:.2rem 0">No recurring blocks yet — everyone is off until you add one or open specific days below.</p>'; return; }
  box.innerHTML = schedState.recurring.map((r, i) => {
    const days = DOW.map((d, wd) => `<button type="button" class="wday${(r.days || []).indexOf(wd) >= 0 ? ' on' : ''}" data-ri="${i}" data-wd="${wd}">${d.slice(0, 2)}</button>`).join('');
    return `<div class="recur">
      <div class="recur__days">${days}</div>
      <div class="recur__row">
        <label>From <input type="date" data-ri="${i}" data-k="from" value="${esc(r.from)}"></label>
        <label>To <input type="date" data-ri="${i}" data-k="to" value="${esc(r.to)}"></label>
      </div>
      <div class="recur__row">
        <label>Hours <input type="time" data-ri="${i}" data-k="start" value="${esc(r.start)}"></label>
        <span>–</span>
        <label><input type="time" data-ri="${i}" data-k="end" value="${esc(r.end)}"></label>
        <button type="button" class="mini recur__del" data-del="${i}">Remove</button>
      </div>
    </div>`;
  }).join('');
  box.querySelectorAll('.wday[data-ri]').forEach((b) => b.addEventListener('click', () => {
    const ri = Number(b.dataset.ri), wd = Number(b.dataset.wd);
    const days = schedState.recurring[ri].days;
    const idx = days.indexOf(wd);
    if (idx >= 0) days.splice(idx, 1); else days.push(wd);
    renderRecur(); renderCal();
  }));
  box.querySelectorAll('input[data-ri]').forEach((inp) => inp.addEventListener('change', () => {
    const ri = Number(inp.dataset.ri), k = inp.dataset.k;
    schedState.recurring[ri][k] = inp.value;
    renderCal();
  }));
  box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
    schedState.recurring.splice(Number(b.dataset.del), 1);
    renderRecur(); renderCal();
  }));
}

/* --- closed ranges (holidays / vacations) --- */
function renderClosed() {
  const box = $('closedRows');
  if (!schedState.closedRanges.length) { box.innerHTML = '<p class="muted" style="margin:.2rem 0">No closures yet — add holidays or vacation dates here to close them even during normal open days.</p>'; return; }
  box.innerHTML = schedState.closedRanges.map((c, i) => `<div class="recur closed">
      <div class="recur__row">
        <label>From <input type="date" data-ci="${i}" data-k="from" value="${esc(c.from)}"></label>
        <label>To <input type="date" data-ci="${i}" data-k="to" value="${esc(c.to)}"></label>
        <button type="button" class="mini recur__del" data-cdel="${i}">Remove</button>
      </div>
      <div class="recur__row">
        <label style="flex:1">Reason <input type="text" data-ci="${i}" data-k="reason" maxlength="80" placeholder="e.g. Christmas, vacation" value="${esc(c.reason)}" style="flex:1;min-width:140px"></label>
      </div>
    </div>`).join('');
  box.querySelectorAll('input[data-ci]').forEach((inp) => inp.addEventListener('change', () => {
    schedState.closedRanges[Number(inp.dataset.ci)][inp.dataset.k] = inp.value;
    renderCal();
  }));
  box.querySelectorAll('[data-cdel]').forEach((b) => b.addEventListener('click', () => {
    schedState.closedRanges.splice(Number(b.dataset.cdel), 1);
    renderClosed(); renderCal();
  }));
}

/* --- month calendar --- */
function renderCal() {
  const y = schedState.viewY, m = schedState.viewM;
  $('calMonth').textContent = new Date(y, m, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const todayIso = isoOf(new Date().getFullYear(), new Date().getMonth(), new Date().getDate());
  let cells = '';
  for (let i = 0; i < first; i++) cells += '<div class="cal__cell cal__cell--pad"></div>';
  for (let d = 1; d <= days; d++) {
    const iso = isoOf(y, m, d);
    const wd = new Date(y, m, d).getDay();
    const past = iso < todayIso;
    const av = schedAvail(iso, wd);
    const closedReason = !av ? schedClosedReason(iso) : null; // null unless in a closed range
    const isClosedRange = closedReason !== null && !schedState.dateHours[iso];
    const sel = schedState.editIso === iso ? ' cal__cell--sel' : '';
    const cls = 'cal__cell' + (av ? ' cal__cell--on' : ' cal__cell--off') + (isClosedRange ? ' cal__cell--closed' : '') + (past ? ' cal__cell--past' : '') + sel;
    const hrs = av ? `<span class="cal__hrs">${fmtTime(av.start)}–${fmtTime(av.end)}</span>` : (isClosedRange ? `<span class="cal__hrs">${esc(closedReason || 'Closed')}</span>` : '');
    const title = isClosedRange ? ` title="Closed${closedReason ? ': ' + esc(closedReason) : ''}"` : '';
    cells += `<div class="${cls}"${title}${past ? '' : ` data-day="${iso}" data-wd="${wd}"`}><span>${d}</span>${hrs}</div>`;
  }
  $('calGrid').innerHTML = cells;
  $('calGrid').querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', () => openDayEditor(c.dataset.day, Number(c.dataset.wd))));
}

/* --- per-day editor --- */
function openDayEditor(iso, wd) {
  schedState.editIso = iso;
  const av = schedAvail(iso, wd);
  const ov = schedState.dateHours[iso];
  $('deLabel').textContent = new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  $('deOn').checked = !!av;
  $('deStart').value = (av && av.start) || '09:00';
  $('deEnd').value = (av && av.end) || '17:00';
  $('deClear').style.display = ov ? '' : 'none';
  const closedReason = schedClosedReason(iso);
  let src;
  if (ov) src = 'a specific day override';
  else if (av) src = 'a recurring block';
  else if (closedReason !== null) src = 'closed' + (closedReason ? ' (' + closedReason + ')' : '') + ' — a holiday/vacation range';
  else src = 'off (default)';
  $('deSource').textContent = 'Currently: ' + src + '.';
  $('dayEditor').style.display = '';
  renderCal();
}
function hideDayEditor() { if (schedState) schedState.editIso = null; $('dayEditor').style.display = 'none'; }

/* --- wiring --- */
$('addRecur').addEventListener('click', () => {
  schedState.recurring.push({ days: [], start: '09:00', end: '17:00', from: isoOf(schedState.viewY, schedState.viewM, 1), to: '' });
  renderRecur(); renderCal();
});
$('addClosed').addEventListener('click', () => {
  const first = isoOf(schedState.viewY, schedState.viewM, 1);
  schedState.closedRanges.push({ from: first, to: first, reason: '' });
  renderClosed(); renderCal();
});
$('deApply').addEventListener('click', () => {
  const iso = schedState.editIso; if (!iso) return;
  if ($('deOn').checked) {
    const start = $('deStart').value, end = $('deEnd').value;
    if (!start || !end || end <= start) { setStatus($('schedStatus'), 'End time must be after start time.', 'err'); return; }
    schedState.dateHours[iso] = { on: true, start, end };
  } else {
    schedState.dateHours[iso] = { on: false };
  }
  clr($('schedStatus'));
  hideDayEditor(); renderCal();
});
$('deClear').addEventListener('click', () => {
  const iso = schedState.editIso; if (iso) delete schedState.dateHours[iso];
  hideDayEditor(); renderCal();
});
$('deClose').addEventListener('click', hideDayEditor);

$('calPrev').addEventListener('click', () => { if (--schedState.viewM < 0) { schedState.viewM = 11; schedState.viewY--; } renderCal(); });
$('calNext').addEventListener('click', () => { if (++schedState.viewM > 11) { schedState.viewM = 0; schedState.viewY++; } renderCal(); });
$('schedCancel').addEventListener('click', closeSchedModal);
$('schedSave').addEventListener('click', async () => {
  $('schedSave').disabled = true;
  setStatus($('schedStatus'), '<span class="spin"></span>Saving…', 'info');
  try {
    await api('staffAvailability', {
      id: schedState.id,
      recurring: schedState.recurring,
      closedRanges: schedState.closedRanges,
      dateHours: schedState.dateHours,
    });
    closeSchedModal();
    loadStaff();
  } catch (err) { setStatus($('schedStatus'), '❌ ' + err.message, 'err'); }
  finally { $('schedSave').disabled = false; }
});

/* ================= SQUARE ================= */
let sqLoaded = false;
let sqCache = { locations: [], team: [], services: [] };

function sqFillSelect(sel, items, valueKey, labelFn, current) {
  const el = $(sel);
  const opts = items.map((it) => `<option value="${esc(it[valueKey])}"${it[valueKey] === current ? ' selected' : ''}>${esc(labelFn(it))}</option>`).join('');
  el.innerHTML = (items.length ? '' : '<option value="">— none found —</option>') + opts;
  if (current) el.value = current;
}

async function loadSquare() {
  try {
    const r = await api('squareStatus');
    const sq = r.square || {};
    if (!sq.hasToken) {
      $('sqNotConnected').classList.remove('hidden');
      $('sqForm').classList.add('hidden');
      setStatus($('sqStatus'), '⚪ Not connected — no access token set.', 'info');
      return;
    }
    $('sqNotConnected').classList.add('hidden');
    $('sqForm').classList.remove('hidden');
    $('sqEnv').value = sq.env || 'production';
    $('sqAutoBook').checked = sq.autoBook !== false;
    // Preselect saved ids even before catalog loads.
    if (sq.locationId) $('sqLocation').innerHTML = `<option value="${esc(sq.locationId)}" selected>${esc(sq.locationId)}</option>`;
    if (sq.teamMemberId) $('sqTeam').innerHTML = `<option value="${esc(sq.teamMemberId)}" selected>${esc(sq.teamMemberId)}</option>`;
    if (sq.serviceVariationId) $('sqService').innerHTML = `<option value="${esc(sq.serviceVariationId)}" selected>${esc(sq.serviceVariationId)}</option>`;
    if (sq.connected) {
      setStatus($('sqStatus'), '🟢 Connected — web bookings ' + (sq.autoBook !== false ? 'auto-sync to your calendar.' : 'sync is paused.'), 'ok');
      $('sqBookingsCard').classList.remove('hidden');
      if (!sqLoaded) sqConnect();
    } else {
      setStatus($('sqStatus'), '🟡 Token set — click “Load from Square”, then pick a location, groomer & service and save.', 'info');
    }
  } catch (err) {
    setStatus($('sqStatus'), '❌ ' + err.message, 'err');
  }
}

async function sqConnect() {
  setStatus($('sqStatus'), '<span class="spin"></span>Loading from Square…', 'info');
  $('sqConnectBtn').disabled = true;
  try {
    const saved = await api('squareStatus').then((r) => r.square || {});
    const r = await api('squareConnect');
    sqCache = { locations: r.locations || [], team: r.team || [], services: r.services || [] };
    sqLoaded = true;
    sqFillSelect('sqLocation', sqCache.locations, 'id', (l) => l.name || l.id, saved.locationId);
    sqFillSelect('sqTeam', sqCache.team, 'id', (t) => t.name, saved.teamMemberId);
    sqFillSelect('sqService', sqCache.services, 'variationId', (s) => s.label + (s.durationMinutes ? ` (${s.durationMinutes}m)` : ''), saved.serviceVariationId);
    setStatus($('sqStatus'), '✅ Loaded ' + sqCache.locations.length + ' location(s), ' + sqCache.team.length + ' groomer(s), ' + sqCache.services.length + ' service(s).', 'ok');
    $('sqBookingsCard').classList.remove('hidden');
    loadSqBookings();
  } catch (err) {
    setStatus($('sqStatus'), '❌ ' + err.message, 'err');
  } finally { $('sqConnectBtn').disabled = false; }
}

async function loadSqBookings() {
  const box = $('sqBookings');
  box.innerHTML = '<p class="muted"><span class="spin"></span>Loading…</p>';
  try {
    const r = await api('squareBookings', { limit: 30 });
    const b = r.bookings || [];
    if (!b.length) { box.innerHTML = '<p class="muted">No upcoming appointments on your Square calendar.</p>'; return; }
    box.innerHTML = b.map((x) => {
      const when = x.startAt ? new Date(x.startAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
      const note = esc(x.sellerNote || x.customerNote || '');
      return `<div style="padding:.6rem 0;border-bottom:1px solid var(--line)"><strong>${esc(when)}</strong> · <span class="muted">${esc(x.status || '')}</span>${note ? '<br /><span class="muted">' + note + '</span>' : ''}</div>`;
    }).join('');
  } catch (err) {
    box.innerHTML = '<p class="status show err">❌ ' + esc(err.message) + '</p>';
  }
}

$('sqConnectBtn').addEventListener('click', sqConnect);
$('sqRefreshBtn').addEventListener('click', loadSqBookings);
$('sqForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const cfg = {
    env: $('sqEnv').value,
    locationId: $('sqLocation').value,
    teamMemberId: $('sqTeam').value,
    serviceVariationId: $('sqService').value,
    autoBook: $('sqAutoBook').checked,
  };
  $('sqSaveBtn').disabled = true;
  setStatus($('sqStatus'), '<span class="spin"></span>Saving…', 'info');
  try {
    await api('squareSaveConfig', { square: cfg });
    setStatus($('sqStatus'), '✅ Saved. ' + (cfg.autoBook ? 'Web bookings will land on your calendar.' : 'Auto-sync is paused.'), 'ok');
    $('sqBookingsCard').classList.remove('hidden');
    loadSqBookings();
  } catch (err) {
    setStatus($('sqStatus'), '❌ ' + err.message, 'err');
  } finally { $('sqSaveBtn').disabled = false; }
});

/* ---------- auto sign-in ---------- */
(function () {
  if (resetToken) return; // don't auto-login while completing a reset
  const saved = localStorage.getItem('pp_key');
  if (saved) { $('adminKey').value = saved; loginCard.requestSubmit(); }
})();
