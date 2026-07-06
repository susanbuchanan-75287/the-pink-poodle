/* ===================================================================
   The Pink Poodle — Spa & Booking mini-app (LIVE backend)
   Everything persists server-side in Firestore via the pinkPoodleSpa
   Cloud Function. Nothing is stored in the browser — no localStorage,
   no sessionStorage, no cookies. Runtime state lives only in memory for
   the current page view and is cleared on reload.
   =================================================================== */
(function () {
  'use strict';

  /* ---------- backend ---------- */
  var ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSpa';
  function api(action, payload) {
    return fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.assign({ action: action }, payload || {}))
    }).then(function (r) {
      return r.json().catch(function () { return { error: 'Network error.' }; }).then(function (j) {
        if (!r.ok || (j && j.error)) throw new Error((j && j.error) || ('HTTP ' + r.status));
        return j;
      });
    });
  }

  /* ---------- static menus (client-side estimate only) ---------- */
  var STYLISTS = [
    { name: 'Britni', role: 'Owner & Groomer' },
    { name: 'Jenefer', role: 'Groomer & Stylist' },
    { name: 'Hannah', role: 'Bath & Spa Specialist' },
    { name: 'No preference', role: 'First available' }
  ];
  var SERVICES = [
    { id: 'bath', name: 'Bath & Brush', desc: 'Shampoo, blow-dry, brush-out', price: 30, dur: 45 },
    { id: 'groom', name: 'Full Groom', desc: 'Bath + breed/style haircut', price: 55, dur: 90 },
    { id: 'puppy', name: "Puppy's First Groom", desc: 'Gentle intro for pups under 6 mo', price: 40, dur: 60 },
    { id: 'deshed', name: 'De-Shed Treatment', desc: 'Deep de-shedding for double coats', price: 45, dur: 60 },
    { id: 'nails', name: 'Nail Trim', desc: 'Quick trim, in & out', price: 12, dur: 15 },
    { id: 'teeth', name: 'Teeth Brushing', desc: 'Fresh breath & clean smile', price: 8, dur: 10 }
  ];
  var ADDONS = [
    { id: 'grind', name: 'Nail grind', price: 8 },
    { id: 'facial', name: 'Blueberry facial', price: 6 },
    { id: 'cologne', name: 'Cologne + bow/bandana', price: 5 },
    { id: 'flea', name: 'Flea & tick bath', price: 12 },
    { id: 'ears', name: 'Ear cleaning', price: 6 },
    { id: 'gland', name: 'Gland expression', price: 8 }
  ];
  var SIZE_ADD = { 'Small (0–20 lb)': 0, 'Medium (20–50 lb)': 10, 'Large (50–90 lb)': 22, 'X-Large (90+ lb)': 38 };
  var STEP_ICONS = ['📝', '🐾', '🛁', '✂️', '✨', '🔔', '🏠'];
  var STEPS = ['Requested', 'Checked in', 'Bathing', 'Grooming', 'Finishing', 'Ready for pickup', 'Picked up'];

  /* ---------- helpers ---------- */
  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function money(n) { return '$' + (Math.round((Number(n) || 0) * 100) / 100).toString().replace(/\.00$/, ''); }
  function todayISO() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  var toastT;
  function toast(msg) { var t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove('show'); }, 2800); }
  function dl(name, mime, text) {
    var blob = new Blob([text], { type: mime });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    document.body.removeChild(a); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* ---------- runtime-only state (cleared on reload) ---------- */
  var sel = { services: {}, addons: {}, stylist: 'No preference' };
  var staffPin = null;              // held in memory only while the tab is open
  var staffRole = null;
  var staffName = '';
  var lastCodes = [];               // recent REF codes booked this session (memory only)
  var boardCache = [];              // last fetched board tickets
  var feesCache = [];               // last fetched fees
  var boardFilter = 'All';
  var currentSub = 'board';
  var coState = { id: null, items: [] };
  var knownVax = ['Rabies', 'Bordetella', 'DHPP', 'Canine Influenza'];
  var requiredVax = ['Rabies'];
  var dueCache = [];
  var upcomingCache = [];            // scheduled appointments
  var reportRange = 'week';          // today | week | month | all
  var reportCache = null;
  var schId = null;                  // ticket being scheduled
  var depId = null;                  // ticket a deposit is being requested for
  var rbId = null;                   // ticket being rebooked
  var petPhotoCache = [];            // photos for the pet open in the editor

  /* =================================================================
     NAVIGATION
     ================================================================= */
  function go(view) {
    document.querySelectorAll('.view').forEach(function (v) { v.classList.toggle('hidden', v.dataset.view !== view); });
    document.querySelectorAll('.nav__btn').forEach(function (b) { b.classList.toggle('on', b.dataset.go === view); });
    if (view === 'staff') showSub(currentSub);
    window.scrollTo(0, 0);
  }
  document.querySelectorAll('.nav__btn').forEach(function (b) { b.addEventListener('click', function () { go(b.dataset.go); }); });

  /* =================================================================
     SERVICE MENU + TOTAL (client-side estimate)
     ================================================================= */
  function renderServices() {
    $('svcList').innerHTML = SERVICES.map(function (s) {
      return '<div class="svc ' + (sel.services[s.id] ? 'sel' : '') + '" data-svc="' + s.id + '">' +
        '<div class="svc__check">' + (sel.services[s.id] ? '✓' : '') + '</div>' +
        '<div><div class="svc__name">' + esc(s.name) + '</div><div class="svc__desc">' + esc(s.desc) + '</div></div>' +
        '<div class="svc__price">from ' + money(s.price) + '<div class="svc__dur">' + s.dur + ' min</div></div></div>';
    }).join('');
    $('svcList').querySelectorAll('[data-svc]').forEach(function (el) {
      el.addEventListener('click', function () { var k = el.dataset.svc; sel.services[k] = !sel.services[k]; renderServices(); renderTotal(); });
    });
  }
  function renderAddons() {
    $('addonList').innerHTML = ADDONS.map(function (a) {
      return '<button type="button" class="pill ' + (sel.addons[a.id] ? 'sel' : '') + '" data-add="' + a.id + '">' + esc(a.name) + ' +' + money(a.price) + '</button>';
    }).join('');
    $('addonList').querySelectorAll('[data-add]').forEach(function (el) {
      el.addEventListener('click', function () { var k = el.dataset.add; sel.addons[k] = !sel.addons[k]; renderAddons(); renderTotal(); });
    });
  }
  function renderStylists() {
    $('stylistList').innerHTML = STYLISTS.map(function (s) {
      return '<button type="button" class="pill ' + (sel.stylist === s.name ? 'sel' : '') + '" data-sty="' + esc(s.name) + '">' + esc(s.name) + '</button>';
    }).join('');
    $('stylistList').querySelectorAll('[data-sty]').forEach(function (el) {
      el.addEventListener('click', function () { sel.stylist = el.dataset.sty; renderStylists(); });
    });
  }
  function estimate() {
    var total = 0, dur = 0, groomy = false;
    SERVICES.forEach(function (s) { if (sel.services[s.id]) { total += s.price; dur += s.dur; if (['groom', 'deshed', 'puppy'].indexOf(s.id) >= 0) groomy = true; } });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) { total += a.price; dur += 8; } });
    var size = $('pSize').value;
    if (groomy && SIZE_ADD[size]) total += SIZE_ADD[size];
    return { total: total, dur: dur };
  }
  function renderTotal() {
    var e = estimate();
    $('totalAmt').textContent = money(e.total);
    $('totalDur').textContent = e.dur ? ('≈ ' + (e.dur >= 60 ? Math.floor(e.dur / 60) + 'h ' : '') + (e.dur % 60) + 'm') : 'Select services';
  }
  function selectedServiceNames() {
    var names = [];
    SERVICES.forEach(function (s) { if (sel.services[s.id]) names.push(s.name); });
    ADDONS.forEach(function (a) { if (sel.addons[a.id]) names.push('+' + a.name); });
    return names;
  }
  $('pSize').addEventListener('change', renderTotal);
  $('bkTime').addEventListener('change', function () { $('exactWrap').classList.toggle('hidden', this.value !== 'exact'); });
  // Reveal the vaccination file picker only when "Upload proof now" is chosen.
  (function () {
    function sync() { $('spVaxFileWrap').classList.toggle('hidden', !$('spVaxUpload').checked); }
    if ($('spVaxUpload')) $('spVaxUpload').addEventListener('change', sync);
    if ($('spVaxBring')) $('spVaxBring').addEventListener('change', sync);
  })();
  function readAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = function () { reject(new Error('read failed')); };
      r.readAsDataURL(file);
    });
  }

  /* =================================================================
     CREATE BOOKING → live backend
     ================================================================= */
  $('bookBtn').addEventListener('click', function () {
    var petName = $('pName').value.trim();
    if (!petName) { toast("Please add your pup's name 🐩"); return; }
    var services = selectedServiceNames();
    if (!services.length) { toast('Choose at least one service 🛁'); return; }
    if (!$('oName').value.trim() || !$('oPhone').value.trim()) { toast('Add your name & mobile so we can confirm 📱'); return; }
    if (!$('cVax').checked || !$('cHandle').checked || !$('cContact').checked) { toast('Please check the 3 OK boxes 🐾'); return; }
    if (!$('cSign').value.trim()) { toast('Please sign with your name ✍️'); return; }
    var vaxMode = $('spVaxUpload').checked ? 'upload' : ($('spVaxBring').checked ? 'bring' : '');
    if (!vaxMode) { toast('Upload vaccination proof or choose to bring a copy 💉'); return; }
    var vaxFile = (vaxMode === 'upload' && $('spVaxFile').files && $('spVaxFile').files[0]) ? $('spVaxFile').files[0] : null;
    if (vaxMode === 'upload' && !vaxFile) { toast('Choose a photo or PDF, or pick "bring a copy" 💉'); return; }
    if (vaxFile && vaxFile.size > 8 * 1024 * 1024) { toast('That file is over 8 MB — pick a smaller one 📄'); return; }

    var e = estimate();
    var when = $('bkDate').value ? new Date($('bkDate').value + 'T12:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : 'flexible';
    var time = $('bkTime').value === 'exact' ? ($('bkExact').value || 'exact time') : ($('bkTime').value || 'any time');
    var btn = $('bookBtn'); btn.disabled = true; btn.textContent = 'Sending…';

    api('spaBook', {
      pet: { name: petName, breed: $('pBreed').value.trim(), size: $('pSize').value, notes: $('pNotes').value.trim() },
      owner: { name: $('oName').value.trim(), phone: $('oPhone').value.trim(), email: $('oEmail').value.trim() },
      services: services, stylist: sel.stylist, requestedDate: when, requestedTime: time, est: e.total,
      vax: { mode: vaxMode, current: $('cVax').checked },
      company: $('hp').value
    }).then(function (res) {
      lastCodes.unshift({ code: res.code, pet: petName });
      // Best-effort: attach the uploaded proof to the fresh ticket.
      var after = Promise.resolve();
      if (vaxFile && res.code) {
        after = readAsDataUrl(vaxFile).then(function (dataUrl) {
          return api('spaVaxUpload', { code: res.code, dataUrl: dataUrl, name: vaxFile.name });
        }).catch(function () { toast('Booked — but the file didn\'t attach. Bring a copy 📄'); });
      }
      return after.then(function () {
        showBookingSuccess(res.code, petName, services, sel.stylist, when, time, e.total);
        // reset selections
        sel.services = {}; sel.addons = {};
        $('pName').value = ''; $('pBreed').value = ''; $('pNotes').value = '';
        $('cVax').checked = $('cHandle').checked = $('cContact').checked = false;
        if ($('spVaxUpload').checked) $('spVaxUpload').checked = false;
        if ($('spVaxBring').checked) $('spVaxBring').checked = false;
        $('spVaxFileWrap').classList.add('hidden'); $('spVaxFile').value = '';
        renderServices(); renderAddons(); renderTotal();
        toast('Request sent! Code ' + res.code + ' 🩷');
      });
    }).catch(function (err) {
      toast(err.message || 'Could not send — please text 304-921-2748');
    }).then(function () { btn.disabled = false; btn.textContent = 'Request →'; });
  });

  function showBookingSuccess(code, petName, services, stylist, when, time, est) {
    go('track');
    $('trackCode').value = code;
    var msg = "Hi Britni! I'd like to book at The Pink Poodle.\n" +
      'Pet: ' + petName + '\n' +
      'Services: ' + services.join(', ') + '\n' +
      'Stylist: ' + stylist + '\n' +
      'When: ' + when + ', ' + time + '\n' +
      'Est: ' + money(est) + ' · Ref ' + code;
    var sms = 'sms:3049212748' + (/iPad|iPhone|iPod/.test(navigator.userAgent) ? '&' : '?') + 'body=' + encodeURIComponent(msg);
    $('trackBody').innerHTML =
      '<div class="card" style="border:1px solid var(--gold,#c9a34e)">' +
      '<h2 style="margin-top:0">You\'re on the list! ✨</h2>' +
      '<p>Save this booking code — it\'s how you\'ll track ' + esc(petName) + '\'s spa day:</p>' +
      '<div class="track__code" style="font-size:1.6rem;text-align:center;letter-spacing:0.2em">' + esc(code) + '</div>' +
      '<a class="btn btn--primary btn--block" style="margin-top:0.8rem" href="' + sms + '">💬 Text this request to the salon</a>' +
      '<button class="btn btn--soft btn--block" id="trackNow" type="button" style="margin-top:0.5rem">Track now →</button>' +
      '</div>';
    var tn = $('trackNow'); if (tn) tn.addEventListener('click', doTrack);
  }

  /* =================================================================
     TRACK (customer) — by code
     ================================================================= */
  function doTrack() {
    var code = $('trackCode').value.trim().toUpperCase();
    if (!code) { toast('Enter your booking code ✨'); return; }
    $('trackBody').innerHTML = '<p class="muted">Looking up ' + esc(code) + '…</p>';
    api('spaTrack', { code: code }).then(function (res) {
      var t = res.ticket;
      var loyalty = res.loyalty || { visits: 0, spent: 0 };
      var loyaltyCard = loyaltyHtml(loyalty, t.petName);
      if (t.cancelled) {
        $('trackBody').innerHTML = '<div class="card"><div class="track__code">' + esc(t.petName || 'Your pup') + ' · REF ' + esc(t.code) + '</div><p class="muted">This appointment was cancelled. Text 304-921-2748 to rebook.</p></div>' + loyaltyCard;
        return;
      }
      var steps = STEPS.map(function (label, i) {
        var cls = i < t.step ? 'done' : (i === t.step ? 'active' : '');
        return '<div class="step ' + cls + '"><div class="dot">' + (i < t.step ? '✓' : STEP_ICONS[i]) + '</div><div class="lbl">' + label + '</div></div>';
      }).join('');
      var canCancel = t.step < 2;
      var apptLine = t.apptDate ? '<div class="muted" style="margin-top:0.3rem">Scheduled: ' + esc(t.apptDate) + (t.apptTime ? ' at ' + esc(t.apptTime) : '') + (t.confirmed ? ' ✓ confirmed' : ' · awaiting confirmation') + '</div>' : '';
      var minDate = (function () { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })();
      var reschedHtml = canCancel ? (
        '<div style="margin-top:0.6rem;display:flex;gap:0.5rem;flex-wrap:wrap">' +
        '<button class="btn btn--soft btn--sm" id="custResched" type="button">📅 Reschedule</button>' +
        '<button class="btn btn--soft btn--sm" id="custCancel" type="button">Cancel this request</button>' +
        '</div>' +
        '<div class="card hidden" id="reschedForm" style="margin-top:0.6rem">' +
          '<div class="row2">' +
            '<div class="field"><label>New date</label><input type="date" id="reschedDate" min="' + esc(minDate) + '" /></div>' +
            '<div class="field"><label>Time <span class="muted">(optional)</span></label><input type="time" id="reschedTime" /></div>' +
          '</div>' +
          '<div class="field"><label>Note <span class="muted">(optional)</span></label><input type="text" id="reschedNote" placeholder="e.g. mornings are best" maxlength="200" /></div>' +
          '<button class="btn btn--primary btn--block" id="reschedGo" type="button">Request new time →</button>' +
          '<p class="muted" style="margin:0.4rem 0 0">We\'ll text the salon to confirm your new time. 🩷</p>' +
        '</div>'
      ) : '';
      $('trackBody').innerHTML = '<div class="track"><div class="track__code">' + esc(t.petName || 'Your pup') + ' · REF ' + esc(t.code) + '</div>' +
        '<div class="track__status">' + esc(STEPS[t.step] || 'Requested') + (t.step === 5 ? ' 🔔' : '') + '</div>' +
        apptLine +
        '<div class="steps">' + steps + '</div>' +
        reschedHtml +
        '</div>' + loyaltyCard;
      var cc = $('custCancel');
      if (cc) cc.addEventListener('click', function () {
        if (!confirm('Cancel this appointment?')) return;
        api('spaCancelByCode', { code: t.code }).then(function () { toast('Cancelled. Text us to rebook 🩷'); doTrack(); }).catch(function (e) { toast(e.message); });
      });
      var rb = $('custResched');
      if (rb) rb.addEventListener('click', function () { var f = $('reschedForm'); if (f) f.classList.toggle('hidden'); });
      var rg = $('reschedGo');
      if (rg) rg.addEventListener('click', function () {
        var d = $('reschedDate').value;
        if (!d) { toast('Pick a new date ✨'); return; }
        rg.disabled = true;
        api('spaRescheduleByCode', { code: t.code, apptDate: d, apptTime: $('reschedTime').value || '', note: $('reschedNote').value || '' })
          .then(function () { toast('New time requested — we\'ll confirm shortly! 🩷'); doTrack(); })
          .catch(function (e) { toast(e.message); rg.disabled = false; });
      });
    }).catch(function (err) {
      $('trackBody').innerHTML = '<div class="empty"><div class="big">🔍</div><p>' + esc(err.message || 'No booking found for that code.') + '</p></div>';
    });
  }
  function loyaltyHtml(l, petName) {
    var visits = Number(l.visits) || 0;
    var spent = Number(l.spent) || 0;
    if (visits < 1) {
      return '<div class="loyalty"><div class="loyalty__head">🏆 Loyalty</div>' +
        '<p class="muted" style="margin:0.2rem 0 0">This will be ' + esc(petName || 'your pup') + '\'s first visit with us — welcome to the pack! 🐩</p></div>';
    }
    return '<div class="loyalty"><div class="loyalty__head">🏆 Loyalty</div>' +
      '<div class="loyalty__stats">' +
      '<div class="loyalty__stat"><span class="loyalty__num">' + visits + '</span><span class="loyalty__lbl">visit' + (visits === 1 ? '' : 's') + '</span></div>' +
      '<div class="loyalty__stat"><span class="loyalty__num">' + money(spent) + '</span><span class="loyalty__lbl">spent with us</span></div>' +
      '</div>' +
      '<p class="muted" style="margin:0.4rem 0 0">Thank you for pampering ' + esc(petName || 'your pup') + ' with us! 🩷</p></div>';
  }
  $('trackGo').addEventListener('click', doTrack);
  $('trackCode').addEventListener('keydown', function (e) { if (e.key === 'Enter') doTrack(); });

  /* =================================================================
     STAFF — PIN gate
     ================================================================= */
  function staffUnlocked() { return !!staffPin; }
  function can(min) {
    var rank = { stylist: 1, manager: 2, owner: 3 };
    return (rank[staffRole] || 0) >= (rank[min] || 0);
  }
  function setStaffUI(on) {
    $('staffToggle').classList.toggle('on', on);
    $('staffToggle').textContent = on ? ('🔓 ' + (staffName || 'Staff')) : '🔒 Staff';
    document.querySelector('.nav__staff').classList.toggle('hidden', !on);
    document.querySelectorAll('[data-min-role]').forEach(function (el) {
      var ok = on && can(el.dataset.minRole);
      el.classList.toggle('hidden', !ok);
      el.hidden = !ok;
      if ('disabled' in el) el.disabled = !ok;
    });
  }
  $('staffToggle').addEventListener('click', function () {
    if (staffUnlocked()) { staffPin = null; staffRole = null; staffName = ''; setStaffUI(false); go('home'); return; }
    $('pinInput').value = ''; $('pinModal').classList.add('open'); setTimeout(function () { $('pinInput').focus(); }, 100);
  });
  $('pinGo').addEventListener('click', function () {
    var pin = $('pinInput').value.trim();
    if (!pin) return;
    $('pinGo').disabled = true;
    api('spaLogin', { pin: pin }).then(function (res) {
      var actor = res.actor || {};
      staffPin = pin; staffRole = actor.role || 'stylist'; staffName = actor.name || '';
      return fetchBoard();
    }).then(function () {
      $('pinModal').classList.remove('open'); setStaffUI(true); go('staff'); showSub('board');
      if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }).catch(function (err) {
      toast(err.message || 'Wrong PIN');
    }).then(function () { $('pinGo').disabled = false; });
  });
  $('pinInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('pinGo').click(); });
  $('pinCancel').addEventListener('click', function () { $('pinModal').classList.remove('open'); });

  /* ---------- staff subnav ---------- */
  function showSub(sub) {
    currentSub = sub;
    document.querySelectorAll('#staffSubnav .pill').forEach(function (b) { b.classList.toggle('sel', b.dataset.sub === sub); });
    document.querySelectorAll('.staff__pane').forEach(function (p) { p.classList.toggle('hidden', p.dataset.sub !== sub); });
    if (sub === 'board') renderBoard();
    if (sub === 'ledger') loadLedger();
    if (sub === 'clients') loadClients();
    if (sub === 'vaxdue') loadVaxDue();
    if (sub === 'upcoming') loadUpcoming();
    if (sub === 'waitlist') loadWaitlist();
    if (sub === 'retail') loadInventory();
    if (sub === 'route') loadRoutePane();
    if (sub === 'reports') loadReport();
    if (sub === 'fees') loadFees();
  }
  document.querySelectorAll('#staffSubnav .pill').forEach(function (b) { b.addEventListener('click', function () { showSub(b.dataset.sub); }); });

  /* ---------- waitlist (customer join) ---------- */
  var wlBtn = $('wlJoinBtn');
  if (wlBtn) wlBtn.addEventListener('click', function () {
    var pet = $('wlPet').value.trim();
    var phone = $('wlPhone').value.trim();
    if (!pet) { toast('Add your pet\'s name ✨'); return; }
    if (!phone) { toast('Add a mobile number so we can text you 📱'); return; }
    wlBtn.disabled = true;
    api('spaWaitlistJoin', {
      petName: pet, ownerName: $('wlName').value.trim(), phone: phone,
      prefDates: $('wlPref').value.trim(), company: $('wlHp').value
    }).then(function () {
      toast('You\'re on the waitlist! We\'ll text you the moment a spot opens 🩷');
      $('wlPet').value = ''; $('wlName').value = ''; $('wlPhone').value = ''; $('wlPref').value = '';
    }).catch(function (e) { toast(e.message); }).then(function () { wlBtn.disabled = false; });
  });

  /* =================================================================
     STAFF — waitlist
     ================================================================= */
  function loadWaitlist() {
    $('waitlistBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaWaitlist', { pin: staffPin }).then(function (res) {
      var entries = res.entries || [];
      if (!entries.length) { $('waitlistBody').innerHTML = '<div class="empty"><div class="big">🎟️</div><p>No one on the waitlist right now.</p></div>'; return; }
      $('waitlistBody').innerHTML = entries.map(function (e) {
        var when = e.prefDates ? '<div class="muted">Wants: ' + esc(e.prefDates) + '</div>' : '';
        var status = e.status === 'notified'
          ? '<span class="statuschip statuschip--ready">Texted ' + (Number(e.notifyCount) || 1) + '×</span>'
          : '<span class="statuschip statuschip--go">Waiting</span>';
        return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem">' +
          '<div><strong>' + esc(e.petName || 'Pup') + '</strong>' + (e.ownerName ? ' · ' + esc(e.ownerName) : '') + '<br><a href="tel:' + esc(e.phone) + '">' + esc(e.phone) + '</a>' + when + '</div>' +
          '<div>' + status + '</div></div>' +
          '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">' +
          '<button class="btn btn--primary btn--sm" data-wl-notify="' + esc(e.id) + '" type="button">📲 Text: slot open</button>' +
          '<button class="btn btn--soft btn--sm" data-wl-booked="' + esc(e.id) + '" type="button">✓ Booked</button>' +
          '<button class="btn btn--soft btn--sm" data-wl-remove="' + esc(e.id) + '" type="button">✕ Remove</button>' +
          '</div></div>';
      }).join('');
      $('waitlistBody').querySelectorAll('[data-wl-notify]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          btn.disabled = true;
          api('spaWaitlistNotify', { pin: staffPin, id: btn.dataset.wlNotify }).then(function () { toast('Texted! 📲'); loadWaitlist(); }).catch(function (err) { toast(err.message); btn.disabled = false; });
        });
      });
      $('waitlistBody').querySelectorAll('[data-wl-booked]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          api('spaWaitlistRemove', { pin: staffPin, id: btn.dataset.wlBooked, status: 'booked' }).then(function () { toast('Marked booked ✓'); loadWaitlist(); }).catch(function (err) { toast(err.message); });
        });
      });
      $('waitlistBody').querySelectorAll('[data-wl-remove]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('Remove from waitlist?')) return;
          api('spaWaitlistRemove', { pin: staffPin, id: btn.dataset.wlRemove }).then(function () { loadWaitlist(); }).catch(function (err) { toast(err.message); });
        });
      });
    }).catch(function (e) { $('waitlistBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  var wlRefresh = $('waitlistRefresh'); if (wlRefresh) wlRefresh.addEventListener('click', loadWaitlist);

  /* =================================================================
     STAFF — retail / inventory
     ================================================================= */
  var invCache = [];
  var invEditId = null;
  var invAdjId = null;
  function loadInventory() {
    $('invBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaInventoryList', { pin: staffPin }).then(function (res) {
      invCache = res.products || [];
      $('invStockValue').textContent = 'Stock value: ' + money(res.stockValue || 0);
      if (!invCache.length) { $('invBody').innerHTML = '<div class="empty"><div class="big">🛍️</div><p>No products yet. Add shampoo, bows, treats &amp; more.</p></div>'; return; }
      var mgr = can('manager');
      $('invBody').innerHTML = invCache.map(function (p) {
        var low = p.lowStock ? '<span class="statuschip statuschip--ready">Low stock</span>' : '';
        var inactive = !p.active ? '<span class="statuschip">Retired</span>' : '';
        var meta = [p.category, p.sku ? 'SKU ' + p.sku : ''].filter(Boolean).join(' · ');
        var btns = mgr ? (
          '<button class="btn btn--soft btn--sm" data-inv-adj="' + esc(p.id) + '" type="button">± Stock</button>' +
          '<button class="btn btn--soft btn--sm" data-inv-edit="' + esc(p.id) + '" type="button">✎ Edit</button>' +
          (p.active ? '<button class="btn btn--soft btn--sm" data-inv-del="' + esc(p.id) + '" type="button">✕ Retire</button>' : '')
        ) : '';
        return '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;gap:0.5rem">' +
          '<div><strong>' + esc(p.name) + '</strong> ' + low + ' ' + inactive +
          (meta ? '<br><span class="muted">' + esc(meta) + '</span>' : '') +
          '<br><span class="muted">' + money(p.price) + ' · cost ' + money(p.cost) + '</span></div>' +
          '<div style="text-align:right"><div class="total__amt" style="font-size:1.3rem">' + p.qty + '</div><span class="muted">on hand</span></div></div>' +
          (btns ? '<div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-top:0.5rem">' + btns + '</div>' : '') +
          '</div>';
      }).join('');
      $('invBody').querySelectorAll('[data-inv-adj]').forEach(function (btn) { btn.addEventListener('click', function () { openInvAdjust(btn.dataset.invAdj); }); });
      $('invBody').querySelectorAll('[data-inv-edit]').forEach(function (btn) { btn.addEventListener('click', function () { openInvEditor(btn.dataset.invEdit); }); });
      $('invBody').querySelectorAll('[data-inv-del]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          if (!confirm('Retire this product? Past sales keep their history.')) return;
          api('spaInventoryDelete', { pin: staffPin, id: btn.dataset.invDel }).then(function () { toast('Retired'); loadInventory(); }).catch(function (e) { toast(e.message); });
        });
      });
    }).catch(function (e) { $('invBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function openInvEditor(id) {
    var p = invCache.filter(function (x) { return x.id === id; })[0];
    invEditId = id || null;
    $('invModalTitle').textContent = p ? 'Edit product' : 'New product';
    $('invName').value = p ? p.name : '';
    $('invSku').value = p ? p.sku : '';
    $('invCategory').value = p ? p.category : '';
    $('invPrice').value = p ? p.price : '';
    $('invCost').value = p ? p.cost : '';
    $('invQty').value = p ? p.qty : 0;
    $('invQty').disabled = !!p; // qty is managed via stock adjust once created
    $('invThreshold').value = p ? p.lowStockThreshold : 3;
    $('invActive').checked = p ? p.active : true;
    $('invModal').classList.add('open');
  }
  function openInvAdjust(id) {
    invAdjId = id;
    var p = invCache.filter(function (x) { return x.id === id; })[0];
    $('invAdjTitle').textContent = 'Adjust stock — ' + (p ? p.name : '');
    $('invAdjDelta').value = ''; $('invAdjReason').value = 'received'; $('invAdjCost').value = p ? p.cost : '';
    $('invAdjModal').classList.add('open');
  }
  var invAddBtn = $('invAddBtn'); if (invAddBtn) invAddBtn.addEventListener('click', function () { openInvEditor(null); });
  var invRefresh = $('invRefresh'); if (invRefresh) invRefresh.addEventListener('click', loadInventory);
  var invCancel = $('invCancel'); if (invCancel) invCancel.addEventListener('click', function () { $('invModal').classList.remove('open'); });
  var invSave = $('invSave'); if (invSave) invSave.addEventListener('click', function () {
    var name = $('invName').value.trim();
    if (!name) { toast('Product name is required'); return; }
    invSave.disabled = true;
    api('spaInventorySave', {
      pin: staffPin, id: invEditId, name: name, sku: $('invSku').value.trim(), category: $('invCategory').value.trim(),
      price: Number($('invPrice').value) || 0, cost: Number($('invCost').value) || 0,
      qty: Number($('invQty').value) || 0, lowStockThreshold: Number($('invThreshold').value) || 0,
      active: $('invActive').checked
    }).then(function () { $('invModal').classList.remove('open'); toast('Saved ✓'); loadInventory(); })
      .catch(function (e) { toast(e.message); }).then(function () { invSave.disabled = false; });
  });
  var invAdjCancel = $('invAdjCancel'); if (invAdjCancel) invAdjCancel.addEventListener('click', function () { $('invAdjModal').classList.remove('open'); });
  var invAdjSave = $('invAdjSave'); if (invAdjSave) invAdjSave.addEventListener('click', function () {
    var delta = Math.floor(Number($('invAdjDelta').value) || 0);
    if (!delta) { toast('Enter a non-zero change'); return; }
    invAdjSave.disabled = true;
    api('spaInventoryAdjust', { pin: staffPin, id: invAdjId, delta: delta, reason: $('invAdjReason').value, unitCost: Number($('invAdjCost').value) || 0 })
      .then(function () { $('invAdjModal').classList.remove('open'); toast('Stock updated ✓'); loadInventory(); })
      .catch(function (e) { toast(e.message); }).then(function () { invAdjSave.disabled = false; });
  });

  /* =================================================================
     STAFF — mobile-grooming route optimizer
     ================================================================= */
  var rtStops = [];
  function loadRoutePane() {
    api('spaRouteConfig', { pin: staffPin }).then(function (res) {
      var c = res.config || {};
      $('rtBaseAddr').value = c.baseLabel || '';
      $('rtBaseLat').value = (c.baseLat != null ? c.baseLat : '');
      $('rtBaseLng').value = (c.baseLng != null ? c.baseLng : '');
      $('rtRoundTrip').checked = c.roundTrip !== false;
      $('rtAutoGeo').checked = c.autoGeocode !== false;
    }).catch(function () {});
    if (!rtStops.length) rtStops = [{ label: '', address: '' }];
    drawRtStops();
  }
  function drawRtStops() {
    $('rtStops').innerHTML = rtStops.map(function (s, i) {
      return '<div class="card" style="padding:0.6rem;margin-bottom:0.4rem">' +
        '<div class="row2" style="gap:0.4rem"><div class="field" style="margin:0"><label>Pet / client</label><input type="text" data-rt-label="' + i + '" value="' + esc(s.label || '') + '" /></div>' +
        '<button class="btn btn--soft btn--sm" data-rt-del="' + i + '" type="button" style="height:44px;align-self:end">✕</button></div>' +
        '<div class="field" style="margin:0.3rem 0 0"><label>Address</label><input type="text" data-rt-addr="' + i + '" value="' + esc(s.address || '') + '" placeholder="Street, City, State" /></div>' +
        '</div>';
    }).join('');
    $('rtStops').querySelectorAll('[data-rt-label]').forEach(function (el) { el.addEventListener('input', function () { rtStops[el.dataset.rtLabel].label = el.value; }); });
    $('rtStops').querySelectorAll('[data-rt-addr]').forEach(function (el) { el.addEventListener('input', function () { rtStops[el.dataset.rtAddr].address = el.value; }); });
    $('rtStops').querySelectorAll('[data-rt-del]').forEach(function (el) { el.addEventListener('click', function () { rtStops.splice(el.dataset.rtDel, 1); if (!rtStops.length) rtStops = [{ label: '', address: '' }]; drawRtStops(); }); });
  }
  var rtAddStop = $('rtAddStop'); if (rtAddStop) rtAddStop.addEventListener('click', function () { rtStops.push({ label: '', address: '' }); drawRtStops(); });
  var rtBaseAddrEl = $('rtBaseAddr'); if (rtBaseAddrEl) rtBaseAddrEl.addEventListener('input', function () { $('rtBaseLat').value = ''; $('rtBaseLng').value = ''; });
  var rtSaveCfg = $('rtSaveCfg'); if (rtSaveCfg) rtSaveCfg.addEventListener('click', function () {
    rtSaveCfg.disabled = true;
    var payload = { pin: staffPin, roundTrip: $('rtRoundTrip').checked, autoGeocode: $('rtAutoGeo').checked };
    var lat = $('rtBaseLat').value, lng = $('rtBaseLng').value;
    if (lat !== '' && lng !== '') { payload.baseLat = Number(lat); payload.baseLng = Number(lng); payload.baseLabel = $('rtBaseAddr').value.trim(); }
    else if ($('rtBaseAddr').value.trim()) { payload.baseAddress = $('rtBaseAddr').value.trim(); }
    api('spaRouteConfigSave', payload).then(function (res) { toast('Base saved ✓'); var c = res.config || {}; $('rtBaseLat').value = c.baseLat; $('rtBaseLng').value = c.baseLng; })
      .catch(function (e) { toast(e.message); }).then(function () { rtSaveCfg.disabled = false; });
  });
  var rtPull = $('rtPull'); if (rtPull) rtPull.addEventListener('click', function () {
    rtPull.disabled = true;
    $('rtResult').innerHTML = '<p class="muted">Pulling &amp; optimizing today\'s schedule…</p>';
    api('spaRouteOptimize', { pin: staffPin }).then(renderRoute).catch(function (e) { toast(e.message); $('rtResult').innerHTML = ''; }).then(function () { rtPull.disabled = false; });
  });
  var rtOptimize = $('rtOptimize'); if (rtOptimize) rtOptimize.addEventListener('click', function () {
    var stops = rtStops.filter(function (s) { return (s.address && s.address.trim()) || (Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))); });
    if (!stops.length) { toast('Add at least one stop with an address'); return; }
    rtOptimize.disabled = true;
    $('rtResult').innerHTML = '<p class="muted">Optimizing… (locating addresses can take a moment)</p>';
    api('spaRouteOptimize', { pin: staffPin, stops: stops }).then(renderRoute).catch(function (e) { toast(e.message); $('rtResult').innerHTML = ''; }).then(function () { rtOptimize.disabled = false; });
  });
  function renderRoute(res) {
    var order = res.order || [];
    var mapsUrl = '';
    if (order.length) {
      var pts = [res.base.lat + ',' + res.base.lng].concat(order.map(function (s) { return s.lat + ',' + s.lng; }));
      if (res.roundTrip) pts.push(res.base.lat + ',' + res.base.lng);
      mapsUrl = 'https://www.google.com/maps/dir/' + pts.join('/');
    }
    var rows = order.map(function (s, i) {
      return '<div class="card" style="padding:0.6rem;margin-bottom:0.4rem;display:flex;gap:0.7rem;align-items:center">' +
        '<div class="total__amt" style="font-size:1.2rem;min-width:1.6rem">' + (i + 1) + '</div>' +
        '<div><strong>' + esc(s.label || 'Stop') + '</strong>' + (s.apptTime ? ' <span class="muted">' + esc(s.apptTime) + '</span>' : '') +
        (s.address ? '<br><span class="muted">' + esc(s.address) + '</span>' : '') + '</div></div>';
    }).join('');
    var unresolved = (res.unresolved && res.unresolved.length)
      ? '<p class="muted" style="color:#f7c9dd">⚠ Couldn\'t locate: ' + res.unresolved.map(esc).join(', ') + ' — add lat/lng or check the address.</p>' : '';
    $('rtResult').innerHTML = '<div class="card"><h2 style="margin-top:0">Optimized route 🧭</h2>' +
      '<p class="lead">' + order.length + ' stop' + (order.length === 1 ? '' : 's') + ' · ~' + res.miles + ' mi · ~' + res.driveMinutes + ' min driving' + (res.roundTrip ? ' (round trip)' : '') + '</p>' +
      unresolved +
      (mapsUrl ? '<a class="btn btn--gold btn--block" href="' + mapsUrl + '" target="_blank" rel="noopener" style="margin-bottom:0.6rem">🗺️ Open in Google Maps</a>' : '') +
      rows + '</div>';
  }

  /* =================================================================
     STAFF — status board
     ================================================================= */
  function fetchBoard() {
    return api('spaBoard', { pin: staffPin }).then(function (res) { boardCache = res.tickets || []; return boardCache; });
  }
  function renderBoard() {
    fetchBoard().then(drawBoard).catch(function (e) { toast(e.message); });
  }
  function ticketHasPayment(t) { return !!(t && (t.paid || Number(t.finalTotal) > 0 || t.ledgerId)); }
  function drawBoard() {
    var f = $('boardFilter');
    var opts = ['All'].concat(STYLISTS.map(function (s) { return s.name; }).filter(function (n) { return n !== 'No preference'; }));
    f.innerHTML = opts.map(function (o) { return '<button type="button" class="pill ' + (boardFilter === o ? 'sel' : '') + '" data-f="' + esc(o) + '">' + esc(o) + '</button>'; }).join('');
    f.querySelectorAll('[data-f]').forEach(function (el) { el.addEventListener('click', function () { boardFilter = el.dataset.f; drawBoard(); }); });

    var list = boardCache.filter(function (t) { return !t.cancelled; });
    if (boardFilter !== 'All') list = list.filter(function (t) { return t.stylist === boardFilter; });
    var box = $('board');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">🧼</div><p>No pups on the board yet today.</p></div>'; return; }
    box.innerHTML = list.map(function (t) {
      var done = t.step >= 6;
      var ready = t.step === 5;
      var chip = t.voided ? '<span class="statuschip statuschip--done">Voided</span>' : (t.paid ? '<span class="statuschip statuschip--done">Paid ✓</span>' : (done ? '<span class="statuschip statuschip--done">Picked up</span>' : (ready ? '<span class="statuschip statuschip--ready">Ready 🔔</span>' : '<span class="statuschip statuschip--go">' + esc(STEPS[t.step]) + '</span>')));
      var apptBadge = t.apptDate ? '<span class="appt-badge ' + (t.confirmed ? '' : 'appt-badge--pending') + '">📅 ' + esc(t.apptDate) + (t.apptTime ? ' ' + esc(t.apptTime) : '') + (t.confirmed ? ' ✓' : ' · unconfirmed') + '</span>' : '';
      var depBadge = (t.deposit && t.deposit.amount) ? '<span class="appt-badge ' + (t.deposit.status === 'paid' ? '' : 'appt-badge--pending') + '">💳 dep ' + money(t.deposit.amount) + (t.deposit.status === 'paid' ? (t.deposit.applied ? ' applied' : ' paid') : ' ' + esc(t.deposit.status || 'sent')) + '</span>' : '';
      var actions = '';
      if (!done && !t.voided) {
        if (t.step < 5) actions += '<button class="btn btn--primary btn--sm" data-adv="' + t.id + '" data-step="' + (t.step + 1) + '">Next: ' + esc(STEPS[t.step + 1]) + ' →</button>';
        if (t.step === 5) actions += '<button class="btn btn--gold btn--sm" data-adv="' + t.id + '" data-step="6">Mark picked up</button>';
        if (t.step >= 1) actions += '<button class="btn btn--soft btn--sm" data-adv="' + t.id + '" data-step="' + (t.step - 1) + '">‹ Back</button>';
      }
      if (!done && !t.voided) actions += '<button class="btn btn--soft btn--sm" data-sched="' + t.id + '">📅 ' + (t.apptDate ? 'Reschedule' : 'Schedule') + '</button>';
      if (!t.voided && t.apptDate && !t.confirmed) actions += '<button class="btn btn--soft btn--sm" data-confirm="' + t.id + '">✓ Confirm</button>';
      if (!t.paid && !t.voided) actions += '<button class="btn btn--soft btn--sm" data-dep="' + t.id + '">💳 Deposit</button>';
      if (!t.paid && !t.voided) actions += '<button class="btn btn--gold btn--sm" data-co="' + t.id + '">💳 Checkout</button>';
      if ((t.paid || done) && !t.voided) actions += '<button class="btn btn--soft btn--sm" data-rebook="' + t.id + '">🔁 Rebook</button>';
      if (!t.voided) actions += '<button class="btn btn--soft btn--sm" data-cx="' + t.id + '">Cancel</button>';
      if (!t.voided && t.vaxIntake) {
        if (t.vaxIntake.hasFile) actions += '<button class="btn btn--soft btn--sm" data-vaxdoc="' + t.id + '">🔍 Vax proof</button>';
        if (t.vaxIntake.status !== 'verified') actions += '<button class="btn btn--soft btn--sm" data-vaxok="' + t.id + '">✓ Vax OK</button>';
        if (t.vaxIntake.status !== 'rejected') actions += '<button class="btn btn--soft btn--sm" data-vaxno="' + t.id + '">✕ Vax reject</button>';
      }
      if (ticketHasPayment(t)) actions += can('manager') ? '<button class="btn btn--soft btn--sm" data-void="' + t.id + '">Void</button>' : '';
      else if (!t.voided) actions += '<button class="btn btn--soft btn--sm" data-del="' + t.id + '">✕</button>';
      var owner = t.owner || {};
      return '<div class="card ticket ' + (ready ? 'ticket--ready' : '') + (done || t.voided ? ' ticket--done' : '') + '" style="' + (t.voided ? 'opacity:0.6;text-decoration:line-through' : '') + '">' +
        '<div class="ticket__top"><strong>' + esc(t.pet && t.pet.name || t.petName) + '</strong>' + chip + apptBadge + depBadge + vaxIntakeChip(t.vaxIntake) +
        '<span class="ticket__code" style="margin-left:auto">' + esc(t.code) + '</span></div>' +
        '<div class="ticket__svcs">' + esc((t.services || []).join(' · ')) + ' — ' + esc(t.stylist) +
        (t.requestedTime ? ' · ' + esc(t.requestedTime) : '') + (t.est ? ' · est ' + money(t.est) : '') +
        (t.finalTotal ? ' · <strong>paid ' + money(t.finalTotal) + '</strong>' : '') + '</div>' +
        (owner.name || owner.phone ? '<div class="muted">📱 ' + esc(owner.name || '') + (owner.phone ? ' · ' + esc(owner.phone) : '') + '</div>' : '') +
        (t.pet && t.pet.notes ? '<div class="muted">📝 ' + esc(t.pet.notes) + '</div>' : '') +
        safetyLine(t.safety) +
        (t.vaxIntake && t.vaxIntake.status === 'rejected' && t.vaxIntake.reason ? '<div class="muted">💉 Rejected: ' + esc(t.vaxIntake.reason) + '</div>' : '') +
        (t.voided && t.voidReason ? '<div class="muted">Void reason: ' + esc(t.voidReason) + '</div>' : '') +
        '<div class="ticket__actions">' + actions + '</div></div>';
    }).join('');

    box.querySelectorAll('[data-adv]').forEach(function (el) { el.addEventListener('click', function () { advance(el.dataset.adv, Number(el.dataset.step)); }); });
    box.querySelectorAll('[data-co]').forEach(function (el) { el.addEventListener('click', function () { openCheckout(el.dataset.co); }); });
    box.querySelectorAll('[data-cx]').forEach(function (el) { el.addEventListener('click', function () { openCancel(el.dataset.cx); }); });
    box.querySelectorAll('[data-del]').forEach(function (el) { el.addEventListener('click', function () {
      if (!confirm('Remove from board? This deletes the ticket.')) return;
      api('spaDelete', { pin: staffPin, id: el.dataset.del }).then(renderBoard).catch(function (e) { toast(e.message); });
    }); });
    box.querySelectorAll('[data-void]').forEach(function (el) { el.addEventListener('click', function () { voidTicket(el.dataset.void); }); });
    box.querySelectorAll('[data-sched]').forEach(function (el) { el.addEventListener('click', function () { openSchedule(el.dataset.sched); }); });
    box.querySelectorAll('[data-confirm]').forEach(function (el) { el.addEventListener('click', function () {
      api('spaConfirm', { pin: staffPin, id: el.dataset.confirm }).then(function () { toast('Confirmed ✓'); renderBoard(); }).catch(function (e) { toast(e.message); });
    }); });
    box.querySelectorAll('[data-dep]').forEach(function (el) { el.addEventListener('click', function () { openDeposit(el.dataset.dep); }); });
    box.querySelectorAll('[data-rebook]').forEach(function (el) { el.addEventListener('click', function () { openRebook(el.dataset.rebook); }); });
    box.querySelectorAll('[data-vaxdoc]').forEach(function (el) { el.addEventListener('click', function () {
      toast('Loading proof…');
      api('spaVaxDoc', { pin: staffPin, ticketId: el.dataset.vaxdoc }).then(function (r) { openDataUrl(r.dataUrl); }).catch(function (e) { toast(e.message); });
    }); });
    box.querySelectorAll('[data-vaxok]').forEach(function (el) { el.addEventListener('click', function () {
      var expires = prompt('Rabies expiration date to save to the pet profile (YYYY-MM-DD)?\nLeave blank to just verify for today.', '');
      if (expires === null) return;
      expires = expires.trim();
      if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) { toast('Use YYYY-MM-DD or leave blank.'); return; }
      api('spaVaxVerify', { pin: staffPin, ticketId: el.dataset.vaxok, status: 'verified', expires: expires }).then(function (r) { toast(r.savedToProfile ? 'Verified & saved to profile 💉✓' : 'Vaccination verified 💉✓'); renderBoard(); }).catch(function (e) { toast(e.message); });
    }); });
    box.querySelectorAll('[data-vaxno]').forEach(function (el) { el.addEventListener('click', function () {
      var reason = prompt('Reason for rejecting this vaccination proof? (shown on the board so the owner can be told what to bring)', '');
      if (reason === null) return;
      api('spaVaxVerify', { pin: staffPin, ticketId: el.dataset.vaxno, status: 'rejected', reason: reason.trim() }).then(function () { toast('Vaccination rejected'); renderBoard(); }).catch(function (e) { toast(e.message); });
    }); });
  }
  function voidTicket(id) {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    var reason = prompt('Reason for voiding this paid ticket?');
    if (reason == null) return;
    reason = reason.trim();
    if (!reason) { toast('Void reason required.'); return; }
    api('spaVoid', { pin: staffPin, id: id, reason: reason }).then(function () { toast('Ticket voided'); renderBoard(); }).catch(function (e) { toast(e.message); });
  }
  function advance(id, step) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0];
    api('spaAdvance', { pin: staffPin, id: id, step: step }).then(function () {
      if (step === 5 && t && 'Notification' in window && Notification.permission === 'granted') {
        try { new Notification('🐩 ' + (t.pet && t.pet.name || 'A pup') + ' is ready for pickup!', { body: 'The Pink Poodle · Ref ' + t.code }); } catch (e) {}
      }
      renderBoard();
    }).catch(function (e) { toast(e.message); });
  }
  $('boardRefresh').addEventListener('click', renderBoard);

  /* ---------- walk-in ---------- */
  $('walkInBtn').addEventListener('click', function () {
    $('wiName').value = '';
    $('wiStylist').innerHTML = STYLISTS.filter(function (s) { return s.name !== 'No preference'; }).map(function (s) { return '<option>' + esc(s.name) + '</option>'; }).join('');
    if (boardFilter !== 'All') $('wiStylist').value = boardFilter;
    $('walkinModal').classList.add('open');
  });
  $('wiCancel').addEventListener('click', function () { $('walkinModal').classList.remove('open'); });
  $('wiSave').addEventListener('click', function () {
    var name = $('wiName').value.trim(); if (!name) { toast('Pet name?'); return; }
    api('spaWalkin', { pin: staffPin, petName: name, stylist: $('wiStylist').value }).then(function () {
      $('walkinModal').classList.remove('open'); toast('Checked in ' + name); renderBoard();
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     CHECKOUT
     ================================================================= */
  function openCheckout(id) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    coState = { id: id, items: [] };
    // Seed line items from the requested services with menu prices.
    (t.services || []).forEach(function (name) {
      var clean = name.replace(/^\+/, '');
      var svc = SERVICES.filter(function (s) { return s.name === clean; })[0];
      var add = ADDONS.filter(function (a) { return a.name === clean; })[0];
      var price = svc ? svc.price : (add ? add.price : 0);
      coState.items.push({ label: clean, amount: price });
    });
    if (!coState.items.length) coState.items.push({ label: (t.services && t.services[0]) || 'Grooming', amount: t.est || 0 });
    $('checkoutTitle').textContent = 'Checkout — ' + (t.pet && t.pet.name || t.petName);
    $('coDiscount').value = 0; $('coTip').value = 0; $('coPay').value = 'Cash';
    drawCoItems();
    $('checkoutModal').classList.add('open');
  }
  function drawCoItems() {
    $('coItems').innerHTML = coState.items.map(function (it, i) {
      if (it.invId) {
        return '<div class="row2" style="grid-template-columns:1fr 56px 90px 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
          '<div><span class="statuschip statuschip--go">🛍️</span> ' + esc(it.label) + '</div>' +
          '<input type="number" data-ci-qty="' + i + '" value="' + (it.qty || 1) + '" min="1" step="1" inputmode="numeric" title="Qty" />' +
          '<input type="number" data-ci-amt="' + i + '" value="' + it.amount + '" min="0" step="1" inputmode="decimal" />' +
          '<button class="btn btn--soft btn--sm" data-ci-del="' + i + '" type="button">✕</button></div>';
      }
      return '<div class="row2" style="grid-template-columns:1fr 90px 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<input type="text" data-ci-label="' + i + '" value="' + esc(it.label) + '" placeholder="Item" />' +
        '<input type="number" data-ci-amt="' + i + '" value="' + it.amount + '" min="0" step="1" inputmode="decimal" />' +
        '<button class="btn btn--soft btn--sm" data-ci-del="' + i + '" type="button">✕</button></div>';
    }).join('');
    $('coItems').querySelectorAll('[data-ci-label]').forEach(function (el) { el.addEventListener('input', function () { coState.items[el.dataset.ciLabel].label = el.value; }); });
    $('coItems').querySelectorAll('[data-ci-qty]').forEach(function (el) { el.addEventListener('input', function () { var it = coState.items[el.dataset.ciQty]; it.qty = Math.max(1, Math.floor(Number(el.value) || 1)); it.amount = Math.round((it.unitPrice || 0) * it.qty * 100) / 100; drawCoItems(); }); });
    $('coItems').querySelectorAll('[data-ci-amt]').forEach(function (el) { el.addEventListener('input', function () { coState.items[el.dataset.ciAmt].amount = Math.max(0, Number(el.value) || 0); coTotal(); }); });
    $('coItems').querySelectorAll('[data-ci-del]').forEach(function (el) { el.addEventListener('click', function () { coState.items.splice(el.dataset.ciDel, 1); drawCoItems(); coTotal(); }); });
    coTotal();
  }
  function coTotal() {
    var gross = coState.items.reduce(function (s, it) { return s + (Number(it.amount) || 0); }, 0);
    var total = Math.max(0, gross - (Number($('coDiscount').value) || 0)) + (Number($('coTip').value) || 0);
    $('coTotal').textContent = money(total);
  }
  $('coAddItem').addEventListener('click', function () { coState.items.push({ label: '', amount: 0 }); drawCoItems(); });
  var coAddProduct = $('coAddProduct'); if (coAddProduct) coAddProduct.addEventListener('click', function () {
    $('prodSearch').value = '';
    $('productModal').classList.add('open');
    var draw = function () {
      var products = (invCache || []).filter(function (p) { return p.active; });
      if (!products.length) { $('prodPickBody').innerHTML = '<p class="muted">No products yet — add some in the Retail tab.</p>'; return; }
      $('prodPickBody').innerHTML = products.map(function (p) {
        var low = p.qty <= 0 ? ' <span class="statuschip statuschip--ready">Out</span>' : (p.lowStock ? ' <span class="statuschip statuschip--ready">Low</span>' : '');
        return '<button class="btn btn--soft btn--block" data-pick="' + esc(p.id) + '" type="button" style="text-align:left;margin-bottom:0.35rem">' +
          '<strong>' + esc(p.name) + '</strong> — ' + money(p.price) + low + ' <span class="muted">(' + p.qty + ' on hand)</span></button>';
      }).join('');
      $('prodPickBody').querySelectorAll('[data-pick]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var p = invCache.filter(function (x) { return x.id === btn.dataset.pick; })[0]; if (!p) return;
          var existing = coState.items.filter(function (it) { return it.invId === p.id; })[0];
          if (existing) { existing.qty = (existing.qty || 1) + 1; existing.amount = Math.round((existing.unitPrice || p.price) * existing.qty * 100) / 100; }
          else { coState.items.push({ label: p.name, invId: p.id, qty: 1, unitPrice: p.price, amount: p.price }); }
          $('productModal').classList.remove('open'); drawCoItems();
        });
      });
    };
    if (!invCache.length) { api('spaInventoryList', { pin: staffPin }).then(function (res) { invCache = res.products || []; draw(); }).catch(function (e) { toast(e.message); }); }
    else draw();
  });
  var prodPickClose = $('prodPickClose'); if (prodPickClose) prodPickClose.addEventListener('click', function () { $('productModal').classList.remove('open'); });
  var prodSearch = $('prodSearch'); if (prodSearch) prodSearch.addEventListener('input', function () {
    var q = prodSearch.value.toLowerCase();
    $('prodPickBody').querySelectorAll('[data-pick]').forEach(function (btn) { btn.style.display = btn.textContent.toLowerCase().indexOf(q) >= 0 ? '' : 'none'; });
  });
  $('coDiscount').addEventListener('input', coTotal);
  $('coTip').addEventListener('input', coTotal);
  $('coCancel').addEventListener('click', function () { $('checkoutModal').classList.remove('open'); });
  $('coSave').addEventListener('click', function () {
    $('coSave').disabled = true;
    api('spaCheckout', {
      pin: staffPin, id: coState.id,
      items: coState.items.filter(function (it) { return it.label && it.amount >= 0; }),
      discount: Number($('coDiscount').value) || 0,
      tip: Number($('coTip').value) || 0,
      payMethod: $('coPay').value
    }).then(function (res) {
      $('checkoutModal').classList.remove('open'); toast('Paid ' + money(res.total) + ' ✓'); renderBoard();
    }).catch(function (e) { toast(e.message); }).then(function () { $('coSave').disabled = false; });
  });

  /* =================================================================
     CANCEL (staff, with optional no-show fee)
     ================================================================= */
  var cxId = null;
  function openCancel(id) { cxId = id; $('cxReason').value = ''; $('cxFee').value = 0; $('cancelModal').classList.add('open'); }
  $('cxCancel').addEventListener('click', function () { $('cancelModal').classList.remove('open'); });
  $('cxSave').addEventListener('click', function () {
    api('spaCancel', { pin: staffPin, id: cxId, reason: $('cxReason').value.trim() || 'Cancelled', noShowFee: Number($('cxFee').value) || 0 })
      .then(function () { $('cancelModal').classList.remove('open'); toast('Cancelled'); renderBoard(); })
      .catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     LEDGER
     ================================================================= */
  function loadLedger() {
    $('ledgerBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaLedger', { pin: staffPin }).then(function (res) {
      var bal = res.balances || [];
      $('ledgerBalances').innerHTML = '<h2 style="margin-top:0">Account balances</h2>' +
        (bal.length ? '<table class="ledger"><tbody>' + bal.map(function (b) {
          return '<tr><td>' + esc(b.acct) + '</td><td style="text-align:right">' + money(b.balance) + '</td></tr>';
        }).join('') + '</tbody></table>' : '<p class="muted">No entries yet.</p>');
      var entries = res.entries || [];
      $('ledgerBody').innerHTML = entries.length ? entries.map(function (e) {
        var lines = (e.lines || []).map(function (l) {
          return '<tr><td>' + esc(l.acct) + '</td><td style="text-align:right">' + (l.dr ? money(l.dr) : '') + '</td><td style="text-align:right">' + (l.cr ? money(l.cr) : '') + '</td></tr>';
        }).join('');
        return '<div class="card"><div class="ticket__top"><strong>' + esc(e.date || '') + '</strong><span class="muted" style="margin-left:auto">' + esc(e.ref || '') + '</span></div>' +
          '<div class="muted">' + esc(e.memo || '') + '</div>' +
          '<table class="ledger"><thead><tr><th>Account</th><th style="text-align:right">Debit</th><th style="text-align:right">Credit</th></tr></thead><tbody>' + lines + '</tbody></table></div>';
      }).join('') : '<div class="empty"><div class="big">📒</div><p>No journal entries yet.</p></div>';
    }).catch(function (e) { $('ledgerBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  $('ledgerRefresh').addEventListener('click', loadLedger);
  $('ledgerAddBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    $('leDate').value = todayISO(); $('leMemo').value = ''; $('leDebit').value = ''; $('leCredit').value = ''; $('leAmount').value = '';
    $('ledgerModal').classList.add('open');
  });
  $('leCancel').addEventListener('click', function () { $('ledgerModal').classList.remove('open'); });
  $('leSave').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    api('spaLedgerAdd', { pin: staffPin, date: $('leDate').value, memo: $('leMemo').value.trim(), debit: $('leDebit').value.trim(), credit: $('leCredit').value.trim(), amount: Number($('leAmount').value) || 0 })
      .then(function () { $('ledgerModal').classList.remove('open'); toast('Entry posted 📒'); loadLedger(); })
      .catch(function (e) { toast(e.message); });
  });
  $('ledgerCsvBtn').addEventListener('click', function () {
    api('spaLedger', { pin: staffPin }).then(function (res) {
      var rows = [['Date', 'Ref', 'Memo', 'Account', 'Debit', 'Credit']];
      (res.entries || []).forEach(function (e) {
        (e.lines || []).forEach(function (l) { rows.push([e.date || '', e.ref || '', e.memo || '', l.acct, l.dr || '', l.cr || '']); });
      });
      dl('pink-poodle-ledger-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     CLIENTS CRM  (owners → pets → vaccination · visits · spend)
     ================================================================= */
  var clientsCache = [];
  var editPets = [];          // pets in the currently-open client modal
  var editPhones = [];
  var editPickups = [];       // authorized-pickup people in the open client modal
  var editingClientId = '';

  function vaxStatusBadge(status) {
    var map = {
      ok: { cls: 'vax--current', icon: '✅', label: 'Vaccines OK' },
      unknown: { cls: 'vax--unknown', icon: '❔', label: 'Vaccines unknown' },
      expiring: { cls: 'vax--expiring', icon: '⏳', label: 'Vaccines expiring' },
      expired: { cls: 'vax--expired', icon: '⚠️', label: 'Vaccines expired' },
      missing: { cls: 'vax--expired', icon: '⚠️', label: 'Vaccines missing' }
    };
    return map[status] || map.unknown;
  }
  function vaxBadge(status) {
    var v = vaxStatusBadge(status);
    return '<span class="vaxbadge ' + v.cls + '">' + v.icon + ' ' + esc(v.label) + '</span>';
  }
  // Booking-time vaccination intake (upload proof now vs. bring a copy) shown on
  // the live board so a groomer sees compliance state before touching the pet.
  function vaxIntakeChip(vi) {
    if (!vi) return '';
    var st = vi.status || 'pending';
    if (vi.reverifyNeeded && st !== 'verified' && st !== 'rejected') {
      return '<span class="appt-badge appt-badge--pending">💉 re-uploaded — re-verify</span>';
    }
    var label = st === 'verified' ? '💉 Vax ✓'
      : st === 'rejected' ? '💉 Vax rejected'
      : vi.mode === 'upload' ? (vi.hasFile ? '💉 proof — review' : '💉 upload pending')
      : '💉 bring copy';
    return '<span class="appt-badge ' + (st === 'verified' ? '' : 'appt-badge--pending') + '">' + esc(label) + '</span>';
  }
  function openDataUrl(dataUrl) {
    try {
      var parts = dataUrl.split(',');
      var mime = (parts[0].match(/:(.*?);/) || [])[1] || 'application/octet-stream';
      var bin = atob(parts[1]); var arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var url = URL.createObjectURL(new Blob([arr], { type: mime }));
      window.open(url, '_blank');
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
    } catch (e) { window.open(dataUrl, '_blank'); }
  }
  // Compact safety/contact block staff need at the counter (drop-off & pickup).
  function safetyLine(s) {
    if (!s) return '';
    var out = '';
    if (s.emergencyName || s.emergencyPhone) out += '<div class="muted">🆘 ' + esc(s.emergencyName || '') + (s.emergencyRelation ? ' (' + esc(s.emergencyRelation) + ')' : '') + (s.emergencyPhone ? ' · ' + esc(s.emergencyPhone) : '') + '</div>';
    if (s.authorizedPickup && s.authorizedPickup.length) out += '<div class="muted">🤝 Pickup: ' + s.authorizedPickup.map(function (x) { return esc(x.name || '') + (x.phone ? ' (' + esc(x.phone) + ')' : ''); }).join(', ') + '</div>';
    if (s.vetName || s.vetClinic || s.vetPhone) out += '<div class="muted">🩺 ' + esc([s.vetName, s.vetClinic].filter(Boolean).join(' · ')) + (s.vetPhone ? ' · ' + esc(s.vetPhone) : '') + '</div>';
    return out;
  }
  function phonesFor(c) {
    var phones = (c && c.phones && c.phones.length) ? c.phones : (c && c.phone ? [{ type: 'Mobile', number: c.phone }] : []);
    return phones.filter(function (p) { return p && p.number; }).map(function (p) { return { type: p.type || 'Mobile', number: p.number || '' }; });
  }
  function primaryPhone(c) { var phones = phonesFor(c); return phones.length ? phones[0].number : ''; }
  function phoneLines(c) {
    var phones = phonesFor(c);
    return phones.map(function (p) { return '<div class="muted">📱 ' + esc(p.type || 'Phone') + ': ' + esc(p.number) + '</div>'; }).join('');
  }
  function vaxSummary(p) {
    return (p.vaccinations || []).filter(function (v) { return v && v.type; }).map(function (v) {
      return v.type + (v.expires ? ':' + v.expires : '') + (v.verifiedAt ? ' verified ' + v.verifiedAt : '') + (v.notes ? ' (' + v.notes + ')' : '');
    }).join('; ');
  }
  function rabiesFrom(vaccinations) {
    var r = (vaccinations || []).filter(function (v) { return /^rabies$/i.test(v.type || ''); })[0];
    return r ? (r.expires || '') : '';
  }
  function smsHref(phone, name) {
    var msg = 'Hi ' + (name ? name.split(' ')[0] : 'there') + '! It\u2019s The Pink Poodle \uD83D\uDC29 — ';
    return 'sms:' + String(phone).replace(/[^\d+]/g, '') + '?&body=' + encodeURIComponent(msg);
  }

  function loadClients() {
    $('clientsBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaClients', { pin: staffPin }).then(function (res) {
      clientsCache = res.clients || [];
      requiredVax = res.requiredVax || res.required || requiredVax;
      knownVax = res.knownVax || res.known || knownVax;
      clientsCache.sort(function (a, b) { return (a.name || 'zzz').toLowerCase() < (b.name || 'zzz').toLowerCase() ? -1 : 1; });
      drawClients();
    }).catch(function (e) { $('clientsBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawClients() {
    var q = ($('clientSearch').value || '').trim().toLowerCase();
    var list = clientsCache.filter(function (c) {
      if (!q) return true;
      var allPhones = phonesFor(c).map(function (p) { return p.number; }).join(' ');
      var hay = (c.name || '') + ' ' + (c.phone || '') + ' ' + allPhones + ' ' + (c.email || '') + ' ' + (c.pets || []).map(function (p) { return p.name + ' ' + p.breed; }).join(' ');
      return hay.toLowerCase().indexOf(q) >= 0;
    });
    var box = $('clientsBody');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="big">📇</div><p>' + (q ? 'No matches.' : 'No clients yet — they appear automatically after the first booking.') + '</p></div>'; return; }
    box.innerHTML = list.map(function (c, i) {
      var idx = clientsCache.indexOf(c);
      var pets = (c.pets || []).map(function (p) {
        return '<div class="petrow"><span class="petrow__name">🐩 ' + esc(p.name || 'Pet') +
          (p.breed ? ' <span class="muted">· ' + esc(p.breed) + '</span>' : '') +
          (p.size ? ' <span class="muted">· ' + esc(p.size) + '</span>' : '') + '</span>' +
          vaxBadge(p.vaxStatus) +
          (p.temperament ? '<div class="muted">🐾 ' + esc(p.temperament) + '</div>' : '') +
          (p.notes ? '<div class="muted">📝 ' + esc(p.notes) + '</div>' : '') +
          (vaxSummary(p) ? '<div class="muted">💉 ' + esc(vaxSummary(p)) + '</div>' : (p.vaxNotes ? '<div class="muted">💉 ' + esc(p.vaxNotes) + '</div>' : '')) +
          ((p.vetName || p.vetClinic || p.vetPhone) ? '<div class="muted">🩺 ' + esc([p.vetName, p.vetClinic].filter(Boolean).join(' · ')) + (p.vetPhone ? ' · ' + esc(p.vetPhone) : '') + '</div>' : '') + '</div>';
      }).join('');
      var safety = '';
      if (c.emergencyName || c.emergencyPhone) safety += '<div class="muted">🆘 ' + esc(c.emergencyName || '') + (c.emergencyRelation ? ' (' + esc(c.emergencyRelation) + ')' : '') + (c.emergencyPhone ? ' · ' + esc(c.emergencyPhone) : '') + '</div>';
      if (c.authorizedPickup && c.authorizedPickup.length) safety += '<div class="muted">🤝 Pickup: ' + c.authorizedPickup.map(function (x) { return esc(x.name || '') + (x.phone ? ' (' + esc(x.phone) + ')' : ''); }).join(', ') + '</div>';
      var contact = '';
      var phone = primaryPhone(c);
      if (phone) contact += '<a class="btn btn--soft btn--sm" href="tel:' + esc(phone) + '">📞 Call</a>' +
        '<a class="btn btn--soft btn--sm" href="' + esc(smsHref(phone, c.name)) + '">💬 Text</a>';
      if (c.email) contact += '<a class="btn btn--soft btn--sm" href="mailto:' + esc(c.email) + '">✉️ Email</a>';
      return '<div class="card client">' +
        '<div class="ticket__top"><strong>' + esc(c.name || '(no name)') + '</strong>' +
        vaxBadge(c.vaxStatus) +
        (c.derived ? '<span class="statuschip statuschip--go" title="From bookings — not yet saved">auto</span>' : '') +
        '<span class="ticket__code" style="margin-left:auto">' + (c.visits || 0) + ' visit' + ((c.visits || 0) === 1 ? '' : 's') + ' · ' + money(c.spent || 0) + '</span></div>' +
        phoneLines(c) +
        (c.notes ? '<div class="muted">🗒️ ' + esc(c.notes) + '</div>' : '') +
        safety +
        '<div class="client__contact">' + contact + '</div>' +
        (pets || '<div class="muted">No pets on file yet.</div>') +
        '<div class="ticket__actions"><button class="btn btn--gold btn--sm" data-cledit="' + idx + '">✎ Edit / add pet</button>' +
        (c.derived || !can('manager') ? '' : '<button class="btn btn--soft btn--sm" data-cldel="' + idx + '">Delete</button>') + '</div></div>';
    }).join('');
    box.querySelectorAll('[data-cledit]').forEach(function (el) { el.addEventListener('click', function () { openClient(clientsCache[Number(el.dataset.cledit)]); }); });
    box.querySelectorAll('[data-cldel]').forEach(function (el) { el.addEventListener('click', function () {
      var c = clientsCache[Number(el.dataset.cldel)];
      if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
      if (!c.id || !confirm('Delete ' + (c.name || 'this client') + '? Their visit history on tickets is kept.')) return;
      api('spaClientDelete', { pin: staffPin, id: c.id }).then(function () { toast('Client deleted'); loadClients(); }).catch(function (e) { toast(e.message); });
    }); });
  }
  $('clientSearch').addEventListener('input', drawClients);
  $('clientsRefresh').addEventListener('click', loadClients);
  $('clientAddBtn').addEventListener('click', function () { openClient(null); });

  /* ---- client modal ---- */
  function openClient(c) {
    c = c || {};
    editingClientId = c.id || '';
    editPets = (c.pets || []).map(function (p) { return Object.assign({}, p); });
    editPhones = phonesFor(c);
    if (!editPhones.length) editPhones = [{ type: 'Mobile', number: '' }];
    $('clientModalTitle').textContent = c.name ? 'Edit ' + c.name : 'New client';
    $('clId').value = c.id || '';
    $('clName').value = c.name || '';
    $('clEmail').value = c.email || '';
    $('clNotes').value = c.notes || '';
    $('clEmName').value = c.emergencyName || '';
    $('clEmRel').value = c.emergencyRelation || '';
    $('clEmPhone').value = c.emergencyPhone || '';
    editPickups = (c.authorizedPickup || []).map(function (x) { return { name: x.name || '', phone: x.phone || '' }; });
    $('clDelete').style.display = c.id && can('manager') ? '' : 'none';
    drawEditPhones();
    drawEditPickups();
    drawEditPets();
    $('clientModal').classList.add('open');
  }
  function closeClient() { $('clientModal').classList.remove('open'); }
  function drawEditPhones() {
    $('clPhones').innerHTML = editPhones.map(function (p, i) {
      return '<div class="row2" style="grid-template-columns:110px 1fr 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<select data-phone-type="' + i + '"><option' + (p.type === 'Mobile' ? ' selected' : '') + '>Mobile</option><option' + (p.type === 'Home' ? ' selected' : '') + '>Home</option><option' + (p.type === 'Work' ? ' selected' : '') + '>Work</option><option' + (p.type === 'Other' ? ' selected' : '') + '>Other</option></select>' +
        '<input type="tel" data-phone-number="' + i + '" value="' + esc(p.number) + '" placeholder="(304) 555-1234" inputmode="tel" />' +
        '<button class="btn btn--soft btn--sm" data-phone-rm="' + i + '" type="button">✕</button></div>';
    }).join('');
    $('clPhones').querySelectorAll('[data-phone-type]').forEach(function (el) { el.addEventListener('change', function () { editPhones[el.dataset.phoneType].type = el.value; }); });
    $('clPhones').querySelectorAll('[data-phone-number]').forEach(function (el) { el.addEventListener('input', function () { editPhones[el.dataset.phoneNumber].number = el.value; }); });
    $('clPhones').querySelectorAll('[data-phone-rm]').forEach(function (el) { el.addEventListener('click', function () {
      editPhones.splice(Number(el.dataset.phoneRm), 1);
      if (!editPhones.length) editPhones.push({ type: 'Mobile', number: '' });
      drawEditPhones();
    }); });
  }
  function drawEditPickups() {
    $('clPickups').innerHTML = editPickups.map(function (p, i) {
      return '<div class="row2" style="grid-template-columns:1fr 1fr 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<input type="text" data-pickup-name="' + i + '" value="' + esc(p.name) + '" placeholder="Name" />' +
        '<input type="tel" data-pickup-phone="' + i + '" value="' + esc(p.phone) + '" placeholder="Phone" inputmode="tel" />' +
        '<button class="btn btn--soft btn--sm" data-pickup-rm="' + i + '" type="button">✕</button></div>';
    }).join('') || '<p class="muted" style="margin:0 0 0.4rem;font-size:0.82rem">None added.</p>';
    $('clPickups').querySelectorAll('[data-pickup-name]').forEach(function (el) { el.addEventListener('input', function () { editPickups[el.dataset.pickupName].name = el.value; }); });
    $('clPickups').querySelectorAll('[data-pickup-phone]').forEach(function (el) { el.addEventListener('input', function () { editPickups[el.dataset.pickupPhone].phone = el.value; }); });
    $('clPickups').querySelectorAll('[data-pickup-rm]').forEach(function (el) { el.addEventListener('click', function () {
      editPickups.splice(Number(el.dataset.pickupRm), 1);
      drawEditPickups();
    }); });
  }
  function drawEditPets() {
    $('clPets').innerHTML = editPets.length ? editPets.map(function (p, i) {
      return '<div class="petrow petrow--edit"><span class="petrow__name">🐩 ' + esc(p.name || 'Pet') +
        (p.breed ? ' <span class="muted">· ' + esc(p.breed) + '</span>' : '') + '</span>' +
        vaxBadge(p.vaxStatus) +
        '<span style="margin-left:auto"><button class="btn btn--soft btn--sm" data-petedit="' + i + '" type="button">✎</button>' +
        '<button class="btn btn--soft btn--sm" data-petrm="' + i + '" type="button">✕</button></span></div>';
    }).join('') : '<p class="muted">No pets yet — add one below.</p>';
    $('clPets').querySelectorAll('[data-petedit]').forEach(function (el) { el.addEventListener('click', function () { openPet(Number(el.dataset.petedit)); }); });
    $('clPets').querySelectorAll('[data-petrm]').forEach(function (el) { el.addEventListener('click', function () {
      editPets.splice(Number(el.dataset.petrm), 1); drawEditPets();
    }); });
  }
  $('clCancel').addEventListener('click', closeClient);
  $('clAddPhone').addEventListener('click', function () { editPhones.push({ type: 'Mobile', number: '' }); drawEditPhones(); });
  $('clAddPickup').addEventListener('click', function () { editPickups.push({ name: '', phone: '' }); drawEditPickups(); });
  $('clAddPet').addEventListener('click', function () { openPet(-1); });
  $('clDelete').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    if (!editingClientId || !confirm('Delete this client?')) return;
    api('spaClientDelete', { pin: staffPin, id: editingClientId }).then(function () { toast('Client deleted'); closeClient(); loadClients(); }).catch(function (e) { toast(e.message); });
  });
  $('clSave').addEventListener('click', function () {
    var phones = editPhones.map(function (p) { return { type: p.type || 'Mobile', number: (p.number || '').trim() }; }).filter(function (p) { return p.number; });
    var client = {
      id: $('clId').value || '',
      name: $('clName').value.trim(),
      phones: phones,
      email: $('clEmail').value.trim(),
      notes: $('clNotes').value.trim(),
      emergencyName: $('clEmName').value.trim(),
      emergencyRelation: $('clEmRel').value.trim(),
      emergencyPhone: $('clEmPhone').value.trim(),
      authorizedPickup: editPickups.map(function (p) { return { name: (p.name || '').trim(), phone: (p.phone || '').trim() }; }).filter(function (p) { return p.name || p.phone; }),
      pets: editPets
    };
    if (!client.name && !phones.length) { toast('Add a name or phone number.'); return; }
    api('spaClientSave', { pin: staffPin, client: client }).then(function () { toast('Client saved 💾'); closeClient(); loadClients(); }).catch(function (e) { toast(e.message); });
  });

  /* ---- pet modal (edits into editPets, saved with the client) ---- */
  var editingPetIdx = -1;
  var editVax = [];
  function openPet(i) {
    editingPetIdx = i;
    var p = i >= 0 ? editPets[i] : {};
    $('petModalTitle').textContent = i >= 0 ? 'Edit ' + (p.name || 'pet') : 'Add pet';
    $('petId').value = p.id || '';
    $('petName').value = p.name || '';
    $('petBreed').value = p.breed || '';
    $('petSize').value = p.size || '';
    $('petTemperament').value = p.temperament || '';
    $('petNotes').value = p.notes || '';
    var g = p.groom || {};
    $('petGroomStyle').value = g.style || '';
    $('petGroomBody').value = g.body || '';
    $('petGroomLegs').value = g.legs || '';
    $('petGroomFace').value = g.face || '';
    $('petGroomEars').value = g.ears || '';
    $('petGroomTail').value = g.tail || '';
    $('petGroomFeet').value = g.feet || '';
    $('petGroomFinish').value = g.finish || '';
    $('petGroomNotes').value = g.notes || '';
    $('petVetName').value = p.vetName || '';
    $('petVetPhone').value = p.vetPhone || '';
    $('petVetClinic').value = p.vetClinic || '';
    loadPetPhotos(p.id || '', editingClientId || '');
    editVax = (p.vaccinations || []).map(function (v) { return Object.assign({}, v); });
    if (!editVax.length && p.rabiesExpires) editVax.push({ type: 'Rabies', expires: p.rabiesExpires, verifiedAt: '', notes: p.vaxNotes || '' });
    if (!editVax.length) editVax.push({ type: 'Rabies', expires: '', verifiedAt: '', notes: '' });
    drawKnownVaxList();
    drawEditVax();
    $('petDelete').style.display = i >= 0 ? '' : 'none';
    $('petModal').classList.add('open');
  }
  function drawKnownVaxList() {
    $('knownVaxList').innerHTML = knownVax.map(function (v) { return '<option value="' + esc(v) + '"></option>'; }).join('');
  }
  function drawEditVax() {
    $('petVaxList').innerHTML = editVax.map(function (v, i) {
      return '<div class="card" style="padding:0.55rem;margin-bottom:0.45rem;background:#fff">' +
        '<div class="field"><label>Type</label><input type="text" data-vax-type="' + i + '" value="' + esc(v.type || '') + '" list="knownVaxList" placeholder="Rabies" /></div>' +
        '<div class="row2"><div class="field"><label>Expires</label><input type="date" data-vax-exp="' + i + '" value="' + esc(v.expires || '') + '" /></div>' +
        '<div class="field"><label>Verified</label><input type="date" data-vax-ver="' + i + '" value="' + esc(v.verifiedAt || '') + '" /></div></div>' +
        '<div class="field"><label>Notes</label><input type="text" data-vax-notes="' + i + '" value="' + esc(v.notes || '') + '" placeholder="optional" /></div>' +
        '<button class="btn btn--soft btn--sm" data-vax-rm="' + i + '" type="button">Remove vaccination</button></div>';
    }).join('');
    $('petVaxList').querySelectorAll('[data-vax-type]').forEach(function (el) { el.addEventListener('input', function () { editVax[el.dataset.vaxType].type = el.value; }); });
    $('petVaxList').querySelectorAll('[data-vax-exp]').forEach(function (el) { el.addEventListener('input', function () { editVax[el.dataset.vaxExp].expires = el.value; petVaxPreview(); }); });
    $('petVaxList').querySelectorAll('[data-vax-ver]').forEach(function (el) { el.addEventListener('input', function () { editVax[el.dataset.vaxVer].verifiedAt = el.value; }); });
    $('petVaxList').querySelectorAll('[data-vax-notes]').forEach(function (el) { el.addEventListener('input', function () { editVax[el.dataset.vaxNotes].notes = el.value; }); });
    $('petVaxList').querySelectorAll('[data-vax-rm]').forEach(function (el) { el.addEventListener('click', function () {
      editVax.splice(Number(el.dataset.vaxRm), 1);
      drawEditVax();
    }); });
    petVaxPreview();
  }
  function petVaxPreview() {
    var summary = editVax.filter(function (v) { return v.type; }).map(function (v) { return (v.type || '') + (v.expires ? ' ' + v.expires : ''); }).join(' · ');
    $('petVaxStatus').innerHTML = summary ? '<p class="muted" style="margin:0.4rem 0 0">' + esc(summary) + '</p>' : '<p class="muted" style="margin:0.4rem 0 0">No vaccinations entered.</p>';
  }
  $('petAddVax').addEventListener('click', function () { editVax.push({ type: '', expires: '', verifiedAt: '', notes: '' }); drawEditVax(); });
  $('petCancel').addEventListener('click', function () { $('petModal').classList.remove('open'); });
  $('petDelete').addEventListener('click', function () {
    if (editingPetIdx >= 0) { editPets.splice(editingPetIdx, 1); drawEditPets(); }
    $('petModal').classList.remove('open');
  });
  $('petSave').addEventListener('click', function () {
    var name = $('petName').value.trim();
    if (!name) { toast('Pet name required.'); return; }
    var vaccinations = editVax.map(function (v) {
      return { type: (v.type || '').trim(), expires: v.expires || '', verifiedAt: v.verifiedAt || '', notes: (v.notes || '').trim() };
    }).filter(function (v) { return v.type; });
    var pet = {
      id: $('petId').value || '',
      name: name,
      breed: $('petBreed').value.trim(),
      size: $('petSize').value,
      temperament: $('petTemperament').value.trim(),
      notes: $('petNotes').value.trim(),
      rabiesExpires: rabiesFrom(vaccinations),
      vaccinations: vaccinations,
      groom: {
        style: $('petGroomStyle').value.trim(),
        body: $('petGroomBody').value.trim(),
        legs: $('petGroomLegs').value.trim(),
        face: $('petGroomFace').value.trim(),
        ears: $('petGroomEars').value.trim(),
        tail: $('petGroomTail').value.trim(),
        feet: $('petGroomFeet').value.trim(),
        finish: $('petGroomFinish').value.trim(),
        notes: $('petGroomNotes').value.trim()
      },
      vetName: $('petVetName').value.trim(),
      vetPhone: $('petVetPhone').value.trim(),
      vetClinic: $('petVetClinic').value.trim()
    };
    if (editingPetIdx >= 0) editPets[editingPetIdx] = pet; else editPets.push(pet);
    $('petModal').classList.remove('open');
    drawEditPets();
  });

  $('clientsCsvBtn').addEventListener('click', function () {
    var rows = [['Owner', 'Phones', 'Email', 'Visits', 'Spent', 'Pet', 'Breed', 'Size', 'VaxStatus', 'Vaccinations', 'Vet', 'Emergency', 'AuthorizedPickup', 'Notes']];
    clientsCache.forEach(function (c) {
      var phones = phonesFor(c).map(function (p) { return (p.type || 'Phone') + ':' + p.number; }).join('; ');
      var emerg = (c.emergencyName || c.emergencyPhone) ? (c.emergencyName || '') + (c.emergencyRelation ? ' (' + c.emergencyRelation + ')' : '') + (c.emergencyPhone ? ' ' + c.emergencyPhone : '') : '';
      var pickup = (c.authorizedPickup || []).map(function (x) { return (x.name || '') + (x.phone ? ' ' + x.phone : ''); }).join('; ');
      if (c.pets && c.pets.length) c.pets.forEach(function (p) {
        var vet = [p.vetName, p.vetClinic, p.vetPhone].filter(Boolean).join(' ');
        rows.push([c.name || '', phones, c.email || '', c.visits || 0, c.spent || 0, p.name || '', p.breed || '', p.size || '', p.vaxStatus || '', vaxSummary(p), vet, emerg, pickup, c.notes || '']);
      });
      else rows.push([c.name || '', phones, c.email || '', c.visits || 0, c.spent || 0, '', '', '', c.vaxStatus || '', '', '', emerg, pickup, c.notes || '']);
    });
    dl('pink-poodle-clients-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
  });
  $('clientsVcfBtn').addEventListener('click', function () {
    var vcf = clientsCache.map(function (c) {
      var n = c.name || 'Pink Poodle Client';
      var pets = (c.pets || []).map(function (p) { return p.name + (vaxSummary(p) ? ' (' + vaxSummary(p) + ')' : ''); });
      var note = (c.visits || 0) + ' visits, ' + money(c.spent || 0) + ' spent' + (pets.length ? '. Pets: ' + pets.join(', ') : '') + (c.notes ? '. ' + c.notes : '');
      return 'BEGIN:VCARD\r\nVERSION:3.0\r\nFN:' + vEsc(n) + '\r\n' +
        phonesFor(c).map(function (p) { return 'TEL;TYPE=' + vEsc((p.type || 'CELL').toUpperCase()) + ':' + vEsc(p.number) + '\r\n'; }).join('') +
        (c.email ? 'EMAIL:' + vEsc(c.email) + '\r\n' : '') +
        'NOTE:' + vEsc(note) + '\r\n' +
        'END:VCARD';
    }).join('\r\n');
    dl('pink-poodle-clients-' + todayISO() + '.vcf', 'text/vcard', vcf);
  });

  function csvCell(v) {
    v = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
    return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
  }
  function csvRow(arr) { return arr.map(csvCell).join(','); }
  function vEsc(v) { return String(v == null ? '' : v).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); }

  /* =================================================================
     VACCINATIONS DUE
     ================================================================= */
  function vaxWorst(status) {
    return { missing: 0, expired: 1, expiring: 2, unknown: 3, ok: 4 }[status] == null ? 5 : { missing: 0, expired: 1, expiring: 2, unknown: 3, ok: 4 }[status];
  }
  function loadVaxDue() {
    $('vaxDueBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaVaxDue', { pin: staffPin }).then(function (res) {
      dueCache = res.due || [];
      requiredVax = res.required || requiredVax;
      dueCache.sort(function (a, b) { return vaxWorst(a.status) - vaxWorst(b.status) || String(a.client || '').localeCompare(String(b.client || '')); });
      drawVaxDue();
    }).catch(function (e) { $('vaxDueBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawVaxDue() {
    if (!dueCache.length) { $('vaxDueBody').innerHTML = '<div class="empty"><div class="big">✅</div><p>No vaccinations due.</p></div>'; return; }
    $('vaxDueBody').innerHTML = dueCache.map(function (d) {
      var shots = (d.details || []).map(function (x) {
        return '<span class="vaxbadge ' + vaxStatusBadge(x.status).cls + '">' + esc(x.type || '') + (x.expires ? ' ' + esc(x.expires) : '') + ' · ' + esc(x.status || '') + '</span>';
      }).join(' ');
      var contact = d.phone ? '<a class="btn btn--soft btn--sm" href="tel:' + esc(d.phone) + '">📞 Call</a>' +
        '<a class="btn btn--soft btn--sm" href="' + esc(smsHref(d.phone, d.client)) + '">💬 Text</a>' : '';
      return '<div class="card"><div class="ticket__top"><strong>' + esc(d.client || 'Client') + '</strong>' + vaxBadge(d.status) +
        '<span class="ticket__code" style="margin-left:auto">🐩 ' + esc(d.pet || '') + '</span></div>' +
        (d.phone ? '<div class="muted">📱 ' + esc(d.phone) + '</div>' : '') +
        '<div style="margin:0.45rem 0">' + shots + '</div><div class="client__contact">' + contact + '</div></div>';
    }).join('');
  }
  $('vaxDueRefresh').addEventListener('click', loadVaxDue);
  $('vaxDueCsvBtn').addEventListener('click', function () {
    var rows = [['Client', 'Phone', 'Pet', 'Status', 'Vaccinations']];
    dueCache.forEach(function (d) {
      rows.push([d.client || '', d.phone || '', d.pet || '', d.status || '', (d.details || []).map(function (x) { return (x.type || '') + ':' + (x.expires || '') + ':' + (x.status || ''); }).join('; ')]);
    });
    dl('pink-poodle-vaccinations-due-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
  });

  /* =================================================================
     FEES & PIN
     ================================================================= */
  function loadFees() {
    api('spaFees', { pin: staffPin }).then(function (res) { feesCache = res.fees || []; drawFees(); }).catch(function (e) { toast(e.message); });
    loadVaxConfig();
    loadDepositConfig();
    loadReviewConfig();
  }
  function drawFees() {
    $('feesBody').innerHTML = feesCache.map(function (f, i) {
      return '<div class="row2" style="grid-template-columns:1fr 100px 34px;gap:0.4rem;align-items:center;margin-bottom:0.4rem">' +
        '<input type="text" data-fee-label="' + i + '" value="' + esc(f.label) + '" placeholder="Fee name" ' + (can('manager') ? '' : 'disabled') + ' />' +
        '<input type="number" data-fee-amt="' + i + '" value="' + f.amount + '" min="0" step="1" inputmode="decimal" ' + (can('manager') ? '' : 'disabled') + ' />' +
        (can('manager') ? '<button class="btn btn--soft btn--sm" data-fee-del="' + i + '" type="button">✕</button>' : '') + '</div>';
    }).join('');
    $('feesBody').querySelectorAll('[data-fee-label]').forEach(function (el) { el.addEventListener('input', function () { feesCache[el.dataset.feeLabel].label = el.value; }); });
    $('feesBody').querySelectorAll('[data-fee-amt]').forEach(function (el) { el.addEventListener('input', function () { feesCache[el.dataset.feeAmt].amount = Math.max(0, Number(el.value) || 0); }); });
    $('feesBody').querySelectorAll('[data-fee-del]').forEach(function (el) { el.addEventListener('click', function () { feesCache.splice(el.dataset.feeDel, 1); drawFees(); }); });
  }
  $('feeAddBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    feesCache.push({ label: '', amount: 0 }); drawFees();
  });
  $('feeSaveBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    api('spaFeesSave', { pin: staffPin, fees: feesCache.filter(function (f) { return f.label; }) })
      .then(function (res) { feesCache = res.fees || []; drawFees(); toast('Fees saved ⚙️'); })
      .catch(function (e) { toast(e.message); });
  });
  $('pinSaveBtn').addEventListener('click', function () {
    if (!can('owner')) { toast('That needs an owner PIN.'); return; }
    var np = $('newPin').value.trim();
    if (!/^\d{4,8}$/.test(np)) { toast('PIN must be 4–8 digits'); return; }
    api('spaSetPin', { pin: staffPin, newPin: np }).then(function () {
      staffPin = np; $('newPin').value = ''; toast('PIN updated 🔒');
    }).catch(function (e) { toast(e.message); });
  });
  function loadVaxConfig() {
    if (!can('manager')) { drawVaxConfig(); return; }
    api('spaVaxConfig', { pin: staffPin }).then(function (res) {
      requiredVax = res.required || requiredVax;
      knownVax = res.known || knownVax;
      drawVaxConfig();
    }).catch(function (e) { $('vaxConfigBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawVaxConfig() {
    var list = knownVax.slice();
    requiredVax.forEach(function (v) { if (list.indexOf(v) < 0) list.push(v); });
    if (!$('vaxConfigBody')) return;
    $('vaxConfigBody').innerHTML = list.length ? list.map(function (v, i) {
      return '<label class="check"><input type="checkbox" data-vax-req="' + i + '" value="' + esc(v) + '" ' + (requiredVax.indexOf(v) >= 0 ? 'checked' : '') + ' /> <span>' + esc(v) + '</span></label>';
    }).join('') : '<p class="muted">No vaccination names configured yet.</p>';
  }
  $('vaxAddCustomBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    var v = $('vaxCustom').value.trim();
    if (!v) return;
    if (knownVax.indexOf(v) < 0) knownVax.push(v);
    if (requiredVax.indexOf(v) < 0) requiredVax.push(v);
    $('vaxCustom').value = '';
    drawVaxConfig();
  });
  $('vaxSaveBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    var req = [];
    $('vaxConfigBody').querySelectorAll('[data-vax-req]').forEach(function (el) { if (el.checked) req.push(el.value); });
    api('spaVaxConfigSave', { pin: staffPin, required: req }).then(function (res) {
      requiredVax = res.required || req;
      knownVax = res.known || knownVax;
      drawVaxConfig();
      toast('Vaccination settings saved 💉');
    }).catch(function (e) { toast(e.message); });
  });

  /* =================================================================
     LEVEL-UP: scheduling, deposits, rebook, upcoming, reports,
     deposit/review config, before-after photos
     ================================================================= */

  /* ---------- schedule appointment ---------- */
  function openSchedule(id) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    schId = id;
    $('scheduleTitle').textContent = 'Schedule — ' + (t.pet && t.pet.name || t.petName || 'pup');
    $('schDate').min = todayISO();
    $('schDate').value = t.apptDate || todayISO();
    $('schTime').value = t.apptTime || '';
    $('scheduleModal').classList.add('open');
  }
  $('schCancel').addEventListener('click', function () { $('scheduleModal').classList.remove('open'); });
  $('schSave').addEventListener('click', function () {
    var date = $('schDate').value;
    if (!date) { toast('Pick a date.'); return; }
    api('spaSchedule', { pin: staffPin, id: schId, apptDate: date, apptTime: $('schTime').value || '' })
      .then(function () { $('scheduleModal').classList.remove('open'); toast('Appointment scheduled 📅'); renderBoard(); })
      .catch(function (e) { toast(e.message); });
  });

  /* ---------- deposits (Square) ---------- */
  function openDeposit(id) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    depId = id;
    var dep = t.deposit || {};
    $('depositTitle').textContent = 'Deposit — ' + (t.pet && t.pet.name || t.petName || 'pup');
    $('depAmount').value = dep.amount || 30;
    $('depStatus').innerHTML = dep.amount
      ? 'Current: ' + money(dep.amount) + ' · <strong>' + esc(dep.status || 'sent') + '</strong>' + (dep.url ? ' · <a href="' + esc(dep.url) + '" target="_blank" rel="noopener">link</a>' : '')
      : 'No deposit requested yet.';
    $('depCheck').style.display = dep.orderId ? '' : 'none';
    $('depositModal').classList.add('open');
  }
  $('depCancel').addEventListener('click', function () { $('depositModal').classList.remove('open'); });
  $('depSend').addEventListener('click', function () {
    var amount = Number($('depAmount').value) || 0;
    if (amount < 1) { toast('Enter an amount.'); return; }
    $('depSend').disabled = true;
    api('spaDepositRequest', { pin: staffPin, id: depId, amount: amount })
      .then(function (res) { toast('Deposit link sent ' + (res.sent === 'sms' ? '(text)' : res.sent === 'email' ? '(email)' : '') + ' 💳'); $('depositModal').classList.remove('open'); renderBoard(); })
      .catch(function (e) { toast(e.message); })
      .then(function () { $('depSend').disabled = false; });
  });
  $('depCheck').addEventListener('click', function () {
    api('spaDepositCheck', { pin: staffPin, id: depId })
      .then(function (res) { toast(res.status === 'paid' ? 'Deposit paid ✓' : 'Still pending…'); if (res.status === 'paid') { $('depositModal').classList.remove('open'); renderBoard(); } })
      .catch(function (e) { toast(e.message); });
  });

  /* ---------- rebook / standing appointments ---------- */
  function openRebook(id) {
    var t = boardCache.filter(function (x) { return x.id === id; })[0]; if (!t) return;
    rbId = id;
    $('rebookTitle').textContent = 'Rebook — ' + (t.pet && t.pet.name || t.petName || 'pup');
    $('rebookModal').classList.add('open');
  }
  $('rbCancel').addEventListener('click', function () { $('rebookModal').classList.remove('open'); });
  $('rbSave').addEventListener('click', function () {
    var weeks = Number($('rebookWeeks').value) || 4;
    $('rbSave').disabled = true;
    api('spaRebook', { pin: staffPin, id: rbId, weeks: weeks })
      .then(function (res) { $('rebookModal').classList.remove('open'); toast('Next visit set for ' + esc(res.apptDate) + ' 🔁'); renderBoard(); })
      .catch(function (e) { toast(e.message); })
      .then(function () { $('rbSave').disabled = false; });
  });

  /* ---------- upcoming appointments ---------- */
  function loadUpcoming() {
    $('upcomingBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaUpcoming', { pin: staffPin }).then(function (res) { upcomingCache = res.tickets || []; drawUpcoming(); })
      .catch(function (e) { $('upcomingBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawUpcoming() {
    if (!upcomingCache.length) { $('upcomingBody').innerHTML = '<div class="empty"><div class="big">📅</div><p>No upcoming appointments scheduled.</p></div>'; return; }
    $('upcomingBody').innerHTML = upcomingCache.map(function (t) {
      var owner = t.owner || {};
      var badge = t.confirmed ? '<span class="appt-badge">✓ confirmed</span>' : '<span class="appt-badge appt-badge--pending">unconfirmed</span>';
      var contact = owner.phone ? '<a class="btn btn--soft btn--sm" href="tel:' + esc(owner.phone) + '">📞 Call</a>' +
        '<a class="btn btn--soft btn--sm" href="' + esc(smsHref(owner.phone, owner.name)) + '">💬 Text</a>' : '';
      var confirmBtn = !t.confirmed ? '<button class="btn btn--soft btn--sm" data-upconfirm="' + t.id + '">✓ Confirm</button>' : '';
      return '<div class="card"><div class="ticket__top"><strong>📅 ' + esc(t.apptDate) + (t.apptTime ? ' · ' + esc(t.apptTime) : '') + '</strong>' + badge +
        '<span class="ticket__code" style="margin-left:auto">' + esc(t.code) + '</span></div>' +
        '<div class="ticket__svcs">🐩 ' + esc(t.pet && t.pet.name || t.petName || '') + ' — ' + esc((t.services || []).join(' · ')) + ' · ' + esc(t.stylist) + '</div>' +
        (owner.name || owner.phone ? '<div class="muted">📱 ' + esc(owner.name || '') + (owner.phone ? ' · ' + esc(owner.phone) : '') + '</div>' : '') +
        '<div class="client__contact" style="margin-top:0.4rem">' + contact + confirmBtn + '</div></div>';
    }).join('');
    $('upcomingBody').querySelectorAll('[data-upconfirm]').forEach(function (el) { el.addEventListener('click', function () {
      api('spaConfirm', { pin: staffPin, id: el.dataset.upconfirm }).then(function () { toast('Confirmed ✓'); loadUpcoming(); }).catch(function (e) { toast(e.message); });
    }); });
  }
  $('upcomingRefresh').addEventListener('click', loadUpcoming);
  $('upcomingCsvBtn').addEventListener('click', function () {
    var rows = [['Date', 'Time', 'Confirmed', 'Pet', 'Services', 'Stylist', 'Owner', 'Phone', 'Code']];
    upcomingCache.forEach(function (t) {
      var o = t.owner || {};
      rows.push([t.apptDate || '', t.apptTime || '', t.confirmed ? 'yes' : 'no', (t.pet && t.pet.name) || t.petName || '', (t.services || []).join(' | '), t.stylist || '', o.name || '', o.phone || '', t.code || '']);
    });
    dl('pink-poodle-upcoming-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
  });

  /* ---------- reports / KPIs ---------- */
  function loadReport() {
    document.querySelectorAll('#reportRange .pill').forEach(function (b) { b.classList.toggle('sel', b.dataset.range === reportRange); });
    $('reportBody').innerHTML = '<p class="muted">Loading…</p>';
    api('spaReport', { pin: staffPin, range: reportRange }).then(function (res) { reportCache = res.report || null; drawReport(); })
      .catch(function (e) { $('reportBody').innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawReport() {
    var r = reportCache; if (!r) { $('reportBody').innerHTML = '<p class="muted">No data.</p>'; return; }
    function kpi(num, lbl) { return '<div class="kpi"><div class="kpi__num">' + num + '</div><div class="kpi__lbl">' + esc(lbl) + '</div></div>'; }
    var kpis = '<div class="kpis">' +
      kpi(money(r.revenue), 'Revenue') +
      kpi(r.visits, 'Paid visits') +
      kpi(money(r.avgTicket), 'Avg ticket') +
      kpi(money(r.retailRevenue), 'Retail sales') +
      kpi(money(r.grossProfit), 'Gross profit') +
      kpi(money(r.tips), 'Tips') +
      kpi(money(r.deposits), 'Deposits') +
      kpi(r.booked, 'Booked') +
      kpi(r.noShows + ' (' + r.noShowRate + '%)', 'No-shows') +
      kpi(money(r.noShowFees), 'No-show fees') +
      kpi(r.cancels, 'Cancellations') +
      kpi(r.returningVisits, 'Returning') +
      '</div>';
    var svc = (r.byService || []).length
      ? '<div class="card"><h2 style="margin-top:0;font-size:1rem">Top services</h2>' + r.byService.map(function (s) {
          return '<div style="display:flex;justify-content:space-between;padding:0.15rem 0"><span>' + esc(s.service) + '</span><strong>' + s.count + '</strong></div>';
        }).join('') + '</div>'
      : '';
    var days = (r.byDay || []).length
      ? '<div class="card" style="margin-top:0.6rem"><h2 style="margin-top:0;font-size:1rem">Revenue by day</h2>' + r.byDay.map(function (d) {
          return '<div style="display:flex;justify-content:space-between;padding:0.15rem 0"><span class="muted">' + esc(d.day) + '</span><strong>' + money(d.revenue) + '</strong></div>';
        }).join('') + '</div>'
      : '';
    var prod = (r.byProduct || []).length
      ? '<div class="card" style="margin-top:0.6rem"><h2 style="margin-top:0;font-size:1rem">Top products (' + (r.unitsSold || 0) + ' sold)</h2>' + r.byProduct.map(function (p) {
          return '<div style="display:flex;justify-content:space-between;padding:0.15rem 0"><span>' + esc(p.product) + '</span><strong>' + p.units + '</strong></div>';
        }).join('') + '</div>'
      : '';
    $('reportBody').innerHTML = kpis + svc + prod + days;
  }
  document.querySelectorAll('#reportRange .pill').forEach(function (b) { b.addEventListener('click', function () { reportRange = b.dataset.range; loadReport(); }); });
  $('reportRefresh').addEventListener('click', loadReport);
  $('reportCsvBtn').addEventListener('click', function () {
    var r = reportCache; if (!r) { toast('Nothing to export yet.'); return; }
    var rows = [['Metric', 'Value']];
    rows.push(['Range', r.range]); rows.push(['Since', r.since]);
    rows.push(['Revenue', r.revenue]); rows.push(['Retail sales', r.retailRevenue]); rows.push(['COGS', r.cogs]); rows.push(['Gross profit', r.grossProfit]); rows.push(['Paid visits', r.visits]); rows.push(['Avg ticket', r.avgTicket]);
    rows.push(['Tips', r.tips]); rows.push(['Deposits', r.deposits]); rows.push(['Booked', r.booked]);
    rows.push(['No-shows', r.noShows]); rows.push(['No-show rate %', r.noShowRate]); rows.push(['No-show fees', r.noShowFees]);
    rows.push(['Cancellations', r.cancels]); rows.push(['Returning visits', r.returningVisits]);
    rows.push([]); rows.push(['Service', 'Count']);
    (r.byService || []).forEach(function (s) { rows.push([s.service, s.count]); });
    rows.push([]); rows.push(['Product', 'Units sold']);
    (r.byProduct || []).forEach(function (p) { rows.push([p.product, p.units]); });
    rows.push([]); rows.push(['Day', 'Revenue']);
    (r.byDay || []).forEach(function (d) { rows.push([d.day, d.revenue]); });
    dl('pink-poodle-report-' + r.range + '-' + todayISO() + '.csv', 'text/csv', rows.map(csvRow).join('\r\n'));
  });

  /* ---------- deposit config ---------- */
  function loadDepositConfig() {
    if (!can('manager')) return;
    api('spaDepositConfig', { pin: staffPin }).then(function (res) {
      var c = res.config || {};
      $('depCfgEnabled').checked = !!c.enabled;
      $('depCfgAmount').value = c.defaultAmount || 30;
    }).catch(function () {});
  }
  $('depCfgSaveBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    api('spaDepositConfigSave', { pin: staffPin, enabled: $('depCfgEnabled').checked, defaultAmount: Number($('depCfgAmount').value) || 0 })
      .then(function () { toast('Deposit settings saved 💳'); }).catch(function (e) { toast(e.message); });
  });

  /* ---------- review booster config ---------- */
  function loadReviewConfig() {
    if (!can('manager')) return;
    api('spaReviewConfig', { pin: staffPin }).then(function (res) {
      var c = res.config || {};
      $('revCfgEnabled').checked = !!c.enabled;
      $('revCfgDelay').value = c.delayHours || 3;
      $('revCfgGoogle').value = c.googleUrl || '';
      $('revCfgFacebook').value = c.facebookUrl || '';
      $('revCfgMsg').value = c.message || '';
    }).catch(function () {});
  }
  $('revCfgSaveBtn').addEventListener('click', function () {
    if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
    api('spaReviewConfigSave', {
      pin: staffPin, enabled: $('revCfgEnabled').checked,
      delayHours: Number($('revCfgDelay').value) || 3,
      googleUrl: $('revCfgGoogle').value.trim(),
      facebookUrl: $('revCfgFacebook').value.trim(),
      message: $('revCfgMsg').value.trim()
    }).then(function () { toast('Review settings saved ⭐'); }).catch(function (e) { toast(e.message); });
  });

  /* ---------- before/after photos ---------- */
  function loadPetPhotos(petId, clientId) {
    petPhotoCache = [];
    var box = $('petPhotos');
    if (!petId) { $('petPhotosMsg').textContent = 'Save the pet first, then reopen to add before & after photos.'; box.innerHTML = ''; return; }
    $('petPhotosMsg').textContent = '';
    box.innerHTML = '<p class="muted">Loading…</p>';
    api('spaPhotos', { pin: staffPin, petId: petId }).then(function (res) {
      petPhotoCache = res.photos || [];
      drawPetPhotos();
    }).catch(function (e) { box.innerHTML = '<p class="muted">' + esc(e.message) + '</p>'; });
  }
  function drawPetPhotos() {
    var box = $('petPhotos');
    if (!petPhotoCache.length) { box.innerHTML = '<p class="muted" style="grid-column:1/-1">No photos yet.</p>'; return; }
    box.innerHTML = petPhotoCache.map(function (p) {
      return '<div class="ph" data-ph="' + esc(p.id) + '">' +
        '<span class="ph__tag">' + esc(p.tag) + '</span>' +
        (can('manager') ? '<button class="ph__rm" data-phrm="' + esc(p.id) + '" type="button" title="Delete">✕</button>' : '') +
        (p.caption ? '<span class="ph__cap">' + esc(p.caption) + '</span>' : '') +
        '</div>';
    }).join('');
    // Lazy-fetch each image behind the PIN and inject.
    petPhotoCache.forEach(function (p) {
      api('spaPhoto', { pin: staffPin, id: p.id }).then(function (res) {
        var cell = box.querySelector('[data-ph="' + p.id + '"]');
        if (cell && res.dataUrl) { var img = document.createElement('img'); img.src = res.dataUrl; img.alt = p.tag; cell.insertBefore(img, cell.firstChild); }
      }).catch(function () {});
    });
    box.querySelectorAll('[data-phrm]').forEach(function (el) { el.addEventListener('click', function () {
      if (!can('manager')) { toast('That needs a manager or owner PIN.'); return; }
      if (!confirm('Delete this photo?')) return;
      api('spaPhotoDelete', { pin: staffPin, id: el.dataset.phrm }).then(function () {
        petPhotoCache = petPhotoCache.filter(function (x) { return x.id !== el.dataset.phrm; });
        drawPetPhotos(); toast('Photo deleted');
      }).catch(function (e) { toast(e.message); });
    }); });
  }
  $('petPhotoUploadBtn').addEventListener('click', function () {
    var petId = $('petId').value;
    if (!petId) { toast('Save the pet first.'); return; }
    var f = $('petPhotoFile').files[0];
    if (!f) { toast('Choose a photo.'); return; }
    if (f.size > 5 * 1024 * 1024) { toast('Image must be under 5 MB.'); return; }
    var btn = $('petPhotoUploadBtn'); btn.disabled = true;
    var reader = new FileReader();
    reader.onload = function () {
      api('spaPhotoUpload', { pin: staffPin, petId: petId, clientId: editingClientId || '', tag: $('petPhotoTag').value, caption: $('petPhotoCaption').value.trim(), dataUrl: reader.result })
        .then(function () { $('petPhotoFile').value = ''; $('petPhotoCaption').value = ''; toast('Photo added 📸'); loadPetPhotos(petId, editingClientId); })
        .catch(function (e) { toast(e.message); })
        .then(function () { btn.disabled = false; });
    };
    reader.onerror = function () { toast('Could not read that file.'); btn.disabled = false; };
    reader.readAsDataURL(f);
  });

  /* =================================================================
     INIT
     ================================================================= */
  $('bkDate').min = todayISO(); $('bkDate').value = todayISO();
  renderServices(); renderAddons(); renderStylists(); renderTotal();
  setStaffUI(false);
  if ('serviceWorker' in navigator) { navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(function () {}); }

  // Appointment confirmation deep-link: spa.html?confirm=CODE
  (function () {
    var m = /[?&]confirm=([A-Za-z0-9]+)/.exec(window.location.search);
    if (!m) return;
    var code = m[1].toUpperCase();
    api('spaConfirmByCode', { code: code }).then(function () {
      go('track');
      $('trackCode').value = code;
      toast('Thanks — your appointment is confirmed! 🩷');
      doTrack();
    }).catch(function (e) {
      go('track');
      $('trackCode').value = code;
      toast(e.message || 'Could not confirm that code.');
    });
    try { history.replaceState(null, '', window.location.pathname); } catch (e) {}
  })();
})();
