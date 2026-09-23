-- ============================================================
-- 迁移：给产品加 workshop（车间）字段 + 报表聚合函数增加 f_workshop 筛选
-- 场景：线上库已运行，不能重跑 00_schema.sql。
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全量 → Run
-- 幂等：可重复执行（drop function + create or replace + grant）
-- 关键：改函数签名必须先 drop 旧签名再建新的，跑完 notify pgrst 刷新 PostgREST 缓存
--       （否则 App 会拿到旧函数签名，报"找不到参数"类错误）
-- ============================================================

-- 1) 产品表新增车间字段（默认 NULL = 未标注）
alter table public.products add column if not exists workshop text;

-- 2) report_summary 增加 f_workshop 参数
--    PostgreSQL 不允许 REPLACE 改参数个数，必须先 drop 旧签名
drop function if exists public.report_summary(date, date, uuid, uuid);
drop function if exists public.report_summary(date, date, uuid, uuid, text);

create or replace function public.report_summary(
  f_from date default null,
  f_to date default null,
  f_product uuid default null,
  f_worker uuid default null,
  f_workshop text default null
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
  join public.products p on p.id = r.product_id
  where (f_from is null or r.record_date >= f_from)
    and (f_to is null or r.record_date <= f_to)
    and (f_product is null or r.product_id = f_product)
    and (f_worker is null or r.worker_id = f_worker)
    and (f_workshop is null or p.workshop = f_workshop)
  group by r.record_date, r.product_id, r.part_id, r.worker_id, r.shift
  order by r.record_date desc, r.product_id, r.part_id, r.worker_id, r.shift;
end; $$;

grant execute on function public.report_summary(date, date, uuid, uuid, text) to authenticated;

-- 3) report_monthly_matrix 增加 f_workshop 参数
drop function if exists public.report_monthly_matrix(int, int, uuid);
drop function if exists public.report_monthly_matrix(int, int, uuid, uuid);
drop function if exists public.report_monthly_matrix(int, int, uuid, uuid, text);

create or replace function public.report_monthly_matrix(
  f_year int,
  f_month int,
  f_product uuid default null,
  f_worker uuid default null,
  f_workshop text default null
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
    join public.products p on p.id = r.product_id
    where r.record_date >= v_first
      and r.record_date < v_next
      and (f_product is null or r.product_id = f_product)
      and (f_worker is null or r.worker_id = f_worker)
      and (f_workshop is null or p.workshop = f_workshop)
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

grant execute on function public.report_monthly_matrix(int, int, uuid, uuid, text) to authenticated;

-- 刷新 PostgREST schema 缓存，避免函数签名变更后 App 仍拿到旧缓存
notify pgrst, 'reload schema';

select 'migration ok: workshop added' as result;
