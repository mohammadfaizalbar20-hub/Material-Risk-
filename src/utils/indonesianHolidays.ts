/**
 * Indonesian National Holidays & Cuti Bersama
 * Sumber: SKB 3 Menteri tentang Hari Libur Nasional dan Cuti Bersama
 */

export type HolidayType = 'SUNDAY' | 'NATIONAL_HOLIDAY' | 'CUTI_BERSAMA';

export interface DayHolidayInfo {
  isHoliday: boolean;
  type?: HolidayType;
  name?: string;
  badgeLabel?: string;
}

// Master list of known national holidays & cuti bersama in Indonesia
const holidayMap: Record<string, { type: 'NATIONAL_HOLIDAY' | 'CUTI_BERSAMA'; name: string }> = {
  // === TAHUN 2025 ===
  '2025-01-01': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru 2025 Masehi' },
  '2025-01-27': { type: 'NATIONAL_HOLIDAY', name: "Isra Mi'raj Nabi Muhammad SAW" },
  '2025-01-28': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Tahun Baru Imlek' },
  '2025-01-29': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru Imlek 2576 Kongzili' },
  '2025-03-28': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Hari Suci Nyepi' },
  '2025-03-29': { type: 'NATIONAL_HOLIDAY', name: 'Hari Suci Nyepi (Tahun Baru Saka 1947)' },
  '2025-03-31': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1446 H' },
  '2025-04-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1446 H' },
  '2025-04-02': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1446 H' },
  '2025-04-03': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1446 H' },
  '2025-04-04': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1446 H' },
  '2025-04-07': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1446 H' },
  '2025-04-18': { type: 'NATIONAL_HOLIDAY', name: 'Wafat Yesus Kristus' },
  '2025-04-20': { type: 'NATIONAL_HOLIDAY', name: 'Hari Kebangkitan Yesus Kristus (Paskah)' },
  '2025-05-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Buruh Internasional' },
  '2025-05-12': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Waisak 2569 BE' },
  '2025-05-13': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Hari Raya Waisak' },
  '2025-05-29': { type: 'NATIONAL_HOLIDAY', name: 'Kenaikan Yesus Kristus' },
  '2025-05-30': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Kenaikan Yesus Kristus' },
  '2025-06-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Lahir Pancasila' },
  '2025-06-06': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Adha 1446 H' },
  '2025-06-09': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Adha 1446 H' },
  '2025-06-27': { type: 'NATIONAL_HOLIDAY', name: '1 Muharam / Tahun Baru Islam 1447 H' },
  '2025-08-17': { type: 'NATIONAL_HOLIDAY', name: 'Hari Proklamasi Kemerdekaan RI ke-80' },
  '2025-09-05': { type: 'NATIONAL_HOLIDAY', name: 'Maulid Nabi Muhammad SAW' },
  '2025-12-25': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Natal' },
  '2025-12-26': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Hari Raya Natal' },

  // === TAHUN 2026 ===
  '2026-01-01': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru 2026 Masehi' },
  '2026-01-16': { type: 'NATIONAL_HOLIDAY', name: "Isra Mi'raj Nabi Muhammad SAW" },
  '2026-02-16': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Tahun Baru Imlek' },
  '2026-02-17': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru Imlek 2577 Kongzili' },
  '2026-03-19': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Hari Raya Nyepi' },
  '2026-03-20': { type: 'NATIONAL_HOLIDAY', name: 'Hari Suci Nyepi (Tahun Baru Saka 1948)' },
  '2026-03-21': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1447 H' },
  '2026-03-22': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1447 H' },
  '2026-03-23': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1447 H' },
  '2026-03-24': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1447 H' },
  '2026-03-25': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Fitri 1447 H' },
  '2026-04-03': { type: 'NATIONAL_HOLIDAY', name: 'Wafat Yesus Kristus (Jumat Agung)' },
  '2026-04-05': { type: 'NATIONAL_HOLIDAY', name: 'Hari Paskah' },
  '2026-05-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Buruh Internasional (May Day)' },
  '2026-05-14': { type: 'NATIONAL_HOLIDAY', name: 'Kenaikan Yesus Kristus' },
  '2026-05-15': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Kenaikan Yesus Kristus' },
  '2026-05-27': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Adha 1447 H' },
  '2026-05-28': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Idul Adha 1447 H' },
  '2026-05-31': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Waisak 2570 BE' },
  '2026-06-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Lahir Pancasila' },
  '2026-06-16': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru Islam 1448 H' },
  '2026-08-17': { type: 'NATIONAL_HOLIDAY', name: 'Hari Kemerdekaan Republik Indonesia ke-81' },
  '2026-08-25': { type: 'NATIONAL_HOLIDAY', name: 'Maulid Nabi Muhammad SAW' },
  '2026-11-10': { type: 'NATIONAL_HOLIDAY', name: 'Hari Pahlawan Nasional (Libur Produksi Simbolik)' },
  '2026-12-24': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Hari Raya Natal' },
  '2026-12-25': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Natal' },
  '2026-12-26': { type: 'CUTI_BERSAMA', name: 'Cuti Bersama Pasca Natal' },

  // === TAHUN 2027 ===
  '2027-01-01': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru 2027 Masehi' },
  '2027-01-06': { type: 'NATIONAL_HOLIDAY', name: "Isra Mi'raj Nabi Muhammad SAW" },
  '2027-02-06': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru Imlek 2578 Kongzili' },
  '2027-03-09': { type: 'NATIONAL_HOLIDAY', name: 'Hari Suci Nyepi Saka 1949' },
  '2027-03-10': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1448 H' },
  '2027-03-11': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Fitri 1448 H' },
  '2027-03-26': { type: 'NATIONAL_HOLIDAY', name: 'Wafat Yesus Kristus' },
  '2027-05-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Buruh Internasional' },
  '2027-05-06': { type: 'NATIONAL_HOLIDAY', name: 'Kenaikan Yesus Kristus' },
  '2027-05-17': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Idul Adha 1448 H' },
  '2027-05-20': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Waisak 2571 BE' },
  '2027-06-01': { type: 'NATIONAL_HOLIDAY', name: 'Hari Lahir Pancasila' },
  '2027-06-06': { type: 'NATIONAL_HOLIDAY', name: 'Tahun Baru Islam 1449 H' },
  '2027-08-17': { type: 'NATIONAL_HOLIDAY', name: 'Hari Kemerdekaan RI ke-82' },
  '2027-12-25': { type: 'NATIONAL_HOLIDAY', name: 'Hari Raya Natal' },
};

