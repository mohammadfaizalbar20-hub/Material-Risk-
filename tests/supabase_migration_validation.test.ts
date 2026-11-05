import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSupabaseUrl,
  isValidSupabaseUrl,
  isValidSupabaseAnonKey,
  safeDbDate,
  isValidUuid,
  generateUuid,
} from '../src/lib/supabase.ts';

test('1. cleanSupabaseUrl removes /rest/v1 and trailing slashes', () => {
  assert.equal(
    cleanSupabaseUrl('https://fk2win5o5c3pgb73favlsu.supabase.co/rest/v1'),
    'https://fk2win5o5c3pgb73favlsu.supabase.co'
  );
  assert.equal(
    cleanSupabaseUrl('https://fk2win5o5c3pgb73favlsu.supabase.co/rest/v1/'),
    'https://fk2win5o5c3pgb73favlsu.supabase.co'
  );
  assert.equal(
    cleanSupabaseUrl('https://fk2win5o5c3pgb73favlsu.supabase.co/rest'),
    'https://fk2win5o5c3pgb73favlsu.supabase.co'
  );
  assert.equal(
    cleanSupabaseUrl('https://fk2win5o5c3pgb73favlsu.supabase.co///'),
    'https://fk2win5o5c3pgb73favlsu.supabase.co'
  );
  assert.equal(
    cleanSupabaseUrl('fk2win5o5c3pgb73favlsu.supabase.co/rest/v1'),
    'https://fk2win5o5c3pgb73favlsu.supabase.co'
  );
  assert.equal(
    cleanSupabaseUrl('http://localhost:54321/rest/v1'),
    'http://localhost:54321'
  );
});

test('2. isValidSupabaseUrl and isValidSupabaseAnonKey validation', () => {
  // Correct values
  assert.equal(isValidSupabaseUrl('https://fk2win5o5c3pgb73favlsu.supabase.co'), true);
  assert.equal(isValidSupabaseAnonKey('sb_publishable_Yhkm-cLiSN70SAXCx7BS6g_rasB-3Vk'), true);
  assert.equal(isValidSupabaseAnonKey('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xyz'), true);

  // Swapped or invalid values
  assert.equal(isValidSupabaseUrl('sb_publishable_Yhkm-cLiSN70SAXCx7BS6g_rasB-3Vk'), false);
  assert.equal(isValidSupabaseUrl('not-a-url'), false);
  assert.equal(isValidSupabaseAnonKey('https://fk2win5o5c3pgb73favlsu.supabase.co'), false);
  assert.equal(isValidSupabaseAnonKey('short'), false);
});

test('3. safeDbDate normalizes different date formats to YYYY-MM-DD', () => {
  assert.equal(safeDbDate('2026-11-04'), '2026-11-04');
  assert.equal(safeDbDate('2026-11-04T10:00:00Z'), '2026-11-04');
  assert.equal(safeDbDate('04/11/2026'), '2026-11-04');
  assert.equal(safeDbDate('04-11-2026'), '2026-11-04');
  assert.match(safeDbDate(null), /^\d{4}-\d{2}-\d{2}$/);
  assert.match(safeDbDate(''), /^\d{4}-\d{2}-\d{2}$/);
});

test('4. UUID helper validates and generates RFC4122 v4 UUIDs', () => {
  const uuid = generateUuid();
  assert.equal(isValidUuid(uuid), true);
  assert.equal(isValidUuid('hist-1'), false);
  assert.equal(isValidUuid('upload-1730000000-123'), false);
  assert.equal(isValidUuid('550e8400-e29b-41d4-a716-446655440000'), true);
});
