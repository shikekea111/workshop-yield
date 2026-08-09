-- ============================================================
-- 车间产量统计 · 一次性账号种子脚本
-- 用途：① 修复历史上残缺的账号（缺 auth.identities / metadata 导致 500）
--       ② 批量新建 1004~1500（统一初始密码，display_name 设为工号）
-- 执行位置：Supabase 控制台 → SQL Editor → 全量粘贴 → Run
-- 说明：本脚本以 postgres 角色直接写 auth.users，无需 is_admin 守卫，
--       因此只能在 SQL Editor 里跑，不能从应用内调用。幂等，可重跑。
-- ============================================================

do $$
declare
  v_pwd   text := '123456';          -- 新账号统一初始密码（按需修改）
  new_id  uuid;
  col     text;
  email   text;
  i       int;
begin
  -- ============================================================
  -- ① 修复：补全所有 auth.users 缺失字段 + 补 identities + 规范化 display_name
  -- ============================================================
  -- 1a. 核心字段（GoTrue 登录必需）
  update auth.users
    set instance_id = '00000000-0000-0000-0000-000000000000',
        aud         = 'authenticated',
        role        = coalesce(role, 'authenticated'),
        raw_app_meta_data = coalesce(raw_app_meta_data,
                          '{"provider":"email","providers":["email"]}'::jsonb)
    where instance_id is null
       or aud is null
       or raw_app_meta_data is null;

  -- 1b. 可空文本/token 列 NULL -> ''（跳过 phone，避免唯一键冲突；email 是生成列不会被选中）
  for col in
    select column_name from information_schema.columns
    where table_schema = 'auth' and table_name = 'users'
      and data_type in ('character varying','text','character','citext')
      and column_name != 'phone'
      and is_nullable = 'YES'
  loop
    execute format('update auth.users set %I = '''' where %I is null', col, col);
  end loop;

  -- 1c. 补 auth.identities 行（GoTrue 登录必查 identity，否则 500；email 是生成列，不 INSERT）
  insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
  select gen_random_uuid(), u.id,
         jsonb_build_object('sub', u.id::text, 'email', u.email,
                            'email_verified', true, 'phone_verified', false),
         'email', u.id::text, now(), now()
  from auth.users u
  where not exists (select 1 from auth.identities i where i.user_id = u.id)
  on conflict (provider, provider_id) do nothing;

  -- 1d. 规范化 display_name：@factory.local 账号统一显示为工号（去掉姓名，与离线对照表解耦）
  insert into public.profiles (id, email, display_name, role)
  select u.id, u.email, split_part(u.email, '@', 1), 'worker'
  from auth.users u
  where u.email like '%@factory.local'
  on conflict (id) do update
    set display_name = excluded.display_name
    where public.profiles.email like '%@factory.local';

  -- ============================================================
  -- ② 批量新建 1004~1500（跳过已存在的）
  -- ============================================================
  for i in 1004..1500 loop
    email := i::text || '@factory.local';
    if exists (select 1 from auth.users where auth.users.email = email) then
      continue;
    end if;

    new_id := gen_random_uuid();

    insert into auth.users
      (instance_id, id, aud, email, encrypted_password, email_confirmed_at,
       raw_app_meta_data, raw_user_meta_data, role)
    values
      ('00000000-0000-0000-0000-000000000000', new_id, 'authenticated', email,
       extensions.crypt(v_pwd, extensions.gen_salt('bf', 10)), now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', i::text), 'authenticated');

    -- 2b. 可空文本/token 列 NULL -> ''
    for col in
      select column_name from information_schema.columns
      where table_schema = 'auth' and table_name = 'users'
        and data_type in ('character varying','text','character','citext')
        and column_name != 'phone'
        and is_nullable = 'YES'
    loop
      execute format('update auth.users set %I = '''' where id = %L and %I is null', col, new_id, col);
    end loop;

    -- 2c. identities 行
    insert into auth.identities (id, user_id, identity_data, provider, provider_id, created_at, updated_at)
    values (gen_random_uuid(), new_id,
      jsonb_build_object('sub', new_id::text, 'email', email,
                         'email_verified', true, 'phone_verified', false),
      'email', new_id::text, now(), now())
    on conflict (provider, provider_id) do nothing;

    -- 2d. profiles（display_name = 工号）
    insert into public.profiles (id, email, display_name, role)
    values (new_id, email, i::text, 'worker')
    on conflict (id) do nothing;
  end loop;

  raise notice 'done: repaired existing + seeded 1004..1500 (pwd=%): 账号区间现为 1001~1500 连续可用', v_pwd;
end $$;
