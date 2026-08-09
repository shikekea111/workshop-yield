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
    view.innerHTML =
      '<div class="login-wrap">' +
        '<div class="login-logo">🏭</div>' +
        '<div class="login-title">' + (window.APP_CONFIG.APP_NAME || '车间产量上报') + '</div>' +
        '<div class="login-sub">' + (App.mode === 'admin' ? '管理后台登录' : '员工登录') + '</div>' +
        '<div class="card">' +
          '<div class="field"><label>邮箱</label><input id="lgEmail" type="email" placeholder="员工账号邮箱" /></div>' +
          '<div class="field"><label>密码</label><input id="lgPw" type="password" placeholder="密码" /></div>' +
          '<button class="btn" id="loginBtn">登录</button>' +
          '<p class="muted" style="margin-top:10px">账号由管理员创建。首次登录后可在「我的」修改密码。</p>' +
        '</div>' +
      '</div>';
    document.getElementById('loginBtn').addEventListener('click', doLogin);
    document.getElementById('lgPw').addEventListener('keydown', function (e) { if (e.key === 'Enter') doLogin(); });
  }

  function doLogin() {
    var email = document.getElementById('lgEmail').value.trim();
    var pw = document.getElementById('lgPw').value;
    if (!email || !pw) { UI.toast('请输入邮箱和密码', true); return; }
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
    if (App.mode === 'admin' && App.profile.role !== 'admin') { location.href = 'index.html'; return; }
    if (App.mode === 'emp' && App.profile.role === 'admin') { location.href = 'admin.html'; return; }
    var tabbar = document.getElementById('tabbar');
    if (tabbar) tabbar.style.display = 'flex';
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
