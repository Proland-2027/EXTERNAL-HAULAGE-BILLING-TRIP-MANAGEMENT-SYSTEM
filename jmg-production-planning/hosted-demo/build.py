import re
src = open('/home/user/EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM/jmg-production-planning/assets/app.js').read()
s = src
def rep(old, new):
    global s
    if old not in s: raise SystemExit('MISSING: ' + old[:90])
    s = s.replace(old, new, 1)
def rep_block(start_marker, end_marker, new):
    global s
    a = s.index(start_marker); b = s.index(end_marker, a) + len(end_marker)
    s = s[:a] + new + s[b:]

rep_block('  const api = {', '\n  };\n', """  const api = {
    async req(method, path, body) { return window.JMG_SERVER.handle(method, path, body); },
    get(path, params) { const q = params ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString() : ''; return this.req('GET', path + q); },
    post(path, body) { return this.req('POST', path, body); },
    put(path, body) { return this.req('PUT', path, body); },
    del(path) { return this.req('DELETE', path); },
  };
""")
rep("  function confirmDlg(msg) { return window.confirm(msg); }", """  function confirmDlg(msg) {
    return new Promise((resolve) => {
      const m = modal(`<h3 style="margin-bottom:10px">${esc(msg)}</h3><div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dlgOk">Yes, continue</button></div>`);
      m.el.querySelector('#dlgOk').addEventListener('click', () => { m.close(); resolve(true); });
      m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
    });
  }
  function promptDlg(msg, value) {
    return new Promise((resolve) => {
      const m = modal(`<h3 style="margin-bottom:10px">${esc(msg)}</h3><input type="text" id="dlgIn" value="${esc(value || '')}"><div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px"><button class="btn" data-close>Cancel</button><button class="btn primary" id="dlgOk">OK</button></div>`);
      const inp = m.el.querySelector('#dlgIn'); inp.focus();
      m.el.querySelector('#dlgOk').addEventListener('click', () => { const v = inp.value; m.close(); resolve(v); });
      m.el.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(null)));
    });
  }""")
s = re.sub(r"if \(!confirmDlg\((.*?)\)\) \{ return; \}", r"if (!(await confirmDlg(\1))) { return; }", s)
assert 'window.confirm' not in s
rep("const r = prompt('Reason for cancelling ' + o.order_no + ':');", "const r = await promptDlg('Reason for cancelling ' + o.order_no + ':');")
rep("const code = prompt('Type / code for the new row (e.g. P600, SFP-BT-P1100):'); if (!code) { return; } const prod = prompt('Productivity per shift:');", "const code = await promptDlg('Type / code for the new row (e.g. P600, SFP-BT-P1100):'); if (!code) { return; } const prod = await promptDlg('Productivity per shift:');")
rep("const pw = prompt('New password (leave blank to keep):'); if (pw) { d.password = pw; }", "")
rep("alert('User created. Password: ' + r.password);", "toast('Role assigned');")
assert 'prompt(' not in s.replace('promptDlg(', '') and ' alert(' not in s

rep("""  function route() {
    const h = location.hash.replace(/^#\\/?/, '') || 'dashboard';""", """  function go(h) { state.hash = String(h).replace(/^#\\/?/, ''); route(); window.scrollTo(0, 0); }
  window.jmgGo = go;
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#/"]'); if (a) { e.preventDefault(); go(a.getAttribute('href')); return; }
    const g = e.target.closest('[data-go]'); if (g) { go(g.dataset.go); }
  });
  function route() {
    const h = state.hash || 'dashboard';""")
s = re.sub(r"location\.hash = '#/([^']*)' \+ new URLSearchParams\(([^;]*?)\)\.toString\(\);", r"go('\1' + new URLSearchParams(\2).toString());", s)
s = re.sub(r"location\.hash = `#/([^`]*)`;", r"go(`\1`);", s)
s = re.sub(r"location\.hash = '#/([^']*)' \+ ([^;]+);", r"go('\1' + \2);", s)
s = re.sub(r"location\.hash = '#/([^']*)';", r"go('\1');", s)
s = s.replace('onclick="location.hash=\'#/orders/${o.id}\'"', 'data-go="orders/${o.id}"')
assert 'location.hash' not in s, [l for l in s.split('\n') if 'location.hash' in l][:3]
rep("  window.addEventListener('hashchange', route);\n", "")

