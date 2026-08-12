// 员工/班组长创建函数 —— 走官方 Auth Admin API（与 Dashboard「Add user」同一后端）
// 根治「SQL 直插 auth.users 导致登录报 Database error querying schema」的问题。
//
// 部署后需在函数 Secrets 里设置 SERVICE_ROLE_KEY（service_role 密钥，切勿泄露到前端）。
// SUPABASE_URL / SUPABASE_ANON_KEY 通常由 Supabase 自动注入，若没有请手动补为 secret。
//
// 安全模型：前端只传自己的登录 JWT；本函数校验调用者为 admin，再用 service_role 建号。
// service_role 仅在服务端（本函数环境）使用，绝不会下发到浏览器。

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getJson(url: string, headers: Record<string, string>): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(url, { headers });
  let data: any = null;
  try { data = await res.json(); } catch { /* no body */ }
  return { ok: res.ok, status: res.status, data };
}

Deno.serve(async (req: Request) => {
  // CORS 预检
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const SUPABASE_URL = (Deno.env.get('SUPABASE_URL') || '').replace(/\/$/, '');
    const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') || '';
    const SERVICE_ROLE_KEY = Deno.env.get('SERVICE_ROLE_KEY') || '';
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
      return json({ error: '服务端未配置 SUPABASE_URL / SERVICE_ROLE_KEY' }, 500);
    }

    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return json({ error: '缺少 Authorization（请先登录）' }, 401);

    // 1) 校验调用者登录态，取回其用户 id
    const who = await getJson(`${SUPABASE_URL}/auth/v1/user`, {
      Authorization: authHeader,
      apikey: ANON_KEY,
    });
    if (!who.ok || !who.data || !who.data.id) {
      return json({ error: '登录态无效，请重新登录' }, 401);
    }
    const callerId = who.data.id as string;

    // 2) 校验调用者为 admin（读自己的 profile.role，RLS 允许本人读）
    const prof = await getJson(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${callerId}`, {
      Authorization: authHeader,
      apikey: ANON_KEY,
    });
    const callerRole = prof.data && prof.data[0] && prof.data[0].role;
    if (callerRole !== 'admin') {
      return json({ error: '无权限：仅管理员可创建账号' }, 403);
    }

    // 3) 解析入参
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    const displayName = body.display_name ? String(body.display_name) : null;
    const userRole = body.role === 'leader' ? 'leader' : 'worker';

    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      return json({ error: '邮箱格式不正确' }, 400);
    }
    if (password.length < 6) {
      return json({ error: '密码至少 6 位' }, 400);
    }

    // 4) 用 service_role 调官方 Auth Admin API 建号
    const createRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
      },
      body: JSON.stringify({
        email,
        password,
        email_confirm: true, // 跳过邮件确认，员工可直接用初始密码登录
        user_metadata: { display_name: displayName, role: userRole },
      }),
    });
    const createData = await createRes.json().catch(() => null);
    if (!createRes.ok || !createData || !createData.id) {
      const msg = (createData && (createData.msg || createData.message)) || '创建失败';
      // 邮箱已存在等场景：把后端消息透传给前端
      return json({ error: msg }, createRes.status || 400);
    }

    // 5) 兜底修正角色（触发器若未读 metadata，则这里用 service_role 强制写对）
    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${createData.id}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
        apikey: SERVICE_ROLE_KEY,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ role: userRole }),
    });
    if (!patchRes.ok) {
      // 角色兜底失败：账号已建但角色可能不对，提示管理员重试
      return json({ error: '账号已创建，但角色设置失败，请在「员工」列表确认/修正' }, 500);
    }

    return json({ data: { id: createData.id, email: createData.email, role: userRole } }, 200);
  } catch (e) {
    const msg = e && (e as any).message ? (e as any).message : String(e);
    return json({ error: msg }, 500);
  }
});
