// 管理端：汇总报表 / 产品工序 / 员工 / 设置
window.Admin = (function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }

  function render(tab) {
    if (tab === 'report') return renderReport();
    if (tab === 'products') return renderProducts();
    if (tab === 'workers') return renderWorkers();
    if (tab === 'me') return renderMe();
  }

  // ---------------- 汇总报表 ----------------
  function renderReport() {
    var view = document.getElementById('view');
    view.innerHTML =
      '<div class="card"><h2>📊 产量汇总</h2>' +
        '<div class="filters">' +
          '<div class="field"><label>从</label><input id="rf" type="date"></div>' +
          '<div class="field"><label>到</label><input id="rt" type="date"></div>' +
          '<div class="field"><label>产品</label><select id="rp"><option value="">全部</option></select></div>' +
          '<div class="field"><label>员工</label><select id="rw"><option value="">全部</option></select></div>' +
        '</div>' +
        '<button class="btn" id="rq">查询汇总</button>' +
        '<button class="btn secondary sm" id="rex" style="margin-top:8px">导出 CSV</button>' +
      '</div>' +
      '<div id="board"></div>' +
      '<div class="tbl-wrap"><table class="tbl" id="rtbl"><thead><tr>' +
        '<th>日期</th><th>产品编号</th><th>产品名</th><th>工序号</th><th>工序名</th><th>员工</th><th>班次</th><th>数量</th>' +
        '</tr></thead><tbody id="rtbody"></tbody><tfoot id="rtfoot"></tfoot></table></div>';

    Db.listAllProducts().then(function (ps) {
      var sel = document.getElementById('rp');
      (ps || []).forEach(function (p) { sel.insertAdjacentHTML('beforeend', '<option value="' + p.id + '">' + esc(p.code) + ' ' + esc(p.name) + '</option>'); });
    });
    Db.listWorkers().then(function (ws) {
      var sel = document.getElementById('rw');
      (ws || []).forEach(function (w) { sel.insertAdjacentHTML('beforeend', '<option value="' + w.id + '">' + esc(String(w.email).split('@')[0]) + '</option>'); });
    });

    document.getElementById('rq').addEventListener('click', runReport);
    document.getElementById('rex').addEventListener('click', exportCsv);
  }

  var lastRows = null;
  var prodMap = {}, partMap = {}, workerMap = {};   // id -> 名称，避免每行回查
  function runReport() {
    var f = {
      from: document.getElementById('rf').value || '2000-01-01',
      to: document.getElementById('rt').value || '2999-12-31',
      product_id: document.getElementById('rp').value || null,
      worker_id: document.getElementById('rw').value || null
    };
    document.getElementById('rtbody').innerHTML = '<tr><td colspan="8" class="center-note">查询中…</td></tr>';
    // 先建名称映射表，再拉服务端聚合结果（仅汇总行，体积极小）
    Promise.all([Db.listAllProducts(), Db.listAllParts(), Db.listWorkers()]).then(function (res) {
      (res[0] || []).forEach(function (p) { prodMap[p.id] = { code: p.code, name: p.name }; });
      (res[1] || []).forEach(function (p) { partMap[p.id] = { no: p.part_no, name: p.part_name, process: p.process }; });
      (res[2] || []).forEach(function (w) { workerMap[w.id] = String(w.email).split('@')[0]; });
      return Db.reportSummary(f);
    }).then(function (rows) {
      lastRows = rows || [];
      renderTable(lastRows);
      renderBoard(lastRows, f);
    }).catch(function (e) {
      document.getElementById('rtbody').innerHTML = '<tr><td colspan="8" class="ocr-error">查询失败：' + esc(e.message || e) + '</td></tr>';
    });
  }

  function renderTable(rows) {
    var tbody = document.getElementById('rtbody');
    var tfoot = document.getElementById('rtfoot');
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="8" class="center-note">该条件无数据</td></tr>'; tfoot.innerHTML = ''; return; }
    var total = 0;
    tbody.innerHTML = rows.map(function (r) {
      total += (r.total_qty || 0);
      var p = prodMap[r.product_id] || {};
      var pt = partMap[r.part_id] || {};
      var wname = workerMap[r.worker_id] || '';
      return '<tr><td>' + r.record_date + '</td><td>' + esc(p.code) + '</td><td>' + esc(p.name) + '</td><td>' + esc(pt.no) + '</td><td>' + esc(pt.name) + '</td><td>' + esc(wname) + '</td><td>' + esc(r.shift || '') + '</td><td>' + r.total_qty + '</td></tr>';
    }).join('');
    tfoot.innerHTML = '<tr><td colspan="7" style="text-align:right">合计</td><td>' + total + ' 件</td></tr>';
  }

  function renderBoard(rows, f) {
    var box = document.getElementById('board');
    if (!rows.length) { box.innerHTML = ''; return; }
    // 各产品已报总量
    var byProd = {};
    rows.forEach(function (r) { byProd[r.product_id] = (byProd[r.product_id] || 0) + (r.total_qty || 0); });
    // 计划（只取该区间，避免拉全量历史计划）
    Db.listPlans(f.from, f.to).then(function (plans) {
      plans = plans || [];
      var html = '<h3 style="margin:4px 2px 8px">区间进度</h3>';
      Object.keys(byProd).forEach(function (pid) {
        var done = byProd[pid];
        var plan = plans.filter(function (p) { return p.product_id === pid; })
          .sort(function (a, b) { return b.plan_date < a.plan_date ? -1 : 1; })[0];
        var pname = (prodMap[pid] || {}).name || '';
        if (plan) {
          var pct = Math.round(done / plan.target_qty * 100);
          var over = pct > 100;
          html += '<div class="board-row"><div class="br-top"><span class="br-name">' + esc(pname) + '</span>' +
            '<span class="br-pct">' + done + ' / ' + plan.target_qty + '（' + pct + '%）</span></div>' +
            '<div class="progress' + (over ? ' over' : '') + '"><span style="width:' + Math.min(pct, 100) + '%"></span></div></div>';
        } else {
          html += '<div class="board-row"><div class="br-top"><span class="br-name">' + esc(pname) + '</span>' +
            '<span class="br-pct">已报 ' + done + ' 件（未设计划）</span></div></div>';
        }
      });
      box.innerHTML = html;
    }).catch(function () { box.innerHTML = ''; });
  }

  function exportCsv() {
    if (!lastRows || !lastRows.length) { UI.toast('请先查询再导出', true); return; }
    var header = ['日期', '产品编号', '产品名', '工序号', '工序名', '员工', '班次', '数量'];
    var lines = [header.join(',')];
    lastRows.forEach(function (r) {
      var p = prodMap[r.product_id] || {};
      var pt = partMap[r.part_id] || {};
      var wname = workerMap[r.worker_id] || '';
      var row = [r.record_date, p.code, p.name, pt.no, pt.name, wname, r.shift || '', r.total_qty];
      lines.push(row.map(function (c) { return '"' + String(c).replace(/"/g, '""') + '"'; }).join(','));
    });
    var total = lastRows.reduce(function (a, r) { return a + (r.total_qty || 0); }, 0);
    lines.push('"合计","","","","","",' + total);
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = '产量汇总_' + (document.getElementById('rf').value || '') + '_' + (document.getElementById('rt').value || '') + '.csv';
    a.click();
    UI.toast('已导出 CSV');
  }

  // ---------------- 产品 / 零件 ----------------
  function renderProducts() {
    var view = document.getElementById('view');
    view.innerHTML =
      '<div class="card"><div class="row-between"><h2>📦 产品</h2><div><button class="btn sm" id="batchP">批量录入</button> <button class="btn sm" id="addP">+ 新增产品</button></div></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>编号</th><th>名称</th><th>状态</th><th>操作</th></tr></thead><tbody id="pbody"></tbody></table></div>' +
      '</div>' +
      '<div class="card"><div class="row-between"><h2>🔩 工序</h2><button class="btn sm" id="addPt">+ 新增工序</button></div>' +
        '<div class="field"><label>选择产品</label>' +
          '<div class="search-box" style="margin-bottom:8px"><div class="si">🔍</div><input type="text" id="pSelSearch" placeholder="输入产品编号或名称搜索，如 13811 或 摇臂" autocomplete="off" /></div>' +
          '<div id="pSelList" class="cand-list" style="display:none; max-height: 260px; overflow-y: auto; margin-bottom: 10px;"></div>' +
          '<select id="pSel" style="display:none;"></select>' +
          '<div id="pSelTag" class="selbox" style="display:none; margin-top:8px"><div class="sb-label">已选产品</div><div class="sb-value" id="pSelTagVal"></div></div>' +
        '</div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>工序号</th><th>工序名</th><th>状态</th><th>操作</th></tr></thead><tbody id="ptbody"></tbody></table></div>' +
      '</div>';

    function loadProducts() {
      Db.listAllProducts().then(function (ps) {
        ps = ps || [];
        var pb = document.getElementById('pbody');
        pb.innerHTML = ps.map(function (p) {
          return '<tr><td>' + esc(p.code) + '</td><td>' + esc(p.name) + '</td><td>' + (p.enabled ? '<span class="badge ok">启用</span>' : '<span class="badge off">停用</span>') + '</td>' +
            '<td><button class="btn sm" data-edit="' + p.id + '">编辑</button> <button class="btn sm danger" data-del="' + p.id + '">' + (p.enabled ? '停用' : '启用') + '</button></td></tr>';
        }).join('');

        // 可搜索产品选择器
        var enabled = ps.filter(function (p) { return p.enabled; });
        var sel = document.getElementById('pSel');
        sel.innerHTML = enabled.map(function (p) { return '<option value="' + p.id + '">' + esc(p.code) + ' ' + esc(p.name) + '</option>'; }).join('');
        sel.onchange = loadParts;

        var search = document.getElementById('pSelSearch');
        var list = document.getElementById('pSelList');
        var tag = document.getElementById('pSelTag');
        var tagVal = document.getElementById('pSelTagVal');
        var activeIndex = -1;

        function productText(p) { return esc(p.code) + ' ' + esc(p.name); }
        function selectProduct(p) {
          sel.value = p.id;
          search.value = productText(p);
          if (tag) { tag.style.display = 'block'; tagVal.textContent = productText(p); }
          if (list) list.style.display = 'none';
          activeIndex = -1;
          loadParts();
        }
        function renderList(items) {
          if (!items.length) { list.innerHTML = '<div class="cand-item" style="color:var(--text-soft)">无匹配产品</div>'; list.style.display = 'block'; activeIndex = -1; return; }
          list.innerHTML = items.map(function (p, i) {
            return '<div class="cand-item psel-item" data-index="' + i + '" data-id="' + p.id + '"><div class="cand-main"><div class="cand-name">' + esc(p.code) + '</div><div class="cand-sub">' + esc(p.name) + '</div></div></div>';
          }).join('');
          list.style.display = 'block';
          activeIndex = -1;
          list.querySelectorAll('.psel-item').forEach(function (el) {
            el.onclick = function () {
              var id = el.getAttribute('data-id');
              var p = enabled.find(function (x) { return x.id === id; });
              if (p) selectProduct(p);
            };
          });
        }
        function filterAndShow(q) {
          q = q.trim().toLowerCase();
          if (!q) { list.style.display = 'none'; return; }
          renderList(enabled.filter(function (p) {
            return (p.code || '').toLowerCase().indexOf(q) !== -1 || (p.name || '').toLowerCase().indexOf(q) !== -1;
          }));
        }
        function updateActive(dir) {
          var items = list.querySelectorAll('.psel-item');
          if (!items.length) return;
          activeIndex = Math.max(0, Math.min(items.length - 1, activeIndex + dir));
          items.forEach(function (el, i) { el.style.background = i === activeIndex ? 'var(--primary-light)' : '#fff'; });
          items[activeIndex].scrollIntoView({ block: 'nearest' });
        }

        search.addEventListener('input', function () { filterAndShow(search.value); });
        search.addEventListener('focus', function () { if (search.value.trim()) filterAndShow(search.value); });
        search.addEventListener('keydown', function (e) {
          if (e.key === 'ArrowDown') { e.preventDefault(); updateActive(1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); updateActive(-1); }
          else if (e.key === 'Enter') {
            e.preventDefault();
            var items = list.querySelectorAll('.psel-item');
            if (activeIndex >= 0 && items[activeIndex]) items[activeIndex].click();
            else {
              var q = search.value.trim().toLowerCase();
              var first = enabled.find(function (p) { return (p.code || '').toLowerCase().indexOf(q) !== -1 || (p.name || '').toLowerCase().indexOf(q) !== -1; });
              if (first) selectProduct(first);
            }
          } else if (e.key === 'Escape') { list.style.display = 'none'; activeIndex = -1; }
        });
        document.addEventListener('click', function (e) { if (!e.target.closest('#pSelSearch') && !e.target.closest('#pSelList')) { list.style.display = 'none'; activeIndex = -1; } });

        // 默认选中第一个启用产品
        if (enabled.length) { selectProduct(enabled[0]); }
        else { loadParts(); }

        pb.querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editProduct(ps.filter(function (x) { return x.id === b.getAttribute('data-edit'); })[0]); }; });
        pb.querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { toggleProduct(b.getAttribute('data-del')); }; });
      });
    }
    function loadParts() {
      var pid = document.getElementById('pSel').value;
      if (!pid) { document.getElementById('ptbody').innerHTML = ''; return; }
      Db.listAllParts().then(function (all) {
        var rows = (all || []).filter(function (x) { return x.product_id === pid; });
        document.getElementById('ptbody').innerHTML = rows.map(function (p) {
          return '<tr><td>' + esc(p.part_no) + '</td><td>' + esc(p.part_name) + '</td><td>' + (p.enabled ? '<span class="badge ok">启用</span>' : '<span class="badge off">停用</span>') + '</td>' +
            '<td><button class="btn sm" data-edit="' + p.id + '">编辑</button> <button class="btn sm danger" data-del="' + p.id + '">' + (p.enabled ? '停用' : '启用') + '</button></td></tr>';
        }).join('') || '<tr><td colspan="4" class="center-note">该产品暂无工序</td></tr>';
        document.getElementById('ptbody').querySelectorAll('[data-edit]').forEach(function (b) { b.onclick = function () { editPart(rows.filter(function (x) { return x.id === b.getAttribute('data-edit'); })[0]); }; });
        document.getElementById('ptbody').querySelectorAll('[data-del]').forEach(function (b) { b.onclick = function () { togglePart(b.getAttribute('data-del')); }; });
      });
    }

    document.getElementById('addP').onclick = editProduct;
    document.getElementById('batchP').onclick = openBatchImportProducts;
    document.getElementById('addPt').onclick = function () {
      var pid = document.getElementById('pSel').value;
      if (!pid) { UI.toast('请先在上方选择产品', true); return; }
      editPart(null, pid);
    };
    loadProducts();
  }

  function editProduct(p) {
    p = p || {};
    UI.modal('产品', '<div class="field"><label>产品编号</label><input id="pc" value="' + esc(p.code || '') + '" placeholder="如 BED-001"></div><div class="field"><label>产品名称</label><input id="pn" value="' + esc(p.name || '') + '" placeholder="如 单人充气床"></div>', {
      center: true, okText: '保存',
      onOk: function () {
        var code = document.getElementById('pc').value.trim();
        var name = document.getElementById('pn').value.trim();
        if (!code || !name) { UI.toast('请填编号和名称', true); return; }
        Db.upsertProduct({ id: p.id || undefined, code: code, name: name }).then(function () { UI.close(); UI.toast('已保存'); renderProducts(); }).catch(function (e) { UI.toast('保存失败：' + (e.message || e), true); });
      }
    });
  }
  function toggleProduct(id) {
    Db.deleteProduct(id).then(function () { UI.toast('已更新'); renderProducts(); }).catch(function (e) { UI.toast('操作失败：' + (e.message || e), true); });
  }

  function editPart(p, presetPid) {
    p = p || {};
    var pid = p.product_id || presetPid;
    UI.modal('工序', '<div class="field"><label>工序号</label><input id="ppno" value="' + esc(p.part_no || '') + '" placeholder="如 10 / 20 / 144J"></div><div class="field"><label>工序名</label><input id="ppn" value="' + esc(p.part_name || '') + '" placeholder="如 钻轴孔 / 调质"></div>', {
      center: true, okText: '保存',
      onOk: function () {
        var part_no = document.getElementById('ppno').value.trim();
        var part_name = document.getElementById('ppn').value.trim();
        if (!part_no || !part_name) { UI.toast('请填工序号和工序名', true); return; }
        var rec = { id: p.id || undefined, product_id: pid, process: part_name, part_no: part_no, part_name: part_name };
        Db.upsertPart(rec).then(function () { UI.close(); UI.toast('已保存'); renderProducts(); }).catch(function (e) { UI.toast('保存失败：' + (e.message || e), true); });
      }
    });
  }
  function togglePart(id) {
    Db.deletePart(id).then(function () { UI.toast('已更新'); renderProducts(); }).catch(function (e) { UI.toast('操作失败：' + (e.message || e), true); });
  }

  // ---------------- 批量录入产品工序 ----------------
  // 数据格式（每行一条工序，产品信息可重复；从 Excel 复制粘贴即可）：
  //   产品编号, 产品名称, 工序号, 工序名
  //   例：BED-001, 单人充气床, 10, 裁布
  // 支持 TAB / 逗号 / 中文逗号 分隔；含「产品编号/工序号」字样的一行视为表头自动跳过。
  function openBatchImportProducts() {
    var body =
      '<p class="muted" style="margin-top:0">在 Excel 里选中「产品编号、产品名称、工序号、工序名」四列（每个产品的 20~30 道工序各占一行，产品编号/名称可重复），直接 <b>复制粘贴</b> 到下方；或上传 CSV 文件。<br>系统会自动按「产品编号」归集产品、按「产品+工序号」去重，重复运行只更新不会重复建。</p>' +
      '<div class="field"><label>粘贴数据（每行：产品编号, 产品名称, 工序号, 工序名）</label>' +
        '<textarea id="bpTxt" placeholder="BED-001\t单人充气床\t10\t裁布&#10;BED-001\t单人充气床\t20\t缝纫&#10;BED-002\t双人充气床\t10\t裁布"></textarea></div>' +
      '<div class="field"><label>或上传文件（.csv / .txt / .tsv）</label>' +
        '<input id="bpFile" type="file" accept=".csv,.txt,.tsv"></div>' +
      '<button class="btn secondary" id="bpParse">解析预览</button>' +
      '<div id="bpPrev" style="margin-top:12px"></div>' +
      '<button class="btn" id="bpRun" style="margin-top:12px;display:none">开始导入</button>' +
      '<button class="btn ghost" id="bpClose" style="margin-top:10px">关闭</button>';

    UI.modal('批量录入产品工序', body, { center: true, hideActions: true });
    document.getElementById('bpClose').onclick = UI.close;

    var pending = [];

    function parse(text) {
      var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var rows = [];
      lines.forEach(function (line, idx) {
        var parts;
        if (line.indexOf('\t') >= 0) parts = line.split('\t');
        else if (line.indexOf('，') >= 0) parts = line.split('，');
        else if (line.indexOf(',') >= 0) parts = line.split(',');
        else parts = line.split(/\s+/);
        parts = parts.map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
        if (parts.length < 3) return; // 至少要 产品编号 + 工序号 + 工序名
        // 跳过表头
        if (idx === 0 && /产品编号|产品名称|工序号|工序名|编号|名称|part/i.test(parts.join(' '))) return;
        var code, name, partNo, partName;
        if (parts.length >= 4) {
          code = parts[0]; name = parts[1]; partNo = parts[2]; partName = parts[3];
        } else {
          // 只有3列：产品编号, 工序号, 工序名（产品名称默认用编号）
          code = parts[0]; name = ''; partNo = parts[1]; partName = parts[2];
        }
        rows.push({ code: code, name: name || code, part_no: partNo, part_name: partName });
      });
      return rows;
    }

    function renderPreview(rows) {
      var prev = document.getElementById('bpPrev');
      var runBtn = document.getElementById('bpRun');
      if (!rows.length) {
        prev.innerHTML = '<p class="ocr-error">未解析到数据，请检查格式：每行至少「产品编号、工序号、工序名」三列（产品名称可选）。</p>';
        runBtn.style.display = 'none';
        return;
      }
      // 产品去重
      var prodSeen = {}, prodCount = 0;
      rows.forEach(function (r) {
        if (!prodSeen[r.code]) { prodSeen[r.code] = true; prodCount++; }
      });
      // 工序去重
      var partSeen = {}, partCount = 0;
      rows.forEach(function (r) {
        var k = r.code + '|' + r.part_no;
        if (!partSeen[k]) { partSeen[k] = true; partCount++; }
      });
      var html = '<div class="card"><p style="margin:0"><b>解析结果</b>：产品 ' + prodCount + ' 个，工序 ' + partCount + ' 条。</p>' +
        '<p class="muted" style="margin:6px 0 0">前 5 行预览：</p></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>产品编号</th><th>产品名称</th><th>工序号</th><th>工序名</th></tr></thead><tbody>';
      rows.slice(0, 5).forEach(function (r) {
        html += '<tr><td>' + esc(r.code) + '</td><td>' + esc(r.name) + '</td><td>' + esc(r.part_no) + '</td><td>' + esc(r.part_name) + '</td></tr>';
      });
      html += '</tbody></table></div>';
      prev.innerHTML = html;
      runBtn.style.display = 'block';
      runBtn.textContent = '开始导入（产品 ' + prodCount + ' + 工序 ' + partCount + '）';
    }

    document.getElementById('bpFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { document.getElementById('bpTxt').value = fr.result; UI.toast('文件已读取，点「解析预览」'); };
      fr.onerror = function () { UI.toast('读取失败', true); };
      fr.readAsText(f, 'UTF-8');
    });

    document.getElementById('bpParse').addEventListener('click', function () {
      var text = document.getElementById('bpTxt').value;
      if (!text.trim()) { UI.toast('请先粘贴或上传数据', true); return; }
      pending = parse(text);
      renderPreview(pending);
    });

    document.getElementById('bpRun').addEventListener('click', function () {
      if (!pending.length) return;
      var btn = document.getElementById('bpRun');
      btn.disabled = true;
      btn.textContent = '导入中…';

      // 1) 产品去重后批量 upsert（按 code 幂等），取回 code->id 映射
      var prodMap = {};
      pending.forEach(function (r) {
        if (!prodMap[r.code]) prodMap[r.code] = { code: r.code, name: r.name };
        else if (r.name && r.name !== r.code && (prodMap[r.code].name === r.code || !prodMap[r.code].name)) {
          prodMap[r.code].name = r.name; // 取更完整的名称
        }
      });
      var products = Object.keys(prodMap).map(function (k) { return prodMap[k]; });

      Db.upsertProductsBatch(products).then(function (savedProducts) {
        var codeToId = {};
        (savedProducts || []).forEach(function (p) { codeToId[p.code] = p.id; });
        // 2) 工序去重后批量 upsert（按 product_id+part_no 幂等）
        var seen = {}, parts = [];
        pending.forEach(function (r) {
          var pid = codeToId[r.code];
          if (!pid) return;
          var k = r.code + '|' + r.part_no;
          if (seen[k]) return;
          seen[k] = true;
          parts.push({ product_id: pid, part_no: r.part_no, part_name: r.part_name, process: r.part_name });
        });
        return Db.upsertPartsBatch(parts).then(function (savedParts) {
          UI.toast('导入完成：产品 ' + (savedProducts || []).length + ' 个，工序 ' + (savedParts || []).length + ' 条');
          UI.close();
          renderProducts();
        });
      }).catch(function (e) {
        btn.disabled = false;
        UI.toast('导入失败：' + (e.message || e), true);
      });
    });
  }

  // ---------------- 员工 ----------------
  function renderWorkers() {
    var view = document.getElementById('view');
    view.innerHTML =
      '<div class="card"><div class="row-between"><h2>🧑‍🔧 员工账号</h2><div><button class="btn sm" id="batchW">批量录入</button> <button class="btn sm" id="addW">+ 创建员工</button></div></div>' +
        '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>工号</th><th>邮箱</th><th>状态</th><th>操作</th></tr></thead><tbody id="wbody"></tbody></table></div>' +
        '<p class="muted">初始密码由管理员设定，员工首次登录后在「我的」修改。</p>' +
      '</div>';
    Db.listWorkers().then(function (ws) {
      document.getElementById('wbody').innerHTML = (ws || []).map(function (w) {
        return '<tr><td>' + esc(String(w.email).split('@')[0]) + (w.role === 'admin' ? '（管理员）' : '') + '</td><td>' + esc(w.email) + '</td><td>' + (w.disabled ? '<span class="badge off">已禁用</span>' : '<span class="badge ok">正常</span>') + '</td>' +
          '<td><button class="btn sm ' + (w.disabled ? '' : 'danger') + '" data-toggle="' + w.id + '">' + (w.disabled ? '启用' : '禁用') + '</button></td></tr>';
      }).join('') || '<tr><td colspan="4" class="center-note">暂无员工</td></tr>';
      document.getElementById('wbody').querySelectorAll('[data-toggle]').forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute('data-toggle');
          var dis = b.textContent === '禁用';
          Db.setWorkerDisabled(id, dis).then(function () { UI.toast('已更新'); renderWorkers(); }).catch(function (e) { UI.toast('操作失败：' + (e.message || e), true); });
        };
      });
    }).catch(function (e) { view.innerHTML = '<p class="ocr-error">加载失败：' + esc(e.message || e) + '</p>'; });

    document.getElementById('batchW').onclick = openBatchImport;

    document.getElementById('addW').onclick = function () {
      UI.modal('创建员工', '<div class="field"><label>工号/账号前缀（可不填姓名）</label><input id="wn" placeholder="如 1001"></div><div class="field"><label>邮箱（作为账号）</label><input id="we" type="email" placeholder="1001@factory.local"></div><div class="field"><label>初始密码</label><input id="wp" type="password" placeholder="至少6位"></div>', {
        center: true, okText: '创建',
        onOk: function () {
          var name = document.getElementById('wn').value.trim();
          var email = document.getElementById('we').value.trim();
          var pw = document.getElementById('wp').value;
          if (!email || pw.length < 6) { UI.toast('请填邮箱和初始密码（≥6位）', true); return; }
          if (!name) name = String(email).split('@')[0];   // 不绑定姓名时，display_name 默认用账号前缀
          Db.createWorker(email, pw, name).then(function () { UI.close(); UI.toast('员工已创建'); renderWorkers(); })
            .catch(function (e) { UI.toast('创建失败：' + (e.message || e) + '（若提示 forbidden，请确认当前账号为管理员；部分 Supabase 版本需用后台手动建号）', true); });
        }
      });
    };
  }

  // ---------------- 批量录入员工 ----------------
  function openBatchImport() {
    var domain = (window.APP_CONFIG && window.APP_CONFIG.EMAIL_DOMAIN) || 'factory.local';
    var body =
      '<p class="muted" style="margin-top:0">两种方式任选其一：① 在 Excel 里选中「工号」一列（姓名可选，可加第二/三列初始密码），直接 <b>复制粘贴</b> 到下方文本框；② 点「选择文件」上传 CSV/TSV。<br>账号自动生成为 <code>工号@' + esc(domain) + '</code>，员工用此账号登录。表中如含「工号/姓名」表头行会自动跳过。姓名留空时默认用工号显示，应用不再体现姓名。</p>' +
      '<div class="field"><label>粘贴数据（每行：工号, 姓名可选, 密码可选）</label>' +
        '<textarea id="biTxt" placeholder="1001\t张三\t123456&#10;1002\t李四&#10;（也可逗号分隔，密码列可留空）"></textarea></div>' +
      '<div class="field"><label>或上传文件（.csv / .txt / .tsv）</label>' +
        '<input id="biFile" type="file" accept=".csv,.txt,.tsv"></div>' +
      '<div class="field"><label>默认密码（留空＝用「工号」作密码；仅当某行没填密码时生效）</label>' +
        '<input id="biPwd" type="text" placeholder="如 123456"></div>' +
      '<button class="btn secondary" id="biParse">解析预览</button>' +
      '<div id="biPrev" style="margin-top:12px"></div>' +
      '<button class="btn" id="biRun" style="margin-top:12px;display:none">开始导入</button>' +
      '<button class="btn ghost" id="biClose" style="margin-top:10px">关闭</button>';

    UI.modal('批量录入员工', body, { center: true, hideActions: true });
    document.getElementById('biClose').onclick = UI.close;

    var pending = [];
    var existingEmails = {};
    Db.listWorkers().then(function (ws) {
      (ws || []).forEach(function (w) { if (w.email) existingEmails[String(w.email).toLowerCase()] = true; });
    }).catch(function () {});

    function buildEmail(empId) {
      empId = String(empId).trim();
      if (empId.indexOf('@') >= 0) return empId.toLowerCase();
      return empId + '@' + domain;
    }

    function parse(text) {
      var lines = text.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      var rows = [];
      lines.forEach(function (line, idx) {
        var parts;
        if (line.indexOf('\t') >= 0) parts = line.split('\t');
        else if (line.indexOf('，') >= 0) parts = line.split('，');
        else if (line.indexOf(',') >= 0) parts = line.split(',');
        else parts = line.split(/\s+/);
        parts = parts.map(function (p) { return p.trim(); }).filter(function (p) { return p.length > 0; });
        if (parts.length < 1) return;
        if (idx === 0 && /工号|姓名|编号|名称|密码|email|name/i.test(parts[0] + ' ' + (parts[1] || ''))) return; // 跳过表头
        rows.push({ empId: parts[0], name: parts[1], pwd: parts[2] || '' });
      });
      return rows;
    }

    function renderPreview(rows, defaultPwd) {
      var prev = document.getElementById('biPrev');
      var runBtn = document.getElementById('biRun');
      if (!rows.length) {
        prev.innerHTML = '<p class="ocr-error">未解析到数据，请检查格式（每行至少 工号 一列，姓名/密码可选）。</p>';
        runBtn.style.display = 'none';
        return;
      }
      var newCount = 0, existCount = 0;
      var html = '<div class="tbl-wrap"><table class="tbl"><thead><tr><th>工号</th><th>姓名（可选）</th><th>登录账号</th><th>初始密码</th><th>状态</th></tr></thead><tbody>';
      rows.forEach(function (r) {
        var email = buildEmail(r.empId);
        var pwd = r.pwd || defaultPwd || r.empId;
        var exist = !!existingEmails[email];
        if (exist) existCount++; else newCount++;
        html += '<tr><td>' + esc(r.empId) + '</td><td>' + esc(r.name || r.empId) + '</td><td>' + esc(email) + '</td><td>' + esc(pwd) + '</td><td>' +
          (exist ? '<span class="badge off">已存在</span>' : '<span class="badge ok">新建</span>') + '</td></tr>';
      });
      html += '</tbody></table></div>';
      html += '<p class="muted">共 ' + rows.length + ' 人：新建 ' + newCount + '，已存在 ' + existCount + '（已存在者导入时自动跳过，不会改其密码）。</p>';
      prev.innerHTML = html;
      runBtn.style.display = 'block';
      runBtn.textContent = '开始导入 ' + rows.length + ' 人';
    }

    document.getElementById('biFile').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var fr = new FileReader();
      fr.onload = function () { document.getElementById('biTxt').value = fr.result; UI.toast('文件已读取，点「解析预览」'); };
      fr.onerror = function () { UI.toast('读取失败', true); };
      fr.readAsText(f, 'UTF-8');
    });

    document.getElementById('biParse').addEventListener('click', function () {
      var text = document.getElementById('biTxt').value;
      if (!text.trim()) { UI.toast('请先粘贴或上传数据', true); return; }
      pending = parse(text);
      renderPreview(pending, document.getElementById('biPwd').value.trim());
    });

    document.getElementById('biRun').addEventListener('click', function () {
      if (!pending.length) return;
      var defaultPwd = document.getElementById('biPwd').value.trim();
      var btn = document.getElementById('biRun');
      btn.disabled = true;
      var n = pending.length, done = 0, ok = 0, fail = 0;
      btn.textContent = '导入中 0/' + n;
      // 顺序执行，避免并发冲爆 auth.users 写入；失败不中断，继续下一条
      function step(i) {
        if (i >= n) {
          btn.textContent = '导入完成（成功 ' + ok + '，失败 ' + fail + '）';
          UI.toast('导入完成：成功 ' + ok + '，失败 ' + fail);
          if (fail > 0) console.warn('批量录入失败 ' + fail + ' 条，详见控制台');
          renderWorkers();
          return;
        }
        var r = pending[i];
        var email = buildEmail(r.empId);
        var pwd = r.pwd || defaultPwd || r.empId;
        Db.createWorker(email, pwd, r.name).then(function () {
          ok++; done++; btn.textContent = '导入中 ' + done + '/' + n; step(i + 1);
        }).catch(function (e) {
          fail++; done++; btn.textContent = '导入中 ' + done + '/' + n;
          console.error('批量录入失败：' + email, e);
          step(i + 1);
        });
      }
      step(0);
    });
  }

  // ---------------- 设置 ----------------
  function renderMe() {
    var view = document.getElementById('view');
    view.innerHTML =
      '<div class="card"><h2>⚙️ 设置</h2>' +
        '<p class="profile-line">账号：' + esc(App.profile.email) + '</p>' +
        '<p class="profile-line">邮箱：' + esc(App.profile.email) + '</p>' +
        '<a class="btn ghost" href="index.html" style="margin-top:8px;text-decoration:none;display:block">打开员工上报端</a>' +
        '<button class="btn danger" id="logout" style="margin-top:10px">退出登录</button>' +
      '</div>' +
      '<div class="card"><h3>数据说明</h3><p class="muted">所有产量数据存于你自己的 Supabase 项目，可随时在后台导出 CSV 备份。工序主数据由管理员在「产品/工序」中维护，员工只能点选，避免写错。</p></div>';
    document.getElementById('logout').onclick = function () { Db.signOut().then(function () { location.reload(); }).catch(function () { location.reload(); }); };
  }

  return { render: render };
})();
