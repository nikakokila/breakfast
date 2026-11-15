// Makes the app installable and usable offline.
// 1) Registers the service worker (it keeps a copy of the app on the tablet).
// 2) Shows an "Install app" button when Chrome allows installing.

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Offline mode unavailable:', err));
  });
}

const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone;
let deferred = null;

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e;
  if (standalone() || document.getElementById('install-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'install-bar';
  bar.className = 'install-bar';
  bar.innerHTML = `<img src="icons/icon-192.png" alt=""><div><b>Install the app</b><span>Adds an icon to this tablet and opens full-screen.</span></div>
    <button class="btn btn-gold btn-sm" type="button" id="install-yes">Install</button>
    <button class="btn btn-ghost btn-sm" type="button" id="install-no" aria-label="Not now">Not now</button>`;
  document.body.appendChild(bar);
  bar.querySelector('#install-yes').onclick = async () => {
    bar.remove();
    deferred.prompt();
    await deferred.userChoice.catch(() => {});
    deferred = null;
  };
  bar.querySelector('#install-no').onclick = () => bar.remove();
});

window.addEventListener('appinstalled', () => document.getElementById('install-bar')?.remove());
