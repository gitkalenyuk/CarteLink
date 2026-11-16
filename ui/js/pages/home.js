'use strict';
// Огляд: composed by the active design (CL.homeLayout) from live widgets
// (CL.viz.*). The user can still move, resize and hide every block.

(function () {
  const CL = window.CL;
  const { esc, ic, t } = CL;
  const BARE = { kpis: true };

  CL.page('home', {
    title: 'Огляд', icon: 'home', group: 'gateway', order: 10,
    badge: () => (CL.status && CL.status.errors24h ? { text: CL.status.errors24h > 99 ? '99+' : String(CL.status.errors24h) } : null),

    async render(root, ctx) {
      const q = new URLSearchParams(location.search);
      const moved = q.get('moved');
      const st = CL.status || (await CL.loadStatus().catch(() => null));
      const layout = CL.homeLayout();
      root.innerHTML =
        (moved ? '<div class="banner">' + ic('alert') + '<div class="grow">' + esc(t('Порт {old} зайнятий іншою програмою, тому зараз CarteLink працює на порту {port}. Це лише на цей запуск — звільни порт {old} і перезапусти CarteLink, щоб повернутись до звичної адреси.', { old: moved, port: q.get('port') || '?' })) + '</div></div>' : '') +
        (st && st.warning ? '<div class="banner bad">' + ic('alert') + '<div class="grow">' + esc(st.warning) + '</div></div>' : '') +
        '<div class="blocks home-blocks" data-area="home-' + CL.currentDesign().id + '">' +
        layout.map((b) => '<section class="block w-' + b.id + (BARE[b.id] ? '' : ' card') + '" data-block="' + b.id + '" data-w="' + b.w + '" data-title="' + esc(CL.widgetTitle(b.id)) + '"' + (b.id === 'setup' ? ' hidden' : '') + '><div class="wbody"></div></section>').join('') +
        '</div>';
      CL.look.applyLayout(root);
      layout.forEach((b) => {
        const el = root.querySelector('[data-block="' + b.id + '"] .wbody');
        try { CL.viz[b.id](el, ctx, b); } catch (e) { console.error(e); el.innerHTML = '<div class="hint">' + esc(e.message) + '</div>'; }
      });
      ctx.on('design', () => CL.shell.rerender());
    },
  });
})();
