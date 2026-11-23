const menu = document.querySelector('.menu');
const navigation = document.getElementById('primary-nav');
const narrow = matchMedia('(max-width: 680px)');
function toggleMenu(open) {
  menu.setAttribute('aria-expanded', String(open));
  navigation.hidden = narrow.matches && !open;
}
function updateMenu() {
  menu.hidden = !narrow.matches;
  toggleMenu(false);
}
menu.addEventListener('click', () => toggleMenu(navigation.hidden));
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') {
    toggleMenu(false);
    menu.focus();
  }
});
narrow.addEventListener('change', updateMenu);
updateMenu();
