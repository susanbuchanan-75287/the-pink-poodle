// ===== Nav: scroll state + mobile toggle =====
const nav = document.getElementById('nav');
const navToggle = document.getElementById('navToggle');
const navMobile = document.getElementById('navMobile');

const onScroll = () => nav.classList.toggle('nav--scrolled', window.scrollY > 40);
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

navToggle.addEventListener('click', () => {
  const open = navMobile.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', open);
});
navMobile.querySelectorAll('a').forEach(a =>
  a.addEventListener('click', () => {
    navMobile.classList.remove('open');
    navToggle.setAttribute('aria-expanded', false);
  })
);

// ===== Footer year =====
document.getElementById('year').textContent = new Date().getFullYear();

// ===== Booking form -> spa system (pp_spa_tickets, single source of truth) =====
const SALON_PHONE = '3049212748'; // Britni's cell (fallback deep-link)
const SPA_ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleSpa';
// Lightweight "text a stylist" contact leads (no pet/services) stay on the
// simple lead endpoint; full grooming bookings go through the spa system.
const BOOK_ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleBook';
const form = document.getElementById('bookForm');
const bookStatus = document.getElementById('bookStatus');
const bookBtn = document.getElementById('bookBtn');

const val = (id) => (document.getElementById(id).value || '').trim();

// Reveal the file picker only when "Upload proof now" is selected.
(function () {
  const wrap = document.getElementById('vaxFileWrap');
  const up = document.getElementById('vaxUpload');
  const br = document.getElementById('vaxBring');
  function sync() { if (wrap) wrap.hidden = !(up && up.checked); }
  if (up) up.addEventListener('change', sync);
  if (br) br.addEventListener('change', sync);
})();

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('read failed'));
    r.readAsDataURL(file);
  });
}

function smsFallbackUrl(fields) {
  const lines = [
    'Hi Britni! I\'d like to book an appointment at The Pink Poodle.',
    `Name: ${fields.ownerName}`,
    fields.phone ? `Phone: ${fields.phone}` : '',
    fields.dogName ? `Dog: ${fields.dogName}${fields.breed ? ` (${fields.breed})` : ''}` : (fields.breed ? `Breed/Size: ${fields.breed}` : ''),
    `Service: ${fields.service}`,
    (fields.groomer && fields.groomer !== 'No preference') ? `Preferred groomer: ${fields.groomer}` : '',
    fields.prefDate ? `Preferred: ${fields.prefDate}` : '',
    fields.notes ? `Notes: ${fields.notes}` : ''
  ].filter(Boolean);
  const body = encodeURIComponent(lines.join('\n'));
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return `sms:${SALON_PHONE}${isiOS ? '&' : '?'}body=${body}`;
}

function setStatus(msg, kind) {
  if (!bookStatus) return;
  bookStatus.textContent = msg;
  bookStatus.className = 'book__status' + (kind ? ' book__status--' + kind : '');
}

