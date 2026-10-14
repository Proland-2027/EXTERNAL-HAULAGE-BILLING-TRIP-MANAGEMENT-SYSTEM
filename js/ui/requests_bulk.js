/* Bulk selection and cancellation of client requests (CRM): reason required, history preserved, lost-sales capture, and
 * release of allocated trucks only after Operations Manager approval. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, D = HB.dispatch, h = U.h;
  const view = HB.views.planning; view.picked = view.picked || new Set();
  view.cancelSelected = function (ctx) {
    const { store } = ctx; const picked = view.picked; const reqs = view.requestRows(store).filter((r) => picked.has(r.id)); if (!reqs.length) return;
    if (!ctx.can('request.cancel')) return U.toast('Your role cannot cancel client requests.', 'bad');
    const live = store.state.allocations.filter((a) => picked.has(a.requestId) && !['Cancelled', 'Completed'].includes(a.status));
    const canRelease = ctx.can('allocation.release');
    const inp = { reason: U.select(D.CANCEL_REASONS.map(([r]) => [r, r]), 'No truck available'), kind: U.select(D.LOST_KINDS, 'Confirmed lost sale'), department: U.select(['Fleet planning', 'Operations', 'Commercial / sales', 'Client', 'Finance', 'Workshop'], 'Fleet planning'), remarks: h('input', { type: 'text', placeholder: 'Optional remarks (kept on every cancelled request and lost-sales record)' }), release: h('input', { type: 'checkbox', checked: canRelease ? true : null, disabled: canRelease ? null : true }) };
    inp.reason.addEventListener('change', () => { inp.kind.value = D.lostSalesKindFor(inp.reason.value); });
    const body = h('div', { class: 'stack' }, h('p', { class: 'small', text: `${reqs.length} request${reqs.length > 1 ? 's' : ''} selected. Cancelled requests are kept (never deleted) with the reason, the user and the time in the audit trail. Trucks still required on each request are recorded as lost sales at the agreed client rate; not every cancellation counts as lost revenue (choose the classification).` }),
      h('div', { class: 'table-frame short', style: { minHeight: 0 } }, h('table', { class: 'data' }, h('thead', {}, h('tr', {}, ['Request', 'Client', 'Route', 'Requested', 'Allocated', 'Unfulfilled', 'Agreed rate', 'Est. lost revenue'].map((x) => h('th', { text: x })))), h('tbody', {}, reqs.map((r) => { const rate = D.requestRate(r, store.dispatchCtx()); const ls = D.lostSales(r, r.counts, rate.rate); return h('tr', {}, h('td', { class: 'num', text: r.id }), h('td', { text: r.client }), h('td', { text: `${r.loadingFrom} → ${r.destination}` }), h('td', { class: 'num', text: r.counts.requested }), h('td', { class: 'num', text: r.counts.allocated }), h('td', { class: 'num', text: ls.unfulfilled }), h('td', { class: 'money', text: rate.rate === null ? 'no rate' : U.money(rate.rate) }), h('td', { class: 'money', text: ls.lost === null ? '—' : U.money(ls.lost) })); })))),
      h('div', { class: 'form-grid' }, U.field('Cancellation reason (required)', inp.reason), U.field('Lost-sales classification', inp.kind, { help: 'Confirmed lost sale, at risk, or cancelled without revenue loss.' }), U.field('Responsible department', inp.department), U.field('Remarks', inp.remarks, { span2: true })),
      live.length ? (canRelease ? h('label', { class: 'row small notice warn' }, inp.release, ` Release the ${live.length} allocated truck${live.length > 1 ? 's' : ''} now (allocations ${live.map((a) => a.id).join(', ')} are cancelled). You are the Operations Manager, so no further approval is needed; confirmation follows.`) : h('div', { class: 'notice warn small', text: `${live.length} allocated truck${live.length > 1 ? 's' : ''} (${live.map((a) => a.plate).join(', ')}) stay allocated until the Operations Manager approves the release. The request${reqs.length > 1 ? 's' : ''} will show "Cancellation Requested" until then.` })) : h('div', { class: 'small muted', text: 'No active allocations on the selected requests.' }));
    const m = U.modal({ title: 'Cancel selected requests', size: 'wide', body });
    m.setActions([h('button', { class: 'btn', onClick: () => m.close() }, 'Keep requests'), h('button', { class: 'btn danger', id: 'btn-confirm-cancel', onClick: async (ev) => {
      const btn = ev.currentTarget; if (btn.disabled) return; btn.disabled = true; btn.textContent = 'Cancelling…'; // one run per click: a second click while the first is saving must not cancel or record anything twice
      const reason = inp.reason.value; const release = canRelease && inp.release.checked;
      if (live.length && release && !(await U.confirm({ title: 'Release allocated trucks', message: `Cancel ${live.length} allocation(s) and free the trucks for other requests? This is recorded in the audit trail.`, okLabel: 'Release trucks', danger: true }))) { btn.disabled = false; btn.textContent = 'Cancel requests'; return; }
      let n = 0, pending = 0; const errors = [];
      for (const r of reqs) {
        try {
          const cur = store.state.requests.find((x) => x.id === r.id);
          if (!cur || cur.status === 'Cancelled') { errors.push(`${r.id}: already cancelled`); continue; }
          const res = await store.cancelRequest(r.id, reason, { release, remarks: E.clean(inp.remarks.value), kind: inp.kind.value });
          if (res.pending) { pending++; continue; }
          if (r.counts.outstanding > 0 || inp.kind.value !== 'Not a lost sale') await HB.views.lostsales.recordForRequest(ctx, store.state.requests.find((x) => x.id === r.id), r.counts, reason, inp.kind.value, inp.department.value, E.clean(inp.remarks.value));
          n++;
        } catch (e) { errors.push(`${r.id}: ${e.message}`); }
      }
      picked.clear(); m.close(); if (HB.views.crm && HB.views.crm.root && HB.views.crm.root.isConnected) HB.views.crm.draw(); else view.draw();
      if (n) U.toast(`${n} request${n > 1 ? 's' : ''} cancelled; lost sales recorded.`, 'good'); if (pending) U.toast(`${pending} request${pending > 1 ? 's' : ''} marked Cancellation Requested: the Operations Manager must approve the truck release.`, 'warn'); if (errors.length) U.toast(errors.join(' | '), 'bad');
    } }, 'Cancel requests')]);
  };
})();
