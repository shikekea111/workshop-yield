// 员工端：上报 / 今日 / 我的
window.Employee = (function () {
  'use strict';

  var curDraft = null;        // 当前上报草稿（同一时间只有一个）
  var allProducts = [];
  var allParts = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // ---------- 上报（同屏分步选择，避免嵌套弹层覆盖） ----------
  function openAdd() {
    curDraft = { product: null, part: null };
    UI.sheet('上报产量', '', function (bodyEl, close) {
      curDraft._body = bodyEl; curDraft._close = close;
      step('product');
    });
  }

  function step(st) {
    var body = curDraft._body;
    if (st === 'product') {
      body.innerHTML = '<div class="search-box"><span class="si">🔍</span><input id="sp" placeholder="搜索产品编号/名称"></div><div id="plist"><div class="ocr-loading">加载中…</div></div>';
      Db.listProducts().then(function (rows) {
        allProducts = rows || [];
        renderProductList();
      }).catch(function (e) { body.querySelector('#plist').innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>'; });
      body.querySelector('#sp').addEventListener('input', function (e) {
        var kw = e.target.value.trim().toLowerCase();
        var f = allProducts.filter(function (p) { return !kw || (p.code + ' ' + p.name).toLowerCase().indexOf(kw) >= 0; });
        renderProductList(f);
      });
    } else if (st === 'part') {
      body.innerHTML =
        '<p class="muted">已选产品：' + esc(curDraft.product.code) + ' ' + esc(curDraft.product.name) +
        '　<a data-act="back" style="color:var(--primary)">重选</a></p>' +
        '<div class="search-box"><span class="si">🔍</span><input id="sp2" placeholder="搜索工序号/工序名"></div>' +
        '<div id="ptlist"><div class="ocr-loading">加载中…</div></div>';
      body.querySelector('[data-act=back]').addEventListener('click', function () { step('product'); });
      Db.listPartsByProduct(curDraft.product.id).then(function (rows) {
        allParts = rows || [];
        renderPartList();
      }).catch(function (e) { body.querySelector('#ptlist').innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>'; });
      body.querySelector('#sp2').addEventListener('input', function (e) {
        var kw = e.target.value.trim().toLowerCase();
        var f = allParts.filter(function (p) { return !kw || (p.part_no + ' ' + p.part_name).toLowerCase().indexOf(kw) >= 0; });
        renderPartList(f);
      });
    } else if (st === 'form') {
      body.innerHTML =
        '<div class="selbox" id="bProd"><div class="sb-label">产品</div><div class="sb-value">' + esc(curDraft.product.code) + ' ' + esc(curDraft.product.name) + '</div></div>' +
        '<div class="selbox" id="bPart"><div class="sb-label">工序</div><div class="sb-value">' + esc(curDraft.part.part_no) + ' · ' + esc(curDraft.part.part_name) + '</div></div>' +
        '<div class="field"><label>生产数量</label><input id="qty" type="number" min="1" inputmode="numeric" placeholder="请输入数量"></div>' +
        '<button class="btn" id="submitRec">提交</button>';
      body.querySelector('#bProd').addEventListener('click', function () { step('product'); });
      body.querySelector('#bPart').addEventListener('click', function () { step('part'); });
      body.querySelector('#submitRec').addEventListener('click', submit);
    }
  }

  function renderProductList(list) {
    list = list || allProducts;
    var box = curDraft._body.querySelector('#plist');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="em-ico">📦</div>无匹配产品</div>'; return; }
    box.innerHTML = list.map(function (p) {
      return '<div class="cand-item" data-id="' + p.id + '"><div class="cand-main"><div class="cand-name">' + esc(p.name) + '</div><div class="cand-sub">' + esc(p.code) + '</div></div><span class="badge process">选</span></div>';
    }).join('');
    box.querySelectorAll('.cand-item').forEach(function (el) {
      el.addEventListener('click', function () {
        curDraft.product = list.filter(function (r) { return r.id === el.getAttribute('data-id'); })[0];
        step('part');
      });
    });
  }

  function renderPartList(list) {
    list = list || allParts;
    var box = curDraft._body.querySelector('#ptlist');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="em-ico">🔩</div>该产品暂无工序，请联系管理员维护</div>'; return; }
    box.innerHTML = list.map(function (p) {
      return '<div class="cand-item" data-id="' + p.id + '"><div class="cand-main"><div class="cand-name">' + esc(p.part_no) + ' · ' + esc(p.part_name) + '</div></div><span class="badge process">选</span></div>';
    }).join('');
    box.querySelectorAll('.cand-item').forEach(function (el) {
      el.addEventListener('click', function () {
        curDraft.part = list.filter(function (r) { return r.id === el.getAttribute('data-id'); })[0];
        step('form');
      });
    });
  }

  function submit() {
    var qty = parseInt(document.getElementById('qty').value, 10);
    if (!curDraft.product) { UI.toast('请选择产品', true); return; }
    if (!curDraft.part) { UI.toast('请选择工序', true); return; }
    if (!qty || qty <= 0) { UI.toast('请输入正确数量', true); return; }
    UI.toast('提交中…');
    Db.insertRecord({
      worker_id: App.session.user.id,
      product_id: curDraft.product.id,
      part_id: curDraft.part.id,
      process: curDraft.part.part_name,
      qty: qty,
      record_date: Db._today()
    }).then(function () {
      UI.toast('已提交 ✓');
      curDraft._close();
      render(App.currentTab === 'today' ? 'today' : 'record');
    }).catch(function (e) { UI.toast('提交失败：' + (e.message || e), true); });
  }

  // ---------- 视图 ----------
  function render(tab) {
    if (tab === 'record') return renderRecord();
    if (tab === 'today') return renderToday();
    if (tab === 'me') return renderMe();
  }

  function renderRecord() {
    var view = document.getElementById('view');
    var today = Db._today();
    Db.listMyRecords(today).then(function (rows) {
      var total = (rows || []).reduce(function (a, r) { return a + (r.qty || 0); }, 0);
      view.innerHTML =
        '<div class="card">' +
          '<h2>👋 ' + esc(App.profile.display_name || '工友') + '，今天辛苦了</h2>' +
          '<p class="muted">日期：' + today + '</p>' +
          '<div class="score-row">' +
            '<div class="score-big">' + (rows ? rows.length : 0) + '<span class="score-unit">条</span></div>' +
            '<div class="score-meta"><div class="score-level">今日已报 ' + total + ' 件</div><div class="muted">点击下方按钮继续上报</div></div>' +
          '</div>' +
          '<button class="btn" id="goAdd" style="margin-top:12px">＋ 新增上报</button>' +
        '</div>' +
        '<div class="card"><h3>怎么用</h3><p class="muted">选产品 → 选工序 → 填数量 → 提交。工序由管理员预置，无需手输，避免写错。</p></div>';
      document.getElementById('goAdd').addEventListener('click', openAdd);
    }).catch(function (e) {
      view.innerHTML = '<div class="empty"><div class="em-ico">⚠️</div>加载失败：' + esc(e.message || e) + '</div>';
    });
  }

  function renderToday() {
    var view = document.getElementById('view');
    view.innerHTML = '<div class="card"><h2>📅 今日上报</h2><div id="todayList"><div class="ocr-loading">加载中…</div></div></div>';
    Db.listMyRecords(Db._today()).then(function (rows) {
      var box = document.getElementById('todayList');
      if (!rows || !rows.length) { box.innerHTML = '<div class="empty"><div class="em-ico">📭</div>今天还没有上报</div>'; return; }
      box.innerHTML = rows.map(function (r) {
        var pn = (r.parts && r.parts.part_name) ? r.parts.part_name : '';
        var pno = (r.parts && r.parts.part_no) ? r.parts.part_no : '';
        var pname = (r.products && r.products.name) ? r.products.name : '';
        var time = (r.submitted_at || '').slice(11, 16);
        return '<div class="rec-item" data-id="' + r.id + '">' +
          '<div class="rec-ico">📦</div>' +
          '<div class="rec-body"><div class="rec-title">' + esc(pno) + ' · ' + esc(pn) + '</div>' +
          '<div class="rec-sub">' + esc(pname) + '　' + time + '</div></div>' +
          '<div class="rec-qty">' + r.qty + ' 件</div>' +
          '<div class="rec-actions"><button class="icon-btn" data-act="edit" title="修改">✏️</button><button class="icon-btn" data-act="del" title="删除">🗑️</button></div>' +
          '</div>';
      }).join('');
      box.querySelectorAll('.rec-item').forEach(function (el) {
        var id = el.getAttribute('data-id');
        var rec = rows.filter(function (r) { return r.id === id; })[0];
        el.querySelector('[data-act=del]').addEventListener('click', function () { doDelete(id); });
        el.querySelector('[data-act=edit]').addEventListener('click', function () { doEdit(rec); });
      });
    }).catch(function (e) {
      document.getElementById('todayList').innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>';
    });
  }

  function doDelete(id) {
    UI.confirm('确定删除这条上报记录吗？', '删除').then(function (ok) {
      if (!ok) return;
      Db.deleteRecord(id).then(function () { UI.toast('已删除'); renderToday(); }).catch(function (e) { UI.toast('删除失败：' + (e.message || e), true); });
    });
  }

  function doEdit(rec) {
    UI.sheet('修改上报', '<div class="field"><label>数量（原 ' + rec.qty + ' 件）</label><input id="eqty" type="number" min="1" inputmode="numeric" value="' + rec.qty + '"></div><button class="btn" id="esave">保存</button>', function (body, close) {
      body.querySelector('#esave').addEventListener('click', function () {
        var q = parseInt(body.querySelector('#eqty').value, 10);
        if (!q || q <= 0) { UI.toast('请输入正确数量', true); return; }
        Db.updateRecord(rec.id, { qty: q }).then(function () { UI.toast('已保存'); close(); renderToday(); }).catch(function (e) { UI.toast('保存失败：' + (e.message || e), true); });
      });
    });
  }

  function renderMe() {
    var view = document.getElementById('view');
    var today = Db._today();
    var first = new Date(); first.setDate(1);
    var m0 = String(first.getMonth() + 1).padStart(2, '0');
    var d0 = String(first.getDate()).padStart(2, '0');
    var fromStr = first.getFullYear() + '-' + m0 + '-' + d0;
    view.innerHTML =
      '<div class="card"><h2>👤 我的</h2>' +
        '<p class="profile-line">姓名：' + esc(App.profile.display_name) + '</p>' +
        '<p class="profile-line">邮箱：' + esc(App.profile.email) + '</p>' +
        '<p class="profile-line">角色：' + (App.profile.role === 'admin' ? '管理员' : '员工') + '</p>' +
      '</div>' +
      '<div class="card"><h3>历史上报</h3>' +
        '<div class="filters"><div class="field"><label>从</label><input id="hf" type="date" value="' + fromStr + '"></div>' +
        '<div class="field"><label>到</label><input id="ht" type="date" value="' + today + '"></div></div>' +
        '<button class="btn secondary sm" id="hq">查询</button>' +
        '<div id="hlist" style="margin-top:12px"></div>' +
      '</div>' +
      '<div class="card">' +
        '<button class="btn ghost" id="cpw">修改密码</button>' +
        '<button class="btn danger" id="logout" style="margin-top:10px">退出登录</button>' +
      '</div>';
    document.getElementById('hq').addEventListener('click', function () {
      var f = document.getElementById('hf').value, t = document.getElementById('ht').value;
      Db.listMyHistory(f, t).then(function (rows) {
        var box = document.getElementById('hlist');
        if (!rows || !rows.length) { box.innerHTML = '<p class="muted">该区间无记录</p>'; return; }
        box.innerHTML = rows.map(function (r) {
          var pn = (r.parts && r.parts.part_name) || '';
          var pno = (r.parts && r.parts.part_no) || '';
          return '<div class="rec-item"><div class="rec-ico">📦</div><div class="rec-body"><div class="rec-title">' + esc(pno) + ' · ' + esc(pn) + '</div><div class="rec-sub">' + r.record_date + '</div></div><div class="rec-qty">' + r.qty + ' 件</div></div>';
        }).join('');
      }).catch(function (e) { UI.toast('查询失败：' + (e.message || e), true); });
    });
    document.getElementById('cpw').addEventListener('click', changePw);
    document.getElementById('logout').addEventListener('click', function () {
      Db.signOut().then(function () { location.reload(); }).catch(function () { location.reload(); });
    });
  }

  function changePw() {
    UI.modal('修改密码', '<div class="field"><label>新密码</label><input id="npw" type="password" placeholder="至少6位"></div><div class="field"><label>确认新密码</label><input id="npw2" type="password" placeholder="再次输入"></div>', {
      center: true, okText: '保存',
      onOk: function () {
        var a = document.getElementById('npw').value, b = document.getElementById('npw2').value;
        if (a.length < 6) { UI.toast('密码至少6位', true); return; }
        if (a !== b) { UI.toast('两次输入不一致', true); return; }
        Db.updatePassword(a).then(function () { UI.close(); UI.toast('密码已修改'); }).catch(function (e) { UI.toast('修改失败：' + (e.message || e), true); });
      }
    });
  }

  return { render: render, openAdd: openAdd };
})();
