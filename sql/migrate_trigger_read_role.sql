-- 可选一致性迁移：让 handle_new_user 触发器读取 user_metadata.role，
-- 这样在 Supabase Dashboard「Add user」时若传入 metadata.role，也会直接建成对应角色
-- （应用内「创建员工」已通过 Edge Function 兜底写对角色，本迁移主要影响 Dashboard 建号路径）。
-- 幂等可重跑：create or replace + 触发器已存在则跳过重建。

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1)),
    coalesce(new.raw_user_meta_data->>'role', 'worker')
  )
  on conflict (id) do update set
    role = coalesce(excluded.role, profiles.role, 'worker'),
    display_name = coalesce(excluded.display_name, profiles.display_name);
  return new;
end; $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();
