/* Production Planning - core: API client, router, layout, shared widgets */
(function () {
	'use strict';
	const PP = window.PP = { views: {}, boot: null, state: {} };
	const B = window.PP_BOOT;

	/* ---------- API ---------- */
	PP.api = async function (path, opts = {}) {
		const url = B.rest + path.replace(/^\//, '');
		const init = { method: opts.method || 'GET', headers: { 'X-WP-Nonce': B.nonce }, credentials: 'same-origin' };
		if (opts.body instanceof FormData) { init.body = opts.body; }
		else if (opts.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
		const res = await fetch(url, init);
		if (opts.blob) {
			if (!res.ok) { throw new Error('Export failed (' + res.status + ')'); }
			return res.blob();
		}
		let data = null;
		try { data = await res.json(); } catch (e) { data = null; }
		if (!res.ok) {
			const msg = data && data.message ? data.message : 'Request failed (' + res.status + ')';
			if (res.status === 401 || res.status === 403) { PP.toast(msg + ' - please sign in again.', 'bad'); }
			throw new Error(msg);
		}
		return data;
	};
	PP.get = (p, params) => PP.api(p + (params ? PP.qs(params) : ''));
	PP.post = (p, body) => PP.api(p, { method: 'POST', body: body || {} });
	PP.del = (p) => PP.api(p, { method: 'DELETE' });
	PP.qs = function (params) {
		const u = new URLSearchParams();
		Object.keys(params || {}).forEach(k => { if (params[k] !== undefined && params[k] !== null && params[k] !== '') { u.append(k, params[k]); } });
		const s = u.toString();
		return s ? '?' + s : '';
	};
	PP.download = async function (what, params) {
		try {
			PP.toast('Preparing Excel export…');
			const blob = await PP.api('export/' + what + PP.qs(params), { blob: true });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = what + '.xlsx';
			document.body.appendChild(a); a.click(); a.remove();
		} catch (e) { PP.toast(e.message, 'bad'); }
	};

	/* ---------- helpers ---------- */
	PP.esc = s => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
	PP.n = (v, d = 0) => { if (v === null || v === undefined || v === '' || isNaN(v)) { return '–'; } return Number(v).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }); };
	PP.q = v => { const x = Number(v); if (isNaN(x)) { return '–'; } return Number.isInteger(x) ? x.toLocaleString() : x.toLocaleString(undefined, { maximumFractionDigits: 2 }); };
	PP.money = v => { if (v === null || v === undefined || v === '' || isNaN(v)) { return '–'; } const s = (PP.boot && PP.boot.settings.currency_symbol) || ''; return s + Number(v).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
	PP.pct = v => (v === null || v === undefined || v === '' || isNaN(v)) ? '–' : Number(v).toFixed(1) + '%';
	PP.d = v => { if (!v) { return '–'; } return String(v).slice(0, 10); };
	PP.dt = v => { if (!v) { return '–'; } return String(v).slice(0, 16).replace('T', ' '); };
	PP.badge = (s, extra) => '<span class="badge ' + PP.esc(String(s || '').replace(/\s+/g, '.')) + ' ' + (extra || '') + '">' + PP.esc(s || '–') + '</span>';
	PP.bar = (pct, cls) => { const p = Math.max(0, Math.min(100, Number(pct) || 0)); return '<div class="bar" title="' + p.toFixed(0) + '%"><i class="' + (cls || '') + '" style="width:' + p + '%"></i></div>'; };
	PP.today = () => (PP.boot && PP.boot.today) || new Date().toISOString().slice(0, 10);
	PP.monthLabel = m => { if (!m) { return ''; } const d = new Date(m + '-01T00:00:00'); return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); };
	PP.deptName = code => { const d = (PP.boot.departments || []).find(x => x.code === code); return d ? d.name : code; };
	PP.can = cap => !!(PP.boot && PP.boot.user.caps[cap]);
	PP.el = (sel, root) => (root || document).querySelector(sel);
	PP.els = (sel, root) => Array.from((root || document).querySelectorAll(sel));
	PP.h = (tag, attrs, html) => { const e = document.createElement(tag); Object.keys(attrs || {}).forEach(k => e.setAttribute(k, attrs[k])); if (html !== undefined) { e.innerHTML = html; } return e; };
	PP.formData = form => { const o = {}; new FormData(form).forEach((v, k) => { if (k.endsWith('[]')) { (o[k.slice(0, -2)] = o[k.slice(0, -2)] || []).push(v); } else { o[k] = v; } }); PP.els('input[type=checkbox]', form).forEach(c => { if (!c.name.endsWith('[]')) { o[c.name] = c.checked ? 1 : 0; } }); return o; };
	PP.opt = (list, val, label, selected, blank) => (blank !== undefined ? '<option value="">' + PP.esc(blank) + '</option>' : '') + list.map(x => { const v = typeof val === 'function' ? val(x) : (val ? x[val] : x); const l = typeof label === 'function' ? label(x) : (label ? x[label] : x); return '<option value="' + PP.esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + PP.esc(l) + '</option>'; }).join('');
	PP.deptOptions = (selected, blank) => PP.opt(PP.boot.departments, 'code', d => d.name + ' (' + d.code + ')', selected, blank);
	PP.productOptions = (selected, blank, onlyFinished) => PP.opt(PP.boot.products.filter(p => !onlyFinished || Number(p.is_finished) === 1 || Number(p.sellable) === 1), 'code', p => p.code + ' – ' + p.description, selected, blank);
	PP.achievementCls = p => (p === null || p === undefined) ? '' : (p >= 95 ? 'ok' : (p >= 80 ? 'warn' : 'bad'));

	/* ---------- table ---------- */
	PP.table = function (cols, rows, opts = {}) {
		if (!rows || !rows.length) { return '<div class="empty">' + PP.esc(opts.empty || 'No data') + '</div>'; }
		let h = '<div class="tbl-wrap"><table class="tbl ' + (opts.cls || '') + '"><thead><tr>' + cols.map(c => '<th class="' + (c.num ? 'num' : '') + '">' + PP.esc(c.l) + '</th>').join('') + '</tr></thead><tbody>';
		rows.forEach((r, i) => {
			const attrs = opts.rowAttrs ? opts.rowAttrs(r, i) : '';
			h += '<tr ' + attrs + ' class="' + (opts.rowClass ? opts.rowClass(r) : '') + (opts.onRow ? ' clickable' : '') + '">' + cols.map(c => '<td class="' + (c.num ? 'num ' : '') + (c.wrap ? 'wrap ' : '') + '">' + (c.f ? c.f(r, i) : PP.esc(r[c.k])) + '</td>').join('') + '</tr>';
		});
		if (opts.total) { h += '<tr class="total">' + cols.map(c => '<td class="' + (c.num ? 'num' : '') + '">' + (opts.total[c.k] !== undefined ? opts.total[c.k] : '') + '</td>').join('') + '</tr>'; }
		return h + '</tbody></table></div>';
	};
	PP.bindRows = (root, handler) => PP.els('tr.clickable', root).forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('button,a,input,select')) { return; } handler(tr.dataset, tr); }));

	/* ---------- toast & modal ---------- */
	PP.toast = function (msg, cls) {
		let w = PP.el('.toast-wrap'); if (!w) { w = PP.h('div', { class: 'toast-wrap' }); document.body.appendChild(w); }
		const t = PP.h('div', { class: 'toast ' + (cls || '') }, PP.esc(msg)); w.appendChild(t);
		setTimeout(() => t.remove(), cls === 'bad' ? 7000 : 3500);
	};
	PP.modal = function (title, body, opts = {}) {
		PP.closeModal();
		const bg = PP.h('div', { class: 'modal-bg' });
		bg.innerHTML = '<div class="modal ' + (opts.wide ? 'wide' : '') + '"><div class="m-head"><h2>' + PP.esc(title) + '</h2><button class="x-btn" data-close>×</button></div><div class="m-body">' + body + '</div>' + (opts.footer !== false ? '<div class="m-foot">' + (opts.footer || '<button class="btn" data-close>Close</button>') + '</div>' : '') + '</div>';
		document.body.appendChild(bg);
		bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) { PP.closeModal(); } });
		if (opts.onOpen) { opts.onOpen(bg); }
		return bg;
	};
	PP.closeModal = () => PP.els('.modal-bg').forEach(m => m.remove());
	PP.confirm = (msg, title) => new Promise(resolve => {
		PP.modal(title || 'Please confirm', '<p>' + PP.esc(msg) + '</p>', { footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="pp-confirm-ok">Confirm</button>', onOpen: bg => { bg.querySelector('#pp-confirm-ok').onclick = () => { PP.closeModal(); resolve(true); }; bg.addEventListener('click', e => { if (e.target === bg || e.target.closest('[data-close]')) { resolve(false); } }); } });
	});
	PP.busy = function (btn, on) { if (!btn) { return; } btn.disabled = !!on; if (on) { btn.dataset.txt = btn.innerHTML; btn.innerHTML = 'Working…'; } else if (btn.dataset.txt) { btn.innerHTML = btn.dataset.txt; } };

	/* ---------- simple SVG charts ---------- */
	PP.barChart = function (items, opts = {}) {
		// items: [{label, values:[..], colors?}] ; grouped vertical bars
		const W = opts.width || 640, H = opts.height || 220, padL = 44, padB = 44, padT = 14, padR = 8;
		const series = opts.series || ['Value'];
		const colors = opts.colors || ['#1d4ed8', '#15803d', '#b45309', '#0e7490'];
		const max = Math.max(1, ...items.flatMap(i => i.values));
		const iw = (W - padL - padR) / Math.max(1, items.length), bw = Math.max(4, (iw - 10) / series.length);
		let s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' + PP.esc(opts.title || 'Chart') + '"><g>';
		for (let t = 0; t <= 4; t++) { const y = padT + (H - padT - padB) * (1 - t / 4); const v = max * t / 4; s += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y + '" stroke="#e2e8f0"/><text x="' + (padL - 6) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" fill="#64748b">' + PP.q(Math.round(v)) + '</text>'; }
		items.forEach((it, i) => {
			it.values.forEach((v, j) => { const h = (H - padT - padB) * (v / max); const x = padL + i * iw + 5 + j * bw; s += '<rect x="' + x + '" y="' + (H - padB - h) + '" width="' + (bw - 2) + '" height="' + h + '" fill="' + colors[j % colors.length] + '" rx="2"><title>' + PP.esc(it.label + ' – ' + series[j] + ': ' + PP.q(v)) + '</title></rect>'; });
			s += '<text x="' + (padL + i * iw + iw / 2) + '" y="' + (H - padB + 14) + '" text-anchor="middle" font-size="10" fill="#334155">' + PP.esc(String(it.label).slice(0, 14)) + '</text>';
		});
		s += '</g></svg>';
		if (series.length > 1) { s += '<div class="legend">' + series.map((n, j) => '<span><i style="background:' + colors[j] + '"></i>' + PP.esc(n) + '</span>').join('') + '</div>'; }
		return s;
	};
	PP.hbars = function (rows, opts = {}) {
		// rows: [{label, value, max, cls, sub, data}]
		return '<div class="hbar-list">' + rows.map(r => { const pct = r.max ? Math.min(100, r.value / r.max * 100) : Number(r.value); return '<div class="row ' + (r.data ? 'clickable' : '') + '" ' + (r.data ? Object.keys(r.data).map(k => 'data-' + k + '="' + PP.esc(r.data[k]) + '"').join(' ') : '') + '><div class="lbl" title="' + PP.esc(r.label) + '">' + PP.esc(r.label) + '</div>' + PP.bar(pct, r.cls) + '<div class="val">' + PP.esc(r.text !== undefined ? r.text : PP.pct(pct)) + '</div></div>'; }).join('') + '</div>';
	};

	/* ---------- layout & router ---------- */
	const NAV = [
		{ id: 'dashboard', label: 'Dashboard', ic: '▦', cap: 'pp_view' },
		{ id: 'sales', label: 'Sales Demand', ic: '🛒', cap: 'pp_view' },
		{ id: 'planning', label: 'Production Planning', ic: '🗓', cap: 'pp_view' },
		{ id: 'orders', label: 'Production Orders', ic: '📋', cap: 'pp_view' },
		{ id: 'workorders', label: 'Department Work Orders', ic: '🏭', cap: 'pp_view' },
		{ id: 'wip', label: 'Work in Progress', ic: '🔄', cap: 'pp_view' },
		{ id: 'gantt', label: 'Production Gantt Chart', ic: '📊', cap: 'pp_view' },
		{ id: 'daily', label: 'Daily Productivity', ic: '📈', cap: 'pp_view' },
		{ id: 'costing', label: 'BOM Costing', ic: '💰', cap: 'pp_view' },
		{ id: 'reports', label: 'Monthly Reports', ic: '📑', cap: 'pp_view' },
		{ id: 'master', label: 'Master Data & Settings', ic: '⚙', cap: 'pp_view' },
	];
	PP.route = function () {
		const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
		const [path, query] = hash.split('?');
		const parts = path.split('/');
		const params = {}; new URLSearchParams(query || '').forEach((v, k) => { params[k] = v; });
		return { view: parts[0], id: parts[1], sub: parts[2], params };
	};
	PP.go = (path) => { location.hash = '#/' + path; };
	PP.render = async function () {
		const r = PP.route();
		PP.els('.pp-nav a').forEach(a => a.classList.toggle('active', a.dataset.view === r.view));
		PP.el('.pp-nav').classList.remove('open');
		const main = PP.el('.pp-main');
		const view = PP.views[r.view] || PP.views.dashboard;
		main.innerHTML = '<div class="pp-loading">Loading…</div>';
		try { await view(main, r); } catch (e) { console.error(e); main.innerHTML = '<div class="notice bad">' + PP.esc(e.message) + '</div>'; }
		window.scrollTo(0, 0);
	};
	PP.title = (t, sub, actions) => '<div class="pp-page-title"><div><h1>' + PP.esc(t) + '</h1>' + (sub ? '<div class="sub">' + sub + '</div>' : '') + '</div><div class="actions">' + (actions || '') + '</div></div>';

	async function layout() {
		const app = PP.el('#pp-app');
		const u = PP.boot.user;
		app.innerHTML = '<header class="pp-top"><button class="menu-btn" id="pp-menu">☰</button><div class="brand"><span class="logo">▦</span>Production Planning</div><div class="spacer"></div><button class="alerts-btn" id="pp-alerts">Alerts<span class="n" id="pp-alert-count">' + PP.boot.alerts_open + '</span></button><div class="user"><b>' + PP.esc(u.name) + '</b><br>' + PP.esc(u.roles) + ' · <a href="' + PP.esc(PP.boot.logout_url) + '" style="color:#93c5fd">Sign out</a></div></header><div class="pp-body"><nav class="pp-nav">' + NAV.filter(n => PP.can(n.cap)).map(n => '<a href="#/' + n.id + '" data-view="' + n.id + '"><span class="ic">' + n.ic + '</span>' + n.label + '</a>').join('') + '<div class="nav-group">Signed in as</div><div style="padding:0 12px;font-size:12px;color:#64748b">' + PP.esc(u.login) + '<br>' + PP.esc(u.roles) + (u.departments && u.departments.length ? '<br>Sections: ' + PP.esc(u.departments.join(', ')) : '') + '</div></nav><main class="pp-main"></main></div>';
		PP.el('#pp-menu').onclick = () => PP.el('.pp-nav').classList.toggle('open');
		PP.el('#pp-alerts').onclick = showAlerts;
		window.addEventListener('hashchange', () => { PP.closeModal(); PP.render(); });
		await PP.render();
	}
	async function showAlerts() {
		const alerts = await PP.get('alerts');
		PP.modal('Alerts (' + alerts.length + ' open)', alerts.length ? '<div class="alert-list">' + alerts.map(a => '<div class="al">' + PP.badge(a.level) + '<div style="flex:1">' + PP.esc(a.message) + '<div class="small muted">' + PP.esc(a.type) + ' · ' + PP.dt(a.created_at) + (a.audience ? ' · for ' + PP.esc(a.audience) : '') + (a.request_id ? ' · <a href="#/sales/' + a.request_id + '" data-close>' + PP.esc(a.request_no || 'request') + '</a>' : '') + '</div></div><button class="btn sm" data-ack="' + a.id + '">Acknowledge</button></div>').join('') + '</div>' : '<div class="empty">No open alerts.</div>', {
			onOpen: bg => bg.querySelectorAll('[data-ack]').forEach(b => b.onclick = async () => { await PP.post('alerts/' + b.dataset.ack + '/ack'); b.closest('.al').remove(); PP.boot.alerts_open--; PP.el('#pp-alert-count').textContent = Math.max(0, PP.boot.alerts_open); })
		});
	}
	PP.refreshAlertCount = async () => { try { const b = await PP.get('bootstrap'); PP.boot.alerts_open = b.alerts_open; PP.el('#pp-alert-count').textContent = b.alerts_open; } catch (e) { /* ignore */ } };

	document.addEventListener('DOMContentLoaded', async () => {
		try { PP.boot = await PP.get('bootstrap'); await layout(); }
		catch (e) { PP.el('#pp-app').innerHTML = '<div class="notice bad" style="margin:40px">Could not load the application: ' + PP.esc(e.message) + '</div>'; }
	});
})();
