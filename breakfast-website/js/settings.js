// SETTINGS — profile picture, nickname, account info, log out, and team roles for managers.
import { api, html, avatar, toast, confirmDialog, fmtDay, setBusy } from './lib.js';
import { state, view, go, renderShell, refreshBrand, downloadBackup, restoreFromFile } from './app.js';

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
            <div class="card-head"><h2>Nickname</h2></div>
            <form class="card-pad inline-form" id="nick-form">
              <div class="field"><input class="input" name="nickname" value="${me.nickname}" maxlength="30" required aria-label="Nickname">
                <span class="hint">Shown in the top bar and next to the actions you perform.</span></div>
              <button class="btn btn-primary" type="submit">Save nickname</button>
            </form>
          </div>

          <div class="card">
            <div class="card-head"><h2>Account information</h2></div>
            <dl class="info-list">
              <dt>Full name</dt><dd>${me.fullName}</dd>
              <dt>Email</dt><dd>${me.email}</dd>
              <dt>Role</dt><dd class="role-pill">${me.role}</dd>
              <dt>Member since</dt><dd>${fmtDay(me.createdAt)}</dd>
              <dt>Employee ID</dt><dd>#${String(me.id).padStart(4, '0')}</dd>
            </dl>
            <div class="card-pad" style="display:flex;justify-content:flex-end">
              <button class="btn btn-danger-outline" id="logout">Log out</button>
            </div>
          </div>

          ${isManager() ? html`
            <div class="card">
              <div class="card-head"><h2>Team</h2><span class="muted small">${team.length} accounts</span></div>
              <div class="table-wrap"><table class="stack">
                <thead><tr><th>Employee</th><th>Email</th><th>Joined</th><th>Role</th></tr></thead>
                <tbody>${team.map((u) => html`<tr>
                  <td class="td-name"><div style="display:flex;align-items:center;gap:10px">${avatar(u)}<div><b>${u.nickname}</b><div class="muted small">${u.fullName}</div></div></div></td>
                  <td data-label="Email">${u.email}</td>
                  <td class="muted small" data-label="Joined">${fmtDay(u.createdAt)}</td>
                  <td data-label="Role"><select class="select" style="height:36px;width:auto" data-role="${u.id}">
                    <option value="employee" ${u.role === 'employee' ? 'selected' : ''}>Employee</option>
                    <option value="manager" ${u.role === 'manager' ? 'selected' : ''}>Manager</option>
                  </select></td>
                </tr>`)}</tbody>
              </table></div>
              <p class="card-pad muted small">Managers can correct completed shifts (every correction is logged). New employees sign up with the employee access code below.</p>
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
                <div class="name-row">
                  <div class="field"><label for="a-name">App name</label><input class="input" id="a-name" name="brandName" maxlength="40" value="${app.brandName}"></div>
                  <div class="field"><label for="a-sub">Small line under the name</label><input class="input" id="a-sub" name="brandSubtitle" maxlength="40" value="${app.brandSubtitle}"></div>
                </div>
                <div class="name-row">
                  <div class="field"><label for="a-access">Employee access code</label><input class="input" id="a-access" name="accessCode" value="${app.accessCode}"><span class="hint">Needed to create an account.</span></div>
                  <div class="field"><label for="a-delete">Delete code</label><input class="input" id="a-delete" name="deleteCode" value="${app.deleteCode}"><span class="hint">Needed to delete a shift.</span></div>
                </div>
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
      const ok = await confirmDialog({ title: 'Log out?', text: 'You’ll need your email and password to log back in.', confirmText: 'Log out', variant: 'danger' });
      if (!ok) return;
      await api('POST', '/api/auth/logout');
      state.me = null;
      go('/login');
    });

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
