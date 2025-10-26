  (function () {
    const form = document.querySelector('#contact form');
    if (!form) return;

    // --- Status box (accessible) ---
    const status = document.createElement('div');
    status.style.display = 'none';
    status.setAttribute('role', 'alert');
    status.setAttribute('aria-live', 'polite');
    status.className = 'alert';
    form.parentNode.insertBefore(status, form);

    // Submit button
    const submitBtn = form.querySelector('button[type="submit"]');

    function showStatus(kind, msg) {
      status.className = 'alert alert-' + kind;
      status.textContent = msg;
      status.style.display = 'block';
    }

    // --- Build a normalised string of the key fields (no HTML changes needed) ---
    function normalise(sel) {
      const el = form.querySelector(sel);
      return (el && (el.value || '').toString().trim().toLowerCase()) || '';
    }
    function signaturePlain() {
      const parts = [
        normalise('input[name="Name"]'),
        normalise('input[name="Email"]'),
        normalise('input[name="Phone"]'),
        normalise('input[name="Suburb"]'),
        normalise('select[name="Property Type"]'),
        normalise('input[name="Size"]'),
        normalise('select[name="Service"]'),
        normalise('select[name="Frequency"]'),
        normalise('select[name="Preferred Day"]'),
        normalise('select[name="Preferred Time"]'),
        normalise('textarea[name="Message"]')
      ];
      return parts.join('|');
    }

    // --- Hash the signature for privacy (fallback to plain if crypto unsupported) ---
    async function signatureHash() {
      const str = signaturePlain();
      if (!window.crypto || !window.crypto.subtle) return str; // fallback
      const enc = new TextEncoder().encode(str);
      const buf = await crypto.subtle.digest('SHA-256', enc);
      const bytes = new Uint8Array(buf);
      let hex = '';
      for (let b of bytes) hex += b.toString(16).padStart(2, '0');
      return hex;
    }

    // --- Duplicate memory (24 hours, shared across tabs) ---
    const STORE_KEY = 'bc_recent_submissions';
    const WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

    function loadStore() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); }
      catch { return []; }
    }
    function saveStore(list) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(list)); } catch {}
    }
    function purgeOld(list) {
      const now = Date.now();
      return list.filter(item => now - item.t < WINDOW_MS);
    }
    function remember(sig) {
      const list = purgeOld(loadStore());
      list.push({ s: sig, t: Date.now() });
      saveStore(list.slice(-100)); // cap size
    }
    function isDuplicateNow(sig) {
      const list = purgeOld(loadStore());
      saveStore(list); // write back purged list
      return list.some(item => item.s === sig);
    }

    // --- Submit button + form busy state ---
    function setSubmittingState(isOn) {
      if (submitBtn) {
        if (isOn) {
          submitBtn.disabled = true;
          submitBtn.dataset.originalText = submitBtn.textContent;
          submitBtn.textContent = 'Sending...';
        } else {
          submitBtn.disabled = false;
          if (submitBtn.dataset.originalText) {
            submitBtn.textContent = submitBtn.dataset.originalText;
          }
        }
      }
      form.setAttribute('aria-busy', isOn ? 'true' : 'false');
    }

    // --- Fetch with timeout helper ---
    function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeoutMs);
      return fetch(url, { ...options, signal: controller.signal })
        .finally(() => clearTimeout(id));
    }

    form.addEventListener('submit', async function (e) {
      // 1) Native validation
      if (!form.checkValidity()) {
        e.preventDefault();
        form.reportValidity();
        return;
      }

      // 2) Honeypot (bot)
      const gotcha = form.querySelector('[name="_gotcha"]');
      if (gotcha && gotcha.value) {
        e.preventDefault();
        showStatus('success', 'Thanks!');
        form.reset();
        return;
      }

      // 3) Duplicate throttle (24h, cross-tab, privacy-hashed)
      e.preventDefault(); // we will AJAX-submit
      const sig = await signatureHash();
      if (isDuplicateNow(sig)) {
        showStatus('danger', 'Looks like you already sent this recently. If you need to add details, please change something and try again.');
        return;
      }

      // 4) Personalise your existing _subject field using the Name input
      const nameInput = form.querySelector('input[name="Name"]');
      const subjectInput = form.querySelector('input[name="_subject"]');
      const person = (nameInput && nameInput.value.trim()) || 'Website visitor';
      if (subjectInput) subjectInput.value = 'New BeautyClean enquiry from ' + person;

      // 5) Send via AJAX
      setSubmittingState(true);
      const data = new FormData(form);

      fetchWithTimeout(form.action, {
        method: 'POST',
        body: data,
        headers: { 'Accept': 'application/json' }
      }, 15000)
      .then(async (resp) => {
        if (resp.ok) {
          remember(sig); // remember only on success
          showStatus('success', 'Thanks! Your request has been sent. We’ll be in touch shortly.');
          form.reset();
          // keep disabled briefly to deter instant re-clicks
          setTimeout(() => setSubmittingState(false), 4000);
        } else {
          // Try to show Formspree's error details
          let msg = 'Oops — there was a problem submitting the form.';
          try {
            const json = await resp.json();
            if (json && json.errors) {
              msg = json.errors.map(e => e.message).join(', ') || msg;
            }
          } catch(_) {}
          showStatus('danger', msg);
          setSubmittingState(false);
        }
      })
      .catch((err) => {
        const timedOut = (err && err.name === 'AbortError');
        showStatus('danger', timedOut
          ? 'Taking too long to respond. Please try again in a moment or email us directly.'
          : 'Network error — please try again, or email us directly.');
        setSubmittingState(false);
      });
    });
  })();