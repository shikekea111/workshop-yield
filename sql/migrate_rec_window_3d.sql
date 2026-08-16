-- ============================================================
-- 放宽本人产量记录的改/删窗口：仅当天 → 最近 3 天
-- 目的：夜班同事次日补报（选昨天日期）后，本人仍可修改/删除，
--       避免被 RLS 静默锁死（原来 record_date = 当天 会拦掉历史记录）。
-- 在 Supabase 控制台 → SQL Editor 全量执行一次即可（幂等，可重跑）。
-- 注意：表级 grant 已在 00_schema.sql 授权，drop/create policy 不影响权限。
-- ============================================================

drop policy if exists p_rec_update_self on public.production_records;
create policy p_rec_update_self on public.production_records for update
  using (worker_id = auth.uid() and record_date >= (timezone('Asia/Shanghai', now()) - interval '3 days')::date)
  with check (worker_id = auth.uid());

drop policy if exists p_rec_delete_self on public.production_records;
create policy p_rec_delete_self on public.production_records for delete
  using (worker_id = auth.uid() and record_date >= (timezone('Asia/Shanghai', now()) - interval '3 days')::date);
