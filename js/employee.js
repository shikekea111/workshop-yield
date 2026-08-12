// 员工端：上报 / 今日 / 我的
window.Employee = (function () {
  'use strict';

  var curDraft = null;        // 当前上报草稿（同一时间只有一个）
  var curBatch = null;        // 批量填报草稿（同一产品多工序）
  var allProducts = [];
  var allParts = [];

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  // 将 UTC ISO 时间转北京时间（UTC+8）显示，不受浏览器时区设置影响
  function fmtTime(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    var t = d.getTime() + d.getTimezoneOffset() * 60000 + 8 * 3600000;
    var c = new Date(t);
    var h = String(c.getHours()).padStart(2, '0');
    var m = String(c.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  // 按员工手机当前小时预选班次（国内即北京时间；点选可改）
  function guessShift() {
    var h = new Date().getHours();
    if (h >= 8 && h < 16) return '白班';
    if (h >= 16) return '中班';
    return '夜班'; // 0-8 点
  }

  // ---------- 上报（同屏分步选择，避免嵌套弹层覆盖） ----------
  function openAdd() {
    curDraft = { product: null, part: null, shift: null };
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
        '<div class="field"><label>班次</label><div class="shift-pick" id="shiftPick">' +
          '<div class="shift-chip" data-shift="白班">☀️ 白班</div>' +
          '<div class="shift-chip" data-shift="中班">🌙 中班</div>' +
          '<div class="shift-chip" data-shift="夜班">🌃 夜班</div>' +
        '</div><p class="muted" style="margin:4px 0 0">默认按当前时间预选，可点改</p></div>' +
        '<div class="field"><label>生产数量</label><input id="qty" type="number" min="1" inputmode="numeric" placeholder="请输入数量"></div>' +
        '<button class="btn" id="submitRec">提交</button>';
      body.querySelector('#bProd').addEventListener('click', function () { step('product'); });
      body.querySelector('#bPart').addEventListener('click', function () { step('part'); });
      body.querySelector('#submitRec').addEventListener('click', submit);
      // 班次选择
      var sp = body.querySelector('#shiftPick');
      sp.querySelectorAll('.shift-chip').forEach(function (c) {
        c.addEventListener('click', function () {
          curDraft.shift = c.getAttribute('data-shift');
          sp.querySelectorAll('.shift-chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        });
      });
      // 预选当前班次
      var pre = guessShift();
      curDraft.shift = pre;
      sp.querySelectorAll('.shift-chip').forEach(function (c) { if (c.getAttribute('data-shift') === pre) c.classList.add('on'); });
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
    if (!curDraft.shift) { UI.toast('请选择班次', true); return; }
    if (!qty || qty <= 0) { UI.toast('请输入正确数量', true); return; }
    UI.toast('提交中…');
    Db.insertRecord({
      worker_id: App.session.user.id,
      product_id: curDraft.product.id,
      part_id: curDraft.part.id,
      process: curDraft.part.part_name,
      shift: curDraft.shift,
      qty: qty,
      record_date: Db._today()
    }).then(function () {
      UI.toast('已提交 ✓');
      curDraft._close();
      render(App.currentTab === 'today' ? 'today' : 'record');
    }).catch(function (e) { UI.toast('提交失败：' + (e.message || e), true); });
  }

  // ---------- 批量填报（选同一产品 → 勾选多工序 → 各填数量 → 统一班次 → 一次提交） ----------
  function openBatchAdd() {
    curBatch = { product: null, parts: [], selected: {}, shift: guessShift(), _body: null, _close: null };
    UI.sheet('批量填报', '', function (bodyEl, close) {
      curBatch._body = bodyEl; curBatch._close = close;
      stepBatch('product');
    });
  }

  function stepBatch(st) {
    var body = curBatch._body;
    if (st === 'product') {
      body.innerHTML = '<div class="search-box"><span class="si">🔍</span><input id="bsp" placeholder="搜索产品编号/名称"></div><div id="bplist"><div class="ocr-loading">加载中…</div></div>';
      Db.listProducts().then(function (rows) {
        var list = rows || [];
        renderBatchProductList(list);
        body.querySelector('#bsp').addEventListener('input', function (e) {
          var kw = e.target.value.trim().toLowerCase();
          var f = list.filter(function (p) { return !kw || (p.code + ' ' + p.name).toLowerCase().indexOf(kw) >= 0; });
          renderBatchProductList(f);
        });
      }).catch(function (e) { body.querySelector('#bplist').innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>'; });
    } else if (st === 'parts') {
      body.innerHTML =
        '<p class="muted">' + esc(curBatch.product.code) + ' ' + esc(curBatch.product.name) +
        '　<a data-act="back" style="color:var(--primary)">重选</a></p>' +
        '<p class="muted" style="margin:-4px 0 8px">勾选工序并填写数量（可多选）</p>' +
        '<div id="bptlist"><div class="ocr-loading">加载中…</div></div>' +
        '<div class="field"><label>班次（整批统一）</label><div class="shift-pick" id="bshiftPick">' +
          '<div class="shift-chip" data-shift="白班">☀️ 白班</div>' +
          '<div class="shift-chip" data-shift="中班">🌙 中班</div>' +
          '<div class="shift-chip" data-shift="夜班">🌃 夜班</div>' +
        '</div></div>' +
        '<button class="btn" id="toPreview">预览</button>';
      body.querySelector('[data-act=back]').addEventListener('click', function () { stepBatch('product'); });
      var sp = body.querySelector('#bshiftPick');
      sp.querySelectorAll('.shift-chip').forEach(function (c) {
        c.addEventListener('click', function () {
          curBatch.shift = c.getAttribute('data-shift');
          sp.querySelectorAll('.shift-chip').forEach(function (x) { x.classList.toggle('on', x === c); });
        });
      });
      var pre = curBatch.shift;
      sp.querySelectorAll('.shift-chip').forEach(function (c) { if (c.getAttribute('data-shift') === pre) c.classList.add('on'); });
      Db.listPartsByProduct(curBatch.product.id).then(function (rows) {
        curBatch.parts = rows || [];
        renderBatchPartList();
      }).catch(function (e) { body.querySelector('#bptlist').innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>'; });
      body.querySelector('#toPreview').addEventListener('click', function () { stepBatch('preview'); });
    } else if (st === 'preview') {
      var chosen = Object.keys(curBatch.selected).map(function (k) { return curBatch.selected[k]; }).filter(function (s) { return s.qty > 0; });
      var total = chosen.reduce(function (a, s) { return a + s.qty; }, 0);
      var html = '<p class="muted">产品：' + esc(curBatch.product.code) + ' ' + esc(curBatch.product.name) + '　班次：' + esc(curBatch.shift || '未选') + '</p>';
      if (!chosen.length) {
        html += '<div class="empty"><div class="em-ico">📋</div>还没有填写数量的工序</div>';
      } else {
        html += '<div class="batch-list" id="bPreview">';
        chosen.forEach(function (s) {
          html += '<div class="batch-row" data-pid="' + s.part.id + '">' +
            '<div class="br-main">' + esc(s.part.part_no) + ' · ' + esc(s.part.part_name) + '</div>' +
            '<input class="br-qty" type="number" min="1" inputmode="numeric" value="' + s.qty + '">' +
            '<button class="br-del" data-act="del" aria-label="删除">✕</button>' +
          '</div>';
        });
        html += '</div><div class="batch-sum">共 <b>' + chosen.length + '</b> 道工序 · 合计 <b>' + total + '</b> 件</div>';
      }
      html += '<div class="batch-actions">' +
        '<button class="btn ghost" id="backEdit">返回修改</button>' +
        '<button class="btn" id="doSubmit"' + (chosen.length ? '' : ' disabled') + '>提交（' + chosen.length + '条）</button>' +
      '</div>';
      body.innerHTML = html;
      body.querySelector('#backEdit').addEventListener('click', function () { stepBatch('parts'); });
      body.querySelectorAll('#bPreview .br-qty').forEach(function (inp) {
        inp.addEventListener('input', function (e) {
          var pid = e.target.closest('.batch-row').getAttribute('data-pid');
          var v = parseInt(e.target.value, 10);
          if (curBatch.selected[pid]) curBatch.selected[pid].qty = (isNaN(v) ? 0 : v);
        });
      });
      body.querySelectorAll('#bPreview .br-del').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          delete curBatch.selected[e.target.closest('.batch-row').getAttribute('data-pid')];
          stepBatch('preview');
        });
      });
      var doSubmitBtn = body.querySelector('#doSubmit');
      if (doSubmitBtn) doSubmitBtn.addEventListener('click', submitBatch);
    }
  }

  function renderBatchProductList(list) {
    var box = curBatch._body.querySelector('#bplist');
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="em-ico">📦</div>无匹配产品</div>'; return; }
    box.innerHTML = list.map(function (p) {
      return '<div class="cand-item" data-id="' + p.id + '"><div class="cand-main"><div class="cand-name">' + esc(p.name) + '</div><div class="cand-sub">' + esc(p.code) + '</div></div><span class="badge process">选</span></div>';
    }).join('');
    box.querySelectorAll('.cand-item').forEach(function (el) {
      el.addEventListener('click', function () {
        curBatch.product = list.filter(function (r) { return r.id === el.getAttribute('data-id'); })[0];
        stepBatch('parts');
      });
    });
  }

  function renderBatchPartList() {
    var box = curBatch._body.querySelector('#bptlist');
    var list = curBatch.parts;
    if (!list.length) { box.innerHTML = '<div class="empty"><div class="em-ico">🔩</div>该产品暂无工序，请联系管理员维护</div>'; return; }
    box.innerHTML = '<div class="chip-row">' + list.map(function (p) {
      var sel = curBatch.selected[p.id];
      return '<div class="chip' + (sel ? ' sel' : '') + '" data-id="' + p.id + '">' +
        '<span class="chip-t">' + esc(p.part_no) + ' · ' + esc(p.part_name) + '</span>' +
        '<input class="chip-qty" type="number" min="1" inputmode="numeric" placeholder="数量" style="display:' + (sel ? 'inline-block' : 'none') + '" value="' + (sel ? sel.qty : '') + '">' +
      '</div>';
    }).join('') + '</div>';
    box.querySelectorAll('.chip').forEach(function (el) {
      var pid = el.getAttribute('data-id');
      el.addEventListener('click', function (e) {
        if (curBatch.selected[pid]) {
          delete curBatch.selected[pid];
          el.classList.remove('sel');
          el.querySelector('.chip-qty').style.display = 'none';
        } else {
          curBatch.selected[pid] = { part: list.filter(function (r) { return r.id === pid; })[0], qty: 0 };
          el.classList.add('sel');
          var inp = el.querySelector('.chip-qty');
          inp.style.display = 'inline-block';
          inp.focus();
        }
        e.stopPropagation();
      });
      var inp = el.querySelector('.chip-qty');
      inp.addEventListener('click', function (e) { e.stopPropagation(); });
      inp.addEventListener('input', function (e) {
        var v = parseInt(e.target.value, 10);
        if (curBatch.selected[pid]) curBatch.selected[pid].qty = (isNaN(v) ? 0 : v);
      });
    });
  }

  function submitBatch() {
    var rows = [];
    Object.keys(curBatch.selected).forEach(function (pid) {
      var s = curBatch.selected[pid];
      if (s.qty > 0) rows.push({
        worker_id: App.session.user.id,
        product_id: curBatch.product.id,
        part_id: s.part.id,
        process: s.part.part_name,
        shift: curBatch.shift,
        qty: s.qty,
        record_date: Db._today()
      });
    });
    if (!curBatch.shift) { UI.toast('请选择班次', true); return; }
    if (rows.length === 0) { UI.toast('请至少填写一道工序的数量', true); return; }
    UI.toast('提交中…');
    Db.insertRecordsBatch(rows).then(function () {
      UI.toast('已提交 ' + rows.length + ' 条 ✓');
      curBatch._close();
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
      var d = new Date();
      var wd = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
      var n = rows ? rows.length : 0;
      view.innerHTML =
        '<div class="emp-hero">' +
          '<div class="eh-date">' + today + ' · ' + wd + '</div>' +
          '<div class="eh-greet">👋 今天辛苦了</div>' +
          '<div class="eh-stats">' +
            '<div class="eh-stat"><div class="eh-num">' + n + '</div><div class="eh-lbl">已报工序</div></div>' +
            '<div class="eh-div"></div>' +
            '<div class="eh-stat"><div class="eh-num">' + total + '</div><div class="eh-lbl">总件数</div></div>' +
          '</div>' +
        '</div>' +
        '<button class="btn" id="goAdd">＋ 新增上报</button>' +
        '<button class="btn secondary" id="goBatch">📋 批量填报</button>' +
        '<div class="card emp-tips">' +
          '<div class="et-ico">💡</div>' +
          '<div class="et-body"><b>怎么用</b><p class="muted">选产品 → 选工序 → 填数量 → 提交。工序由管理员预置，无需手输，避免写错。</p></div>' +
        '</div>';
      document.getElementById('goAdd').addEventListener('click', openAdd);
      document.getElementById('goBatch').addEventListener('click', openBatchAdd);
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
        var time = fmtTime(r.submitted_at);
        return '<div class="rec-item" data-id="' + r.id + '">' +
          '<div class="rec-ico">📦</div>' +
          '<div class="rec-body"><div class="rec-title">' + esc(pno) + ' · ' + esc(pn) + '</div>' +
          '<div class="rec-sub">' + esc(pname) + '　' + time + (r.shift ? '　<span class="shift-tag">' + esc(r.shift) + '</span>' : '') + '</div></div>' +
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
      UI.toast('删除中…');
      Db.deleteRecord(id).then(function (res) {
        // count = 服务端实际删除的行数；RLS 拦截时可能为 0（如记录不是今天的）
        var n = (res && res.count != null) ? res.count : 0;
        if (n === 0) {
          UI.toast('未删除：该记录可能不是今天的，或已被删除', true);
        } else {
          UI.toast('已删除 1 条');
        }
        // 以真库为准重刷：今日列表 + 首页（记录 tab）的"已报工序"计数，避免陈旧视图
        renderToday();
        render('record');
      }).catch(function (e) { UI.toast('删除失败：' + (e.message || e), true); });
    });
  }

  function doEdit(rec) {
    UI.sheet('修改上报',
      '<div class="field"><label>数量（原 ' + rec.qty + ' 件）</label><input id="eqty" type="number" min="1" inputmode="numeric" value="' + rec.qty + '"></div>' +
      '<div class="field"><label>班次</label><div class="shift-pick" id="eshiftPick">' +
        '<div class="shift-chip" data-shift="白班">☀️ 白班</div>' +
        '<div class="shift-chip" data-shift="中班">🌙 中班</div>' +
        '<div class="shift-chip" data-shift="夜班">🌃 夜班</div>' +
      '</div></div>' +
      '<button class="btn" id="esave">保存</button>', function (body, close) {
        var editShift = rec.shift || guessShift();
        function selectShift(val) {
          editShift = val;
          body.querySelectorAll('#eshiftPick .shift-chip').forEach(function (c) { c.classList.toggle('on', c.getAttribute('data-shift') === val); });
        }
        body.querySelectorAll('#eshiftPick .shift-chip').forEach(function (c) {
          c.addEventListener('click', function () { selectShift(c.getAttribute('data-shift')); });
        });
        selectShift(editShift);
        body.querySelector('#esave').addEventListener('click', function () {
          var q = parseInt(body.querySelector('#eqty').value, 10);
          if (!q || q <= 0) { UI.toast('请输入正确数量', true); return; }
          Db.updateRecord(rec.id, { qty: q, shift: editShift }).then(function () { UI.toast('已保存'); close(); renderToday(); }).catch(function (e) { UI.toast('保存失败：' + (e.message || e), true); });
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
    var acc = (App.profile.email || '').split('@')[0];
    view.innerHTML =
      '<div class="emp-profile">' +
        '<div class="ep-avatar">' + esc(acc) + '</div>' +
        '<div class="ep-info">' +
          '<div class="ep-name">工号 ' + esc(acc) + '</div>' +
          '<div class="ep-sub">' + esc(App.profile.email) + '</div>' +
          '<div class="ep-role">' + (App.profile.role === 'admin' ? '管理员' : '员工') + '</div>' +
        '</div>' +
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
