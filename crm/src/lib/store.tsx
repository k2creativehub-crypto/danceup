import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { supabase } from '../supabase';
import { useAuth } from '../auth';
import type { ScheduleSlot } from './format';

// Общий справочник: ученики, группы, зачисления и расписание загружаются один раз при входе.
// Страницы берут данные отсюда и открываются мгновенно, без собственных запросов.

export type DirStatus = 'active' | 'reserve' | 'left';

export interface DirGuardian {
  full_name: string | null;
  phone: string | null;
}
export interface DirStudent {
  id: string;
  full_name: string;
  birth_date: string | null;
  birth_date_raw: string | null;
  phone: string | null;
  guardian_id: string | null;
  guardian: DirGuardian | null;
}
export interface DirGroup {
  id: string;
  name: string;
  season: string;
  teacher_id: string | null;
  is_archived: boolean;
  teacher: { full_name: string } | null;
}
export interface DirEnrollment {
  id: string;
  student_id: string;
  group_id: string;
  status: DirStatus;
  is_primary: boolean;
  start_date: string | null;
  end_date: string | null;
}
export interface DirTeacher {
  id: string;
  full_name: string;
}

export type Part = 'students' | 'groups' | 'enrollments' | 'slots' | 'teachers';
const ALL_PARTS: Part[] = ['students', 'groups', 'enrollments', 'slots', 'teachers'];

interface Directory {
  students: DirStudent[];
  groups: DirGroup[];
  enrollments: DirEnrollment[];
  slots: ScheduleSlot[];
  teachers: DirTeacher[];
  studentById: Map<string, DirStudent>;
  groupById: Map<string, DirGroup>;
  enrollmentsByStudent: Map<string, DirEnrollment[]>;
  enrollmentsByGroup: Map<string, DirEnrollment[]>;
  slotsByGroup: Map<string, ScheduleSlot[]>;
  loading: boolean;
  error: string | null;
  /** Тихо перезагружает части справочника, не показывая «Загрузка…». */
  refresh: (parts?: Part[]) => Promise<void>;
  /** Мгновенно применяет сохранённое изменение к данным на экране. */
  patch: (table: 'students' | 'groups' | 'enrollments', id: string, fields: Record<string, unknown>) => void;
  patchGuardian: (guardianId: string, fields: Partial<DirGuardian>) => void;
  removeEnrollment: (id: string) => void;
}

const Ctx = createContext<Directory | null>(null);

export function useDirectory(): Directory {
  const v = useContext(Ctx);
  if (!v) throw new Error('useDirectory вызван вне DirectoryProvider');
  return v;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin';

  const [students, setStudents] = useState<DirStudent[]>([]);
  const [groups, setGroups] = useState<DirGroup[]>([]);
  const [enrollments, setEnrollments] = useState<DirEnrollment[]>([]);
  const [slots, setSlots] = useState<ScheduleSlot[]>([]);
  const [teachers, setTeachers] = useState<DirTeacher[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadedAt = useRef(0);

  // Возвращает текст первой ошибки или null.
  const run = useCallback(
    async (parts: Part[]): Promise<string | null> => {
      const want = new Set(parts);
      const tasks: Promise<string | null>[] = [];

      if (want.has('students')) {
        tasks.push(
          Promise.resolve(
            supabase
              .from('students')
              .select(
                'id, full_name, birth_date, birth_date_raw, phone, guardian_id, guardian:guardians(full_name, phone)',
              )
              .limit(5000),
          ).then(({ data, error: e }) => {
            if (e) return e.message;
            setStudents((data ?? []) as unknown as DirStudent[]);
            return null;
          }),
        );
      }
      if (want.has('groups')) {
        tasks.push(
          Promise.resolve(
            supabase
              .from('groups')
              .select('id, name, season, teacher_id, is_archived, teacher:teachers(full_name)')
              .limit(1000),
          ).then(({ data, error: e }) => {
            if (e) return e.message;
            setGroups((data ?? []) as unknown as DirGroup[]);
            return null;
          }),
        );
      }
      if (want.has('enrollments')) {
        tasks.push(
          Promise.resolve(
            supabase
              .from('enrollments_v')
              .select('id, student_id, group_id, status, is_primary, start_date, end_date')
              .limit(10000),
          ).then(({ data, error: e }) => {
            if (e) return e.message;
            setEnrollments((data ?? []) as unknown as DirEnrollment[]);
            return null;
          }),
        );
      }
      if (want.has('slots')) {
        tasks.push(
          Promise.resolve(
            supabase.from('group_schedule').select('group_id, weekday, start_time, end_time, location').limit(5000),
          ).then(({ data, error: e }) => {
            if (e) return e.message;
            setSlots((data ?? []) as unknown as ScheduleSlot[]);
            return null;
          }),
        );
      }
      if (want.has('teachers') && isAdmin) {
        tasks.push(
          Promise.resolve(supabase.from('teachers').select('id, full_name').limit(500)).then(({ data, error: e }) => {
            if (e) return e.message;
            const list = (data ?? []) as unknown as DirTeacher[];
            setTeachers([...list].sort((a, b) => a.full_name.localeCompare(b.full_name, 'ru')));
            return null;
          }),
        );
      }

      const results = await Promise.all(tasks);
      loadedAt.current = Date.now();
      return results.find((r) => r !== null) ?? null;
    },
    [isAdmin],
  );

  useEffect(() => {
    let alive = true;
    run(ALL_PARTS).then((err) => {
      if (!alive) return;
      if (err) setError(err);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [run]);

  const refresh = useCallback(
    async (parts: Part[] = ALL_PARTS) => {
      const err = await run(parts);
      if (err) console.warn('Не удалось обновить данные в фоне:', err);
    },
    [run],
  );

  // Если вкладка долго была в фоне, при возвращении тихо обновляем данные.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > 2 * 60 * 1000) {
        void refresh();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  const patch = useCallback<Directory['patch']>((table, id, fields) => {
    const merge = <T extends { id: string }>(rows: T[]): T[] =>
      rows.map((r) => (r.id === id ? ({ ...r, ...fields } as T) : r));
    if (table === 'students') setStudents(merge);
    else if (table === 'groups') setGroups(merge);
    else setEnrollments(merge);
  }, []);

  const patchGuardian = useCallback((guardianId: string, fields: Partial<DirGuardian>) => {
    setStudents((rows) =>
      rows.map((s) =>
        s.guardian_id === guardianId && s.guardian ? { ...s, guardian: { ...s.guardian, ...fields } } : s,
      ),
    );
  }, []);

  const removeEnrollment = useCallback((id: string) => {
    setEnrollments((rows) => rows.filter((r) => r.id !== id));
  }, []);

  const value = useMemo<Directory>(
    () => ({
      students,
      groups,
      enrollments,
      slots,
      teachers,
      studentById: new Map(students.map((s) => [s.id, s])),
      groupById: new Map(groups.map((g) => [g.id, g])),
      enrollmentsByStudent: groupBy(enrollments, (e) => e.student_id),
      enrollmentsByGroup: groupBy(enrollments, (e) => e.group_id),
      slotsByGroup: groupBy(slots, (s) => s.group_id),
      loading,
      error,
      refresh,
      patch,
      patchGuardian,
      removeEnrollment,
    }),
    [students, groups, enrollments, slots, teachers, loading, error, refresh, patch, patchGuardian, removeEnrollment],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
