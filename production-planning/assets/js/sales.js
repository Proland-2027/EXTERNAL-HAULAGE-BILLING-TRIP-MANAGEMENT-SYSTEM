/* Sales demand */
(function () {
	const PP = window.PP;
	PP.views.sales = async function (main, r) {
		if (r.id === 'new') { return newRequest(main); }
		if (r.id) { return detail(main, r.id); }
		const f = r.params;
		const rows = await PP.get('requests', f);
		main.innerHTML = PP.title('Sales Demand', 'Production requests raised by Sales. Only a Production Planner can confirm a schedule.', PP.can('pp_sales') ? '<a class="btn primary" href="#/sales/new">+ New Production Request</a>' : '') +
			'<form class="filters card" id="sr-f" style="padding:12px"><label class="f">Search<input name="q" value="' + PP.esc(f.q || '') + '" placeholder="request, customer, SO ref, product"></label><label class="f">Status<select name="status">' + PP.opt(['Submitted', 'Planned', 'Confirmed', 'In Progress', 'Completed', 'Cancelled'], null, null, f.status, 'All') + '</select></label><label class="f">Product type<select name="product_type">' + PP.opt(['Genset', 'Canopy'], null, null, f.product_type, 'All') + '</select></label><label class="f">Priority<select name="priority">' + PP.opt(['Urgent', 'High', 'Normal', 'Low'], null, null, f.priority, 'All') + '</select></label><button class="btn primary">Filter</button><a class="btn" href="#/sales">Reset</a></form>' +
			'<div class="card">' + PP.table([
				{ l: 'Request', f: x => '<b>' + PP.esc(x.request_no) + '</b>' }, { l: 'Date', f: x => PP.d(x.created_at) }, { l: 'Customer / project', k: 'customer' }, { l: 'SO ref', k: 'sales_order_ref' }, { l: 'Product', f: x => '<b>' + PP.esc(x.product_code) + '</b><div class="small muted">' + PP.esc(x.product_description) + '</div>' }, { l: 'Type', k: 'product_type' }, { l: 'Qty', num: true, f: x => PP.q(x.qty) }, { l: 'Delivery', f: x => PP.d(x.delivery_date) }, { l: 'Priority', f: x => PP.badge(x.priority) }, { l: 'Status', f: x => PP.badge(x.status) + (x.is_delayed ? ' ' + PP.badge('Delayed') : '') }, { l: 'Planned completion', f: x => PP.d(x.expected_completion) }, { l: 'Forecast', f: x => '<span class="' + (x.is_delayed ? 'bad-text b' : '') + '">' + PP.d(x.forecast_completion || x.expected_completion) + '</span>' }, { l: 'Plan', f: x => x.plan_no ? PP.esc(x.plan_no + ' v' + x.plan_version) : (Number(x.proposed_plans) ? '<span class="muted">proposed</span>' : '') }
			], rows, { onRow: true, rowAttrs: x => 'data-id="' + x.id + '"', empty: 'No production requests yet.' }) + '</div>';
		PP.el('#sr-f').onsubmit = e => { e.preventDefault(); PP.go('sales?' + new URLSearchParams(Object.fromEntries(Object.entries(PP.formData(e.target)).filter(([k, v]) => v))).toString()); };
		PP.bindRows(main, d => PP.go('sales/' + d.id));
	};

	async function newRequest(main) {
		main.innerHTML = PP.title('New Production Request', 'Sales request number is generated automatically on submit.') +
			'<div class="two"><div class="card"><form id="sr-new" class="form">' +
			'<label class="f">Sales request number<input readonly value="(automatic)"></label>' +
			'<label class="f">Customer or project<input name="customer" required placeholder="Customer / project name"></label>' +
			'<label class="f">Sales order reference<input name="sales_order_ref" placeholder="SO-…"></label>' +
			'<label class="f full">Finished-product code<select name="product_code" required id="sr-prod">' + PP.productOptions('', 'Select a finished product…', true) + '</select><span class="hint">Codes come from the Finished Product list of the workbook; stacked canopies are listed as Canopy products.</span></label>' +
			'<label class="f full">Product description<input name="product_description" readonly id="sr-desc"></label>' +
			'<label class="f">Product type<input name="product_type" readonly id="sr-type"></label>' +
			'<label class="f">Quantity required<input name="qty" type="number" min="1" step="1" value="1" required id="sr-qty"></label>' +
			'<label class="f">Requested delivery date<input name="delivery_date" type="date"></label>' +
			'<label class="f">Priority<select name="priority">' + PP.opt(['Normal', 'High', 'Urgent', 'Low']) + '</select></label>' +
			'<label class="f full">Remarks<textarea name="remarks" rows="3"></textarea></label>' +
			'<div class="full actions"><button class="btn primary" type="submit">Submit request</button><a class="btn" href="#/sales">Cancel</a></div></form></div>' +
			'<div class="card"><h2>Bill of materials preview</h2><div id="sr-bom" class="muted">Select a product and quantity to see the semi-finished components the system will manufacture.</div></div></div>';
		const prod = PP.el('#sr-prod'), qty = PP.el('#sr-qty');
		const fill = () => { const p = PP.boot.products.find(x => x.code === prod.value); PP.el('#sr-desc').value = p ? p.description : ''; PP.el('#sr-type').value = p ? p.product_type : ''; preview(); };
		async function preview() {
			if (!prod.value) { return; }
			PP.el('#sr-bom').innerHTML = 'Exploding BOM…';
			try {
				const x = await PP.get('bom/' + encodeURIComponent(prod.value) + '/explode', { qty: qty.value || 1 });
				PP.el('#sr-bom').innerHTML = (x.warnings.length ? '<div class="notice warn">' + x.warnings.map(PP.esc).join('<br>') + '</div>' : '') + '<div class="small muted" style="margin-bottom:6px">' + x.nodes.length + ' manufactured items · ' + x.materials.length + ' raw materials</div>' + PP.table([{ l: 'Level', k: 'level', num: true }, { l: 'Component', f: n => '<b>' + PP.esc(n.code) + '</b>' + (n.code === x.product.code ? ' <span class="badge">finished</span>' : '') }, { l: 'Description', k: 'description', wrap: true }, { l: 'Qty', num: true, f: n => PP.q(n.qty) }, { l: 'Operations', f: n => n.operations.length ? n.operations.map(o => PP.esc(o.department_code)).join(' → ') : '<span class="warn-text">no routing</span>' }], x.nodes, { cls: 'tbl-sm' });
			} catch (e) { PP.el('#sr-bom').innerHTML = '<div class="notice bad">' + PP.esc(e.message) + '</div>'; }
		}
		prod.onchange = fill; qty.onchange = preview;
		PP.el('#sr-new').onsubmit = async e => {
			e.preventDefault(); const btn = e.target.querySelector('button[type=submit]'); PP.busy(btn, true);
			try { const r = await PP.post('requests', PP.formData(e.target)); PP.toast('Request ' + r.request_no + ' submitted', 'ok'); PP.go('sales/' + r.id); } catch (er) { PP.toast(er.message, 'bad'); }
			PP.busy(btn, false);
		};
	}

	async function detail(main, id) {
		const r = await PP.get('requests/' + id);
		const confirmed = r.plans.find(p => p.status === 'confirmed');
		const proposed = r.plans.find(p => p.status === 'proposed');
		const editable = r.status === 'Submitted' && PP.can('pp_sales');
		main.innerHTML = PP.title(r.request_no + ' · ' + r.product_code, PP.esc(r.product_description) + ' · ' + PP.badge(r.status) + (r.is_delayed ? ' ' + PP.badge('Delayed') : ''),
			'<a class="btn" href="#/sales">← All requests</a>' + (PP.can('pp_plan') && !['Completed', 'Cancelled'].includes(r.status) ? '<a class="btn primary" href="#/planning/' + r.id + '">' + (confirmed ? 'View / re-plan schedule' : 'Generate Production Plan') + '</a>' : '') + (confirmed ? '<a class="btn" href="#/gantt?request_id=' + r.id + '">Gantt</a><a class="btn" href="#/orders?request_id=' + r.id + '">Orders</a>' : '') + (PP.can('pp_plan') && !['Completed', 'Cancelled'].includes(r.status) ? '<button class="btn danger" id="sr-cancel">Cancel request</button>' : '')) +
			'<div class="grid c2"><div class="card"><h2>Request</h2><form id="sr-edit" class="form">' +
			'<label class="f">Customer / project<input name="customer" value="' + PP.esc(r.customer) + '"' + (PP.can('pp_sales') ? '' : ' readonly') + '></label>' +
			'<label class="f">Sales order reference<input name="sales_order_ref" value="' + PP.esc(r.sales_order_ref || '') + '"' + (PP.can('pp_sales') ? '' : ' readonly') + '></label>' +
			'<label class="f">Product<select name="product_code" ' + (editable ? '' : 'disabled') + '>' + PP.productOptions(r.product_code, null, true) + '</select></label>' +
			'<label class="f">Quantity<input name="qty" type="number" min="1" value="' + PP.esc(r.qty) + '"' + (editable ? '' : ' readonly') + '></label>' +
			'<label class="f">Requested delivery<input name="delivery_date" type="date" value="' + PP.esc(r.delivery_date || '') + '"' + (PP.can('pp_sales') ? '' : ' readonly') + '></label>' +
			'<label class="f">Priority<select name="priority" ' + (PP.can('pp_sales') ? '' : 'disabled') + '>' + PP.opt(['Urgent', 'High', 'Normal', 'Low'], null, null, r.priority) + '</select></label>' +
			'<label class="f full">Remarks<textarea name="remarks" rows="2"' + (PP.can('pp_sales') ? '' : ' readonly') + '>' + PP.esc(r.remarks || '') + '</textarea></label>' +
			(PP.can('pp_sales') ? '<div class="full"><button class="btn primary">Save changes</button></div>' : '') + '</form>' +
			'<div class="kv" style="margin-top:12px"><div>Created</div><div>' + PP.dt(r.created_at) + ' by ' + PP.esc(r.created_by) + '</div><div>Planned completion</div><div>' + PP.d(r.expected_completion) + '</div><div>Forecast completion</div><div class="' + (r.is_delayed ? 'bad-text b' : '') + '">' + PP.d(r.forecast_completion) + '</div><div>Actual completion</div><div>' + PP.d(r.actual_completion) + '</div><div>Confirmed plan</div><div>' + (confirmed ? PP.esc(confirmed.plan_no + ' v' + confirmed.version) + ' · confirmed ' + PP.dt(confirmed.confirmed_at) + ' by ' + PP.esc(confirmed.confirmed_by) : '–') + '</div></div></div>' +
			'<div class="card"><h2>Plan versions</h2>' + PP.table([{ l: 'Plan', k: 'plan_no' }, { l: 'Version', k: 'version', num: true }, { l: 'Status', f: p => PP.badge(p.status) }, { l: 'Start', f: p => PP.d(p.summary && p.summary.start_date) }, { l: 'Completion', f: p => PP.d(p.summary && p.summary.completion_date) }, { l: 'Bottleneck', f: p => PP.esc(p.summary && p.summary.bottleneck ? p.summary.bottleneck.department : '') }, { l: 'Est. cost', num: true, f: p => PP.money(p.summary && p.summary.cost ? p.summary.cost.total.total : null) }, { l: 'By', f: p => PP.esc(p.created_by) + '<div class="small muted">' + PP.dt(p.created_at) + '</div>' }, { l: '', f: p => '<a class="btn sm" href="#/planning/' + r.id + '/' + p.id + '">Open</a>' }], r.plans, { cls: 'tbl-sm', empty: 'No plan generated yet.' }) +
			'<h3 style="margin-top:14px">Components to manufacture (BOM explosion)</h3>' + (r.bom_preview.warnings.length ? '<div class="notice warn">' + r.bom_preview.warnings.map(PP.esc).join('<br>') + '</div>' : '') + PP.table([{ l: 'Lvl', k: 'level', num: true }, { l: 'Component', f: n => '<b>' + PP.esc(n.code) + '</b>' }, { l: 'Description', k: 'description', wrap: true }, { l: 'Type', k: 'product_type' }, { l: 'Qty', num: true, f: n => PP.q(n.qty) }, { l: 'Routing', f: n => n.has_routing ? '<span class="ok-text">yes</span>' : '<span class="warn-text">none</span>' }], r.bom_preview.nodes, { cls: 'tbl-sm' }) + '<div class="small muted">' + r.bom_preview.materials + ' raw materials required.</div></div></div>';
		const form = PP.el('#sr-edit');
		if (form) { form.onsubmit = async e => { e.preventDefault(); try { await PP.post('requests/' + id, PP.formData(form)); PP.toast('Saved', 'ok'); detail(main, id); } catch (er) { PP.toast(er.message, 'bad'); } }; }
		const c = PP.el('#sr-cancel'); if (c) { c.onclick = async () => { if (await PP.confirm('Cancel request ' + r.request_no + '? Open production orders will be cancelled.')) { try { await PP.post('requests/' + id + '/cancel', {}); PP.toast('Request cancelled'); detail(main, id); } catch (er) { PP.toast(er.message, 'bad'); } } }; }
	}
})();
