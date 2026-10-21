/* Dashboard */
(function () {
	const PP = window.PP;
	PP.views.dashboard = async function (main, r) {
		const f = Object.assign({ month: PP.today().slice(0, 7) }, r.params);
		const d = await PP.get('dashboard', f);
		const k = d.kpis, m = d.monthly;
		const link = (q) => '#/orders?' + new URLSearchParams(Object.assign({}, q)).toString();
		main.innerHTML = PP.title('Management Dashboard', 'Live status of demand, planning, work in progress and capacity · ' + PP.esc(PP.monthLabel(d.month)),
			'<button class="btn" id="db-refc" title="Recalculate forecast completion dates for all confirmed plans">Recalculate forecasts</button><button class="btn" onclick="window.print()">Print / PDF</button>') +
			'<form class="filters card" id="db-filters" style="padding:12px">' +
			'<label class="f">Month<input type="month" name="month" value="' + PP.esc(f.month) + '"></label>' +
			'<label class="f">Product type<select name="product_type">' + PP.opt(['Genset', 'Canopy'], null, null, f.product_type, 'All') + '</select></label>' +
			'<label class="f">Department<select name="department">' + PP.deptOptions(f.department, 'All') + '</select></label>' +
			'<label class="f">Finished product<select name="product">' + PP.productOptions(f.product, 'All', true) + '</select></label>' +
			'<label class="f">Status<select name="status">' + PP.opt(['Submitted', 'Planned', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'], null, null, f.status, 'All') + '</select></label>' +
			'<label class="f">Requests from<input type="date" name="from" value="' + PP.esc(f.from || '') + '"></label><label class="f">to<input type="date" name="to" value="' + PP.esc(f.to || '') + '"></label>' +
			'<button class="btn primary">Apply</button> <a class="btn" href="#/dashboard">Reset</a></form>' +
			'<div class="kpis">' +
			kpi('Total production requests', k.total, '', 'sales', '') +
			kpi('Awaiting planning', k.awaiting, 'submitted by Sales', 'planning', k.awaiting ? 'warn' : '') +
			kpi('Planned (not confirmed)', k.planned, 'proposed plans', 'planning?status=Planned', '') +
			kpi('Orders in progress', k.in_progress, 'confirmed / running', 'orders?open=1', 'info') +
			kpi('Completed', k.completed, '', 'sales?status=Completed', 'ok') +
			kpi('Delayed orders', k.delayed, 'forecast after plan or delivery', 'orders?delayed=1', k.delayed ? 'bad' : 'ok') +
			kpi('Monthly planned (finished)', PP.q(m.planned_fp), PP.monthLabel(d.month), 'reports?month=' + d.month, '') +
			kpi('Monthly actual (finished)', PP.q(m.actual_fp), 'achievement ' + PP.pct(m.achievement_fp), 'reports?month=' + d.month, PP.achievementCls(m.achievement_fp)) +
			kpi('Achievement to date (all sections)', PP.pct(m.achievement_all), PP.q(m.actual_all) + ' of ' + PP.q(m.planned_to_date) + ' planned to date', 'daily', PP.achievementCls(m.achievement_all)) +
			kpi('Total work in progress', PP.q(d.wip.total), 'units in sections / waiting transfer', 'wip', 'info') +
			kpi('Estimated BOM cost of active orders', PP.money(d.cost.active_total), d.cost.incomplete_plans ? d.cost.incomplete_plans + ' plan(s) with incomplete pricing' : 'all prices available', 'costing', d.cost.incomplete_plans ? 'warn' : '') +
			kpi('Open alerts', d.alerts.length, 'delays, shortfalls, delivery risk', '', d.alerts.length ? 'warn' : 'ok') +
			'</div>' +
			'<div class="grid c2">' +
			'<div class="card"><div class="card-head"><h2>Monthly planned vs actual</h2><span class="small muted">finished products · ' + PP.esc(PP.monthLabel(d.month)) + '</span></div>' + PP.barChart([{ label: 'Finished products', values: [m.planned_fp, m.actual_fp] }, { label: 'All sections', values: [m.planned_all, m.actual_all] }], { series: ['Planned', 'Actual'], height: 200 }) + '</div>' +
			'<div class="card"><div class="card-head"><h2>Capacity utilisation (next 10 working days)</h2><span class="small muted">committed minutes ÷ available minutes</span></div>' + PP.hbars(d.utilisation.map(u => ({ label: u.department, value: u.utilisation, cls: u.utilisation >= 90 ? 'bad' : (u.utilisation >= 70 ? 'warn' : 'ok'), data: { dept: u.department_code } }))) + '</div>' +
			'<div class="card"><div class="card-head"><h2>Work in progress by department</h2><a class="small" href="#/wip">Open WIP module</a></div>' + PP.table([
				{ l: 'Department', f: x => '<a href="#/wip?department=' + x.department_code + '">' + PP.esc(x.department) + '</a>' }, { l: 'Open WOs', k: 'open_orders', num: true }, { l: 'In process', num: true, f: x => PP.q(x.in_process) }, { l: 'Waiting transfer', num: true, f: x => PP.q(x.waiting_transfer) }, { l: 'Balance', num: true, f: x => PP.q(x.balance) }, { l: 'Delayed', num: true, f: x => x.delayed ? '<span class="bad-text b">' + x.delayed + '</span>' : '0' }
			], d.wip.by_department, { cls: 'tbl-sm', empty: 'No confirmed work orders yet.' }) + '</div>' +
			'<div class="card"><div class="card-head"><h2>Current bottlenecks</h2><span class="small muted">departments at ≥ 80% load</span></div>' + (d.bottlenecks.length ? PP.table([{ l: 'Department', k: 'department' }, { l: 'Site', k: 'site' }, { l: 'Manpower', k: 'manpower', num: true }, { l: 'Committed min', num: true, f: x => PP.q(x.committed_minutes) }, { l: 'Available min', num: true, f: x => PP.q(x.pool_minutes) }, { l: 'Load', num: true, f: x => '<span class="' + (x.utilisation >= 100 ? 'bad-text b' : 'warn-text b') + '">' + PP.pct(x.utilisation) + '</span>' }], d.bottlenecks, { cls: 'tbl-sm' }) : '<div class="empty">No department is loaded above 80% in the next 10 working days.</div>') + '</div>' +
			'</div>' +
			'<div class="grid c2">' +
			'<div class="card"><div class="card-head"><h2>Expected finished-product completion</h2><a class="small" href="#/gantt">Gantt chart</a></div>' + PP.table([
				{ l: 'Request', f: x => '<a href="#/sales/' + x.id + '">' + PP.esc(x.request_no) + '</a>' }, { l: 'Customer', k: 'customer' }, { l: 'Product', k: 'product_code' }, { l: 'Qty', num: true, f: x => PP.q(x.qty) }, { l: 'Status', f: x => PP.badge(x.status) }, { l: 'Delivery', f: x => PP.d(x.delivery_date) }, { l: 'Planned', f: x => PP.d(x.expected) }, { l: 'Forecast', f: x => '<span class="' + (x.delayed ? 'bad-text b' : 'ok-text') + '">' + PP.d(x.forecast) + '</span>' }
			], d.completions, { cls: 'tbl-sm', empty: 'No active orders.' }) + '</div>' +
			'<div class="card"><div class="card-head"><h2>Alerts</h2></div>' + (d.alerts.length ? '<div class="alert-list">' + d.alerts.slice(0, 8).map(a => '<div class="al">' + PP.badge(a.level) + '<div>' + PP.esc(a.message) + '<div class="small muted">' + PP.dt(a.created_at) + '</div></div></div>').join('') + '</div>' : '<div class="empty">No open alerts.</div>') + '</div>' +
			'</div>';
		PP.el('#db-filters').onsubmit = e => { e.preventDefault(); const q = PP.formData(e.target); PP.go('dashboard?' + new URLSearchParams(Object.fromEntries(Object.entries(q).filter(([k, v]) => v))).toString()); };
		PP.els('.kpi[data-go]').forEach(kp => kp.onclick = () => { if (kp.dataset.go) { PP.go(kp.dataset.go); } else { PP.el('#pp-alerts').click(); } });
		PP.els('.hbar-list .row.clickable', main).forEach(row => row.onclick = () => PP.go('workorders?department=' + row.dataset.dept));
		PP.el('#db-refc').onclick = async e => { PP.busy(e.target, true); try { await PP.post('reforecast-all'); PP.toast('Forecasts recalculated', 'ok'); PP.render(); } catch (er) { PP.toast(er.message, 'bad'); } PP.busy(e.target, false); };
		function kpi(l, v, s, go, cls) { return '<div class="kpi ' + cls + '" data-go="' + PP.esc(go) + '"><div class="l">' + PP.esc(l) + '</div><div class="v">' + v + '</div><div class="s">' + PP.esc(s) + '</div></div>'; }
	};
})();
