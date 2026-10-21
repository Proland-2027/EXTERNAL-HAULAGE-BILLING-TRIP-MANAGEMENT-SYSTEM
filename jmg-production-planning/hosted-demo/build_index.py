css = open('/home/user/EXTERNAL-HAULAGE-BILLING-TRIP-MANAGEMENT-SYSTEM/jmg-production-planning/assets/app.css').read()
esc = lambda t: t.replace('</script', '<\/script'); engine = esc(open('engine.js').read()); server = esc(open('server.js').read()); app = esc(open('app.js').read())
loader = r"""
(function () {
  const root = document.getElementById('jmg-app');
  const status = (msg) => { root.innerHTML = '<div class="card" style="margin:40px auto;max-width:560px"><h2>JMG Production Planning</h2><p>' + msg + '</p></div>'; };
  window.jmgDownload = async function (filename, data, mime) {
    const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'application/octet-stream' });
    let dl = null; try { dl = window.claude && window.claude.use ? await window.claude.use('downloads') : null; } catch (e) { dl = null; }
    if (dl) { try { await dl.save({ filename, data: blob }); return; } catch (e) { if (e && e.code !== 'cancelled') { console.warn('download refused', e); } return; } }
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  };
  (async () => {
    try {
      status('Loading workbook data (BOM, sections, capacities)…');
      const [m, b] = await Promise.all([fetch('data/masters.json').then((r) => r.json()), fetch('data/bom.json').then((r) => r.json())]);
      window.JMG.loadMasters(m, b);
      status('Connecting to the shared database…');
      await window.JMG_SERVER.init();
      window.JMG_SERVER.onChange(() => { if (window.jmgRefresh) { window.jmgRefresh(); } });
      await window.jmgStart();
    } catch (e) { console.error(e); status('<span style="color:#a52828">Could not start: ' + (e && e.message ? e.message : e) + '</span>'); }
  })();
})();
"""
head = """<title>JMG Production Planning</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Operations UI: fixed light look (dark sidebar, light work surface), explicit colors throughout. */
:root{color-scheme:light}
""" + css.replace(':root{', ':root{--bg:#f3f4f1;', 1) + """
body.jmg-body,body{background:#f3f4f1;color:#0b0b0b;padding-left:max(0px,env(safe-area-inset-left,0px));padding-right:max(0px,env(safe-area-inset-right,0px))}
.main{padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px))}
.side{top:env(safe-area-inset-top,0px)}
.side .brand small{display:block}
</style>
"""
def page(with_shim):
    body = head + '<div id="jmg-app"></div>\n'
    if with_shim: body += '<script>' + open('shim.js').read() + '</script>\n'
    body += '<script>' + engine + '</script>\n<script>' + server + '</script>\n<script>' + app + '</script>\n<script>' + loader + '</script>\n'
    return body
open('index.html', 'w').write(page(False))
open('test.html', 'w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body class="jmg-body">' + page(True) + '</body></html>')
import os; print('index.html', os.path.getsize('index.html'), 'test.html', os.path.getsize('test.html'))