rep_block('  function downloadCSV(rows, name) {', '\n  }\n', """  function downloadCSV(rows, name) {
    const csv = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\\n');
    window.jmgDownload(name + '.csv', '\\ufeff' + csv, 'text/csv');
  }
""")
rep("    XLSX.writeFile(wb, name + '.xlsx');", """    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    window.jmgDownload(name + '.xlsx', out, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');""")
rep_block("      body.querySelector('#bk').addEventListener('click', async () => {", "a.click(); });", "      body.querySelector('#bk').addEventListener('click', async () => { const d = await api.get('admin/backup'); window.jmgDownload('jmg-production-planning-backup-' + todayStr() + '.json', JSON.stringify(d), 'application/json'); });")
rep_block("      body.querySelector('#rsf').addEventListener('submit', async (e) => {", "toast(err.message, true); } });", """      body.querySelector('#rsf').addEventListener('submit', async (e) => { e.preventDefault(); if (!(await confirmDlg('Replace ALL planning data with this backup?'))) { return; } try { const file = e.target.querySelector('input[type=file]').files[0]; const text = await file.text(); const r = await api.post('admin/restore', JSON.parse(text)); body.querySelector('#rres').textContent = JSON.stringify(r, null, 2); toast('Restored'); await boot(false); route(); } catch (err) { toast(err.message, true); } });""")
rep("""        <button class="btn" onclick="window.print()">Print</button></div>""", """</div>""")
rep("""<button type="button" class="btn" onclick="window.print()">Export to PDF (print)</button>""", """<span class="small muted">PDF export is available in the WordPress installation (print view)</span>""")
assert 'window.print' not in s

rep("""<div class="user"><b>${esc(b.user.name)}</b>${esc(b.user.role_label || b.user.roles.join(', '))}<br><a href="${esc(b.logout_url)}">Log out</a>${can('jmg_admin') ? ` · <a href="${esc(b.admin_url)}">WP admin</a>` : ''}</div>""",
    """<div class="user"><b>${esc(b.user.name)}</b>${b.user.role_assigned ? esc(b.user.role_label) : `<label class="small" style="display:block;margin-top:4px">Acting as<select id="roleSel" style="margin-top:3px">${sel(Object.entries(b.roles).map(([k, v]) => ({ v: k, l: v.name.replace('JMG ', '') })), b.user.roles[0])}</select></label>`}${b.user.local_store ? '<div class="small" style="margin-top:6px;color:#ffd98a">Private preview: data stays in this browser only.</div>' : ''}${b.user.can_write === false ? '<div class="small" style="margin-top:6px;color:#ffd98a">View-only access: ask the owner for Contributor access to save changes.</div>' : ''}</div>""")
rep("""    document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('side').classList.toggle('open'));""",
    """    document.getElementById('menuToggle').addEventListener('click', () => document.getElementById('side').classList.toggle('open'));
    const rs = document.getElementById('roleSel'); if (rs) { rs.addEventListener('change', async () => { try { await api.post('role', { role: rs.value }); await boot(false); route(); } catch (e) { toast(e.message, true); } }); }""")
rep("""      body.innerHTML = `<div class="card"><h3>Import / update the production workbook</h3>""", """      body.innerHTML = `<div class="card"><h3>Production workbook</h3><p class="small">This hosted demo runs on the master data imported from <code>Prodction Data.xlsx</code>${imp ? ' (' + esc(imp.file_name) + ', imported ' + esc(imp.created_at) + ')' : ''}. Uploading a new workbook is done in the WordPress installation (Administration → Excel import), which rebuilds products, BOM, sections and capacities from the file.</p></div><div class="card" hidden><h3>Import / update the production workbook</h3>""")
rep_block("""      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Invite a team member</h3>""", """are taken straight to this application.</p></div>""",
    """      body.innerHTML = `<div class="grid g2"><div class="card"><h3>Assign a fixed role to a viewer</h3><p class="small">Team members open the shared link with their claude.ai account (share it with Contributor or Editor access so they can save). Until a role is assigned here they choose their role themselves with the "Acting as" selector. Your own viewer id: <code>${esc(u.me.id || 'not signed in')}</code>.</p><form class="form" id="uf"><label class="f"><span>Viewer id</span><input name="user_id" required placeholder="u_..."></label><label class="f"><span>Display name</span><input name="name"></label><label class="f"><span>Role</span><select name="role">${sel(roleOpts, 'jmg_sales')}</select></label><label class="f full"><span>Sections (supervisors; none = all)</span><select name="sections" multiple size="6">${sel(secOpts, '')}</select></label><div class="full"><button class="btn primary">Assign role</button></div></form></div>""")
rep("""Creates the demo accounts (sales.demo / planner.demo / supervisor.demo / manager.demo / costing.demo) and the scenario from the brief""", """Creates the scenario from the brief""")
rep("  boot().then(route).catch((e) => {", "  window.jmgStart = () => boot().then(route).catch((e) => {")
open('app.js', 'w').write(s)
print('app.js built', len(s))