// "Reserve This" on the Signature Experiences cards: sms: links do nothing on
// desktop, so route them to the booking form, preselect the package, and scroll.
document.querySelectorAll('a[data-package]').forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const pkg = (link.getAttribute('data-package') || '').replace(/&amp;/g, '&').trim();
    const svc = document.getElementById('service');
    if (svc && pkg) {
      const match = Array.from(svc.options).find((o) => o.value === pkg || o.text === pkg);
      if (match) svc.value = match.value;
    }
    const notes = document.getElementById('notes');
    if (notes && pkg && !new RegExp(pkg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(notes.value)) {
      notes.value = (notes.value ? notes.value + ' · ' : '') + 'Interested in: ' + pkg;
    }
    const book = document.getElementById('book');
    if (book) book.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setStatus('You\'re booking the ' + pkg + ' — just add your details below. 💎', 'ok');
    const owner = document.getElementById('ownerName');
    if (owner) setTimeout(() => owner.focus(), 500);
  });
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {
    ownerName: val('ownerName'),
    phone: val('phone'),
    email: val('email'),
    company: val('company'), // honeypot
    dogName: val('dogName'),
    breed: val('breed'),
    service: val('service'),
    groomer: val('groomer'),
    prefDate: val('prefDate'),
    bookDate: val('bookDate'),
    bookTime: val('bookTime'),
    notes: val('notes')
  };

  if (!fields.ownerName) { document.getElementById('ownerName').focus(); return; }
  if (!fields.phone && !fields.email) {
    setStatus('Please add a phone number or email so Britni can reach you.', 'err');
    document.getElementById('phone').focus();
    return;
  }

  // Vaccination proof is required: pick "upload now" or "bring a copy".
  const vaxUp = document.getElementById('vaxUpload');
  const vaxBr = document.getElementById('vaxBring');
  const vaxFile = document.getElementById('vaxFile');
  const vaxMode = vaxUp && vaxUp.checked ? 'upload' : (vaxBr && vaxBr.checked ? 'bring' : '');
  if (!vaxMode) {
    setStatus('Please choose how you\'ll provide proof of vaccination.', 'err');
    if (vaxUp) vaxUp.focus();
    return;
  }
  const chosenFile = (vaxMode === 'upload' && vaxFile && vaxFile.files && vaxFile.files[0]) ? vaxFile.files[0] : null;
  if (vaxMode === 'upload' && !chosenFile) {
    setStatus('Choose a photo or PDF of the vaccination record, or pick "bring a copy".', 'err');
    return;
  }
  if (chosenFile && chosenFile.size > 8 * 1024 * 1024) {
    setStatus('That file is over 8 MB — please choose a smaller photo or PDF.', 'err');
    return;
  }

  bookBtn.disabled = true;
  const original = bookBtn.textContent;
  bookBtn.textContent = 'Sending…';
  setStatus('Sending your request…');

  const petNotes = [fields.prefDate ? 'Preferred: ' + fields.prefDate : '', fields.notes].filter(Boolean).join(' · ').slice(0, 300);
  const payload = {
    action: 'spaBook',
    pet: { name: fields.dogName, breed: fields.breed, size: '', notes: petNotes },
    owner: { name: fields.ownerName, phone: fields.phone, email: fields.email },
    services: [fields.service],
    stylist: fields.groomer || 'No preference',
    requestedDate: fields.bookDate || fields.prefDate,
    requestedTime: fields.bookTime,
    vax: { mode: vaxMode, current: true },
    company: fields.company
  };

  try {
    const res = await fetch(SPA_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json().catch(() => ({}));
    if (!(res.ok && data.ok)) throw new Error(data.error || 'send failed');

    // If they uploaded proof, attach it to the new ticket (best-effort).
    let uploadNote = '';
    if (chosenFile && data.code) {
      try {
        const dataUrl = await readFileAsDataUrl(chosenFile);
        const up = await fetch(SPA_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'spaVaxUpload', code: data.code, dataUrl, name: chosenFile.name })
        });
        const upData = await up.json().catch(() => ({}));
        if (!(up.ok && upData.ok)) uploadNote = ' (We couldn\'t attach your file — please bring a copy or text it to 304-921-2748.)';
      } catch (_) {
        uploadNote = ' (We couldn\'t attach your file — please bring a copy or text it to 304-921-2748.)';
      }
    }
    form.reset();
    document.getElementById('vaxFileWrap').hidden = true;
    const remind = vaxMode === 'bring' ? ' Remember to bring proof of current rabies vaccination on groom day.' : '';
    setStatus('🩷 Sent! Britni got your request' + (data.code ? ' (code ' + data.code + ')' : '') + ' and will text you to confirm.' + remind + uploadNote, 'ok');
  } catch (err) {
    // Fallback: on phones, open Messages pre-filled; otherwise show contact.
    if (/iPad|iPhone|iPod|Android/.test(navigator.userAgent)) {
      setStatus('Opening your Messages app to finish sending…', 'ok');
      window.location.href = smsFallbackUrl(fields);
    } else {
      setStatus('Sorry — that didn\'t go through. Please text 304-921-2748 or email groomerbrit@yahoo.com.', 'err');
    }
  } finally {
    bookBtn.disabled = false;
    bookBtn.textContent = original;
  }
});

// ===== Team: text a stylist (mobile deep-link, desktop pop-up form) =====
(function () {
  const APPT_MSG = "Hi! I'd like to schedule an appointment at The Pink Poodle.";
  const isMobile = /iPad|iPhone|iPod|Android/i.test(navigator.userAgent);
  const isiOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const modal = document.getElementById('teamTextModal');

  const smsTo = (phone, body) => `sms:${phone}${isiOS ? '&' : '?'}body=${encodeURIComponent(body)}`;

  document.querySelectorAll('.js-team-text').forEach((a) => {
    a.addEventListener('click', (e) => {
      const name = a.dataset.name || 'the salon';
      const phone = a.dataset.phone || ('+1' + SALON_PHONE);
      e.preventDefault();
      if (isMobile) {
        // Open Messages pre-filled with the appointment request.
        window.location.href = smsTo(phone, APPT_MSG);
      } else if (modal) {
        openTextModal(name, phone);
      } else {
        window.location.href = smsTo(phone, APPT_MSG);
      }
    });
  });

  if (!modal) return;

  const ttForm = document.getElementById('teamTextForm');
  const ttStatus = document.getElementById('ttStatus');
  const ttSend = document.getElementById('ttSend');
  let current = { name: '', phone: '' };

  const setTt = (msg, kind) => {
    ttStatus.textContent = msg;
    ttStatus.className = 'tmodal__status' + (kind ? ' tmodal__status--' + kind : '');
  };
  const closeTextModal = () => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
  };
  window.openTextModal = function (name, phone) {
    current = { name, phone };
    document.getElementById('ttStylist').textContent = name;
    document.getElementById('ttSendName').textContent = name;
    document.getElementById('ttTitle').textContent = `Text ${name} 💬`;
    document.getElementById('ttMessage').value = APPT_MSG;
    setTt('');
    modal.classList.add('open');
    modal.setAttribute('aria-hidden', 'false');
    setTimeout(() => document.getElementById('ttName').focus(), 60);
  };

  document.getElementById('ttClose').addEventListener('click', closeTextModal);
  modal.addEventListener('click', (e) => { if (e.target === modal) closeTextModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && modal.classList.contains('open')) closeTextModal(); });

  ttForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = (document.getElementById('ttName').value || '').trim();
    const phone = (document.getElementById('ttPhone').value || '').trim();
    const message = (document.getElementById('ttMessage').value || '').trim();
    const company = document.getElementById('ttCompany').value; // honeypot
    if (!name) { document.getElementById('ttName').focus(); return; }
    if (!phone) { setTt('Please add your mobile number so we can text you back.', 'err'); document.getElementById('ttPhone').focus(); return; }
    ttSend.disabled = true;
    setTt('Sending…');
    try {
      const res = await fetch(BOOK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerName: name, phone, stylist: current.name, notes: message, company, source: 'team-text' })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setTt(`🩷 Sent! ${current.name} got your request and will text you back.`, 'ok');
        ttForm.reset();
        setTimeout(closeTextModal, 2600);
      } else {
        throw new Error(data.error || 'send failed');
      }
    } catch (err) {
      const dial = (current.phone || '').replace(/^\+1/, '');
      setTt('Sorry — that didn\'t go through. Please text ' + dial + ' directly.', 'err');
    } finally {
      ttSend.disabled = false;
    }
  });
})();

