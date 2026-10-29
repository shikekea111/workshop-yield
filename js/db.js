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
      insertRecordsBatch: function (rows) {
        return client.from('production_records').insert(rows).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      updateRecord: function (id, patch) {
        patch.updated_at = new Date().toISOString();
        return client.from('production_records').update(patch).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      // 删除按主键 id；返回完整结果（含 count=实际影响行数），供前端判断删除是否真的生效，
      // 避免 RLS 静默拦掉 0 行时还谎报"已删除"。
      deleteRecord: function (id) {
        return client.from('production_records').delete({ count: 'exact' }).eq('id', id)
          .then(function (r) { if (r.error) throw r.error; return r; });
      },
      listMyRecords: function (date) {
        return sess().then(function (s) {
          return client.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).eq('record_date', date).order('submitted_at', { ascending: false })
            .then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },
      // 按 record_date 区间查本人记录（用于「近 N 天上报」tab，支持夜班次日补报）
      listMyRecordsRange: function (from, to) {
        return sess().then(function (s) {
          return client.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).gte('record_date', from).lte('record_date', to)
            .order('record_date', { ascending: false }).order('submitted_at', { ascending: false })
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
          f_worker: f.worker_id || null,
          f_workshop: f.workshop || null
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      // 月度矩阵报表：一行 = 产品×工序×员工；cells 为长度 93 的数组（31日×3班次）
      monthlyMatrix: function (o) {
        o = o || {};
        return client.rpc('report_monthly_matrix', {
          f_year: o.year,
          f_month: o.month,
          f_product: o.product_id || null,
          f_worker: o.worker_id || null,
          f_workshop: o.workshop || null
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
      // 通过 Supabase Edge Function（create-user）创建账号，走官方 Auth Admin API。
      // 根治旧 admin_create_user 直插 auth 表导致登录报「Database error querying schema」的问题。
      // 调用者必须是 admin（Edge Function 内部校验），前端只传自己的登录 JWT。
      createWorker: function (email, pw, name, role) {
        return sess().then(function (s) {
          if (!s) throw new Error('未登录，请重新登录');
          var base = (cfg.SUPABASE_URL || '').replace(/\/$/, '');
          var url = base + '/functions/v1/create-user';
          return fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.access_token },
            body: JSON.stringify({ email: email, password: pw, display_name: name || null, role: role || 'worker' })
          });
        }).then(function (r) { return r.json(); }).then(function (j) {
          if (j && j.error) throw new Error(j.error);
          return j && j.data;
        });
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

  // ============ CloudBase 实现（腾讯云开发 · 国内） ============
  // 与 SupabaseDb 完全同接口：内部用 app.rdb()（PostgREST 风格）和 app.auth()
  // （Supabase 兼容 auth API）。RLS 由 auth.uid() 服务端按当前登录用户生效，前端零改动。
  function makeCloudBaseDb(app) {
    // 注意：CloudBase js-sdk 中 auth 是方法 app.auth()，调用后才返回 auth 实例；
    // 若写成 app.auth（属性）会拿到函数本身，后续 auth.getSession() 会报"不是函数"并中断整个初始化。
    var auth = (typeof app.auth === 'function') ? app.auth() : app.auth;
    var rdb = app.rdb();

    // 取当前会话（带 user.id），未登录返回 null
    function sess() {
      return auth.getSession().then(function (r) {
        var s = r.data && r.data.session;
        return s || null;
      });
    }

    return {
      backend: 'cloudbase',

      // ---- 登录 ----
      // CloudBase 用 username（=工号）登录；账号里的 @factory.local 仅作展示/报表拆分
      signIn: function (account, pw) {
        var username = String(account || '').split('@')[0];
        return auth.signInWithPassword({ username: username, password: pw }).then(function (r) {
          if (r.error) throw r.error;
          return r.data; // { user, session }
        });
      },
      signOut: function () {
        return auth.signOut().then(function (r) { if (r.error) throw r.error; });
      },
      getSession: function () {
        return auth.getSession().then(function (r) { return (r.data && r.data.session) || null; });
      },
      onAuthChange: function (cb) {
        return auth.onAuthStateChange(function (e, s) { cb(s); });
      },
      updatePassword: function (pw) {
        return auth.updateUser({ password: pw }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },

      // ---- 当前用户档案 ----
      getProfile: function () {
        return sess().then(function (s) {
          if (!s) return null;
          return rdb.from('profiles').select('*').eq('id', s.user.id).limit(1).then(function (r) {
            if (r.error) throw r.error;
            return (r.data && r.data[0]) || null;
          });
        });
      },

      // ---- 主数据（读） ----
      listProducts: function () {
        return rdb.from('products').select('*').eq('enabled', true).order('code').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      listAllProducts: function () {
        return rdb.from('products').select('*').order('code').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },
      listPartsByProduct: function (pid) {
        return rdb.from('parts').select('*').eq('product_id', pid).eq('enabled', true)
          .order('process').order('part_no').then(function (r) {
            if (r.error) throw r.error; return r.data;
          });
      },
      listAllParts: function () {
        return rdb.from('parts').select('*, products(code,name)').order('part_no').then(function (r) {
          if (r.error) throw r.error; return r.data;
        });
      },

      // ---- 主数据（写，仅 admin） ----
      upsertProduct: function (p) {
        return rdb.from('products').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      deleteProduct: function (id) {
        return rdb.from('products').update({ enabled: false }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      upsertPart: function (p) {
        return rdb.from('parts').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      upsertProductsBatch: function (rows) {
        return rdb.from('products').upsert(rows, { onConflict: 'code' }).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      upsertPartsBatch: function (rows) {
        return rdb.from('parts').upsert(rows, { onConflict: 'product_id,part_no' }).select().then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      deletePart: function (id) {
        return rdb.from('parts').update({ enabled: false }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },

      // ---- 产量记录 ----
      insertRecord: function (rec) {
        return rdb.from('production_records').insert(rec).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      insertRecordsBatch: function (rows) {
        return rdb.from('production_records').insert(rows).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      updateRecord: function (id, patch) {
        patch.updated_at = new Date().toISOString();
        return rdb.from('production_records').update(patch).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },
      // 删除按主键 id；返回 { count } 供前端判断（RLS 拦截时为 0）
      deleteRecord: function (id) {
        return rdb.from('production_records').delete({ count: 'exact' }).eq('id', id).then(function (r) {
          if (r.error) throw r.error;
          var n = (r.count != null) ? r.count : ((r.data && r.data.length) || 0);
          return { count: n };
        });
      },
      listMyRecords: function (date) {
        return sess().then(function (s) {
          return rdb.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).eq('record_date', date).order('submitted_at', { ascending: false })
            .then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },
      listMyRecordsRange: function (from, to) {
        return sess().then(function (s) {
          return rdb.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).gte('record_date', from).lte('record_date', to)
            .order('record_date', { ascending: false }).order('submitted_at', { ascending: false })
            .then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },
      listMyHistory: function (from, to) {
        return sess().then(function (s) {
          return rdb.from('production_records').select('*, products(name), parts(part_no,part_name)')
            .eq('worker_id', s.user.id).gte('record_date', from).lte('record_date', to)
            .order('record_date', { ascending: false }).then(function (r) { if (r.error) throw r.error; return r.data; });
        });
      },

      // ---- 汇总 / 管理 ----
      reportSummary: function (f) {
        f = f || {};
        return rdb.rpc('report_summary', {
          f_from: f.from || null,
          f_to: f.to || null,
          f_product: f.product_id || null,
          f_worker: f.worker_id || null
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      monthlyMatrix: function (o) {
        o = o || {};
        return rdb.rpc('report_monthly_matrix', {
          f_year: o.year,
          f_month: o.month,
          f_product: o.product_id || null,
          f_worker: o.worker_id || null
        }).then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      listAllRecords: function (f) {
        f = f || {};
        var q = rdb.from('production_records').select('*, products(name), parts(part_no,part_name), profiles(display_name)');
        if (f.from) q = q.gte('record_date', f.from);
        if (f.to) q = q.lte('record_date', f.to);
        if (f.product_id) q = q.eq('product_id', f.product_id);
        if (f.worker_id) q = q.eq('worker_id', f.worker_id);
        q = q.order('record_date', { ascending: false });
        return q.then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      listWorkers: function () {
        return rdb.from('profiles').select('*').order('display_name').then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      // 通过 CloudBase 云函数 create-user 创建账号（走管理端 Auth Admin，前端只传管理员会话）
      createWorker: function (email, pw, name, role) {
        var username = String(email || '').split('@')[0];
        return app.callFunction({
          name: 'create-user',
          data: { username: username, password: pw, display_name: name || null, role: role || 'worker' }
        }).then(function (r) {
          var res = (r && r.result) || (r && r.data) || {};
          if (res.error) throw new Error(res.error);
          if (r && r.error) throw new Error(r.error);
          return res.data;
        });
      },
      setWorkerDisabled: function (id, dis) {
        return rdb.from('profiles').update({ disabled: dis }).eq('id', id).then(function (r) { if (r.error) throw r.error; });
      },

      // ---- 计划（进度，可选） ----
      listPlans: function (productId, date) {
        var q = rdb.from('daily_plans').select('*');
        if (productId) q = q.eq('product_id', productId);
        if (date) q = q.eq('plan_date', date);
        return q.then(function (r) { if (r.error) throw r.error; return r.data; });
      },
      upsertPlan: function (p) {
        return rdb.from('daily_plans').upsert(p).select().then(function (r) { if (r.error) throw r.error; return r.data; });
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
  } else if (cfg.BACKEND === 'cloudbase') {
    try {
      if (!window.cloudbase) {
        throw new Error('window.cloudbase 未定义：js/vendor/cloudbase.min.js 未加载 / 不是 UMD 全局（检查 index.html 引用与 MIME）。');
      }
      // 兼容不同打包形态：部分 js-sdk bundle 把 API 挂在 window.cloudbase.default 上，
      // 顶层 window.cloudbase.init 反而是 undefined。优先取 .default。
      var cbNs = (window.cloudbase.default) ? window.cloudbase.default : window.cloudbase;
      var tcbApp = cbNs.init({
        env: cfg.CLOUDBASE_ENV,
        region: cfg.CLOUDBASE_REGION || 'ap-shanghai',
        accessKey: cfg.CLOUDBASE_PUBLISHABLE_KEY,
        auth: { detectSessionInUrl: true }
      });
      Db = makeCloudBaseDb(tcbApp);
    } catch (err) {
      // 把真正的初始化错误显形到浮层（不要再被 app.js 的级联报错盖掉）
      var _msg = '[db.js] CloudBase 初始化失败（这就是空白页根因）：\n' + (err && err.stack ? err.stack : String(err));
      if (typeof window.__reportFatal === 'function') {
        window.__reportFatal(_msg, 'db.js init');
      } else {
        console.error(_msg);
      }
      // 兜底 stub：让 app.js 不再抛 "Db is not defined"，避免把上面的真因覆盖
      Db = {
        backend: 'cloudbase',
        _initError: String(err && err.message || err),
        getSession: function () { return Promise.reject(new Error('DB 未初始化：' + (err && err.message))); },
        getProfile: function () { return Promise.reject(new Error('DB 未初始化')); },
        signIn: function () { return Promise.reject(new Error('DB 未初始化，无法登录：' + (err && err.message))); },
        onAuthChange: function () { return function () {}; }
      };
    }
  } else {
    Db = { backend: cfg.BACKEND, _notImplemented: true };
  }

  Db._today = todayStr;
  window.Db = Db;
})();
