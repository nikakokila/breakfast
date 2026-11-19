// SETTINGS — profile picture, nickname, account info, log out, and team roles for managers.
import { api, html, raw, avatar, toast, confirmDialog, fmtDay, setBusy, openModal } from './lib.js';
import { state, view, go, renderShell, refreshBrand, downloadBackup, restoreFromFile, lockApp } from './app.js';
import { play, isMuted, setMuted } from './sounds.js';

// Resize the chosen photo in the browser to a 320×320 square before uploading.
async function toSquareImage(file) {
  if (!/^image\/(png|jpeg|webp|gif|heic|heif)$/.test(file.type) && !file.type.startsWith('image/')) {
    throw new Error('Please choose an image file.');
  }
  const bitmap = await createImageBitmap(file);
  const size = 320;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const side = Math.min(bitmap.width, bitmap.height);
  ctx.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.88);
}

// Shrinks a logo to at most 600×200 pixels, keeping transparency.
async function toLogoImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 600 / bitmap.width, 200 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/png');
}

// Shrinks a header photo to 1600 pixels wide (JPEG) so it stays small on the tablet.
async function toHeroImage(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / bitmap.width, 900 / bitmap.height);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  let q = 0.82, url = canvas.toDataURL('image/jpeg', q);
  while (url.length > 900000 && q > 0.4) { q -= 0.1; url = canvas.toDataURL('image/jpeg', q); }
  return url;
}

