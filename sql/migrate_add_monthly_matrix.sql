-- ============================================================
-- 迁移：新增月度矩阵报表函数 report_monthly_matrix
-- 场景：线上库已运行，不能重跑 00_schema.sql。
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全量 → Run
-- 幂等：可重复执行（drop function + create or replace + grant）
-- ============================================================

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

  return query
  with agg as (
    select
      r.product_id,
      r.part_id,
      r.worker_id,
      ((extract(day from r.record_date)::int) - 1) * 3
        + case r.shift when '白班' then 0 when '中班' then 1 when '夜班' then 2 end as slot,
      sum(r.qty) as qty
    from public.production_records r
    where r.record_date >= v_first
      and r.record_date < v_next
      and (f_product is null or r.product_id = f_product)
      and (f_worker is null or r.worker_id = f_worker)
      and r.shift in ('白班', '中班', '夜班')
    group by r.product_id, r.part_id, r.worker_id, slot
  ),
  lines as (
    select product_id, part_id, worker_id, sum(qty) as total_qty
    from agg
    group by product_id, part_id, worker_id
  )
  select
    p.code,
    p.name,
    pr.part_no,
    pr.part_name,
    split_part(pro.email, '@', 1) as worker_account,
    (
      select array_agg(coalesce(a.qty, 0) order by g.slot)
      from generate_series(0, 92) as g(slot)
      left join agg a
        on a.product_id = l.product_id
       and a.part_id   = l.part_id
       and a.worker_id = l.worker_id
       and a.slot      = g.slot
    ) as cells,
    l.total_qty
  from lines l
  join public.products p  on p.id  = l.product_id
  join public.parts   pr on pr.id = l.part_id
  join public.profiles pro on pro.id = l.worker_id
  order by p.code, pr.part_no, pro.email;
end; $$;

grant execute on function public.report_monthly_matrix(int, int, uuid, uuid) to authenticated;

select 'migration ok: report_monthly_matrix added' as result;
