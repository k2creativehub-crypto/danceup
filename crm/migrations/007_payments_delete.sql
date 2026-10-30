-- 007_payments_delete.sql
-- Удалять оплату может только админ (редактирования нет: удалить и внести заново).
-- Если политика delete_payments у вас уже есть, она будет заменена.

alter table public.payments enable row level security;

drop policy if exists delete_payments on public.payments;
create policy delete_payments on public.payments
  for delete to authenticated
  using (public.is_admin());

-- Проверьте, что у админа есть и select/insert на payments (если вы создавали их раньше, ничего делать не нужно).
