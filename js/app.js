// 启动 + 登录 + 视图路由（员工端 index.html 与管理端 admin.html 共用）
window.App = { mode: 'emp', session: null, profile: null, currentTab: null };

(function () {
  'use strict';

  function init() {
    App.mode = (location.pathname.indexOf('admin') >= 0) ? 'admin' : 'emp';
    Db.getSession().then(function (s) {
      if (!s) { showLogin(); return; }
      App.session = s;
      Db.getProfile().then(function (p) {
        App.profile = p;
        boot();
      }).catch(function (e) {
        console.error(e);
        UI.toast('读取档案失败，请重新登录', true);
        showLogin();
      });
    }).catch(function () { showLogin(); });
  }

  function showLogin() {
    var tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.style.display = 'none';
    var view = document.getElementById('view');
    // 员工端：只输工号数字，自动补 @factory.local；管理员端：完整邮箱
    var emailField = (App.mode === 'admin')
      ? '<div class="field"><label>邮箱</label><input id="lgEmail" type="email" placeholder="管理员账号邮箱" autocomplete="username" /></div>'
      : '<div class="field"><label>工号</label>' +
          '<div class="input-suffix">' +
            '<input id="lgEmail" type="text" inputmode="numeric" placeholder="如 1004" autocomplete="username" />' +
            '<span class="suffix">@' + (window.APP_CONFIG.EMAIL_DOMAIN || 'factory.local') + '</span>' +
          '</div></div>';
    var hint = (App.mode === 'admin')
      ? '账号由管理员创建。首次登录后可在「我的」修改密码。'
      : '只需输入工号，域名自动补全。首次登录后可在「我的」修改密码。';
    view.innerHTML =
      '<div class="login-wrap">' +
        '<div class="login-logo">🏭</div>' +
        '<div class="login-title">' + (window.APP_CONFIG.APP_NAME || '车间产量上报') + '</div>' +
        '<div class="login-sub">' + (App.mode === 'admin' ? '管理后台登录' : '员工登录') + '</div>' +
        '<div class="card">' +
          emailField +
          '<div class="field"><label>密码</label><input id="lgPw" type="password" placeholder="密码" /></div>' +
          '<button class="btn" id="loginBtn">登录</button>' +
          '<p class="muted" style="margin-top:10px">' + hint + '</p>' +
        '</div>' +
      '</div>';
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('lgPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
    var eEl = document.getElementById('lgEmail');
    if (eEl) { eEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); }); eEl.focus(); }
  }

  function doLogin() {
    var raw = document.getElementById('lgEmail').value.trim();
    var pw = document.getElementById('lgPw').value;
    if (!raw || !pw) { UI.toast('请输入账号和密码', true); return; }
    // 员工端：只输了工号数字时，自动补 @factory.local（已是完整邮箱或管理员邮箱则不动）
    var email = (App.mode === 'emp' && raw.indexOf('@') < 0)
      ? raw + '@' + (window.APP_CONFIG.EMAIL_DOMAIN || 'factory.local')
      : raw;
    UI.toast('登录中…');
    Db.signIn(email, pw).then(function (data) {
      App.session = (data && data.session) ? data.session : null;
      return Db.getProfile();
    }).then(function (p) {
      App.profile = p;
      boot();
    }).catch(function (e) { UI.toast('登录失败：' + (e.message || e), true); });
  }

  function boot() {
    var role = (App.profile && App.profile.role) || 'worker';
    var isStaff = (role === 'admin' || role === 'leader');
    if (App.mode === 'admin' && !isStaff) { location.href = 'index.html'; return; }
    if (App.mode === 'emp' && isStaff) { location.href = 'admin.html'; return; }
    var tabbar = document.getElementById('tabbar');
    if (tabbar) {
      tabbar.style.display = 'flex';
      // 班组长(leader)只看汇总/月报/设置，隐藏产品与员工管理入口
      if (role === 'leader') {
        var hideTabs = tabbar.querySelectorAll('[data-tab="products"], [data-tab="workers"]');
        hideTabs.forEach(function (t) { t.style.display = 'none'; });
      }
    }
    var def = (App.mode === 'admin') ? 'report' : 'record';
    go(def);
  }

  function go(tab) {
    if (App.mode === 'admin') {
      document.querySelectorAll('#tabbar .tab').forEach(function (t) {
        t.classList.toggle('active', t.getAttribute('data-tab') === tab);
      });
      App.currentTab = tab;
      window.Admin.render(tab);
      return;
    }
    // 员工端
    if (tab === 'add') { window.Employee.openAdd(); return; } // 不切换高亮
    document.querySelectorAll('#tabbar .tab').forEach(function (t) {
      t.classList.toggle('active', t.getAttribute('data-tab') === tab);
    });
    App.currentTab = tab;
    window.Employee.render(tab);
  }

  // tab 点击
  document.addEventListener('click', function (e) {
    var tabEl = e.target.closest && e.target.closest('.tab');
    if (tabEl) { go(tabEl.getAttribute('data-tab')); }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
