(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  // Carousel: both cards (Score = 'meter', Rhythm = 'rhythm') over one nature background; swipe or tap a dot.
  const TREATMENTS = ['meter', 'rhythm'];
  const carousel = $('share-carousel');
  const images = Object.fromEntries(TREATMENTS.map(t => [t, carousel.querySelector('img[data-treatment="' + t + '"]')]));
  const dots = [...document.querySelectorAll('#share-dots button')];
  let current = null;
  let revision = 0;
  let assets = {};
  let active = 'meter';
  let busy = false;
  const asset = () => assets[active] || null;
  const scripts = new Map();

  function status(message, error = false) {
    $('share-status').textContent = message;
    $('share-status').dataset.tone = error ? 'error' : 'info';
  }
  function supportsSharing(file) {
    try {
      return window.isSecureContext && typeof navigator.share === 'function' &&
        typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    } catch (_) { return false; }
  }
  function controls() {
    const ready = !!asset() && busy !== 'share' && busy !== 'download';
    $('share-native').disabled = !ready;
    $('share-save').disabled = !ready;
    $('share-native-label').textContent = busy === 'share' ? 'Opening share menu…' : 'Share image';
    $('share-save').setAttribute('aria-busy', String(busy === 'download'));
    dots.forEach(dot => dot.setAttribute('aria-selected', String(dot.dataset.treatment === active)));
  }
  // Which card is showing: the slide nearest the carousel's scroll position.
  function setActive(treatment) {
    if (!TREATMENTS.includes(treatment) || treatment === active) return controls();
    active = treatment; status(''); controls();
  }
  function show(treatment, smooth = true) {
    const i = TREATMENTS.indexOf(treatment);
    if (i < 0) return;
    carousel.scrollTo({ left: i * carousel.clientWidth, behavior: smooth ? 'smooth' : 'instant' });
    setActive(treatment);
  }
  carousel.addEventListener('scroll', () => {
    const i = Math.round(carousel.scrollLeft / Math.max(1, carousel.clientWidth));
    setActive(TREATMENTS[Math.max(0, Math.min(TREATMENTS.length - 1, i))]);
  }, { passive: true });
  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      show(TREATMENTS[Math.max(0, Math.min(TREATMENTS.length - 1, TREATMENTS.indexOf(active) + (event.key === 'ArrowRight' ? 1 : -1)))]);
    }
  });
  dots.forEach(dot => dot.addEventListener('click', () => show(dot.dataset.treatment)));

  function loadScript(file) {
    if (scripts.has(file)) return scripts.get(file);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = file + '?v=sans-sentence-caption-20261020';
      script.onload = resolve;
      script.onerror = () => { script.remove(); scripts.delete(file); reject(new Error('Artwork unavailable')); };
      document.head.append(script);
    });
    scripts.set(file, promise);
    return promise;
  }

  // Self-contained SVG keeps the exact approved paper/font bytes and transparent edges.
  // No participant name, numerical reading labels or characteristic fixtures are exported.
  async function drawArtefact(snapshot, treatment) {
    const designs = window.TraceArtefactDesigns;
    if (!designs) throw new Error('Artwork renderer unavailable');
    const shareOptions = window.TraceReportOptions?.share || {};
    const spec = window.TraceCardLogic ? window.TraceCardLogic.spec(snapshot, shareOptions) : null;
    const variant = designs.variants.find(item => item.key === (spec ? spec.paper : snapshot.archetype)) || designs.variants[0];
    await Promise.all([
      loadScript('artefacts/runtime/fonts.js'),
      loadScript('artefacts/runtime/' + variant.key + '.js')
    ]);
    const svg = designs.render(snapshot, {
      treatment,
      figurePercent: shareOptions.figurePercent,
      card: shareOptions.card,
      variant: variant.key,
      fontStyle: window.TraceArtefactFonts,
      backgroundData: window.TraceArtefactPapers[variant.key]
    });
    const canvas = document.createElement('canvas');
    canvas.width = 1086; canvas.height = 1448;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Image rendering unavailable');
    const svgURL = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    try {
      const artwork = new Image();
      await new Promise((resolve, reject) => {
        artwork.onload = resolve;
        artwork.onerror = () => reject(new Error('Could not render artwork'));
        artwork.src = svgURL;
      });
      ctx.drawImage(artwork, 0, 0);
      return await new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob); else reject(new Error('Could not prepare image'));
      }, 'image/png'));
    } finally { URL.revokeObjectURL(svgURL); }
  }

  async function prepare(data) {
    // Copy only fields permitted in the image, not the participant record.
    const snapshot = { date: data.date, rhythmDisplay: data.rhythmDisplay, stressDisplay: data.stressDisplay, archetype: data.archetype,
      w: data.w, w2: data.w2, e: data.e, eveningHours: data.eveningHours };
    const key = JSON.stringify(snapshot);
    if (current && current.key === key && TREATMENTS.every(t => assets[t])) return;
    current = { key, snapshot };
    const version = ++revision;
    busy = 'render';
    Object.values(assets).forEach(a => URL.revokeObjectURL(a.url));
    assets = {};
    TREATMENTS.forEach(t => { images[t].hidden = true; images[t].removeAttribute('src'); });
    $('share-loading').hidden = false;
    $('share-loading').textContent = 'Preparing your preview…';
    $('share-preview-stage').setAttribute('aria-busy', 'true');
    $('share-retry').hidden = true;
    status(''); controls();
    try {
      const sharedDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
        .format(new Date(snapshot.date + 'T00:00:00Z'));
      // The visible card first, so it appears as soon as possible; the other one right after.
      for (const treatment of [active, ...TREATMENTS.filter(t => t !== active)]) {
        const blob = await drawArtefact(snapshot, treatment);
        if (version !== revision) return;
        const label = treatment === 'meter' ? 'score' : 'rhythm';
        const file = new File([blob], `trace-cortisol-${label}-${snapshot.date}.png`, { type: 'image/png' });
        assets[treatment] = { file, url: URL.createObjectURL(blob) };
        images[treatment].src = assets[treatment].url;
        images[treatment].alt = `Trace ${label} story overlay. Rhythm score ${snapshot.rhythmDisplay} out of 100. Sample collected ${sharedDate}. No name or raw reading labels.`;
        images[treatment].hidden = false;
        $('share-loading').hidden = true;
        controls();
      }
    } catch (_) {
      if (version !== revision) return;
      $('share-loading').hidden = false;
      $('share-loading').textContent = 'Your image couldn’t be prepared.';
      $('share-retry').hidden = false;
      status('Please try again. Your report is still here.', true);
    } finally {
      if (version === revision) {
        busy = false;
        $('share-preview-stage').setAttribute('aria-busy', 'false');
        controls();
      }
    }
  }

  $('share-native').addEventListener('click', async () => {
    const asset = assets[active];
    if (!asset || busy) return;
    if (!supportsSharing(asset.file)) { controls(); status('Save the image to share it from your gallery.'); return; }
    const version = revision;
    busy = 'share'; controls(); status('');
    try {
      // The file is ready before the click so navigator.share retains user activation.
      await navigator.share({ files: [asset.file] });
      if (version === revision) status('Your image was handed to the share menu. Finish posting in the app you chose.');
    } catch (error) {
      if (version !== revision) return;
      if (error.name === 'AbortError') status('Sharing cancelled. Your image is ready when you are.');
      else status('The share menu couldn’t open. Try again, or save the image and add it to your story.', true);
    } finally {
      if (version === revision) { busy = false; controls(); }
    }
  });
  $('share-save').addEventListener('click', async () => {
    const asset = assets[active];
    if (!asset || busy) return;
    const version = revision;
    busy = 'download'; controls(); status('');
    try {
      // Paint the in-button progress state before handing the ready file to the browser.
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (version !== revision) return;
      const link = document.createElement('a');
      link.href = asset.url; link.download = asset.file.name;
      document.body.append(link); link.click(); link.remove();
    } catch (_) {
      if (version === revision) status('The image couldn’t be saved. Please try again.', true);
    } finally {
      if (version === revision) { busy = false; controls(); }
    }
  });
  $('share-retry').addEventListener('click', () => { if (current) prepare(current.snapshot); });
  window.TraceReportShare = Object.freeze({ prepare, show, get active() { return active; }, ready: treatment => !!assets[treatment] });
})();
