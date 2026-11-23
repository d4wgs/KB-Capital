(() => {
  const sidebar = document.querySelector('#sidebar');
  const toggle = document.querySelector('#toggle-sidebar');
  const mobile = () => getComputedStyle(document.body).getPropertyValue('--mobile').trim() === '1';
  let collapsed = false;
  try { collapsed = localStorage.getItem('workspace.sidebar') === 'compact'; } catch {}
  let mobileOpen = false;
  function layout() {
    const narrow = mobile();
    document.body.classList.toggle('rail', !narrow && collapsed);
    document.body.classList.toggle('nav-open', narrow && mobileOpen);
    sidebar.inert = narrow && !mobileOpen;
    toggle.setAttribute('aria-expanded', String(narrow ? mobileOpen : !collapsed));
  }
  toggle.addEventListener('click', () => {
    if (mobile()) mobileOpen = !mobileOpen;
    else {
      collapsed = !collapsed;
      try { localStorage.setItem('workspace.sidebar', collapsed ? 'compact' : 'full'); } catch {}
    }
    layout();
    if (mobileOpen && mobile()) sidebar.querySelector('[aria-current]')?.focus();
  });
  window.addEventListener('resize', layout);
  document.addEventListener('focusin', event => {
    if (mobileOpen && mobile() && !sidebar.contains(event.target) && event.target !== toggle) {
      mobileOpen = false;
      layout();
    }
  });
  layout();

  const dialog = document.querySelector('#workspace-search');
  const input = document.querySelector('#workspace-query');
  const results = document.querySelector('#search-results');
  let request;
  async function search() {
    request?.abort();
    request = new AbortController();
    try {
      const response = await fetch('/workspace-search?q=' + encodeURIComponent(input.value), {signal:request.signal});
      if (!response.ok) throw Error();
      const pages = await response.json();
      const links = pages.map(page => {
        const link = document.createElement('a');
        link.href = page.route;
        link.textContent = page.category + ' / ' + page.label;
        return link;
      });
      results.replaceChildren(...links);
      if (!links.length) results.textContent = 'No matching pages.';
    } catch (error) {
      if (error.name !== 'AbortError') results.textContent = 'Search unavailable. Try again.';
    }
  }
  function openSearch() {
    if (dialog.open) return;
    dialog.showModal();
    input.value = '';
    input.focus();
    search();
  }
  document.querySelector('#open-search').onclick = openSearch;
  document.querySelector('#close-search').onclick = () => dialog.close();
  input.addEventListener('input', search);
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter') results.querySelector('a')?.click();
  });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      openSearch();
    }
    if (event.key === 'Escape' && mobileOpen) {
      mobileOpen = false;
      layout();
      toggle.focus();
    }
  });
})();
