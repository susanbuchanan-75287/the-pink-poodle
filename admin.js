// The Pink Poodle — admin upload portal
// Sends the chosen photo to the Firebase function, which commits it to the
// website gallery (and, once enabled, posts it to the Facebook page).

const ENDPOINT = 'https://us-central1-binditails-da2de.cloudfunctions.net/pinkPoodleUpload';
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

const form = document.getElementById('uploadForm');
const fileInput = document.getElementById('photo');
const drop = document.getElementById('drop');
const dropText = document.getElementById('dropText');
const preview = document.getElementById('preview');
const previewImg = document.getElementById('previewImg');
const statusEl = document.getElementById('status');
const submitBtn = document.getElementById('submitBtn');

let chosenFile = null;

function setStatus(msg, kind) {
  statusEl.className = 'status show ' + (kind || 'info');
  statusEl.innerHTML = msg;
}
function clearStatus() { statusEl.className = 'status'; statusEl.innerHTML = ''; }

function chooseFile(file) {
  if (!file) return;
  if (!file.type.startsWith('image/')) { setStatus('Please choose an image file.', 'err'); return; }
  if (file.size > MAX_BYTES) { setStatus('That image is over 8 MB — please pick a smaller one.', 'err'); return; }
  chosenFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    previewImg.src = reader.result;
    preview.style.display = 'block';
    dropText.innerHTML = '✅ <strong>' + file.name + '</strong><br />tap to choose a different photo';
  };
  reader.readAsDataURL(file);
  clearStatus();
}

fileInput.addEventListener('change', () => chooseFile(fileInput.files[0]));

['dragenter', 'dragover'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('drag'); }));
drop.addEventListener('drop', (e) => { if (e.dataTransfer.files[0]) chooseFile(e.dataTransfer.files[0]); });

function toBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]); // strip data: prefix
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const adminKey = document.getElementById('adminKey').value.trim();
  const caption = document.getElementById('caption').value.trim();
  const toFacebook = document.getElementById('toFacebook').checked;

  if (!adminKey) { setStatus('Enter your admin passphrase.', 'err'); return; }
  if (!chosenFile) { setStatus('Choose a photo first.', 'err'); return; }

  submitBtn.disabled = true;
  setStatus('<span class="spin"></span>Uploading &amp; publishing… this can take up to a minute.', 'info');

  try {
    const imageBase64 = await toBase64(chosenFile);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adminKey,
        caption,
        filename: chosenFile.name,
        contentType: chosenFile.type,
        postToFacebook: toFacebook,
        imageBase64
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || ('Upload failed (' + res.status + ')'));

    let msg = '🎉 <strong>Published!</strong> Your photo is on its way to the gallery — it appears live in about a minute (GitHub Pages rebuild).';
    if (data.facebook === 'posted') msg += '<br />📘 Also posted to the Facebook page.';
    else if (data.facebook === 'skipped') msg += '<br />📘 Facebook posting is not enabled yet.';
    setStatus(msg, 'ok');

    // reset
    chosenFile = null;
    fileInput.value = '';
    preview.style.display = 'none';
    dropText.innerHTML = '📷 <strong>Tap to choose a photo</strong><br />or drag &amp; drop it here';
    document.getElementById('caption').value = '';
  } catch (err) {
    setStatus('❌ ' + (err.message || 'Something went wrong. Please try again.'), 'err');
  } finally {
    submitBtn.disabled = false;
  }
});
