// 批量建号云函数（内部自动化用）
// 从静态托管拉取用户清单 [{username, display_name}]，逐个创建 CloudBase 内部用户。
// 密码规则：password = username + SUF（默认 "Ab"，即 工号+Ab），满足 CloudBase 强制的
//   长度>=8 且 至少3类字符（数/大/小/特殊）要求。
// 返回 { total, ok, results:[{u,id} 或 {u,e}] }，由调用方收集 UID 后写 profiles。

const mgrMod = require('@cloudbase/manager-node');

exports.main = async (event, context) => {
  try {
    const envId = process.env.TCB_ENV || 'workshop-yield-d3gstiur173833671';
    const EMAIL_DOMAIN = process.env.EMAIL_DOMAIN || 'factory.local';
    const HOSTING_BASE = process.env.HOSTING_BASE || 'https://workshop-yield-d3gstiur173833671-1519501232.tcloudbaseapp.com';

    let body = event;
    if (typeof event === 'string') { try { body = JSON.parse(event); } catch (e) { body = {}; } }
    else if (event && event.body && typeof event.body === 'string') { try { body = JSON.parse(event.body); } catch (e) { body = {}; } }
    body = body || {};

    const listUrl = body.listUrl || (HOSTING_BASE + '/data/bulk_users.json');
    const SUF = body.suffix || 'Ab';
    const skip = Number(body.skip) || 0;
    const take = Number(body.take) || 0;

    const resp = await fetch(listUrl);
    if (!resp.ok) return { error: '拉取用户清单失败: HTTP ' + resp.status };
    let users = await resp.json();
    if (!Array.isArray(users)) return { error: '清单格式错误（应为数组）' };
    if (take > 0) users = users.slice(skip, skip + take);

    const mgr = mgrMod.init({ envId });
    const results = [];
    for (const u of users) {
      const username = String(u.username || '').trim();
      if (!username) { results.push({ u: '', e: '空工号' }); continue; }
      const password = username + SUF;
      const email = username + '@' + EMAIL_DOMAIN;
      try {
        const r = await mgr.user.createUser({
          name: username,
          password: password,
          type: 'internalUser',
          nickName: u.display_name || username,
          email: email
        });
        const uid = (r && r.Data && r.Data.Uid)
          || (r && r.Uid)
          || (r && r.data && r.data.Uid);
        if (!uid) results.push({ u: username, e: 'no uid' });
        else results.push({ u: username, id: uid });
      } catch (e) {
        results.push({ u: username, e: (e && e.message) ? e.message : String(e) });
      }
    }
    const ok = results.filter(r => r.id).length;
    return { total: users.length, ok, results };
  } catch (e) {
    return { error: (e && e.message) ? e.message : String(e) };
  }
};