export async function renderSettings() {
  const isManager = () => state.me.role === 'manager';

  const draw = async () => {
    const el = view();
    const me = state.me;
    const team = isManager() ? (await api('GET', '/api/users')).users : [];
    const app = isManager() ? await api('GET', '/api/settings') : null;

    el.innerHTML = String(html`
      <div class="page-head"><div><div class="eyebrow">Your account</div><h1>Settings</h1><p>Manage your profile. Changes never alter past shift records.</p></div></div>

      <div class="settings-grid">
        <div class="card profile-card">
          ${avatar(me, 'xl')}
          <h2>${me.nickname}</h2>
          <p class="muted">${me.fullName}</p>
          <div class="profile-actions">
            <label class="btn btn-outline btn-sm" style="cursor:pointer">
              ${me.avatarUrl ? 'Change picture' : 'Upload picture'}
              <input type="file" accept="image/*" id="avatar-file" class="sr-only">
            </label>
            ${me.avatarUrl ? html`<button class="btn btn-ghost btn-sm" id="avatar-remove">Remove</button>` : ''}
          </div>
          <p class="muted small" style="margin-top:10px">JPG, PNG or WebP. Visible only to logged-in staff.</p>
        </div>

        <div style="display:grid;gap:22px">
          <div class="card">
            <div class="card-head"><h2>Name on the login screen</h2></div>
            <form class="card-pad inline-form" id="nick-form">
              <div class="field"><input class="input" name="nickname" value="${me.nickname}" maxlength="30" required aria-label="Nickname">
                <span class="hint">Shown on the login screen, in the top bar and next to the actions you perform.</span></div>
              <button class="btn btn-primary" type="submit">Save name</button>
            </form>
          </div>

          <div class="card">
            <div class="card-head"><h2>${me.hasPin ? 'Change your PIN' : 'Choose a PIN'}</h2></div>
            <form class="card-pad" id="pin-form" autocomplete="off">
              <div id="pin-error"></div>
              <div class="pin-row">
                ${me.hasPin ? html`<div class="field"><label for="p-cur">Current PIN</label><input class="input pin-input" id="p-cur" type="password" inputmode="numeric" maxlength="4"></div>` : ''}
                <div class="field"><label for="p-new">New PIN</label><input class="input pin-input" id="p-new" type="password" inputmode="numeric" maxlength="4"></div>
                <div class="field"><label for="p-new2">Repeat new PIN</label><input class="input pin-input" id="p-new2" type="password" inputmode="numeric" maxlength="4"></div>
              </div>
              <button class="btn btn-primary" type="submit">Save PIN</button>
              <p class="muted small" style="margin-top:10px">Forgot your PIN? A manager can give you a new one in Settings → Team.</p>
            </form>
          </div>

          <div class="card">
            <div class="card-head"><h2>Account information</h2></div>
            <dl class="info-list">
              <dt>Full name</dt><dd>${me.fullName}</dd>
              <dt>Role</dt><dd class="role-pill">${me.role}</dd>
              <dt>Member since</dt><dd>${fmtDay(me.createdAt)}</dd>
              <dt>Employee ID</dt><dd>#${String(me.id).padStart(4, '0')}</dd>
            </dl>
            <div class="card-pad" style="display:flex;justify-content:flex-end">
              <button class="btn btn-danger-outline" id="logout">Lock / log out</button>
            </div>
          </div>

          <div class="card">
            <div class="card-head"><h2>Sounds</h2><span class="muted small">${isMuted() ? 'Muted' : 'On'}</span></div>
            <div class="card-pad theme-actions">
              <button type="button" class="btn btn-outline btn-sm" id="preview-sound">Play the app sounds</button>
              <label class="check-row" style="margin:0"><input type="checkbox" id="mute-box" ${isMuted() ? 'checked' : ''}> Mute all sounds on this tablet</label>
            </div>
          </div>

          ${isManager() ? html`
            <div class="card">
              <div class="card-head"><h2>Team</h2><div class="head-actions"><span class="muted small">${team.length} people</span><button class="btn btn-gold btn-sm" type="button" id="add-staff">+ Add employee</button></div></div>
              <div class="table-wrap"><table class="stack">
                <thead><tr><th>Employee</th><th>Joined</th><th>Role</th><th></th></tr></thead>
                <tbody>${team.map((u) => html`<tr>
                  <td class="td-name"><div style="display:flex;align-items:center;gap:10px">${avatar(u)}<div><b>${u.nickname}</b><div class="muted small">${u.fullName}</div></div></div></td>
                  <td class="muted small" data-label="Joined">${fmtDay(u.createdAt)}</td>
                  <td data-label="Role"><select class="select" style="height:36px;width:auto" data-role="${u.id}">
                    <option value="employee" ${u.role === 'employee' ? 'selected' : ''}>Employee</option>
                    <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
                  </select></td>
                  <td class="actions"><button class="btn btn-ghost btn-sm" type="button" data-reset-pin="${u.id}" data-name="${u.nickname}">${u.hasPin ? 'Reset PIN' : 'Set PIN'}</button>
                    ${u.id !== me.id ? html`<button class="btn btn-ghost btn-sm danger-text" type="button" data-remove="${u.id}" data-name="${u.nickname}">Remove</button>` : ''}</td>
                </tr>`)}</tbody>
              </table></div>
              <p class="card-pad muted small">Only managers can add or remove people. Everyone logs in by typing their own PIN, so every PIN must be different. Removed people stay on old shift records.</p>
            </div>

            <div class="card">
              <div class="card-head"><h2>App settings</h2><span class="muted small">Managers only</span></div>
              <form class="card-pad" id="app-form" autocomplete="off">
                <div id="app-error"></div>
                <div class="logo-row">
                  <div class="logo-preview">${state.brand.logo.startsWith('data:') ? html`<img src="${state.brand.logo}" alt="Logo">` : html`<img src="img/emblem.svg" alt="">`}</div>
                  <div>
                    <b>Logo</b>
                    <p class="muted small">Shown at the top of every screen. A white or light version looks best on the navy bar.</p>
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                      <label class="btn btn-outline btn-sm" style="cursor:pointer">${app.hasLogo ? 'Change logo' : 'Upload logo'}<input type="file" id="logo-file" accept="image/*" class="sr-only"></label>
                      ${app.hasLogo ? html`<button type="button" class="btn btn-ghost btn-sm" id="logo-remove">Use the default emblem</button>` : ''}
                    </div>
                  </div>
                </div>
                <div class="logo-row">
                  <div class="hero-preview" ${state.brand.hero ? raw(`style="background-image:url('${state.brand.hero}')"`) : ''}></div>
                  <div>
                    <b>Header photo</b>
                    <p class="muted small">The big picture at the top of every screen. A wide photo of the restaurant or breakfast buffet works best.</p>
                    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
                      <label class="btn btn-outline btn-sm" style="cursor:pointer">${app.hasHero ? 'Change photo' : 'Upload photo'}<input type="file" id="hero-file" accept="image/*" class="sr-only"></label>
                      ${app.hasHero ? html`<button type="button" class="btn btn-ghost btn-sm" id="hero-remove">Use the sunrise instead</button>` : ''}
                    </div>
                  </div>
                </div>
                <div class="name-row">
                  <div class="field"><label for="a-name">App name</label><input class="input" id="a-name" name="brandName" maxlength="40" value="${app.brandName}"></div>
                  <div class="field"><label for="a-sub">Small line under the name</label><input class="input" id="a-sub" name="brandSubtitle" maxlength="40" value="${app.brandSubtitle}"></div>
                </div>
                <div class="field"><label for="a-delete">Delete code</label><input class="input" id="a-delete" name="deleteCode" value="${app.deleteCode}"><span class="hint">Needed to delete a shift.</span></div>
                <div class="field"><label for="a-lock">Lock automatically</label>
                  <select class="select" id="a-lock" name="lockMinutes">
                    ${[[5, 'After 5 minutes without use'], [15, 'After 15 minutes without use'], [30, 'After 30 minutes without use'], [60, 'After 1 hour without use'], [0, 'Never']].map(([v, l]) => html`<option value="${v}" ${app.lockMinutes === v ? 'selected' : ''}>${l}</option>`)}
                  </select>
                  <span class="hint">The app goes back to “Who’s working?”, so each check-in is recorded under the right person.</span></div>
                <button class="btn btn-primary" type="submit">Save app settings</button>
              </form>
            </div>

            <div class="card">
              <div class="card-head"><h2>Backup &amp; restore</h2><span class="muted small">${app.lastBackupAt ? `Last backup ${fmtDay(app.lastBackupAt)}` : 'No backup yet'}</span></div>
              <div class="card-pad">
                <p>All accounts, shifts and statistics are stored only on this tablet. Download a backup regularly and keep it somewhere else, such as email or Google Drive. If the tablet is lost or replaced, restore the file on the new tablet.</p>
                <div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap">
                  <button class="btn btn-gold" type="button" id="backup-btn">Download backup</button>
                  <label class="btn btn-outline" style="cursor:pointer">Restore from a backup<input type="file" id="restore-input" accept=".json,application/json" class="sr-only"></label>
                </div>
                <p class="muted small" style="margin-top:10px">Restoring replaces everything on this tablet with the contents of the backup file.</p>
              </div>
            </div>` : ''}
        </div>
      </div>
    `);

    el.querySelector('#avatar-file').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const dataUrl = await toSquareImage(file);
        const { user } = await api('PUT', '/api/me/avatar', { dataUrl });
        state.me = user;
        toast('Profile picture updated.', 'success');
        refreshPage();
      } catch (err) { toast(err.message || 'Could not read that image.', 'error'); }
    });

    el.querySelector('#avatar-remove')?.addEventListener('click', async () => {
      const { user } = await api('DELETE', '/api/me/avatar');
      state.me = user;
      toast('Profile picture removed.');
      refreshPage();
    });

    el.querySelector('#nick-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('button');
      setBusy(btn, true, 'Saving…');
      try {
        const { user } = await api('PUT', '/api/me/nickname', { nickname: new FormData(e.target).get('nickname') });
        state.me = user;
        toast('Nickname saved.', 'success');
        refreshPage();
      } catch (err) { toast(err.message, 'error'); setBusy(btn, false); }
    });

    el.querySelector('#logout').addEventListener('click', async () => {
      lockApp();
    });

    // ----- PIN -----
    el.querySelector('#pin-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const err = el.querySelector('#pin-error');
      const pin = f.querySelector('#p-new').value;
      if (pin !== f.querySelector('#p-new2').value) { err.innerHTML = String(html`<div class="form-error">The two new PINs are different.</div>`); return; }
      try {
        const { user } = await api('PUT', '/api/me/pin', { currentPin: f.querySelector('#p-cur')?.value, pin });
        state.me = user;
        toast('PIN saved.', 'success');
        refreshPage();
      } catch (x) { err.innerHTML = String(html`<div class="form-error">${x.message}</div>`); }
    });
    el.querySelectorAll('[data-reset-pin]').forEach((b) => b.addEventListener('click', () => {
      openModal(String(html`
        <div class="modal-head"><h2>New PIN for ${b.dataset.name}</h2><p>Give them this PIN. They can change it later in their own Settings.</p></div>
        <form autocomplete="off"><div class="modal-body"><div id="rp-error"></div>
          <div class="field"><label for="rp-pin">New 4-digit PIN</label><input class="input pin-input" id="rp-pin" type="password" inputmode="numeric" maxlength="4" autofocus></div></div>
          <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-primary" type="submit">Save PIN</button></div>
        </form>`), (m, close) => {
        m.querySelector('[data-close]').onclick = close;
        m.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          try {
            await api('PUT', `/api/users/${b.dataset.resetPin}/pin`, { pin: m.querySelector('#rp-pin').value });
            close();
            toast(`New PIN saved for ${b.dataset.name}.`, 'success');
            refreshPage();
          } catch (x) { m.querySelector('#rp-error').innerHTML = String(html`<div class="form-error">${x.message}</div>`); }
        });
      });
    }));

    // ----- manager: app settings, logo, backup -----
    el.querySelector('#app-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = e.target.querySelector('[type=submit]');
      setBusy(btn, true, 'Saving…');
      try {
        await api('PUT', '/api/settings', Object.fromEntries(new FormData(e.target)));
        await refreshBrand();
        toast('App settings saved.', 'success');
        refreshPage();
      } catch (err) {
        el.querySelector('#app-error').innerHTML = String(html`<div class="form-error">${err.message}</div>`);
        setBusy(btn, false);
      }
    });
    el.querySelector('#logo-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await api('PUT', '/api/settings/logo', { dataUrl: await toLogoImage(file) });
        await refreshBrand();
        toast('Logo updated.', 'success');
        refreshPage();
      } catch (err) { toast(err.message || 'Could not read that image.', 'error'); }
    });
    el.querySelector('#hero-file')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        await api('PUT', '/api/settings/hero', { dataUrl: await toHeroImage(file) });
        await refreshBrand();
        toast('Header photo updated.', 'success');
        refreshPage();
      } catch (err) { toast(err.message || 'Could not read that image.', 'error'); }
    });
    el.querySelector('#hero-remove')?.addEventListener('click', async () => {
      await api('DELETE', '/api/settings/hero');
      await refreshBrand();
      toast('Using the sunrise header.');
      refreshPage();
    });
    el.querySelector('#logo-remove')?.addEventListener('click', async () => {
      await api('DELETE', '/api/settings/logo');
      await refreshBrand();
      toast('Using the default emblem.');
      refreshPage();
    });
    el.querySelector('#backup-btn')?.addEventListener('click', async () => { if (await downloadBackup()) refreshPage(); });
    el.querySelector('#restore-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      const ok = await confirmDialog({
        title: 'Restore this backup?',
        text: `Everything on this tablet will be replaced with the contents of “${file.name}”. Anything recorded since that backup will be lost.`,
        confirmText: 'Replace and restore',
        variant: 'danger',
      });
      if (ok) restoreFromFile(file);
    });

    // ----- look and sound -----
    el.querySelector('#preview-sound')?.addEventListener('click', () => {
      play('resort', 'login');
      setTimeout(() => play('resort', 'checkin'), 1800);
      setTimeout(() => play('resort', 'warn'), 2800);
    });
    el.querySelector('#mute-box')?.addEventListener('change', (e) => { setMuted(e.target.checked); renderShell('settings'); draw(); });

    // ----- manager: team -----
    el.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: `Remove ${b.dataset.name}?`,
        text: 'They will no longer be able to log in. Their name stays on the shifts they already worked.',
        confirmText: 'Remove', variant: 'danger',
      });
      if (!ok) return;
      try { await api('DELETE', `/api/users/${b.dataset.remove}`); toast(`${b.dataset.name} removed.`, 'success'); refreshPage(); }
      catch (err) { toast(err.message, 'error'); }
    }));
    el.querySelector('#add-staff')?.addEventListener('click', () => {
      openModal(String(html`
        <div class="modal-head"><h2>Add employee</h2><p>They will log in by typing this PIN, so it must be different from everyone else’s.</p></div>
        <form autocomplete="off" id="staff-form"><div class="modal-body"><div id="sf-error"></div>
          <div class="field"><label for="sf-name">Name</label><input class="input" id="sf-name" name="fullName" maxlength="80" required autofocus placeholder="e.g. Luka"></div>
          <div class="name-row">
            <div class="field"><label for="sf-pin">4-digit PIN</label><input class="input pin-input" id="sf-pin" name="pin" type="password" inputmode="numeric" maxlength="4" required></div>
            <div class="field"><label for="sf-role">Role</label><select class="select" id="sf-role" name="role"><option value="employee">Employee</option><option value="manager">Manager</option></select></div>
          </div>

        </div>
        <div class="modal-foot"><button type="button" class="btn btn-outline" data-close>Cancel</button><button class="btn btn-gold" type="submit">Add employee</button></div>
        </form>`), (m, close) => {
        m.querySelector('[data-close]').onclick = close;
        m.querySelector('form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const body = Object.fromEntries(new FormData(e.target));
          try {
            await api('POST', '/api/users', body);
            close();
            toast(`${body.fullName} added. They can log in with their PIN now.`, 'success');
            refreshPage();
          } catch (x) { m.querySelector('#sf-error').innerHTML = String(html`<div class="form-error">${x.message}</div>`); }
        });
      });
    });

    el.querySelectorAll('[data-role]').forEach((sel) => sel.addEventListener('change', async () => {
      try {
        await api('PUT', `/api/users/${sel.dataset.role}/role`, { role: sel.value });
        toast('Role updated.', 'success');
        if (Number(sel.dataset.role) === state.me.id) { state.me.role = sel.value; refreshPage(); }
      } catch (err) { toast(err.message, 'error'); refreshPage(); }
    }));
  };

  // Redraw the top bar too, so the new nickname/picture shows everywhere.
  const refreshPage = () => { renderShell('settings'); draw(); };
  await draw();
}
