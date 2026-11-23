const preview = document.querySelector('#sample-status b');
document.querySelectorAll('[role="tablist"]').forEach(list => {
  list.addEventListener('click', event => {
    const selected = event.target.closest('[role="tab"]');
    if (!selected) return;
    list.querySelectorAll('[role="tab"]').forEach(tab => {
      tab.setAttribute('aria-selected', String(tab === selected));
      tab.classList.toggle('on', tab === selected);
    });
    preview.textContent = selected.textContent + ' selected';
    if (selected.dataset.v) {
      document.querySelector('#sample-chart').hidden = selected.dataset.v !== 'chart';
      document.querySelector('#sample-table').hidden = selected.dataset.v !== 'table';
    }
  });
});
document.querySelector('#sample-button').onclick = () => { preview.textContent = 'Example action complete'; };
