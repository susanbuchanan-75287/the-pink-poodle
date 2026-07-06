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
    if (p1.length < 8) return setStatus($('resetStatus'), 'Passphrase must be at least 8 characters.', 'err');
    if (p1 !== p2) return setStatus($('resetStatus'), 'The two passphrases don\'t match.', 'err');
    setStatus($('resetStatus'), '<span class="spin"></span>Saving…', 'info');
    try {
      await resetApi('applyReset', { token: resetToken, newPassphrase: p1 });
      localStorage.removeItem('pp_key');
      setStatus($('resetStatus'), '✅ Passphrase updated! Redirecting to sign in…', 'ok');
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
  if (t.dataset.tab === 'messages') loadHistory();
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
    setStatus($('passStatus'), '✅ Passphrase updated. Britni &amp; Susan have been emailed a confirmation.', 'ok');
  } catch (err) {
    setStatus($('passStatus'), '❌ ' + err.message, 'err');
  } finally { $('passBtn').disabled = false; }
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

function offToday(s) {
  const d = new Date();
  const iso = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  if ((s.datesOff || []).includes(iso)) return true;
  if ((s.datesOn || []).includes(iso)) return false;
  return (s.weeklyOff || []).includes(d.getDay());
}

function renderStaff() {
  const box = $('staffList');
  $('staffAddBtn').disabled = staffCache.length >= 10;
  if (!staffCache.length) { box.innerHTML = '<p class="muted">No stylists yet — add one.</p>'; return; }
  box.innerHTML = staffCache.map((s) => {
    const initial = (s.name || '?').trim().charAt(0).toUpperCase();
    const off = offToday(s);
    const status = !s.active ? '<span class="chip">Hidden</span>' : (off ? '<span class="chip">Off today</span>' : '<span class="chip">In today</span>');
    return `<div class="staff${s.active ? '' : ' staff__off'}">
      <div class="staff__av">${esc(initial)}</div>
      <div class="staff__main">
        <div class="staff__name">${esc(s.name)} ${status}</div>
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
function openStaffModal(id) {
  const s = staffCache.find((x) => x.id === id) || {};
  $('staffModalTitle').textContent = id ? ('Edit ' + (s.name || 'stylist')) : 'New stylist';
  $('sfId').value = id || '';
  $('sfName').value = s.name || '';
  $('sfRole').value = s.role || '';
  $('sfPhone').value = s.phone || '';
  $('sfTags').value = s.tags || '';
  $('sfActive').checked = s.active !== false;
  $('sfSquareId').value = s.squareTeamMemberId || '';
  $('sfSmsFrom').value = (s.sms && s.sms.from) || '';
  $('sfSmsEnabled').checked = !!(s.sms && s.sms.enabled);
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

/* ---- schedule calendar ---- */
let schedState = null; // { id, weeklyOff:Set, datesOff:Set, datesOn:Set, viewY, viewM }

function isoOf(y, m, d) { return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }

function effStatus(iso, wd) {
  if (schedState.datesOff.has(iso)) return 'off';
  if (schedState.datesOn.has(iso)) return 'available';
  return schedState.weeklyOff.has(wd) ? 'off' : 'available';
}

function openSchedModal(id) {
  const s = staffCache.find((x) => x.id === id);
  if (!s) return;
  const nowD = new Date();
  schedState = {
    id, name: s.name,
    weeklyOff: new Set(s.weeklyOff || []),
    datesOff: new Set(s.datesOff || []),
    datesOn: new Set(s.datesOn || []),
    viewY: nowD.getFullYear(), viewM: nowD.getMonth(),
  };
  $('schedTitle').textContent = s.name + ' — schedule';
  document.querySelector('#schedModal .cal__dow').innerHTML = DOW.map((d) => `<span>${d}</span>`).join('');
  renderWeeklyOff();
  renderCal();
  clr($('schedStatus'));
  $('schedModal').classList.add('open');
}
function closeSchedModal() { $('schedModal').classList.remove('open'); }

function renderWeeklyOff() {
  $('weeklyOff').innerHTML = DOW.map((d, i) => `<button type="button" class="wday${schedState.weeklyOff.has(i) ? ' on' : ''}" data-wd="${i}">${d}</button>`).join('');
  $('weeklyOff').querySelectorAll('[data-wd]').forEach((b) => b.addEventListener('click', () => {
    const wd = Number(b.dataset.wd);
    if (schedState.weeklyOff.has(wd)) schedState.weeklyOff.delete(wd); else schedState.weeklyOff.add(wd);
    renderWeeklyOff(); renderCal();
  }));
}

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
    const st = effStatus(iso, wd);
    const cls = 'cal__cell' + (st === 'off' ? ' cal__cell--off' : '') + (past ? ' cal__cell--past' : '');
    cells += `<div class="${cls}"${past ? '' : ` data-day="${iso}" data-wd="${wd}"`}>${d}</div>`;
  }
  $('calGrid').innerHTML = cells;
  $('calGrid').querySelectorAll('[data-day]').forEach((c) => c.addEventListener('click', () => toggleDay(c.dataset.day, Number(c.dataset.wd))));
}

function toggleDay(iso, wd) {
  const before = effStatus(iso, wd);
  schedState.datesOff.delete(iso);
  schedState.datesOn.delete(iso);
  const base = schedState.weeklyOff.has(wd) ? 'off' : 'available';
  if (before === 'available') { if (base === 'available') schedState.datesOff.add(iso); }
  else { if (base === 'off') schedState.datesOn.add(iso); }
  renderCal();
}

$('calPrev').addEventListener('click', () => { if (--schedState.viewM < 0) { schedState.viewM = 11; schedState.viewY--; } renderCal(); });
$('calNext').addEventListener('click', () => { if (++schedState.viewM > 11) { schedState.viewM = 0; schedState.viewY++; } renderCal(); });
$('schedCancel').addEventListener('click', closeSchedModal);
$('schedSave').addEventListener('click', async () => {
  $('schedSave').disabled = true;
  setStatus($('schedStatus'), '<span class="spin"></span>Saving…', 'info');
  try {
    await api('staffAvailability', {
      id: schedState.id,
      weeklyOff: Array.from(schedState.weeklyOff),
      datesOff: Array.from(schedState.datesOff),
      datesOn: Array.from(schedState.datesOn),
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
