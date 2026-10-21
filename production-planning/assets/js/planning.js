/* Production planning: generate / adjust / confirm */
(function () {
	const PP = window.PP;
	PP.views.planning = async function (main, r) {
		if (r.id) { return planRequest(main, r.id, r.sub); }
		const rows = await PP.get('requests', { open: 1 });
		const f = r.params;
		const list = rows.filter(x => !f.status || x.status === f.status);
		main.innerHTML = PP.title('Production Planning', 'Generate a proposed schedule from the BOM, routing and departmental capacity, adjust it, then confirm it as the baseline.') +
			'<div class="filters"><a class="btn ' + (!f.status ? 'primary' : '') + '" href="#/planning">All open</a><a class="btn ' + (f.status === 'Submitted' ? 'primary' : '') + '" href="#/planning?status=Submitted">Awaiting planning</a><a class="btn ' + (f.status === 'Planned' ? 'primary' : '') + '" href="#/planning?status=Planned">Proposed, not confirmed</a><a class="btn ' + (f.status === 'Confirmed' ? 'primary' : '') + '" href="#/planning?status=Confirmed">Confirmed</a><a class="btn ' + (f.status === 'In Progress' ? 'primary' : '') + '" href="#/planning?status=In Progress">In progress</a></div>' +
			'<div class="card">' + PP.table([{ l: 'Request', f: x => '<b>' + PP.esc(x.request_no) + '</b>' }, { l: 'Customer', k: 'customer' }, { l: 'Product', f: x => '<b>' + PP.esc(x.product_code) + '</b><div class="small muted">' + PP.esc(x.product_description) + '</div>' }, { l: 'Qty', num: true, f: x => PP.q(x.qty) }, { l: 'Delivery', f: x => PP.d(x.delivery_date) }, { l: 'Priority', f: x => PP.badge(x.priority) }, { l: 'Status', f: x => PP.badge(x.status) + (x.is_delayed ? ' ' + PP.badge('Delayed') : '') }, { l: 'Planned completion', f: x => PP.d(x.expected_completion) }, { l: 'Forecast', f: x => PP.d(x.forecast_completion) }, { l: '', f: x => '<a class="btn sm primary" href="#/planning/' + x.id + '">' + (x.status === 'Submitted' ? 'Plan' : 'Open') + '</a>' }], list, { empty: 'Nothing to plan.' }) + '</div>';
	};

	async function planRequest(main, reqId, planId) {
		const r = await PP.get('requests/' + reqId);
		let plan = null;
		const pid = planId || (r.plans.find(p => p.status === 'proposed') || r.plans.find(p => p.status === 'confirmed') || {}).id;
		if (pid) { plan = await PP.get('plans/' + pid); }
		const canPlan = PP.can('pp_plan') && !['Completed', 'Cancelled'].includes(r.status);
		const hasConfirmed = r.plans.some(p => p.status === 'confirmed');
		const params = plan && plan.params ? plan.params : {};
		main.innerHTML = PP.title('Plan ' + r.request_no + ' · ' + r.product_code + ' × ' + PP.q(r.qty), PP.esc(r.product_description) + ' · ' + PP.badge(r.status) + ' · delivery ' + PP.d(r.delivery_date) + ' · priority ' + PP.badge(r.priority), '<a class="btn" href="#/sales/' + r.id + '">Request</a><a class="btn" href="#/planning">← Planning list</a>') +
			'<div class="card"><div class="card-head"><h2>' + (plan ? 'Adjust and regenerate' : 'Generate Production Plan') + '</h2><span class="small muted">BOM explosion → component orders → departmental operations → finite-capacity schedule (8-hour day, existing confirmed load respected)</span></div>' +
			(canPlan ? '<form id="pl-gen" class="form">' +
				'<label class="f">Earliest start date<input type="date" name="start_date" value="' + PP.esc(params.start_date || '') + '"><span class="hint">blank = next working day</span></label>' +
				'<label class="f">Scheduling priority<select name="priority">' + PP.opt([[1, '1 – Urgent'], [2, '2 – High'], [3, '3 – Normal'], [4, '4 – Low']], x => x[0], x => x[1], params.priority || { Urgent: 1, High: 2, Normal: 3, Low: 4 }[r.priority]) + '</select><span class="hint">lower numbers get capacity first</span></label>' +
				'<label class="f">Capacity basis<select name="capacity_basis">' + PP.opt([['productivity', 'Productivity sheets (then routing hours)'], ['routing', 'BOM routing hours only']], x => x[0], x => x[1], params.capacity_basis || PP.boot.settings.capacity_basis || 'productivity') + '</select></label>' +
				'<label class="chk" style="align-self:end"><input type="checkbox" name="use_stock" ' + (params.use_stock ? 'checked' : '') + '> Net available stock (product master)</label>' +
				'<details class="dd full"><summary>Resource & sequence adjustments (' + (Object.keys(params.manpower || {}).length + Object.keys(params.earliest_start || {}).length) + ')</summary><div class="form" style="margin-top:10px">' +
				'<div class="full small muted">Override manpower for a department (0 = use master data) and pin an earliest start date per component. Priority within this request is derived from BOM level (deepest components first); add a sequence offset to push a component later.</div>' +
				PP.boot.departments.map(d => '<label class="f">' + PP.esc(d.name) + ' manpower<input type="number" step="0.5" min="0" name="manpower[' + d.code + ']" value="' + PP.esc((params.manpower || {})[d.code] || '') + '" placeholder="' + PP.esc(d.manpower) + '"></label>').join('') +
				r.bom_preview.nodes.map(n => '<label class="f">' + PP.esc(n.code) + ' earliest start<input type="date" name="earliest_start[' + PP.esc(n.code) + ']" value="' + PP.esc((params.earliest_start || {})[n.code] || '') + '"></label><label class="f">' + PP.esc(n.code) + ' sequence offset<input type="number" min="0" max="9" name="sequence[' + PP.esc(n.code) + ']" value="' + PP.esc((params.sequence || {})[n.code] || '') + '" placeholder="0"></label>').join('') +
				'</div></details>' +
				'<div class="full actions"><button class="btn primary" id="pl-run">' + (plan ? 'Regenerate proposed plan' : 'Generate Production Plan') + '</button>' + (hasConfirmed ? '<span class="small muted">A confirmed plan exists – regenerating creates a new proposed version; confirming it replaces the baseline (only possible before production starts).</span>' : '') + '</div></form>' : '<div class="muted">Only a Production Planner can generate or confirm plans.</div>') + '</div>' +
			'<div id="pl-plan">' + (plan ? renderPlan(plan, r, canPlan) : '<div class="empty">No plan generated yet.</div>') + '</div>';
		const form = PP.el('#pl-gen');
		if (form) {
			form.onsubmit = async e => {
				e.preventDefault(); const btn = PP.el('#pl-run'); PP.busy(btn, true);
				try {
					const fd = PP.formData(form); const body = { start_date: fd.start_date, priority: fd.priority, capacity_basis: fd.capacity_basis, use_stock: fd.use_stock ? 1 : 0, manpower: {}, earliest_start: {}, sequence: {} };
					Object.keys(fd).forEach(k => { const m = k.match(/^(manpower|earliest_start|sequence)\[(.+)\]$/); if (m && fd[k]) { body[m[1]][m[2]] = fd[k]; } });
					const p = await PP.post('requests/' + reqId + '/generate', body);
					PP.toast('Proposed plan ' + p.plan_no + ' v' + p.version + ' generated', 'ok');
					PP.go('planning/' + reqId + '/' + p.id); if (String(pid) === String(p.id)) { planRequest(main, reqId, p.id); }
				} catch (er) { PP.toast(er.message, 'bad'); }
				PP.busy(btn, false);
			};
		}
		bindPlan(main, plan, r, reqId);
	}

	function renderPlan(p, r, canPlan) {
		const s = p.summary || {};
		const cost = s.cost || {};
		const deptName = c => PP.deptName(c);
		const util = (s.utilisation || []).slice(0, 12);
		const ordersById = {}; p.orders.forEach(o => { ordersById[o.id] = o; });
		return '<div class="card"><div class="card-head"><h2>' + PP.esc(p.plan_no) + ' · version ' + p.version + ' ' + PP.badge(p.status) + '</h2><div class="actions">' +
			(canPlan && p.status === 'proposed' ? '<button class="btn ok" id="pl-confirm">✔ Confirm Production Plan</button>' : '') +
			(canPlan && p.status === 'confirmed' ? '<button class="btn" id="pl-refc">Recalculate forecast</button>' : '') +
			'<button class="btn" id="pl-mat">Material requirement list (Excel)</button><a class="btn" href="#/gantt?plan_id=' + p.id + '&plan_status=' + p.status + '">Gantt chart</a></div></div>' +
			(s.warnings && s.warnings.length ? '<div class="notice warn"><b>Review:</b><br>' + s.warnings.map(PP.esc).join('<br>') + '</div>' : '') +
			(s.infeasible ? '<div class="notice bad">The schedule is infeasible within the planning horizon.</div>' : '') +
			'<div class="kpis">' +
			kp('Start', PP.d(s.start_date), 'next working day with capacity') + kp('Earliest feasible completion', PP.d(s.completion_date), s.working_days + ' working days', s.on_time === false ? 'bad' : 'ok') + kp('Requested delivery', PP.d(r.delivery_date), s.on_time === null ? 'no date given' : (s.on_time ? 'on time' : 'LATE – alert Sales'), s.on_time === false ? 'bad' : '') + kp('Bottleneck', s.bottleneck ? s.bottleneck.department : '–', s.bottleneck ? PP.pct(s.bottleneck.utilisation) + ' load over ' + s.bottleneck.days + ' days' : '', 'warn') + kp('Production orders', s.orders, s.work_orders + ' departmental work orders') + kp('Estimated BOM cost', PP.money(cost.total && cost.total.total), (cost.complete ? 'complete pricing' : (cost.missing_prices || []).length + ' material(s) without price'), cost.complete ? '' : 'warn') + kp('Cost per unit', PP.money(cost.unit && cost.unit.total), 'material ' + PP.money(cost.unit && cost.unit.material)) +
			'</div>' +
			'<div class="grid c2"><div><h3>Department load for this plan</h3>' + PP.hbars(util.map(u => ({ label: u.department || deptName(u.department_code), value: u.utilisation || 0, cls: (u.utilisation || 0) >= 90 ? 'bad' : ((u.utilisation || 0) >= 70 ? 'warn' : 'ok'), text: PP.pct(u.utilisation) + ' · ' + PP.q(u.minutes_used) + ' min' }))) + '</div>' +
			'<div><h3>Operations waiting on predecessors</h3>' + ((s.waits || []).length ? PP.table([{ l: 'Operation', f: w => PP.esc(w.key) }, { l: 'Department', f: w => PP.esc(deptName(w.department_code)) }, { l: 'Days waiting', k: 'wait_days', num: true }], s.waits.slice(0, 8), { cls: 'tbl-sm' }) : '<div class="muted small">No waiting.</div>') + '</div></div>' +
			'<h3 style="margin-top:12px">Production orders</h3>' + PP.table([{ l: 'Order', f: o => '<b>' + PP.esc(o.order_no) + '</b>' + (Number(o.is_master) ? ' <span class="badge">master</span>' : '') }, { l: 'Lvl', k: 'level', num: true }, { l: 'Component', f: o => '<b>' + PP.esc(o.product_code) + '</b><div class="small muted">' + PP.esc(o.description) + '</div>' }, { l: 'Parent', f: o => PP.esc(o.parent_codes || '') }, { l: 'Required', num: true, f: o => PP.q(o.required_qty) }, { l: 'Planned', num: true, f: o => PP.q(o.planned_qty) }, { l: 'Start', f: o => PP.d(o.planned_start) }, { l: 'Finish', f: o => PP.d(o.planned_finish) }, { l: 'Forecast', f: o => PP.d(o.forecast_finish) }, { l: 'Status', f: o => PP.badge(o.status) + (Number(o.has_routing) ? '' : ' <span class="badge warn">no routing</span>') }], p.orders, { cls: 'tbl-sm' }) +
			'<h3 style="margin-top:12px">Departmental work orders & daily targets</h3>' + PP.table([{ l: 'WO', f: w => '<b>' + PP.esc(w.wo_no) + '</b>' }, { l: 'Component', k: 'product_code' }, { l: 'Op', k: 'seq', num: true }, { l: 'Department', k: 'department_name' }, { l: 'Qty', num: true, f: w => PP.q(w.planned_qty) }, { l: 'Min/unit', num: true, f: w => PP.n(w.minutes_per_unit, 1) }, { l: 'Total min', num: true, f: w => PP.q(Math.round(w.planned_minutes)) }, { l: 'Capacity basis', wrap: true, f: w => '<span class="small">' + PP.esc(w.capacity_basis) + '</span>' }, { l: 'Start', f: w => PP.d(w.planned_start) }, { l: 'Finish', f: w => PP.d(w.planned_finish) }, { l: 'Daily targets', wrap: true, f: w => '<span class="small mono">' + (p.daily_targets.filter(t => t.wo_id == w.id && (t.kind === 'proposed' || t.kind === 'baseline')).map(t => t.target_date.slice(5) + ':' + PP.q(t.planned_qty)).join(' ') || '–') + '</span>' }], p.work_orders, { cls: 'tbl-sm' }) +
			'<h3 style="margin-top:12px">Material requirements (' + p.materials.length + ')</h3>' + PP.table([{ l: 'Material', f: m => '<b>' + PP.esc(m.material_code) + '</b>' }, { l: 'Description', k: 'description', wrap: true }, { l: 'UoM', k: 'uom' }, { l: 'Qty', num: true, f: m => PP.q(m.qty) }, { l: 'Unit price', num: true, f: m => PP.money(m.unit_price) }, { l: 'Cost', num: true, f: m => PP.money(m.cost) }, { l: 'Price', f: m => m.price_status === 'missing' ? '<span class="badge bad">missing</span>' : '<span class="small muted">' + PP.esc(m.price_status) + '</span>' }], p.materials.slice(0, 60), { cls: 'tbl-sm' }) + (p.materials.length > 60 ? '<div class="small muted">Showing the 60 most expensive materials – export for the full list.</div>' : '') +
			(p.actual_cost ? '<h3 style="margin-top:12px">Planned vs actual (to date)</h3><div class="kv"><div>Planned total cost</div><div>' + PP.money(cost.total && cost.total.total) + '</div><div>Planned labour</div><div>' + PP.money(cost.total && cost.total.labor) + '</div><div>Actual labour (from daily entries)</div><div>' + PP.money(p.actual_cost.labor_cost) + ' (' + PP.q(p.actual_cost.labor_minutes) + ' min, ' + p.actual_cost.entries + ' entries)</div><div>Actual material cost (recorded on orders)</div><div>' + PP.money(p.actual_cost.material_cost) + '</div><div>Downtime</div><div>' + PP.q(p.actual_cost.downtime_minutes) + ' min</div></div>' : '') +
			'</div>';
		function kp(l, v, s2, cls) { return '<div class="kpi ' + (cls || '') + '" style="cursor:default"><div class="l">' + PP.esc(l) + '</div><div class="v" style="font-size:18px">' + v + '</div><div class="s">' + PP.esc(s2 || '') + '</div></div>'; }
	}

	function bindPlan(main, plan, r, reqId) {
		if (!plan) { return; }
		const c = PP.el('#pl-confirm'); if (c) { c.onclick = async () => { if (await PP.confirm('Confirm ' + plan.plan_no + ' v' + plan.version + ' as the production baseline? Production orders and departmental work orders will be released.')) { PP.busy(c, true); try { await PP.post('plans/' + plan.id + '/confirm'); PP.toast('Plan confirmed – orders released', 'ok'); PP.refreshAlertCount(); planRequest(main, reqId, plan.id); } catch (er) { PP.toast(er.message, 'bad'); PP.busy(c, false); } } }; }
		const f = PP.el('#pl-refc'); if (f) { f.onclick = async () => { PP.busy(f, true); try { const x = await PP.post('plans/' + plan.id + '/reforecast'); PP.toast('Forecast completion: ' + x.result.forecast_completion, 'ok'); planRequest(main, reqId, plan.id); } catch (er) { PP.toast(er.message, 'bad'); PP.busy(f, false); } }; }
		const m = PP.el('#pl-mat'); if (m) { m.onclick = () => PP.download('materials', { plan_id: plan.id }); }
	}
})();
