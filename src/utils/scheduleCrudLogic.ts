import { ProductionSchedule } from '../types/ppic';
import { generateUuid, isValidUuid } from './uuid';

export interface ScheduleCrudResult {
  success: boolean;
  schedule?: ProductionSchedule;
  error?: string;
}

export interface ScheduleCrudTransitionResult extends ScheduleCrudResult {
  schedules: ProductionSchedule[];
}

export interface ScheduleRemoteGateway {
  isConfigured: boolean;
  createSchedule: (schedule: ProductionSchedule) => Promise<{ success: boolean; id?: string; error?: string }>;
  updateSchedule: (schedule: ProductionSchedule) => Promise<{ success: boolean; id?: string; error?: string }>;
  deleteSchedule: (id: string) => Promise<{ success: boolean; error?: string }>;
}

/**
 * Resolves a guaranteed valid UUID v4 for a newly created schedule.
 * Preserves a valid draft UUID if supplied (prevents duplicate inserts on retry).
 */
export function resolveNewScheduleUuid(draftId?: string | null): string {
  if (draftId && isValidUuid(draftId)) {
    return draftId.trim();
  }
  return generateUuid();
}

/**
 * Creates a production schedule with consistent client-side UUID across React state,
 * localStorage, and Supabase. Does not add to local state if Supabase INSERT fails.
 */
export async function createScheduleWithPersistence(
  currentSchedules: ProductionSchedule[],
  draftInput: Omit<ProductionSchedule, 'id'> & { id?: string },
  gateway: ScheduleRemoteGateway
): Promise<ScheduleCrudTransitionResult> {
  const newId = resolveNewScheduleUuid(draftInput.id);
  const candidate: ProductionSchedule = {
    ...draftInput,
    id: newId,
    status: draftInput.status || 'Terjadwal',
  };

  if (gateway.isConfigured) {
    const remoteRes = await gateway.createSchedule(candidate);
    if (!remoteRes.success) {
      return {
        success: false,
        error: remoteRes.error || 'Gagal menyimpan jadwal produksi baru ke Supabase.',
        schedules: currentSchedules,
      };
    }

    if (!remoteRes.id || !isValidUuid(remoteRes.id)) {
      return {
        success: false,
        error: 'Supabase tidak mengembalikan ID UUID jadwal yang valid setelah INSERT.',
        schedules: currentSchedules,
      };
    }

    const savedSchedule: ProductionSchedule = {
      ...candidate,
      id: remoteRes.id.trim(),
    };

    const nextSchedules = currentSchedules.some((s) => s.id === savedSchedule.id)
      ? currentSchedules.map((s) => (s.id === savedSchedule.id ? savedSchedule : s))
      : [...currentSchedules, savedSchedule];

    return {
      success: true,
      schedule: savedSchedule,
      schedules: nextSchedules,
    };
  }

  const nextSchedules = currentSchedules.some((s) => s.id === candidate.id)
    ? currentSchedules.map((s) => (s.id === candidate.id ? candidate : s))
    : [...currentSchedules, candidate];

  return {
    success: true,
    schedule: candidate,
    schedules: nextSchedules,
  };
}

/**
 * Updates an existing production schedule using UPDATE (never INSERT).
 * Blocks speculative updates/inserts when Supabase is configured and ID is a legacy non-UUID (`sch-...`).
 */
export async function updateScheduleWithPersistence(
  currentSchedules: ProductionSchedule[],
  id: string,
  updates: Partial<ProductionSchedule>,
  gateway: ScheduleRemoteGateway
): Promise<ScheduleCrudTransitionResult> {
  const existing = currentSchedules.find((s) => s.id === id);
  if (!existing) {
    return {
      success: false,
      error: 'Jadwal produksi tidak ditemukan.',
      schedules: currentSchedules,
    };
  }

  // Never allow updates to mutate the schedule ID
  const updatedSchedule: ProductionSchedule = {
    ...existing,
    ...updates,
    id: existing.id,
  };

  if (gateway.isConfigured) {
    if (!isValidUuid(existing.id)) {
      return {
        success: false,
        error: `Jadwal "${existing.orNumber}" masih menggunakan ID lokal lama ("${existing.id}") yang belum terpetakan ke UUID Supabase. Pembaruan dibatalkan untuk mencegah pembuatan baris duplikat. Silakan sinkronkan data dari Supabase terlebih dahulu.`,
        schedules: currentSchedules,
      };
    }

    const remoteRes = await gateway.updateSchedule(updatedSchedule);
    if (!remoteRes.success) {
      return {
        success: false,
        error: remoteRes.error || 'Gagal memperbarui jadwal produksi di Supabase.',
        schedules: currentSchedules,
      };
    }
  }

  const nextSchedules = currentSchedules.map((s) =>
    s.id === existing.id ? updatedSchedule : s
  );

  return {
    success: true,
    schedule: updatedSchedule,
    schedules: nextSchedules,
  };
}

/**
 * Deletes only the targeted production schedule.
 * Validates UUID and awaits Supabase confirmation before removing from local state.
 */
export async function deleteScheduleWithPersistence(
  currentSchedules: ProductionSchedule[],
  id: string,
  gateway: ScheduleRemoteGateway
): Promise<ScheduleCrudTransitionResult> {
  const existing = currentSchedules.find((s) => s.id === id);
  if (!existing) {
    return {
      success: false,
      error: 'Jadwal produksi tidak ditemukan.',
      schedules: currentSchedules,
    };
  }

  if (gateway.isConfigured) {
    if (!isValidUuid(existing.id)) {
      return {
        success: false,
        error: `Jadwal "${existing.orNumber}" masih menggunakan ID lokal lama ("${existing.id}") yang tidak memiliki UUID Supabase yang valid. Penghapusan dibatalkan agar tidak gagal atau salah sasaran. Silakan sinkronkan data dari Supabase terlebih dahulu.`,
        schedules: currentSchedules,
      };
    }

    const remoteRes = await gateway.deleteSchedule(existing.id);
    if (!remoteRes.success) {
      return {
        success: false,
        error: remoteRes.error || 'Gagal menghapus jadwal produksi dari Supabase.',
        schedules: currentSchedules,
      };
    }
  }

  const nextSchedules = currentSchedules.filter((s) => s.id !== existing.id);

  return {
    success: true,
    schedule: existing,
    schedules: nextSchedules,
  };
}
