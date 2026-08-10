-- ============================================================
-- 迁移：新增/修复月度矩阵报表函数 report_monthly_matrix
-- 场景：线上库已运行，不能重跑 00_schema.sql。
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全量 → Run
-- 幂等：可重复执行（drop function + create or replace + grant）
-- ============================================================

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
  cells          bigint[],   -- 长度 93：index=(日-1)*3+班次(0白班/1中班/2夜班)
  total_qty      bigint
) language plpgsql security definer set search_path = public as $$
declare
  v_first date := make_date(f_year, f_month, 1);
  v_next  date := (v_first + interval '1 month')::date;
begin
  if not public.is_admin() then raise exception 'forbidden'; end if;

  -- 所有中间列都加前缀，避免与 RETURNS TABLE 输出列同名产生歧义。
  -- cells 通过 cross join generate_series + left join agg + array_agg 生成，保证长度固定 93。
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

grant execute on function public.report_monthly_matrix(int, int, uuid, uuid) to authenticated;

-- 刷新 PostgREST schema 缓存，避免函数签名变更后 App 仍拿到旧缓存
notify pgrst, 'reload schema';

select 'migration ok: report_monthly_matrix added' as result;
