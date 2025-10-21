const textarea = document.getElementById('note');
const storageKey = 'gx-extension-note';

textarea.value = localStorage.getItem(storageKey) || '';

textarea.addEventListener('input', () => {
  localStorage.setItem(storageKey, textarea.value);
});
