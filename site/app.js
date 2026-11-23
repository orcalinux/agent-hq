(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const navigation = document.getElementById('navigation');
  const menuToggle = document.querySelector('.mobile-toggle');
  const mobile = window.matchMedia('(max-width: 760px)');
  let menuOpen = false;
  const syncMenu = () => {
    menuToggle.hidden = !mobile.matches;
    navigation.hidden = mobile.matches && !menuOpen;
    menuToggle.setAttribute('aria-expanded', String(menuOpen));
    menuToggle.setAttribute('aria-label', menuOpen ? 'Close navigation' : 'Open navigation');
  };
  menuToggle.addEventListener('click', () => {
    menuOpen = !menuOpen;
    syncMenu();
  });
  navigation.addEventListener('click', (event) => {
    if (!event.target.closest('a') || !mobile.matches) return;
    menuOpen = false;
    syncMenu();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !menuOpen) return;
    menuOpen = false;
    syncMenu();
    menuToggle.focus();
  });
  document.addEventListener('click', (event) => {
    if (!menuOpen || event.target.closest('.top')) return;
    menuOpen = false;
    syncMenu();
  });
  mobile.addEventListener('change', () => {
    menuOpen = false;
    syncMenu();
  });
  syncMenu();

  const tabs = [...document.querySelectorAll('.tour-tabs [role="tab"]')];
  const panels = [...document.querySelectorAll('.tour-panel')];
  const expand = document.querySelector('.expand-shot');
  const lightbox = document.getElementById('screenshot-dialog');
  let activeView = 'workspace';
  const selectView = (tab) => {
    activeView = tab.dataset.view;
    tabs.forEach((item) => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel) => { panel.hidden = panel.id !== `panel-${activeView}`; });
    expand.setAttribute('aria-label', `Expand ${activeView} screenshot`);
  };
  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => selectView(tab));
    tab.addEventListener('keydown', (event) => {
      let next;
      if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
      if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === 'Home') next = 0;
      if (event.key === 'End') next = tabs.length - 1;
      if (next === undefined) return;
      event.preventDefault();
      selectView(tabs[next]);
      tabs[next].focus();
    });
  });
  if (typeof lightbox.showModal === 'function') {
    expand.hidden = false;
    expand.addEventListener('click', () => {
      const source = document.querySelector(`#panel-${activeView} img`);
      const image = lightbox.querySelector('img');
      image.src = source.src;
      image.alt = source.alt;
      lightbox.querySelector('.original-shot').href = source.src;
      document.getElementById('lightbox-title').textContent = `Agent HQ / ${activeView}`;
      lightbox.showModal();
    });
    lightbox.querySelector('button').addEventListener('click', () => lightbox.close());
    lightbox.addEventListener('click', (event) => {
      if (event.target !== lightbox) return;
      const bounds = lightbox.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) lightbox.close();
    });
  }

  const preview = document.querySelector('.mission-preview');
  const motionToggle = document.querySelector('.motion-toggle');
  let manuallyPaused = false;
  let previewVisible = true;
  const syncMotion = () => {
    motionToggle.hidden = reducedMotion.matches;
    preview.classList.toggle('motion-paused', manuallyPaused || !previewVisible || document.hidden || reducedMotion.matches);
    motionToggle.textContent = manuallyPaused ? 'Play animation' : 'Pause animation';
    motionToggle.setAttribute('aria-pressed', String(manuallyPaused));
  };
  motionToggle.addEventListener('click', () => {
    manuallyPaused = !manuallyPaused;
    syncMotion();
  });
  reducedMotion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  syncMotion();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(([entry]) => {
      previewVisible = entry.isIntersecting;
      syncMotion();
    }).observe(preview);
    const reveals = [...document.querySelectorAll('.reveal')];
    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.remove('is-waiting');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.05 });
    reveals.forEach((element) => {
      if (element.getBoundingClientRect().top > window.innerHeight && !reducedMotion.matches) element.classList.add('is-waiting');
      revealObserver.observe(element);
    });
    document.addEventListener('focusin', (event) => {
      const waiting = event.target.closest('.reveal.is-waiting');
      if (waiting) waiting.classList.remove('is-waiting');
    });
  }

  const userAgent = navigator.userAgent;
  const platform = /Windows/i.test(userAgent) ? 'windows' : /Macintosh|Mac OS X/i.test(userAgent) && !/iPhone|iPad/i.test(userAgent) ? 'mac' : /Linux/i.test(userAgent) && !/Android/i.test(userAgent) ? 'linux' : null;
  if (platform) {
    const option = document.querySelector(`[data-platform="${platform}"]`);
    option.classList.add('recommended');
    option.querySelector('.platform-recommendation').hidden = false;
  }
  const patterns = {
    deb: /-linux-amd64\.deb$/i,
    rpm: /-linux-x86_64\.rpm$/i,
    appimage: /-linux-x86_64\.AppImage$/i,
    'mac-arm': /-mac-arm64\.dmg$/i,
    'mac-intel': /-mac-x64\.dmg$/i,
    windows: /-win-x64\.exe$/i,
  };
  const safeAssetUrl = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'github.com' && url.pathname.startsWith('/orcalinux/agent-hq/releases/download/') ? url.href : null;
    } catch {
      return null;
    }
  };
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 8000);
  fetch('https://api.github.com/repos/orcalinux/agent-hq/releases/latest', { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((release) => {
      const assets = Array.isArray(release.assets) ? release.assets : [];
      let resolved = 0;
      document.querySelectorAll('[data-asset]').forEach((link) => {
        const pattern = patterns[link.dataset.asset];
        const asset = assets.find((item) => typeof item.name === 'string' && pattern.test(item.name));
        const url = asset && safeAssetUrl(asset.browser_download_url);
        if (!url) return;
        link.href = url;
        link.setAttribute('aria-label', `Download ${asset.name}`);
        resolved++;
      });
      if (/^v?\d+\.\d+\.\d+$/.test(release.tag_name)) {
        const version = release.tag_name.replace(/^v/, '');
        document.querySelectorAll('[data-version]').forEach((element) => { element.textContent = version; });
        document.querySelector('[data-release-label]').textContent = `Latest release / v${version}`;
      }
      const checksums = assets.find((asset) => asset.name === 'SHA256SUMS.txt');
      const checksumUrl = checksums && safeAssetUrl(checksums.browser_download_url);
      if (checksumUrl) document.querySelector('[data-checksums]').href = checksumUrl;
      document.getElementById('download-note').textContent = resolved
        ? 'Available builds download from GitHub; other links open Releases. Installers are not code-signed, so your OS may show a warning.'
        : 'Installers are not code-signed. Browse GitHub Releases for available builds.';
    })
    .catch(() => {
      document.getElementById('download-note').textContent = 'Could not load the latest builds. Download links still open GitHub Releases. Installers are not code-signed.';
    })
    .finally(() => window.clearTimeout(timeout));
})();
