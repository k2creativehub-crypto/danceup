import { supabase } from '../supabase';

// Обновляет одну строку. Возвращает текст ошибки или null, если всё сохранено.
// Проверка на пустой ответ нужна, потому что при нехватке прав политика RLS
// молча «не находит» строку и ошибки от сервера нет.
export async function updateRow(
  table: string,
  id: string,
  patch: Record<string, unknown>,
): Promise<string | null> {
  const { data, error } = await supabase.from(table).update(patch).eq('id', id).select('id');
  if (error) return error.message;
  if (!data || data.length === 0) return 'Не удалось сохранить: нет прав или запись не найдена';
  return null;
}
