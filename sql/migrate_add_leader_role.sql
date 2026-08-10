-- ============================================================
-- 班组长(leader)角色迁移
-- 能力：可查看 + 导出「汇总」「月报」；不能管理产品/工序、不能建账号、不能改他人资料。
-- 在 Supabase → SQL Editor 全量执行一次（幂等，可重跑）
-- 执行后需刷新管理端页面（Ctrl+Shift+R）
-- ============================================================

-- 1) profiles.role 约束加入 'leader'
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'leader', 'worker'));

-- 2) is_staff：admin 或 leader（班组长）
create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role in ('admin', 'leader') and not disabled
  );
$$;

-- 3) 汇总 RPC 改用 is_staff 守门（返回类型未变，先 DROP 旧签名再建）
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

-- 4) 月报 RPC 改用 is_staff 守门（返回类型未变，先 DROP 旧签名再建）
drop function if exists public.report_monthly_matrix(int, int, uuid);
drop function if exists public.report_monthly_matrix(int, int, uuid, uuid);
create or replace function public.report_monthly_matrix(
  f_year int,
  f_month int,
  f_product uuid default null,
  f_worker uuid default null
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

-- 5) profiles 读策略：staff（admin + leader）可读全部，用于报表映射工号/账号
drop policy if exists p_profiles_self on public.profiles;
create policy p_profiles_self on public.profiles for select
  using (id = auth.uid() or public.is_staff());
-- 写策略仍是 admin 专属（leader 不能改 profile / 建账号 / 改产品）
drop policy if exists p_profiles_admin_w on public.profiles;
create policy p_profiles_admin_w on public.profiles for update
  using (public.is_admin());

-- 6) 授权 + 刷新 PostgREST 缓存
grant execute on function public.is_staff() to authenticated;
grant execute on function public.report_summary(date, date, uuid, uuid) to authenticated;
grant execute on function public.report_monthly_matrix(int, int, uuid, uuid) to authenticated;
notify pgrst, 'reload schema';
