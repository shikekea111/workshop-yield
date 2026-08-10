// 数据访问层 —— 所有页面只调用 window.Db.*，不直接碰 supabase
// 后端切换（如改腾讯云开发）只需在末尾替换 SupabaseDb 实现，页面零改动。
(function () {
  'use strict';
  var cfg = window.APP_CONFIG;

  function todayStr() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  // ============ Supabase 实现 ============
  function makeSupabaseDb(client) {
    function sess() { return client.auth.getSession().then(function (r) { return r.data.session; }); }

    return {
      backend: 'supabase',

      // ---- 登录 ----
      signIn: function (email, pw) {
        return client.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      signOut: function () { return client.auth.signOut().then(function (r) { if (r.error) throw r.error; }); },
      getSession: function () { return client.auth.getSession().then(function (r) { return r.data.session; }); },
      onAuthChange: function (cb) { return client.auth.onAuthStateChange(function (e, s) { cb(s); }); },
      updatePassword: function (pw) {
        return client.auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },

      // ---- 当前用户档案 ----
      getProfile: function () {
        return sess().then(function (s) {
          if (!s) return null;
          return client.from('profiles').select('*').eq('id', s.user.id).single().then(function (r) {
            if (r.error) throw r.error; return r.data;
          });
        });
      },

      // ---- 主数据（读） ----
      listProducts: function () {
        return client.from('products').select('*').eq('enabled', true).order('code').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      listAllProducts: function () {
        return client.from('products').select('*').order('code').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      listPartsByProduct: function (pid) {
        return client.from('parts').select('*').eq('product_id', pid).eq('enabled', true)
          .order('process').order('part_no').then(function (r) {
            if (r.error) throw r.error; return r.data;
          });
      },
      listAllParts: function () {
        return client.from('parts').select('*, products(code,name)').order('part_no').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },

      // ---- 主数据（写，仅 admin） ----
      upsertProduct: function (p) {
        return client.from('products').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      deleteProduct: function (id) {
        return client.from('products').update({ enabled: false }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      upsertPart: function (p) {
        return client.from('parts').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      // 批量主数据写入（按业务键幂等 upsert，重复运行不会重复建）：
      //   产品按 code 去重；工序按 (product_id, part_no) 去重
      upsertProductsBatch: function (rows) {
        return client.from('products').upsert(rows, { onConflict: 'code' }).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      upsertPartsBatch: function (rows) {
        return client.from('parts').upsert(rows, { onConflict: 'product_id,part_no' }).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      deletePart: function (id) {
        return client.from('parts').update({ enabled: false }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },

      // ---- 产量记录 ----
      insertRecord: function (rec) {
        return client.from('production_records').insert(rec).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      updateRecord: function (id, patch) {
        patch.updated_at = new Date().toISOString();
        return client.from('production_records').update(patch).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      deleteRecord: function (id) {
        return client.from('production_records').delete().eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      listMyRecords: function (date) {
        return sess().then(function (s) {
          return client.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).eq('record_date', date).order('submitted_at', { ascending: false })
            .then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },
      listMyHistory: function (from, to) {
        return sess().then(function (s) {
          return client.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).gte('record_date', from).lte('record_date', to)
            .order('record_date', { ascending: false }).then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },

      // ---- 汇总 / 管理 ----
      // 服务端聚合：只返回分组求和后的汇总行（按 日期/产品/工序号/工序名/员工）
      // 大数据量下远比拉全量明细再 JS 求和高效。仅 admin 可调（函数内有 is_admin 守门）
      reportSummary: function (f) {
        f = f || {};
        return client.rpc('report_summary', {
          f_from: f.from || null,
          f_to: f.to || null,
          f_product: f.product_id || null,
          f_worker: f.worker_id || null
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      // 月度矩阵报表：一行 = 产品×工序×员工；cells 为长度 93 的数组（31日×3班次）
      monthlyMatrix: function (o) {
        o = o || {};
        return client.rpc('report_monthly_matrix', {
          f_year: o.year,
          f_month: o.month,
          f_product: o.product_id || null,
          f_worker: o.worker_id || null
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      // 明细查询（保留：如需按记录级导出/审计时使用；报表主链路已改用 reportSummary）
      listAllRecords: function (f) {
        f = f || {};
        var q = client.from('production_records').select('*, products(name), parts(part_no,part_name), profiles(display_name)');
        if (f.from) q = q.gte('record_date', f.from);
        if (f.to) q = q.lte('record_date', f.to);
        if (f.product_id) q = q.eq('product_id', f.product_id);
        if (f.worker_id) q = q.eq('worker_id', f.worker_id);
        q = q.order('record_date', { ascending: false });
        return q.then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      listWorkers: function () {
        return client.from('profiles').select('*').order('display_name').then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      createWorker: function (email, pw, name) {
        return client.rpc('admin_create_user', { p_email: email, p_password: pw, p_name: name, p_role: 'worker' })
          .then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      setWorkerDisabled: function (id, dis) {
        return client.from('profiles').update({ disabled: dis }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },

      // ---- 计划（进度，可选） ----
      listPlans: function (productId, date) {
        var q = client.from('daily_plans').select('*');
        if (productId) q = q.eq('product_id', productId);
        if (date) q = q.eq('plan_date', date);
        return q.then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      upsertPlan: function (p) {
        return client.from('daily_plans').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      }
    };
  }

  // ============ 初始化 ============
  var Db;
  if (cfg.BACKEND === 'supabase') {
    if (!window.supabase) {
      console.error('supabase-js 未加载：请检查 index.html 中的 CDN 引用或本地 vendor 文件');
    }
    var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
    Db = makeSupabaseDb(client);
  } else {
    // TODO: cloudbase 实现（第二阶段）
    Db = { backend: cfg.BACKEND, _notImplemented: true };
  }

  Db._today = todayStr;
  window.Db = Db;
})();