// ===== Gallery: render from manifest, then lightbox =====
const lightbox = document.getElementById('lightbox');
const lightboxImg = document.getElementById('lightboxImg');
const lightboxClose = lightbox.querySelector('.lightbox__close');

const closeLightbox = () => {
  lightbox.classList.remove('open');
  lightbox.setAttribute('aria-hidden', 'true');
  lightboxImg.src = '';
};
lightboxClose.addEventListener('click', closeLightbox);
lightbox.addEventListener('click', (e) => { if (e.target === lightbox) closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

const openLightbox = (src, alt) => {
  lightboxImg.src = src;
  lightboxImg.alt = alt;
  lightbox.classList.add('open');
  lightbox.setAttribute('aria-hidden', 'false');
};

async function renderGallery() {
  const grid = document.getElementById('galleryGrid');
  if (!grid) return;
  let items = [];
  try {
    const res = await fetch('gallery.json?t=' + Date.now());
    if (res.ok) items = await res.json();
  } catch (_) { /* keep noscript fallback */ }
  if (!Array.isArray(items) || !items.length) return;

  grid.innerHTML = '';
  const INITIAL = 24;
  items.forEach((item, i) => {
    const fig = document.createElement('figure');
    fig.className = 'gallery__item reveal' + (item.tall ? ' gallery__item--tall' : '') + (i >= INITIAL ? ' is-hidden' : '');
    const img = document.createElement('img');
    img.src = item.thumb || item.src;
    img.dataset.full = item.src;
    img.alt = item.alt || item.caption || 'A freshly groomed pup at The Pink Poodle';
    if (item.w) img.width = item.w;
    if (item.h) img.height = item.h;
    img.loading = 'lazy';
    img.decoding = 'async';
    img.addEventListener('click', () => openLightbox(img.dataset.full || img.src, img.alt));
    fig.appendChild(img);
    if (item.caption) {
      const cap = document.createElement('figcaption');
      cap.textContent = item.caption;
      fig.appendChild(cap);
    }
    grid.appendChild(fig);
    if (window.__revealObserver) window.__revealObserver.observe(fig);
    else fig.classList.add('in');
  });

  if (items.length > INITIAL) {
    const wrap = document.createElement('div');
    wrap.className = 'gallery__more-wrap';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn--soft';
    btn.textContent = `View all ${items.length} photos`;
    const count = document.createElement('p');
    count.className = 'gallery__count';
    count.textContent = `Showing ${INITIAL} of ${items.length}`;
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.gallery__item.is-hidden').forEach((el) => {
        el.classList.remove('is-hidden');
        if (window.__revealObserver) window.__revealObserver.observe(el);
        else el.classList.add('in');
      });
      wrap.remove();
    });
    wrap.appendChild(btn);
    wrap.appendChild(count);
    grid.after(wrap);
  }
}

// ===== Reveal on scroll =====
const revealEls = document.querySelectorAll(
  '.about__grid, .card, .gallery__item, .review, .book__intro, .book__form, .visit__grid, .section__head'
);
revealEls.forEach(el => el.classList.add('reveal'));

if ('IntersectionObserver' in window) {
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry, i) => {
      if (entry.isIntersecting) {
        entry.target.style.transitionDelay = `${(i % 4) * 80}ms`;
        entry.target.classList.add('in');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12 });
  window.__revealObserver = io;
  revealEls.forEach(el => io.observe(el));
} else {
  revealEls.forEach(el => el.classList.add('in'));
}

// Render the gallery once the observer is ready
renderGallery();
