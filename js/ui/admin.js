/* Administration: clients, assets, users, settings, audit trail. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, h = U.h;
  HB.views = HB.views || {};
  const simple = (title, drawFn) => { const v = { title }; v.render = (root, ctx) => { v.ctx = ctx; v.root = root; root.append(h('div', { class: 'stack', id: 'adm-' + title.replace(/\W/g, '') })); v.draw(); }; v.onStoreChange = () => { if (v.root && v.root.isConnected) v.draw(); }; v.draw = () => { const wrap = v.root.firstChild; if (!wrap) return; U.clear(wrap); drawFn(wrap, v.ctx, v); }; return v; };

  // ---------------------------------------------------------------- clients
  HB.views.clients = simple('Clients', (wrap, ctx) => {
    const { store } = ctx; const manage = ctx.can('client.manage'); const trips = store.trips();
    const rows = U.sortBy(store.state.clients, (c) => E.norm(c.name));
    wrap.append(h('div', { class: 'toolbar' }, h('p', { class: 'muted small grow', text: 'Client master list (Settings sheet). The code prefixes generated invoice numbers.' }), manage ? h('button', { class: 'btn accent', onClick: () => editClient(ctx, null) }, '+ New client') : null));
    wrap.append(h('div', { class: 'table-frame' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Client Name', 'Code', 'Default Contract Type', 'Address / contact', 'Trips', 'Billing (₦)', 'Balance (₦)', 'Active', ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((c) => { const mine = trips.filter((t) => E.norm(t.client) === E.norm(c.name)); return h('tr', {}, h('td', { text: c.name }), h('td', { class: 'num', text: c.code }), h('td', { text: c.contractType || '' }), h('td', { text: c.address || '' }), h('td', { class: 'num', text: mine.length }), h('td', { class: 'money', text: U.money(E.sum(mine, 'billing')) }), h('td', { class: 'money', text: U.money(E.sum(mine, 'balance')) }), h('td', {}, U.pill(c.active === false ? 'Inactive' : 'Active', c.active === false ? 'neutral' : 'good')), h('td', {}, manage ? h('button', { class: 'btn sm', onClick: () => editClient(ctx, c.id) }, 'Edit') : '')); })))));
  });
  function editClient(ctx, id) {
    const { store } = ctx; const c = id ? store.state.clients.find((x) => x.id === id) : null; const t = Object.assign({ name: '', code: '', contractType: '', address: '', email: '', active: true }, c || {});
    const inp = { name: h('input', { type: 'text', value: t.name }), code: h('input', { type: 'text', value: t.code, maxlength: 6, style: { textTransform: 'uppercase' } }), contractType: h('input', { type: 'text', value: t.contractType }), address: h('input', { type: 'text', value: t.address }), email: h('input', { type: 'text', value: t.email || '' }), active: U.select([['true', 'Active'], ['false', 'Inactive']], String(t.active !== false)) };
    const m = U.modal({ title: id ? 'Edit client' : 'New client', body: h('div', { class: 'form-grid' }, U.field('Client Name', inp.name, { span2: true }), U.field('Client code (invoice prefix)', inp.code), U.field('Default contract type', inp.contractType), U.field('Address', inp.address, { span2: true }), U.field('Email', inp.email), U.field('Status', inp.active)) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const d = { id: id || undefined, name: E.clean(inp.name.value), code: E.clean(inp.code.value).toUpperCase() || E.clientCode(inp.name.value, []), contractType: E.clean(inp.contractType.value), address: E.clean(inp.address.value), email: E.clean(inp.email.value), active: inp.active.value === 'true' };
      if (!d.name) return U.toast('Client name is required.', 'bad');
      if (store.state.clients.some((x) => x.id !== id && E.norm(x.name) === E.norm(d.name))) return U.toast('A client with this name already exists.', 'bad');
      if (!id) d.id = d.code.toLowerCase() + (store.state.clients.some((x) => x.id === d.code.toLowerCase()) ? '-' + Date.now().toString(36) : '');
      try { await store.saveDoc('clients', d, { expectedVersion: c ? c.version : undefined }); m.close(); HB.views.clients.draw(); U.toast('Client saved.', 'good'); } catch (e) { U.toast(e.message, 'bad'); }
    } }, 'Save')]);
  }

  // ---------------------------------------------------------------- assets
  HB.views.assets = simple('Asset List', (wrap, ctx) => {
    const { store } = ctx; const manage = ctx.can('asset.manage'); const trips = store.trips();
    const rows = U.sortBy(store.state.assets, (a) => `${a.vehicleCategory}|${a.plate}`);
    wrap.append(h('div', { class: 'toolbar' }, h('p', { class: 'muted small grow', text: 'Asset List sheet: the plate number drives Asset Code, Type of Vehicle, Category and Cost Center on every trip.' }), manage ? h('button', { class: 'btn accent', onClick: () => editAsset(ctx, null) }, '+ New vehicle') : null, h('button', { class: 'btn', onClick: () => HB.exporter.xlsx([{ name: 'Asset List', rows: [['Plate Number', 'Asset Code', 'Type of Vehicle', 'Cost Center', 'Type'], ...rows.map((a) => [a.plate, a.assetCode, a.vehicleType, a.costCenter, a.vehicleCategory])] }], `Asset_List_${U.todayISO()}.xlsx`) }, 'Export Excel')));
    wrap.append(h('div', { class: 'table-frame' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Plate Number', 'Asset Code', 'Type of Vehicle', 'Category (Type)', 'Cost Center', 'Trips', 'Billing (₦)', 'Status', ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((a) => { const mine = trips.filter((t) => E.norm(t.plate) === E.norm(a.plate)); return h('tr', {}, h('td', { text: a.plate }), h('td', { text: a.assetCode }), h('td', { text: a.vehicleType }), h('td', { text: a.vehicleCategory }), h('td', { text: a.costCenter }), h('td', { class: 'num', text: mine.length }), h('td', { class: 'money', text: U.money(E.sum(mine, 'billing')) }), h('td', {}, U.pill(a.active === false ? 'Retired' : 'Active', a.active === false ? 'neutral' : 'good')), h('td', {}, manage ? h('button', { class: 'btn sm', onClick: () => editAsset(ctx, a.id || a.plate) }, 'Edit') : '')); })))));
  });
  function editAsset(ctx, id) {
    const { store } = ctx; const a = id ? store.state.assets.find((x) => (x.id || x.plate) === id) : null; const t = Object.assign({ plate: '', assetCode: '', vehicleType: 'HAULAGE', costCenter: 'CC059', vehicleCategory: 'New Batch', active: true }, a || {});
    const types = [...new Set(store.state.assets.map((x) => x.vehicleType))].sort(), cats = [...new Set(store.state.assets.map((x) => x.vehicleCategory))].sort(), ccs = [...new Set(store.state.assets.map((x) => x.costCenter))].sort();
    const inp = { plate: h('input', { type: 'text', value: t.plate, disabled: !!a }), assetCode: h('input', { type: 'text', value: t.assetCode }), vehicleType: U.datalistInput('dl-vt', types, t.vehicleType), costCenter: U.datalistInput('dl-cc', ccs, t.costCenter), vehicleCategory: U.datalistInput('dl-vc', cats, t.vehicleCategory), active: U.select([['true', 'Active'], ['false', 'Retired']], String(t.active !== false)) };
    const val = (k) => (inp[k].tagName === 'SPAN' ? inp[k].querySelector('input') : inp[k]).value;
    const m = U.modal({ title: id ? 'Edit vehicle' : 'New vehicle', body: h('div', { class: 'form-grid' }, U.field('Plate Number', inp.plate), U.field('Asset Code', inp.assetCode), U.field('Type of Vehicle', inp.vehicleType), U.field('Cost Center', inp.costCenter), U.field('Category (Type)', inp.vehicleCategory), U.field('Status', inp.active)) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const d = { id: a ? (a.id || a.plate) : E.clean(val('plate')).replace(/[^A-Za-z0-9_-]+/g, '-'), plate: E.clean(val('plate')), assetCode: E.clean(val('assetCode')), vehicleType: E.clean(val('vehicleType')), costCenter: E.clean(val('costCenter')), vehicleCategory: E.clean(val('vehicleCategory')), active: val('active') === 'true' };
      if (!d.plate || !d.assetCode) return U.toast('Plate number and asset code are required.', 'bad');
      if (!a && store.state.assets.some((x) => E.norm(x.plate) === E.norm(d.plate))) return U.toast('This plate already exists.', 'bad');
      try { await store.saveDoc('assets', d, { expectedVersion: a ? a.version : undefined, label: d.plate }); m.close(); HB.views.assets.draw(); U.toast('Vehicle saved.', 'good'); } catch (e) { U.toast(e.message, 'bad'); }
    } }, 'Save')]);
  }

  // ---------------------------------------------------------------- users
  HB.views.users = simple('Users & Roles', (wrap, ctx) => {
    const { store } = ctx; if (!ctx.can('user.manage')) { wrap.append(h('div', { class: 'notice bad', text: 'Only administrators manage users.' })); return; }
    const rows = U.sortBy(store.state.users, 'username');
    wrap.append(h('div', { class: 'toolbar' }, h('p', { class: 'muted small grow', text: 'Every team member gets an individual account. Passwords are stored as salted PBKDF2 hashes.' }), h('button', { class: 'btn accent', onClick: () => editUser(ctx, null) }, '+ New user')));
    wrap.append(h('div', { class: 'card' }, h('h3', { text: 'Role permissions' }), h('div', { style: { overflowX: 'auto' } }, h('table', { class: 'data', style: { width: '100%' } }, h('thead', {}, h('tr', {}, ['Role', 'Trips', 'Selling price & invoices', 'Payments', 'Price list', 'Users & settings', 'Reports & variance'].map((x) => h('th', { text: x })))), h('tbody', {}, E.ROLES.map((r) => h('tr', {}, h('td', {}, h('strong', { text: E.ROLE_LABELS[r] })), h('td', { text: E.can(r, 'trip.create') ? 'Create & edit dispatch/delivery details' : E.can(r, 'trip.edit') ? 'Edit own fields only' : 'View' }), h('td', { text: E.canEditField(r, 'sellingPrice') ? 'Enter selling price, prepare invoices, invoice status' : 'View' }), h('td', { text: E.can(r, 'payment.manage') ? 'Record payments, statements' : 'View' }), h('td', { text: E.can(r, 'rate.manage') ? 'Manage' : 'View' }), h('td', { text: E.can(r, 'user.manage') ? 'Manage' : '—' }), h('td', { text: E.can(r, 'variance.review') ? 'Dashboards, reports, variance review' : 'Reports' }))))))));
    wrap.append(h('div', { class: 'table-frame short' }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Username', 'Name', 'Role', 'Status', 'Created', ''].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((u) => h('tr', {}, h('td', { text: u.username }), h('td', { text: u.name }), h('td', { text: E.ROLE_LABELS[u.role] || u.role }), h('td', {}, U.pill(u.active === false ? 'Disabled' : 'Active', u.active === false ? 'neutral' : 'good')), h('td', { text: U.date(u.createdAt) }), h('td', {}, h('span', { class: 'row' }, h('button', { class: 'btn sm', onClick: () => editUser(ctx, u.id) }, 'Edit'), h('button', { class: 'btn sm', onClick: () => resetPassword(ctx, u) }, 'Reset password')))))))));
  });
  function editUser(ctx, id) {
    const { store } = ctx; const u = id ? store.state.users.find((x) => x.id === id) : null;
    const inp = { username: h('input', { type: 'text', value: u ? u.username : '', disabled: !!u, autocomplete: 'off' }), name: h('input', { type: 'text', value: u ? u.name : '' }), role: U.select(E.ROLES.map((r) => [r, E.ROLE_LABELS[r]]), u ? u.role : 'operations'), active: U.select([['true', 'Active'], ['false', 'Disabled']], String(!u || u.active !== false)), password: h('input', { type: 'password', autocomplete: 'new-password', placeholder: u ? '(unchanged)' : 'At least 8 characters' }) };
    const m = U.modal({ title: u ? 'Edit user' : 'New user', body: h('div', { class: 'form-grid' }, U.field('Username', inp.username), U.field('Full name', inp.name), U.field('Role', inp.role), U.field('Status', inp.active), u ? null : U.field('Password', inp.password, { span2: true })) });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Cancel'), h('button', { class: 'btn primary', onClick: async () => {
      const username = E.clean(inp.username.value).toLowerCase(), name = E.clean(inp.name.value);
      if (!username || !name) return U.toast('Username and name are required.', 'bad');
      if (!u && store.state.users.some((x) => x.username === username)) return U.toast('Username already taken.', 'bad');
      if (!u && inp.password.value.length < 8) return U.toast('Password must be at least 8 characters.', 'bad');
      if (u && u.username === store.user.username && inp.active.value === 'false') return U.toast('You cannot disable your own account.', 'bad');
      try {
        if (u) await store.saveDoc('users', { id: u.id, name, role: inp.role.value, active: inp.active.value === 'true' }, { expectedVersion: u.version, label: username });
        else { const nu = await store.makeUser({ username, name, role: inp.role.value, password: inp.password.value }); await store.saveDoc('users', nu, { label: username }); }
        m.close(); HB.views.users.draw(); U.toast('User saved.', 'good');
      } catch (e) { U.toast(e.message, 'bad'); }
    } }, 'Save')]);
  }
  async function resetPassword(ctx, u) {
    const { store } = ctx; const pw = await U.prompt({ title: `Reset password for ${u.username}`, label: 'New password (at least 8 characters)', type: 'password' }); if (pw === null) return; if (pw.length < 8) return U.toast('Password must be at least 8 characters.', 'bad');
    try { if (store.changePassword) await store.changePassword(u.username, pw); else { const salt = U.randomSalt(); const hash = await U.hashPassword(pw, salt); await store.saveDoc('users', { id: u.id, salt, hash }, { expectedVersion: u.version, label: `${u.username} password reset` }); } U.toast('Password updated.', 'good'); } catch (e) { U.toast(e.message, 'bad'); }
  }

  // ---------------------------------------------------------------- settings
  HB.views.settings = simple('Settings', (wrap, ctx) => {
    const { store } = ctx; const s = store.state.settings; const manage = ctx.can('settings.manage');
    const inp = { company: h('input', { type: 'text', value: s.company || '' }), vatRate: h('input', { type: 'number', step: '0.001', min: '0', max: '1', value: s.vatRate }), paymentTermsDays: h('input', { type: 'number', min: '0', value: s.paymentTermsDays }), bankName: h('input', { type: 'text', value: s.bankName || '' }), accountName: h('input', { type: 'text', value: s.accountName || '' }), accountNumber: h('input', { type: 'text', value: s.accountNumber || '' }), invoiceNote: h('input', { type: 'text', value: s.invoiceNote || '' }) };
    if (!manage) for (const i of Object.values(inp)) i.disabled = true;
    wrap.append(h('div', { class: 'card stack' }, h('h3', { text: 'Invoice settings & reference data (Settings sheet)' }),
      h('div', { class: 'form-grid' }, U.field('Company name', inp.company), U.field('VAT rate (0.075 = 7.5%)', inp.vatRate, { help: 'Applied as ROUND(Selling Price × rate, 2) on every trip.' }), U.field('Payment terms (days)', inp.paymentTermsDays), U.field('Bank name', inp.bankName), U.field('Account name', inp.accountName), U.field('Account number', inp.accountNumber), U.field('Invoice footer note', inp.invoiceNote, { span2: true })),
      manage ? h('div', { class: 'row' }, h('button', { class: 'btn primary', onClick: async () => { const d = { company: E.clean(inp.company.value), vatRate: E.num(inp.vatRate.value), paymentTermsDays: E.num(inp.paymentTermsDays.value), bankName: E.clean(inp.bankName.value), accountName: E.clean(inp.accountName.value), accountNumber: E.clean(inp.accountNumber.value), invoiceNote: E.clean(inp.invoiceNote.value) }; if (!(d.vatRate >= 0 && d.vatRate < 1)) return U.toast('VAT rate must be between 0 and 1.', 'bad'); try { await store.saveSettings(d); U.toast('Settings saved. VAT and billing columns recalculated.', 'good'); } catch (e) { U.toast(e.message, 'bad'); } } }, 'Save settings')) : h('p', { class: 'muted small', text: 'Only administrators can change settings.' })));
    const locs = store.locationNames();
    wrap.append(h('div', { class: 'card stack' }, h('div', { class: 'card-head' }, h('h3', { text: `Locations (${locs.length})` }), manage ? h('button', { class: 'btn sm', onClick: async () => { const n = await U.prompt({ title: 'Add location', label: 'Location name' }); if (n && E.clean(n)) { await store.saveLocations([...new Set([...store.state.locations, E.clean(n)])]); HB.views.settings.draw(); } } }, '+ Add location') : null), h('p', { class: 'muted small', text: 'Loading origins and destinations offered in the Trip Log dropdowns. Every location already used on a trip is included automatically.' }), h('div', { class: 'row', style: { maxHeight: '160px', overflow: 'auto' } }, locs.map((l) => h('span', { class: 'chip', text: l })))));
    wrap.append(h('div', { class: 'card stack' }, h('h3', { text: 'Data source' }), h('p', { class: 'small', text: store.mode === 'shared' ? 'Connected to the shared claude.ai database: every change is saved centrally and pushed live to other signed-in users.' : store.mode === 'server' ? 'Connected to the application server (SQLite database). Permissions are enforced server-side; other users\' changes are polled every few seconds.' : 'Running in local demo mode: data lives in this browser only and is not shared.' }),
      h('p', { class: 'small muted', text: `Imported workbook: Haulage Billing Sheet September R2 (${U.int([...store.state.trips.values()].filter((t) => t.source === 'workbook').length)} historical trips, selling prices untouched). The original file is kept in data/workbook/ as a backup.` }),
      store.mode === 'local' && manage ? h('div', { class: 'row' }, h('button', { class: 'btn danger', onClick: async () => { if (await U.confirm({ title: 'Reset local data', message: 'Delete the local copy and reload the workbook data? Only affects this browser.', okLabel: 'Reset', danger: true })) { await store.resetAll(); location.reload(); } } }, 'Reset to workbook data')) : null));
  });

  // ---------------------------------------------------------------- audit
  HB.views.audit = simple('Audit Trail', (wrap, ctx) => {
    const { store } = ctx; if (!ctx.can('audit.view')) { wrap.append(h('div', { class: 'notice bad', text: 'Only administrators and management can view the audit trail.' })); return; }
    const search = h('input', { type: 'search', placeholder: 'Filter by user, record or field…' });
    const frame = h('div', { class: 'table-frame' }, h('div', { class: 'empty', text: 'Loading…' }));
    wrap.append(h('div', { class: 'toolbar' }, search, h('p', { class: 'muted small', text: 'Who changed what, when: previous value → new value. Each trip also keeps its own change history (open the trip).' })), frame);
    let all = [];
    const draw = () => { const q = E.norm(search.value); const rows = all.filter((a) => !q || E.norm(`${a.userName} ${a.user} ${a.entity} ${a.label} ${a.action} ${(a.changes || []).map((c) => c.field).join(' ')}`).includes(q)); U.clear(frame);
      frame.append(rows.length ? h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['When', 'User', 'Role', 'Action', 'Record', 'Changes'].map((x) => h('th', { text: x })))), h('tbody', {}, rows.map((a) => h('tr', {}, h('td', { text: U.dateTime(a.ts) }), h('td', { text: a.userName || a.user }), h('td', { text: E.ROLE_LABELS[a.role] || a.role || '' }), h('td', {}, U.pill(a.action, a.action === 'delete' ? 'bad' : a.action === 'create' || a.action === 'import' ? 'good' : 'info')), h('td', { text: `${a.entity} · ${a.label || a.entityId}` }), h('td', { style: { whiteSpace: 'normal', maxWidth: '520px' } }, (a.changes || []).slice(0, 10).map((c) => h('div', { class: 'diff' }, `${c.field}: `, h('span', { class: 'from' }, String(c.from ?? '')), h('span', { class: 'to' }, typeof c.to === 'object' ? JSON.stringify(c.to) : String(c.to ?? ''))))))))) : h('div', { class: 'empty', text: 'No audit entries yet.' })); };
    store.fetchAudit(500).then((rows) => { all = rows; draw(); }).catch((e) => { U.clear(frame); frame.append(h('div', { class: 'notice bad', text: e.message })); });
    search.addEventListener('input', U.debounce(draw, 150));
  });
})();
