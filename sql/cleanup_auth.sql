-- ============================================================
-- auth 表清理脚本
-- ------------------------------------------------------------
-- 作用：删除之前 SQL 直插留下的坏数据，只保留 1003 和管理员账号
-- 跑完后再跑 create-accounts.mjs 用官方 API 重建 1001~1500
--
-- 用法：Supabase 控制台 → SQL Editor → 粘贴全文 → Run
-- ============================================================

DO $$
DECLARE
  v_keep        text[];
  v_keep_count  int;
  v_will_delete int;
  v_del_i       int;
  v_del_u       int;
  v_del_p       int;
BEGIN
  -- 构建保留名单：1003@factory.local + 所有 admin 角色的邮箱
  SELECT COALESCE(array_agg(DISTINCT email), '{}') INTO v_keep
  FROM public.profiles
  WHERE role = 'admin' OR email = '1003@factory.local';

  -- 也检查 auth.users 里 email 不含 @factory.local 的（可能是管理员用别的邮箱）
  -- 合并进去
  SELECT COALESCE(array_agg(DISTINCT email), '{}') INTO v_keep
  FROM (
    SELECT email FROM public.profiles WHERE role = 'admin'
    UNION
    SELECT '1003@factory.local'
    UNION
    SELECT email FROM auth.users WHERE email NOT LIKE '%@factory.local'
  ) t;

  v_keep_count := array_length(v_keep, 1);
  IF v_keep_count IS NULL OR v_keep_count = 0 THEN
    RAISE EXCEPTION '安全检查失败：保留名单为空，中止！请检查 profiles 表。';
  END IF;

  RAISE NOTICE '保留 % 个账号: %', v_keep_count, v_keep;

  -- 预览要删除的数量
  SELECT count(*) INTO v_will_delete FROM auth.users WHERE email != ALL(v_keep);
  RAISE NOTICE '将删除 auth.users 中 % 个账号', v_will_delete;

  -- 1. 先删 auth.identities（外键依赖 auth.users）
  DELETE FROM auth.identities
  WHERE user_id IN (SELECT id FROM auth.users WHERE email != ALL(v_keep));
  GET DIAGNOSTICS v_del_i = ROW_COUNT;
  RAISE NOTICE '已删除 % 行 auth.identities', v_del_i;

  -- 2. 删 auth.users
  DELETE FROM auth.users WHERE email != ALL(v_keep);
  GET DIAGNOSTICS v_del_u = ROW_COUNT;
  RAISE NOTICE '已删除 % 行 auth.users', v_del_u;

  -- 3. 删 public.profiles（孤儿数据）
  DELETE FROM public.profiles WHERE email != ALL(v_keep);
  GET DIAGNOSTICS v_del_p = ROW_COUNT;
  RAISE NOTICE '已删除 % 行 public.profiles', v_del_p;

  -- 验证剩余
  SELECT count(*) INTO v_will_delete FROM auth.users;
  RAISE NOTICE '清理完成！auth.users 剩余 % 个账号', v_will_delete;
  RAISE NOTICE '现在可以重新运行 create-accounts.mjs 了。';
END $$;
