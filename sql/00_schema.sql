-- ============================================================
-- 车间产量统计 · 建表 + 索引 + 权限(RLS) + 函数
-- 在 Supabase 控制台 → SQL Editor 全量执行一次
-- ============================================================

-- 启用 pgcrypto（admin_create_user 用 gen_salt/crypt 加密密码必需）
create extension if not exists pgcrypto;

-- 1) 用户档案（扩展 auth.users）；role 区分 admin / worker
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  role text not null default 'worker' check (role in ('admin','worker')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) 产品主数据
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 产品编号，如 BED-001
  name text not null,                   -- 产品名，如 单人充气床
  enabled boolean not null default true,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

-- 3) 工序主数据（产品 → 多道工序：工序号 + 工序名）
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  process text,                         -- 工序（冗余/备用，允许为空；填报时默认=工序名）
  part_no text not null,                -- 工序号，如 10 / 20 / 144J
  part_name text not null,              -- 工序名，如 钻轴孔 / 调质
  enabled boolean not null default true,
  unique (product_id, part_no)          -- 同一产品内工序号不重复
);

-- 4) 产量记录
create table if not exists public.production_records (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references profiles(id) on delete cascade,
  product_id uuid not null references products(id),
  part_id uuid not null references parts(id),
  process text,                         -- 冗余存储工序名，允许为空
  qty int not null check (qty > 0),
  record_date date not null default current_date,  -- 业务日期（哪天做的）
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) 当日计划产量（用于进度百分比，可选；第二阶段用）
create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  plan_date date not null,
  target_qty int not null check (target_qty > 0),
  unique (product_id, plan_date)
);

-- 索引
create index if not exists idx_parts_product on public.parts(product_id) where enabled;
create index if not exists idx_rec_worker on public.production_records(worker_id);
create index if not exists idx_rec_product on public.production_records(product_id);
create index if not exists idx_rec_part on public.production_records(part_id);
create index if not exists idx_rec_date_worker on public.production_records(record_date, worker_id);
-- 汇总报表专用覆盖索引：过滤+分组+聚合列一次走 Index Only Scan，避免回表
create index if not exists idx_rec_report on public.production_records (record_date, product_id, part_id, worker_id) include (qty, process);

-- ============================================================
-- 权限（Row Level Security）
-- ============================================================
alter table public.profiles enable row level security;
alter table public.products enable row level security;
alter table public.parts enable row level security;
alter table public.production_records enable row level security;
alter table public.daily_plans enable row level security;

-- 管理员判定辅助函数
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role='admin' and not disabled);
$$;

-- 新用户注册时自动建 profile（Dashboard 建号 / 任何 signUp 都走这里）
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)), 'worker')
  on conflict (id) do nothing;
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- profiles：本人可读自己；admin 读全部、可改
create policy p_profiles_self on public.profiles for select using (id = auth.uid() or public.is_admin());
create policy p_profiles_admin_w on public.profiles for update using (public.is_admin());

-- products / parts：登录用户可读；仅 admin 可写
create policy p_products_read on public.products for select using (auth.role()='authenticated');
create policy p_products_admin on public.products for all using (public.is_admin()) with check (public.is_admin());
create policy p_parts_read on public.parts for select using (auth.role()='authenticated');
create policy p_parts_admin on public.parts for all using (public.is_admin()) with check (public.is_admin());

-- production_records：员工只能插入自己的；读自己或 admin；改/删仅自己的"当天"
create policy p_rec_insert on public.production_records for insert with check (
  worker_id = auth.uid()
  and not coalesce((select disabled from public.profiles where id = auth.uid()), false)
);
create policy p_rec_select_self on public.production_records for select using (worker_id = auth.uid() or public.is_admin());
-- "当天"以北京时间（Asia/Shanghai）为准，与 App 端 Db._today() 保持一致，避免跨零点提交无法改/删
create policy p_rec_update_self on public.production_records for update
  using (worker_id = auth.uid() and record_date = (timezone('Asia/Shanghai', now()))::date) with check (worker_id = auth.uid());
create policy p_rec_delete_self on public.production_records for delete
  using (worker_id = auth.uid() and record_date = (timezone('Asia/Shanghai', now()))::date);
create policy p_rec_admin on public.production_records for all using (public.is_admin()) with check (public.is_admin());

-- daily_plans：登录可读；仅 admin 可写
create policy p_plans_read on public.daily_plans for select using (auth.role()='authenticated');
create policy p_plans_admin on public.daily_plans for all using (public.is_admin()) with check (public.is_admin());