/**
 * Returns holiday status for a specific date (YYYY-MM-DD or Date object)
 */
export function getIndonesianHolidayInfo(dateInput: string | Date): DayHolidayInfo {
  const dateObj = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  const dayOfWeek = dateObj.getDay(); // 0 = Sunday

  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  // 1. Check fixed/special national holiday or cuti bersama first
  if (holidayMap[dateStr]) {
    const entry = holidayMap[dateStr];
    return {
      isHoliday: true,
      type: entry.type,
      name: entry.name,
      badgeLabel: entry.type === 'NATIONAL_HOLIDAY' ? 'Libur Nasional' : 'Cuti Bersama',
    };
  }

  // 2. Fixed annual recurring national holidays fallback (e.g. Jan 1, May 1, Jun 1, Aug 17, Dec 25)
  const monthDay = `${month}-${day}`;
  if (monthDay === '01-01') {
    return {
      isHoliday: true,
      type: 'NATIONAL_HOLIDAY',
      name: `Tahun Baru ${year} Masehi`,
      badgeLabel: 'Libur Nasional',
    };
  }
  if (monthDay === '05-01') {
    return {
      isHoliday: true,
      type: 'NATIONAL_HOLIDAY',
      name: 'Hari Buruh Internasional',
      badgeLabel: 'Libur Nasional',
    };
  }
  if (monthDay === '06-01') {
    return {
      isHoliday: true,
      type: 'NATIONAL_HOLIDAY',
      name: 'Hari Lahir Pancasila',
      badgeLabel: 'Libur Nasional',
    };
  }
  if (monthDay === '08-17') {
    return {
      isHoliday: true,
      type: 'NATIONAL_HOLIDAY',
      name: `Hari Kemerdekaan Republik Indonesia (${year})`,
      badgeLabel: 'Libur Nasional',
    };
  }
  if (monthDay === '12-25') {
    return {
      isHoliday: true,
      type: 'NATIONAL_HOLIDAY',
      name: 'Hari Raya Natal',
      badgeLabel: 'Libur Nasional',
    };
  }
  if (monthDay === '12-26') {
    return {
      isHoliday: true,
      type: 'CUTI_BERSAMA',
      name: 'Cuti Bersama Natal',
      badgeLabel: 'Cuti Bersama',
    };
  }

  // 3. Check if Sunday (Hari Minggu)
  if (dayOfWeek === 0) {
    return {
      isHoliday: true,
      type: 'SUNDAY',
      name: 'Hari Minggu (Libur Produksi Rutin)',
      badgeLabel: 'Minggu',
    };
  }

  return {
    isHoliday: false,
  };
}
