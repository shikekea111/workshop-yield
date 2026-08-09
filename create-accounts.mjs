// ============================================================
// 车间账号批量创建（官方 Supabase Auth Admin API）
// ------------------------------------------------------------
// 原理：调用 POST /auth/v1/admin/users —— 与 Dashboard「Add user」按钮
//       完全相同的后端接口，创建的账号 100% 可正常登录。
//       不再直接 INSERT auth.users（那条路 GoTrue 会 500）。
//
// 用法：
//   1. 把 service_role 密钥粘贴到同目录 service_role.txt（仅一行）
//   2. node create-accounts.mjs
//   3. 跑完即可用 1001~1500 / 123456 登录（1003 保留不动）
//
// 安全：service_role 密钥拥有全部数据库权限，已在 .gitignore 排除，
//       跑完建议删除 service_role.txt。
// ============================================================
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---- 配置（按需修改）----
const SUPABASE_URL = 'https://xburtlkxsrrezsuisyfk.supabase.co';
const START  = 1001;
const END    = 1500;
const SKIP   = new Set([1003]);          // 1003 已能正常登录且可能有测试数据，保留不动
const DOMAIN = '@factory.local';
const PASSWORD = '123456';
const DELAY_MS = 150;                    // 每次创建间隔，避免限流
// ------------------------

// 读取 service_role 密钥
let SERVICE_ROLE_KEY;
try {
  SERVICE_ROLE_KEY = readFileSync(join(__dirname, 'service_role.txt'), 'utf8').trim();
} catch {
  console.error('\n✗ 找不到 service_role.txt');
  console.error('  请到 Supabase 控制台 → Settings → API → service_role secret，');
  console.error('  复制后粘贴到本目录的 service_role.txt 文件里，再重跑本脚本。\n');
  process.exit(1);
}
if (!SERVICE_ROLE_KEY || SERVICE_ROLE_KEY.length < 30) {
  console.error('\n✗ service_role.txt 内容不像密钥（太短），请检查是否粘贴完整。\n');
  process.exit(1);
}

const hdr = () => ({
  Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
  apikey: SERVICE_ROLE_KEY,
  'Content-Type': 'application/json'
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchRetry(url, opts, retries = 4) {
  let lastErr;
  for (let a = 1; a <= retries; a++) {
    try {
      const r = await fetch(url, opts);
      // 限流 → 退避重试
      if (r.status === 429) {
        const wait = 800 * a;
        console.log(`  ⏳ 被限流，等待 ${wait}ms 后重试…`);
        await sleep(wait);
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      await sleep(400 * a);
    }
  }
  throw lastErr || new Error('请求失败');
}

// 分页拉取全部已有用户，构建 email(lowercase) -> id 映射
async function listAllUsers() {
  const map = new Map();
  let page = 1;
  const perPage = 100;
  while (true) {
    const url = `${SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const r = await fetchRetry(url, { headers: hdr() });
    if (!r.ok) throw new Error(`列出用户失败 HTTP ${r.status}: ${await r.text()}`);
    const data = await r.json();
    const users = Array.isArray(data) ? data : (data.users || []);
    if (!users.length) break;
    for (const u of users) if (u.email) map.set(u.email.toLowerCase(), u.id);
    if (users.length < perPage) break;
    page++;
    if (page > 200) break; // 安全上限
  }
  return map;
}

async function deleteUser(id) {
  const r = await fetchRetry(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: hdr()
  });
  if (!r.ok && r.status !== 404) throw new Error(`删除失败 HTTP ${r.status}: ${await r.text()}`);
}

async function createUser(email, password, displayName) {
  const r = await fetchRetry(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: hdr(),
    body: JSON.stringify({
      email,
      password,
      email_confirm: true, // 跳过邮箱验证（@factory.local 收不到邮件）
      user_metadata: { display_name: displayName } // 触发器会写入 profiles.display_name
    })
  });
  if (!r.ok) {
    const t = await r.text();
    const e = new Error(`HTTP ${r.status}: ${t}`);
    e.body = t;
    throw e;
  }
  return r.json();
}

async function main() {
  console.log('\n=== 车间账号批量创建（官方 Auth Admin API）===');
  console.log(`范围: ${START}~${END} | 跳过: ${[...SKIP].join(',') || '无'} | 密码: ${PASSWORD}\n`);

  console.log('① 获取已有用户列表（用于清理旧的坏账号）…');
  let existing = new Map();
  try {
    existing = await listAllUsers();
    console.log(`   已有 ${existing.size} 个用户\n`);
  } catch (e) {
    console.log(`   ⚠ 列出用户失败（${e.message}），跳过清理直接创建…\n`);
  }

  console.log('② 逐个删除旧账号 + 重新创建…');
  let created = 0, deleted = 0, skipped = 0, failed = 0;
  const failures = [];

  for (let i = START; i <= END; i++) {
    if (SKIP.has(i)) { skipped++; continue; }
    const email = `${i}${DOMAIN}`;
    const lc = email.toLowerCase();

    // 删除已存在的（清理 SQL 直插留下的坏账号）
    const oldId = existing.get(lc);
    if (oldId) {
      try { await deleteUser(oldId); deleted++; }
      catch (e) { console.error(`   ${i} 删除旧账号失败: ${e.message}`); }
      await sleep(80);
    }

    // 创建（官方 API）
    try {
      await createUser(email, PASSWORD, String(i));
      created++;
      if (created % 25 === 0) console.log(`   进度: ${i} 已创建（累计 ${created}）`);
    } catch (e) {
      failed++;
      failures.push(`${i}: ${e.message}`);
      console.error(`   ${i} 创建失败: ${e.message}`);
    }
    await sleep(DELAY_MS);
  }

  console.log('\n=== 完成 ===');
  console.log(`新建 ${created} | 删除旧 ${deleted} | 跳过 ${skipped} | 失败 ${failed}`);
  if (failures.length) {
    console.log('\n失败明细:');
    failures.forEach((f) => console.log(`  ${f}`));
  }
  console.log(`\n✅ 现在可用账号: ${START}~${END}（除 ${[...SKIP].join(',')}），密码 ${PASSWORD}`);
  console.log('   请用 1004 / ' + PASSWORD + ' 在手机上测试登录。');
  console.log('   验证通过后建议删除 service_role.txt。');
}

main().catch((e) => {
  console.error('\n致命错误:', e.message);
  process.exit(1);
});
