-- ============================================================
-- 车间产量统计 · CloudBase PostgreSQL 版 schema
-- 基于 Supabase 00_schema.sql 改造，差异点：
--   ① CloudBase auth.users 是 bigint + 不同列，业务表不 REFERENCES auth.users；
--      用户标识用 varchar(64) 存 CloudBase Auth 的 UID(sub)，RLS 用 auth.uid() (text) 比较。
--   ② 建号（原 admin_create_user 直插 auth.users）改为云函数调 Auth Admin，见 supabase/functions/create-user。
--   ③ 原 handle_new_user 触发器改为云函数创建用户时同步写 profiles。
--   ④ 已删除 pgcrypto 依赖（不再用 crypt 哈希密码）。
-- 执行：用 CloudBase MCP managePgDatabase(action=execute, allowDdlViaExecute=true, confirm=true)
-- ============================================================

-- 1) 用户档案（扩展 CloudBase Auth 用户）
create table if not exists public.profiles (
  id varchar(64) primary key,           -- CloudBase Auth 用户 UID(sub)，匹配 auth.uid() 返回的 text
  email text,
  display_name text,
  role text not null default 'worker' check (role in ('admin','leader','worker')),
  disabled boolean not null default false,
  created_at timestamptz not null default now()
);

-- 2) 产品主数据
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,            -- 产品编号，如 BED-001
  name text not null,                   -- 产品名，如 单人充气床
  enabled boolean not null default true,
  created_by varchar(64) references public.profiles(id),
  created_at timestamptz not null default now()
);

-- 3) 工序主数据（产品 → 多道工序：工序号 + 工序名）
create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  process text,                         -- 工序（冗余/备用，允许为空；填报时默认=工序名）
  part_no text not null,                -- 工序号，如 10 / 20 / 144J
  part_name text not null,              -- 工序名，如 钻轴孔 / 调质
  enabled boolean not null default true,
  unique (product_id, part_no)          -- 同一产品内工序号不重复
);

-- 4) 产量记录
create table if not exists public.production_records (
  id uuid primary key default gen_random_uuid(),
  worker_id varchar(64) not null references public.profiles(id) on delete cascade,
  product_id uuid not null references public.products(id),
  part_id uuid not null references public.parts(id),
  process text,                         -- 冗余存储工序名，允许为空
  shift text,                           -- 班次：白班 / 中班 / 夜班；历史数据可能为 NULL
  qty int not null check (qty > 0),
  record_date date not null default current_date,  -- 业务日期（哪天做的）
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 5) 当日计划产量（用于进度百分比，可选；第二阶段用）
create table if not exists public.daily_plans (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id),
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
-- 汇总报表专用覆盖索引：过滤+分组+聚合列一次走 Index Only Scan，避免回表（含 shift 班次维度）
create index if not exists idx_rec_report on public.production_records (record_date, product_id, part_id, worker_id, shift) include (qty, process);

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

-- 管理/班组长判定：admin 或 leader（班组长可查看+导出报表，但不能管理主数据/账号）
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role in ('admin','leader') and not disabled);
$$;

-- profiles：本人可读自己；admin 读全部、可改
create policy p_profiles_self on public.profiles for select using (id = auth.uid() or public.is_staff());
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
-- 服务端聚合报表（替代"前端拉全量明细再 JS 求和"）
-- 仅管理员/班组长可调用；SECURITY DEFINER 绕过 RLS 直接汇总，由 is_staff() 守门。
-- 前端调用： Db.reportSummary({from, to, product_id, worker_id})
-- ============================================================
drop function if exists public.report_summary(date, date, uuid, uuid);
create or replace function public.report_summary(
  f_from date default null,
  f_to date default null,
  f_product uuid default null,
  f_worker varchar(64) default null
) returns table (
  record_date date,
  product_id uuid,
  part_id uuid,
  worker_id varchar(64),
  shift text,
  total_qty bigint
) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;
  return query
  select r.record_date, r.product_id, r.part_id, r.worker_id, r.shift, sum(r.qty) as total_qty
  from public.production_records r
  where (f_from is null or r.record_date >= f_from)
    and (f_to is null or r.record_date <= f_to)
    and (f_product is null or r.product_id = f_product)
    and (f_worker is null or r.worker_id = f_worker)
  group by r.record_date, r.product_id, r.part_id, r.worker_id, r.shift
  order by r.record_date desc, r.product_id, r.part_id, r.worker_id, r.shift;
end; $$;

-- ============================================================
-- 服务端月度矩阵报表：行=产品×工序×员工，列=1日~31日×白/中/夜+合计
-- 返回 cells 为长度 93 的 bigint[]，index=(日-1)*3+班次(0白班/1中班/2夜班)
-- ============================================================
drop function if exists public.report_monthly_matrix(int, int, uuid);
drop function if exists public.report_monthly_matrix(int, int, uuid, uuid);
create or replace function public.report_monthly_matrix(
  f_year int,
  f_month int,
  f_product uuid default null,
  f_worker varchar(64) default null
) returns table (
  product_code   text,
  product_name   text,
  part_no        text,
  part_name      text,
  worker_account text,
  cells          bigint[],
  total_qty      bigint
) language plpgsql security definer set search_path = public as $$
declare
  v_first date := make_date(f_year, f_month, 1);
  v_next  date := (v_first + interval '1 month')::date;
begin
  if not public.is_staff() then raise exception 'forbidden'; end if;

  return query
  with agg as (
    select
      r.product_id as a_pid,
      r.part_id    as a_ptid,
      r.worker_id  as a_wid,
      ((extract(day from r.record_date)::int) - 1) * 3
        + case r.shift when '白班' then 0 when '中班' then 1 when '夜班' then 2 end as a_slot,
      sum(r.qty) as a_qty
    from public.production_records r
    where r.record_date >= v_first
      and r.record_date < v_next
      and (f_product is null or r.product_id = f_product)
      and (f_worker is null or r.worker_id = f_worker)
      and r.shift in ('白班', '中班', '夜班')
    group by r.product_id, r.part_id, r.worker_id, a_slot
  ),
  line_keys as (
    select distinct a_pid, a_ptid, a_wid from agg
  ),
  full_cells as (
    select
      k.a_pid, k.a_ptid, k.a_wid,
      sum(coalesce(a.a_qty, 0))::bigint as fc_total,
      array_agg(coalesce(a.a_qty, 0) order by s.slot)::bigint[] as fc_cells
    from line_keys k
    cross join generate_series(0, 92) as s(slot)
    left join agg a on a.a_pid  = k.a_pid
                   and a.a_ptid = k.a_ptid
                   and a.a_wid  = k.a_wid
                   and a.a_slot = s.slot
    group by k.a_pid, k.a_ptid, k.a_wid
  )
  select
    p.code::text,
    p.name::text,
    pr.part_no::text,
    pr.part_name::text,
    split_part(pro.email, '@', 1)::text,
    fc.fc_cells,
    fc.fc_total
  from full_cells fc
  join public.products p   on p.id  = fc.a_pid
  join public.parts   pr   on pr.id = fc.a_ptid
  join public.profiles pro on pro.id = fc.a_wid
  order by p.code, pr.part_no, pro.email;
end; $$;

-- ============================================================
-- 显式授权（关键：建项目时若未自动 expose，需手动 GRANT，否则 RLS 策略会 403）
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
grant execute on function public.report_summary(date,date,uuid,varchar) to authenticated;
grant execute on function public.report_monthly_matrix(int,int,uuid,varchar) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_staff() to authenticated;
