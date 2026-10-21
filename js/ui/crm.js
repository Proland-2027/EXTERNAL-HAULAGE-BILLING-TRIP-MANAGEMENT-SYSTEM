/* CRM: client transport requests managed independently from fleet planning. Create and submit requests (Internal Fleet or
 * 3rd Party), watch their progress through the stages, cancel several at once, and see unfulfilled requests and lost sales. */
(function () {
  'use strict';
  const U = HB.U, E = HB.engine, P = HB.planning, D = HB.dispatch, h = U.h;
  HB.views = HB.views || {};
  const tile = (label, value, sub, kind, onClick) => h('div', { class: 'tile ' + (kind || '') + (onClick ? ' clickable' : ''), onClick }, h('span', { class: 'label', text: label }), h('span', { class: 'value', text: value }), sub ? h('span', { class: 'sub', text: sub }) : null);

  const view = { title: 'Client Requests (CRM)' };
  view.render = function (root, ctx) { view.ctx = ctx; view.root = root; root.append(h('div', { class: 'stack', id: 'crm-view' })); view.draw(); if (ctx.params && ctx.params.request) setTimeout(() => HB.views.planning.openRequest(ctx, ctx.params.request), 30); if (ctx.params && ctx.params.new) setTimeout(() => HB.views.planning.editRequest(ctx, null), 30); };
  view.onStoreChange = () => { if (view.root && view.root.isConnected) view.draw(); };
  view.draw = function () {
    const ctx = view.ctx, store = ctx.store, wrap = view.root.querySelector('#crm-view'); if (!wrap) return; U.clear(wrap);
    const pl = HB.views.planning; pl.ctx = ctx; const reqs = pl.requestRows(store); const open = reqs.filter((r) => !['Completed', 'Cancelled'].includes(r.liveStatus));
    const dctx = store.dispatchCtx(); const unfulfilled = open.filter((r) => r.counts.outstanding > 0);
    const atRisk = E.round2(unfulfilled.reduce((s, r) => { const rate = D.requestRate(r, dctx); return s + (D.lostSales(r, r.counts, rate.rate).lost || 0); }, 0));
    const confirmed = E.sum(store.state.lostsales.filter((l) => l.kind === 'Confirmed lost sale'), 'estimatedLost');
    const f = pl.filters;
    wrap.append(h('div', { class: 'tiles' },
      tile('Open requests', U.int(open.length), `${U.int(reqs.length)} logged in total`, 'warn', () => { f.status = ''; view.draw(); }),
      tile('Awaiting route mapping', U.int(open.filter((r) => r.liveStatus === 'Pending Route Mapping').length), 'Route Not Mapped — approval required', open.some((r) => r.liveStatus === 'Pending Route Mapping') ? 'bad' : 'good', () => { f.status = 'Pending Route Mapping'; view.draw(); }),
      tile('With Operations (planning)', U.int(open.filter((r) => r.liveStatus === 'Awaiting Planning').length), 'fleet plan not yet approved', 'info', () => { f.status = 'Awaiting Planning'; view.draw(); }),
      tile('With the station (allocation)', U.int(open.filter((r) => ['Plan Approved', 'Partially Allocated'].includes(r.liveStatus)).length), 'trucks being allocated', 'info', () => { f.status = 'Plan Approved'; view.draw(); }),
      tile('In 3PL module', U.int(open.filter((r) => P.isTpl(r)).length), '3rd-party contractor jobs', 'neutral', () => ctx.nav('tpl')),
      tile('Requests not fulfilled', U.int(unfulfilled.length), `${U.int(unfulfilled.reduce((s, r) => s + r.counts.outstanding, 0))} trucks still required`, unfulfilled.length ? 'bad' : 'good', () => { f.status = ''; view.draw(); }),
      tile('Potential (at-risk) lost sales', U.moneyShort(atRisk), 'unfulfilled trucks × agreed rate', atRisk ? 'warn' : 'good', () => ctx.nav('lostsales')),
      tile('Confirmed lost sales', U.moneyShort(confirmed), `${U.int(store.state.lostsales.filter((l) => l.kind === 'Confirmed lost sale').length)} records`, confirmed ? 'bad' : 'good', () => ctx.nav('lostsales'))));
    wrap.append(h('p', { class: 'small muted', text: 'CRM owns stage 1: log the request with its mandatory Transport Service Type, check the route against the Route Master, submit it to Operations (internal fleet) or the 3PL module (3rd party), follow its progress and cancel requests that will not be served. Requests with allocated trucks are released only after the Operations Manager approves.' }));
    pl.drawRequests(ctx, wrap, reqs, { crm: true });
  };
  HB.views.crm = view;
})();
