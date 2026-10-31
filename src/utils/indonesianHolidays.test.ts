import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getIndonesianHolidayInfo } from './indonesianHolidays';

test('detects all Sundays as holidays', () => {
  // 2026-11-01 is Sunday
  const nov1 = getIndonesianHolidayInfo('2026-11-01');
  assert.equal(nov1.isHoliday, true);
  assert.equal(nov1.type, 'SUNDAY');

  // 2026-11-08 is Sunday
  const nov8 = getIndonesianHolidayInfo('2026-11-08');
  assert.equal(nov8.isHoliday, true);
  assert.equal(nov8.type, 'SUNDAY');
});

test('detects Indonesian national holidays', () => {
  // 17 Agustus 2026
  const independence = getIndonesianHolidayInfo('2026-08-17');
  assert.equal(independence.isHoliday, true);
  assert.equal(independence.type, 'NATIONAL_HOLIDAY');

  // 1 Mei 2026 (Labor Day)
  const labor = getIndonesianHolidayInfo('2026-05-01');
  assert.equal(labor.isHoliday, true);
  assert.equal(labor.type, 'NATIONAL_HOLIDAY');

  // 25 Desember 2026 (Natal)
  const natal = getIndonesianHolidayInfo('2026-12-25');
  assert.equal(natal.isHoliday, true);
  assert.equal(natal.type, 'NATIONAL_HOLIDAY');
});

test('detects Cuti Bersama', () => {
  // 2026-03-23 is Cuti Bersama Idul Fitri 1447 H
  const cutiIdulFitri = getIndonesianHolidayInfo('2026-03-23');
  assert.equal(cutiIdulFitri.isHoliday, true);
  assert.equal(cutiIdulFitri.type, 'CUTI_BERSAMA');
});

test('regular weekdays are not holidays', () => {
  // 2026-11-05 is a Thursday (normal production day)
  const normalDay = getIndonesianHolidayInfo('2026-11-05');
  assert.equal(normalDay.isHoliday, false);
});
