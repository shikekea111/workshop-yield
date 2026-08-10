-- ============================================================
-- 迁移：production_records 增加「班次 shift」列
-- 场景：线上库已运行，不能重跑 00_schema.sql（会 DROP 重建）。
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全量 → Run
-- 幂等：可重复执行，不会报错。
-- ============================================================

-- 1) 加列（判断不存在才加；旧记录 shift 为 NULL，报表显示为空）
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'production_records'
      and column_name = 'shift'
  ) then
    alter table public.production_records add column shift text;
  end if;
end $$;

-- 2) 重建报表覆盖索引（含 shift 维度，让按班次分组走 Index Only Scan）
drop index if exists public.idx_rec_report;
create index idx_rec_report
  on public.production_records (record_date, product_id, part_id, worker_id, shift)
  include (qty, process);

-- 3) 重建聚合函数（返回列 + 分组维度加 shift）
--    注意：PostgreSQL 不允许 REPLACE 改返回类型，必须 DROP 再 CREATE
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
  if not public.is_admin() then raise exception 'forbidden'; end if;
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

-- 4) 授权（幂等，重跑安全）
grant execute on function public.report_summary(date, date, uuid, uuid) to authenticated;

-- 完成提示
select 'migration ok: shift column added' as result;