-- ============================================================
-- 服务端聚合报表：按 日期/产品/工序号/工序名/员工 分组求和，只返回汇总行
-- （替代"前端拉全量明细再 JS 求和"，数据量大时带宽/内存省几个数量级）
-- 仅管理员可调用；SECURITY DEFINER 绕过 RLS 直接汇总，由 is_admin() 守门。
-- 前端调用： Db.reportSummary({from, to, product_id, worker_id})
-- 注意：返回类型变更时需先 DROP 旧函数再 CREATE（PostgreSQL 不允许 REPLACE 改返回类型）
-- ============================================================
drop function if exists public.report_summary(date, date, uuid, uuid);
create or replace function public.report_summary(
  f_from date default null,
  f_to date default null,
  f_product uuid default null,
  f_worker uuid default null
) returns table (
  record_date date,
  product_id uuid,
  part_id uuid,
  worker_id uuid,
  total_qty bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  return query
  select r.record_date, r.product_id, r.part_id, r.worker_id, sum(r.qty) as total_qty
  from public.production_records r
  where (f_from is null or r.record_date >= f_from)
    and (f_to is null or r.record_date <= f_to)
    and (f_product is null or r.product_id = f_product)
    and (f_worker is null or r.worker_id = f_worker)
  group by r.record_date, r.product_id, r.part_id, r.worker_id
  order by r.record_date desc, r.product_id, r.part_id, r.worker_id;
end; $$;

-- ============================================================
-- 管理员在应用内创建员工账号（SECURITY DEFINER，由 is_admin 守门）
-- 前端调用： Db.createWorker(email, password, name)
-- 说明：直接写 auth.users + auth.identities。直接 INSERT 会遗漏：
--   ① instance_id / aud  → GoTrue 查不到用户 → "Invalid login credentials"
--   ② raw_app_meta_data  → GoTrue schema 扫描失败 → "Database error querying schema"
--   ③ 各 token 文本列 NULL → 同上
--   ④ auth.identities 行  → GoTrue 登录查不到 identity → 500
-- 密码用 pgcrypto crypt()+gen_salt('bf',10) 生成 $2a$10$ bcrypt 哈希（与 Supabase 默认一致）。
-- 幂等：邮箱已存在时自愈所有缺失字段 + 补 identities 行，不报错。
-- ============================================================
create or replace function public.admin_create_user(
  p_email text, p_password text, p_name text, p_role text default 'worker'
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
  col text;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;
  new_id := gen_random_uuid();

  -- 1. auth.users：核心字段 + provider 元数据 + bcrypt 10 轮
  insert into auth.users
    (instance_id, id, aud, email, encrypted_password, email_confirmed_at,
     raw_app_meta_data, raw_user_meta_data, role)
  values
    ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', p_email,
     extensions.crypt(p_password, extensions.gen_salt('bf', 10)), now(),
     '{"provider": "email", "providers": ["email"]}'::jsonb,
     jsonb_build_object('display_name', p_name), 'authenticated');

  -- 2. 其余可空文本/token 列 NULL -> ''（动态检测，跳过 phone 避免唯一键冲突）
  for col in
    select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and data_type in ('character varying','text','character','citext')
      and column_name != 'phone'
      and is_nullable = 'YES'
  loop
    execute format('update auth.users set %I = '''' where id = %L and %I is null', col, new_id, col);
  end loop;

  -- 3. auth.identities：GoTrue 登录时必须查到 identity 行，否则 500
  --    注意：email 是 generated column（由 identity_data->>'email' 自动生成），不能 INSERT
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
  values (
    gen_random_uuid(), new_id,
    jsonb_build_object('sub', new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
    'email', new_id::text, now(), now()
  )
  on conflict (provider, provider_id) do nothing;

  -- 4. profiles
  insert into public.profiles (id, email, display_name, role)
  values (new_id, p_email, p_name, p_role)
  on conflict (id) do update set display_name = p_name, role = p_role;
  return new_id;

exception
  when unique_violation then
    select id into new_id from auth.users where email = p_email;
    if new_id is not null then
      update auth.users
        set instance_id = '00000000-0000-0000-0000-000000000000',
            aud = 'authenticated',
            role = coalesce(role, 'authenticated'),
            raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider": "email", "providers": ["email"]}'::jsonb)
        where id = new_id;
      for col in
        select column_name from information_schema.columns
        where table_schema = 'auth' and table_name = 'users'
          and data_type in ('character varying','text','character','citext')
          and column_name != 'phone'
          and is_nullable = 'YES'
      loop
        execute format('update auth.users set %I = '''' where id = %L and %I is null', col, new_id, col);
      end loop;
      insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
      values (
        gen_random_uuid(), new_id,
        jsonb_build_object('sub', new_id::text, 'email', p_email, 'email_verified', true, 'phone_verified', false),
        'email', new_id::text, now(), now()
      )
      on conflict (provider, provider_id) do nothing;
      insert into public.profiles (id, email, display_name, role)
      values (new_id, p_email, p_name, p_role)
      on conflict (id) do update set display_name = p_name, role = p_role;
    end if;
    return new_id;
end; $$;

-- ============================================================
-- 批量录入员工（备选方案：应用内「管理后台 → 员工 → 批量录入」已支持，推荐用 UI）
-- 下面这段 SQL 是兜底：当无法登录管理后台时，可在 SQL Editor 直接跑。
-- 用法：把 emails / names / pwds 三个数组填成你的员工清单（数量需一致），
--       在 Supabase → SQL Editor → New query 粘贴运行即可一次创建全部。
-- 注意：姓名里不要含单引号；密码建议统一初始密码，员工登录后自行修改。
-- 示例（改成你的 200 人数据）：
-- ============================================================
-- do $$
-- declare
--   emails text[] := array['1001@factory.local','1002@factory.local'];
--   names  text[] := array['张三','李四'];
--   pwds   text[] := array['Pwd123456','Pwd123456'];
--   i int;
-- begin
--   for i in 1..array_length(emails,1) loop
--     perform public.admin_create_user(emails[i], pwds[i], names[i]);
--   end loop;
-- end $$;

-- ============================================================
-- 修复已存在的账号（旧函数创建的缺 identities / token / raw_app_meta_data）
-- 旧账号会导致登录报 "Database error querying schema" 或 500。
-- 运行一次即可让旧账号也能正常登录。
-- ============================================================
-- do $$
-- declare rec record; col text;
-- begin
--   -- 1. 核心字段 + raw_app_meta_data
--   update auth.users
--     set instance_id = '00000000-0000-0000-0000-000000000000',
--         aud = 'authenticated',
--         role = coalesce(role, 'authenticated'),
--         raw_app_meta_data = coalesce(raw_app_meta_data, '{"provider": "email", "providers": ["email"]}'::jsonb)
--     where instance_id is null or aud is null or raw_app_meta_data is null;
--
--   -- 2. 文本/token 列 NULL -> ''（跳过 phone）
--   for col in select column_name from information_schema.columns
--     where table_schema='auth' and table_name='users'
--       and data_type in ('character varying','text','character','citext')
--       and column_name != 'phone' and is_nullable = 'YES'
--   loop
--     execute format('update auth.users set %I = '''' where %I is null', col, col);
--   end loop;
--
--   -- 3. 补 auth.identities 行（email 是 generated column，不能 INSERT）
--   for rec in select id, email from auth.users
--     where not exists (select 1 from auth.identities i where i.user_id = auth.users.id)
--   loop
--     insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
--     values (gen_random_uuid(), rec.id,
--       jsonb_build_object('sub', rec.id::text, 'email', rec.email, 'email_verified', true, 'phone_verified', false),
--       'email', rec.id::text, now(), now())
--     on conflict (provider, provider_id) do nothing;
--   end loop;
-- end $$;


-- ============================================================
-- 显式授权（关键修复）
-- 建项目时取消了 "Automatically expose new tables"，Supabase 不会自动给
-- anon/authenticated 角色授权；若只建 RLS 策略而不 GRANT，会报
-- "permission denied for table xxx" / 403。下面手动补齐（幂等，可重跑）。
-- ============================================================
grant usage on schema public to anon, authenticated;
grant select on public.profiles         to anon, authenticated;
grant select on public.products         to anon, authenticated;
grant select on public.parts            to anon, authenticated;
grant select on public.production_records to anon, authenticated;
grant select on public.daily_plans      to anon, authenticated;
grant insert, update, delete on public.products          to authenticated;
grant insert, update, delete on public.parts             to authenticated;
grant insert, update, delete on public.production_records to authenticated;
grant insert, update, delete on public.daily_plans        to authenticated;
grant update                   on public.profiles          to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on function public.report_summary(date,date,uuid,uuid) to authenticated;
grant execute on function public.admin_create_user(text,text,text,text) to authenticated;
grant execute on function public.is_admin() to authenticated;
