/* Production Gantt chart (SVG) */
(function () {
	const PP = window.PP;
	PP.views.gantt = async function (main, r) {
		const f = Object.assign({}, r.params);
		const data = await PP.get('gantt', f);
		const group = f.group || 'request';
		main.innerHTML = PP.title('Production Gantt Chart', 'Baseline (grey), current forecast (blue, red when delayed) and actual progress (green). Operations flow with daily transfer batches, so successors overlap their predecessors.', '<button class="btn" onclick="window.print()">Print / PDF</button>') +
			'<form class="filters card" id="g-f" style="padding:12px"><label class="f">Request id (sales order)<input name="request_id" value="' + PP.esc(f.request_id || '') + '"></label><label class="f">Finished product / component<input name="product" value="' + PP.esc(f.product || '') + '"></label><label class="f">Department</br><select name="department">' + PP.deptOptions(f.department, 'All') + '</select></label><label class="f">From<input type="date" name="from" value="' + PP.esc(f.from || '') + '"></label><label class="f">To<input type="date" name="to" value="' + PP.esc(f.to || '') + '"></label><label class="f">Group by<select name="group">' + PP.opt([['request', 'Sales order'], ['product', 'Finished product'], ['department', 'Department']], x => x[0], x => x[1], group) + '</select></label><label class="f">Plan status<select name="plan_status">' + PP.opt([['confirmed', 'Confirmed'], ['proposed', 'Proposed']], x => x[0], x => x[1], f.plan_status || 'confirmed') + '</select></label>' + (f.plan_id ? '<input type="hidden" name="plan_id" value="' + PP.esc(f.plan_id) + '">' : '') + '<button class="btn primary">Show</button><a class="btn" href="#/gantt">Reset</a></form>' +
			'<div class="legend"><span><i style="background:#cbd5e1"></i>Baseline</span><span><i style="background:#93c5fd"></i>Forecast</span><span><i style="background:#fca5a5"></i>Forecast (delayed)</span><span><i style="background:#16a34a"></i>Actual progress</span><span><i style="background:#fff;border:1px dashed #b91c1c"></i>Today</span></div>' +
			'<div class="card" style="padding:0"><div class="gantt-wrap"><div class="gantt" id="gantt"></div></div></div>';
		PP.el('#g-f').onsubmit = e => { e.preventDefault(); PP.go('gantt?' + new URLSearchParams(Object.fromEntries(Object.entries(PP.formData(e.target)).filter(([k, v]) => v))).toString()); };
		draw(PP.el('#gantt'), data, group);
	};

	function draw(el, data, group) {
		const tasks = data.tasks;
		if (!tasks.length) { el.innerHTML = '<div class="empty">No work orders match the filter.</div>'; return; }
		const key = t => group === 'product' ? t.finished_product_code : (group === 'department' ? t.department : t.request_no + ' · ' + t.finished_product_code + ' × ' + PP.q(t.qty));
		const groups = {};
		tasks.forEach(t => { (groups[key(t)] = groups[key(t)] || []).push(t); });
		Object.values(groups).forEach(g => g.sort((a, b) => (b.level - a.level) || a.product_code.localeCompare(b.product_code) || (a.seq - b.seq)));
		const ds = [], de = [];
		tasks.forEach(t => { [t.baseline_start, t.forecast_start, t.actual_start].forEach(x => x && ds.push(x)); [t.baseline_finish, t.forecast_finish, t.actual_finish].forEach(x => x && de.push(x)); });
		const today = PP.today();
		let min = ds.length ? ds.sort()[0] : today, max = de.length ? de.sort().slice(-1)[0] : today;
		if (today < min) { min = today; } if (today > max) { max = today; }
		const dmin = new Date(min + 'T00:00:00'), dmax = new Date(max + 'T00:00:00');
		const days = Math.max(7, Math.round((dmax - dmin) / 864e5) + 2);
		const dayW = days > 90 ? 12 : (days > 45 ? 18 : 28), labelW = 320, rowH = 24, headH = 44;
		const W = labelW + days * dayW + 20;
		const rows = [];
		Object.keys(groups).forEach(g => { rows.push({ group: g }); groups[g].forEach(t => rows.push({ t })); });
		const H = headH + rows.length * rowH + 10;
		const x = d => labelW + (Math.round((new Date(d + 'T00:00:00') - dmin) / 864e5)) * dayW;
		let s = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
		// day columns
		for (let i = 0; i < days; i++) {
			const d = new Date(dmin.getTime() + i * 864e5); const dow = d.getDay(); const wk = dow === 0 || dow === 6;
			s += '<rect x="' + (labelW + i * dayW) + '" y="' + headH + '" width="' + dayW + '" height="' + (H - headH) + '" fill="' + (wk ? '#f1f5f9' : '#fff') + '"/>';
			if (dayW >= 18 || d.getDate() === 1 || dow === 1) { s += '<text x="' + (labelW + i * dayW + dayW / 2) + '" y="' + (headH - 8) + '" text-anchor="middle" font-size="9.5">' + d.getDate() + '</text>'; }
			if (d.getDate() === 1 || i === 0) { s += '<text x="' + (labelW + i * dayW + 2) + '" y="14" font-size="11" font-weight="600">' + d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }) + '</text>'; }
		}
		s += '<line x1="' + labelW + '" x2="' + W + '" y1="' + headH + '" y2="' + headH + '" stroke="#cbd5e1"/>';
		const pos = {};
		rows.forEach((row, i) => {
			const y = headH + i * rowH;
			if (row.group) { s += '<rect x="0" y="' + y + '" width="' + W + '" height="' + rowH + '" fill="#eef2ff"/><text x="8" y="' + (y + 16) + '" font-weight="700" font-size="12">' + PP.esc(row.group) + '</text>'; return; }
			const t = row.t; pos[t.id] = y;
			s += '<rect class="rowbg" x="0" y="' + y + '" width="' + W + '" height="' + rowH + '" fill="transparent"/>';
			s += '<a href="#/workorders/' + t.id + '"><text x="' + (10 + Math.min(4, t.level) * 10) + '" y="' + (y + 15) + '" font-size="11"><tspan font-weight="600">' + PP.esc(t.product_code) + '</tspan> · ' + PP.esc(t.department) + ' <tspan fill="#64748b">' + PP.esc(t.wo_no) + '</tspan></text></a>';
			if (t.baseline_start && t.baseline_finish) { s += '<rect class="bar-base" x="' + x(t.baseline_start) + '" y="' + (y + 4) + '" width="' + Math.max(3, x(t.baseline_finish) - x(t.baseline_start) + dayW) + '" height="7" rx="2"><title>Baseline ' + t.baseline_start + ' → ' + t.baseline_finish + '</title></rect>'; }
			const fs = t.actual_start || t.forecast_start, ff = t.actual_finish || t.forecast_finish;
			if (fs && ff) {
				const bx = x(fs), bw = Math.max(3, x(ff) - bx + dayW);
				s += '<rect class="bar-fc ' + (t.delayed ? 'delayed' : '') + '" x="' + bx + '" y="' + (y + 12) + '" width="' + bw + '" height="9" rx="2"><title>' + PP.esc(t.wo_no + ' ' + t.operation + '\nForecast ' + fs + ' → ' + ff + '\nQty ' + PP.q(t.qty) + ' · done ' + PP.q(t.good_qty) + ' (' + t.progress + '%)\nStatus ' + t.status) + '</title></rect>';
				if (t.progress > 0) { s += '<rect class="bar-prog" x="' + bx + '" y="' + (y + 12) + '" width="' + (bw * t.progress / 100) + '" height="9" rx="2"/>'; }
			}
		});
		// dependencies
		data.dependencies.forEach(d => {
			const a = tasks.find(t => t.id == d.depends_on_wo_id), b = tasks.find(t => t.id == d.wo_id);
			if (!a || !b || pos[a.id] === undefined || pos[b.id] === undefined) { return; }
			const af = a.actual_finish || a.forecast_finish, bs = b.actual_start || b.forecast_start; if (!af || !bs) { return; }
			const x1 = x(af) + dayW, y1 = pos[a.id] + 16, x2 = x(bs), y2 = pos[b.id] + 16;
			s += '<path class="dep" d="M' + x1 + ' ' + y1 + ' L' + (x1 + 4) + ' ' + y1 + ' L' + (x1 + 4) + ' ' + y2 + ' L' + x2 + ' ' + y2 + '"/>';
		});
		s += '<line class="today" x1="' + (x(today) + dayW / 2) + '" x2="' + (x(today) + dayW / 2) + '" y1="' + headH + '" y2="' + H + '"/><text x="' + (x(today) + dayW / 2 + 3) + '" y="' + (headH + 12) + '" font-size="10" fill="#b91c1c">today</text>';
		s += '</svg>';
		el.innerHTML = s;
	}
})();
