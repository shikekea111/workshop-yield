// 员工/班组长创建云函数（CloudBase 版，支持批量）
// 职责：用管理端 SDK（manager.user.createUser）建 auth 用户，返回 UID。
// profiles 档案行由独立的特权步骤写入（ExecutePGSql / superuser，绕过 RLS），
// 因为 CloudBase 的 profiles 表在 RLS 下无 INSERT 策略，且 node-sdk 无 PG 接口、
// 数据网关 REST 也不接受 manageAppAuth 创建的"用户登录用 api_key"。
// → 阶段二批量建号由批量脚本串联：本函数建 auth 用户 + ExecutePGSql 写 profiles。
//
// 批量模式：入参 { bootstrap_token, users:[{username,password,display_name,role}] }
// 单用户模式（兼容）：入参 { bootstrap_token, username, password, display_name, role }
//
// 关键坑（已踩平）：
//   - @cloudbase/node-sdk v2 没有 PG(rdb) 接口，只有 NoSQL 的 app.database()。
//   - @cloudbase/manager-node v5 的初始化是模块直接 init：require('@cloudbase/manager-node').init({envId})，
//     没有 CloudBase 这个命名导出。
//   - 若后续拿到可用 service_role 网关 key，可填入 SERVICE_ROLE_KEY 让本函数自动写 profiles。
//
// 安全模型：
//   - 普通调用：前端 app.callFunction({ name:'create-user', data:{...} }) 触发，
//     函数通过 app.auth().getUserInfo() 拿调用者 uid，用 service_role key 查 profiles.role 校验 admin。
//   - 首次建 admin（尚无 admin 时）：带 bootstrap_token === 函数环境变量 BOOTSTRAP_TOKEN 即可跳过 admin 校验。
//   - 建号凭据：manager SDK 优先用环境变量 SECRET_ID/SECRET_KEY；未配置时退回 mgrMod.init({ envId })
//     （云函数内置环境身份，通常具备用户管理权限）。

const tcb = require('@cloudbase/node-sdk');
const mgrMod = require('@cloudbase/manager-node');

exports.main = async (event, context) => {
  try {
    const envId = process.env.TCB_ENV || 'workshop-yield-d3gstiur173833671';
    const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'factory.local';
    const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || '';
    const BOOTSTRAP = process.env.BOOTSTRAP_TOKEN || '';
    const GATEWAY = `https://${envId}.api.tcloudbasegateway.com`;

    let body = event;
    if (typeof event === 'string') { try { body = JSON.parse(event); } catch (e) { body = {}; } }
    else if (event && event.body && typeof event.body === 'string') { try { body = JSON.parse(event.body); } catch (e) { body = {}; } }
    body = body || {};

    // 1) 取调用者身份（云函数被已登录用户 callFunction 时，SDK 会带上 JWT 上下文）
    let callerUid = null;
    try {
      const ci = tcb.init({ env: envId }).auth().getUserInfo();
      callerUid = ci && ci.uid;
    } catch (e) { callerUid = null; }

    // 2) 校验调用者为 admin（service_role key 绕过 RLS 读 profiles；无 key 时仅 bootstrap 可建首个 admin）
    let callerRole = null;
    const bootstrapOk = !!(BOOTSTRAP && body.bootstrap_token === BOOTSTRAP);
    if (callerUid && SERVICE_ROLE_KEY) {
      try {
        const r = await fetch(`${GATEWAY}/v1/rdb/rest/profiles?select=role&id=eq.${encodeURIComponent(callerUid)}`, {
          headers: { Authorization: `Bearer ${SERVICE_ROLE_KEY}` }
        });
        const rows = await r.json();
        callerRole = rows && rows[0] && rows[0].role;
      } catch (e) { callerRole = null; }
    }
    if (callerRole !== 'admin' && !bootstrapOk) {
      return { error: '无权限：仅管理员可创建账号（或首次建 admin 需带正确的 bootstrap_token）' };
    }

    // 3) 解析用户列表（批量优先，兼容单用户）
    let users = [];
    if (Array.isArray(body.users) && body.users.length) {
      users = body.users.map(u => ({
        username: String(u.username || '').trim(),
        password: String(u.password || ''),
        display_name: u.display_name ? String(u.display_name) : null,
        role: u.role === 'leader' ? 'leader' : 'worker'
      }));
    } else {
      const username = String(body.username || '').trim();
      const password = String(body.password || '');
      const displayName = body.display_name ? String(body.display_name) : null;
      const role = body.role === 'leader' ? 'leader' : 'worker';
      if (username) users.push({ username, password, display_name: displayName, role });
    }
    if (!users.length) return { error: '无有效用户数据' };

    // 4) 入参校验（密码下限放宽到 6 位：工号本身 6 位纯数字，由 CloudBase 决定最终是否接受）
    for (const u of users) {
      if (!u.username || !/^[A-Za-z0-9._-]{1,64}$/.test(u.username)) {
        u.error = '用户名格式不正确（应为工号，允许字母/数字/._-）';
      }
      if (!u.password || u.password.length < 6) {
        u.error = u.error || '密码至少 6 位';
      }
    }

    // 5) 用管理端 SDK 建号
    const secretId = process.env.SECRET_ID;
    const secretKey = process.env.SECRET_KEY;
    const mgr = (secretId && secretKey)
      ? mgrMod.init({ secretId, secretKey, envId })
      : mgrMod.init({ envId });

    const results = [];
    for (const u of users) {
      if (u.error) { results.push({ username: u.username, ok: false, error: u.error }); continue; }
      const email = u.username + '@' + EMAIL_DOMAIN;
      try {
        const createRes = await mgr.user.createUser({
          name: u.username,
          password: u.password,
          type: 'internalUser',
          nickName: u.display_name || u.username,
          email: email
        });
        const newUid = (createRes && createRes.Data && createRes.Data.Uid)
          || (createRes && createRes.Uid)
          || (createRes && createRes.data && createRes.data.Uid);
        if (!newUid) {
          results.push({ u: u.username, e: '创建失败：未返回用户 UID' });
        } else {
          results.push({ u: u.username, id: newUid });
        }
      } catch (e) {
        const msg = (e && e.message) ? e.message : String(e);
        results.push({ u: u.username, e: msg });
      }
    }

    const okCount = results.filter(r => r.ok).length;
    return { data: { total: users.length, ok: okCount, results } };
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    return { error: msg };
  }
};
