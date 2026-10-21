/* Daily productivity */
(function () {
	const PP = window.PP;
	PP.views.daily = async function (main, r) {
		const f = r.params;
		const from = f.from || new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10), to = f.to || PP.today();
		const [ach, entries] = await Promise.all([PP.get('daily', { from, to, department: f.department }), PP.get('entries', { from, to, department: f.department })]);
		const totals = ach.reduce((a, x) => { a.planned += x.planned || x.target; a.good += x.good; a.rej += x.rejected; a.rew += x.rework; a.down += x.downtime; return a; }, { planned: 0, good: 0, rej: 0, rew: 0, down: 0 });
		const byDept = {};
		ach.forEach(x => { const b = byDept[x.department_code] = byDept[x.department_code] || { department: x.department, planned: 0, good: 0 }; b.planned += x.planned || x.target; b.good += x.good; });
		const byDate = {};
		ach.forEach(x => { const b = byDate[x.date] = byDate[x.date] || { planned: 0, good: 0 }; b.planned += x.planned || x.target; b.good += x.good; });
		const dates = Object.keys(byDate).sort().slice(-14);
		main.innerHTML = PP.title('Daily Productivity', 'Production Achievement % = Actual good output ÷ Planned output × 100', (PP.can('pp_supervise') ? '<button class="btn primary" id="dp-new">＋ Daily production entry</button>' : '') + '<button class="btn" id="dp-x">Excel</button>') +
			'<form class="filters card" id="dp-f" style="padding:12px"><label class="f">From<input type="date" name="from" value="' + from + '"></label><label class="f">To<input type="date" name="to" value="' + to + '"></label><label class="f">Department<select name="department">' + PP.deptOptions(f.department, 'All') + '</select></label><button class="btn primary">Show</button></form>' +
			'<div class="kpis"><div class="kpi"><div class="l">Planned output</div><div class="v">' + PP.q(totals.planned) + '</div></div><div class="kpi ' + PP.achievementCls(totals.planned ? totals.good / totals.planned * 100 : null) + '"><div class="l">Actual good output</div><div class="v">' + PP.q(totals.good) + '</div><div class="s">achievement ' + PP.pct(totals.planned ? totals.good / totals.planned * 100 : null) + '</div></div><div class="kpi"><div class="l">Rejected / rework</div><div class="v">' + PP.q(totals.rej) + ' / ' + PP.q(totals.rew) + '</div></div><div class="kpi"><div class="l">Downtime</div><div class="v">' + PP.q(totals.down) + '</div><div class="s">minutes</div></div></div>' +
			'<div class="grid c2"><div class="card"><h2>Daily planned vs actual</h2>' + (dates.length ? PP.barChart(dates.map(d => ({ label: d.slice(5), values: [byDate[d].planned, byDate[d].good] })), { series: ['Planned', 'Actual good'], height: 220 }) : '<div class="empty">No production recorded in this range.</div>') + '</div>' +
			'<div class="card"><h2>Achievement by department</h2>' + PP.hbars(Object.keys(byDept).map(k => { const b = byDept[k]; const p = b.planned ? b.good / b.planned * 100 : 0; return { label: b.department, value: Math.min(100, p), cls: PP.achievementCls(p), text: PP.pct(p) + ' (' + PP.q(b.good) + '/' + PP.q(b.planned) + ')', data: { dept: k } }; })) + '</div></div>' +
			'<div class="card"><h2>Daily achievement by department</h2>' + PP.table([{ l: 'Date', k: 'date' }, { l: 'Department', k: 'department' }, { l: 'Schedule target', num: true, f: x => PP.q(x.target) }, { l: 'Planned (entered)', num: true, f: x => PP.q(x.planned) }, { l: 'Good', num: true, f: x => PP.q(x.good) }, { l: 'Rejected', num: true, f: x => PP.q(x.rejected) }, { l: 'Rework', num: true, f: x => PP.q(x.rework) }, { l: 'Downtime', num: true, f: x => PP.q(x.downtime) }, { l: 'Achievement', f: x => '<div class="progress-cell">' + PP.bar(x.achievement, PP.achievementCls(x.achievement)) + '<span class="' + PP.achievementCls(x.achievement) + '-text b">' + PP.pct(x.achievement) + '</span></div>' }], ach, { cls: 'tbl-sm', empty: 'No targets or entries in this range.' }) + '</div>' +
			'<div class="card"><h2>Entries</h2>' + PP.table([{ l: 'Date', k: 'entry_date' }, { l: 'Department', k: 'department_name' }, { l: 'Work order', f: e => '<a href="#/workorders/' + e.wo_id + '">' + PP.esc(e.wo_no) + '</a>' }, { l: 'Component', k: 'product_code' }, { l: 'Planned', num: true, f: e => PP.q(e.planned_qty) }, { l: 'Good', num: true, f: e => PP.q(e.good_qty) }, { l: 'Rejected', num: true, f: e => PP.q(e.rejected_qty) }, { l: 'Rework', num: true, f: e => PP.q(e.rework_qty) }, { l: 'Downtime', num: true, f: e => PP.q(e.downtime_minutes) }, { l: 'Manpower', num: true, f: e => PP.q(e.manpower) }, { l: 'Achievement', f: e => PP.pct(e.achievement) }, { l: 'Delay reason', k: 'delay_reason' }, { l: 'By', k: 'entered_by' }], entries, { cls: 'tbl-sm', empty: 'No entries.' }) + '</div>';
		PP.el('#dp-f').onsubmit = e => { e.preventDefault(); PP.go('daily?' + new URLSearchParams(Object.fromEntries(Object.entries(PP.formData(e.target)).filter(([k, v]) => v))).toString()); };
		PP.el('#dp-x').onclick = () => PP.download('entries', { from, to, department: f.department });
		PP.els('.hbar-list .row.clickable', main).forEach(row => row.onclick = () => PP.go('daily?department=' + row.dataset.dept + '&from=' + from + '&to=' + to));
		const n = PP.el('#dp-new');
		if (n) {
			n.onclick = async () => {
				const depts = PP.boot.user.departments && PP.boot.user.departments.length ? PP.boot.departments.filter(d => PP.boot.user.departments.includes(d.code)) : PP.boot.departments;
				PP.modal('Daily production entry', '<form class="form"><label class="f">Department<select id="dp-dept">' + PP.opt(depts, 'code', d => d.name, f.department || depts[0].code) + '</select></label><label class="f">Production order<select id="dp-wo"><option>Loading…</option></select></label></form><div class="small muted" style="margin-top:8px">Pick the department and the work order, then record the output.</div>', {
					footer: '<button class="btn" data-close>Cancel</button><button class="btn primary" id="dp-next">Next →</button>', onOpen: bg => {
						const load = async () => { const wos = await PP.get('work-orders', { department: bg.querySelector('#dp-dept').value, open: 1 }); bg.querySelector('#dp-wo').innerHTML = PP.opt(wos, 'id', w => w.wo_no + ' · ' + w.product_code + ' · bal ' + PP.q(w.balance_qty), '', wos.length ? undefined : 'No open work orders'); };
						bg.querySelector('#dp-dept').onchange = load; load();
						bg.querySelector('#dp-next').onclick = async () => { const id = bg.querySelector('#dp-wo').value; if (!id) { return; } const w = await PP.get('work-orders/' + id); PP.entryModal(w, () => PP.render()); };
					}
				});
			};
		}
	};
})();
