import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanSupabaseUrl,
  isValidSupabaseUrl,
  isValidSupabaseAnonKey,
  safeDbDate,
  isValidUuid,
  generateUuid,
  mapModelToDbRelation,
} from '../src/lib/supabase.ts';
import {
  PPIC_SUPABASE_SCHEMA_SQL,
  PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL,
} from '../src/lib/supabaseSchemaSql.ts';

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

test('5. Long style strings (> 255 chars) are preserved without truncation', () => {
  const longStyle = 'JACKET WATERPROOF REFLECTIVE HOODED WITH REMOVABLE FLEECE LINER - SPECIFICATION EXPORT TO JAPAN - FABRIC 100% POLYESTER TASLAN 210T PU COATING 5000MM WP BREATHABLE FINISH - COLORWAY NAVY BLUE / REFLECTIVE NEON ACCENT - RUNNING SIZES XS S M L XL XXL 3XL - ORDER BATCH 2026-PPIC-FULL-RUN';
  assert.ok(longStyle.length > 255, `Expected length > 255, got ${longStyle.length}`);

  const row = mapModelToDbRelation({
    id: generateUuid(),
    orNumber: 'OR-2026-999',
    style: longStyle,
    createdAt: '2026-11-04',
  });

  // Verify that neither style nor OR number was truncated
  assert.equal(row.style, longStyle);
  assert.equal(row.style.length, longStyle.length);
  assert.equal(row.or_number, 'OR-2026-999');
});

test('6. Schema SQL and Migration Script use TEXT for unrestricted string lengths', () => {
  // Ensure schema.sql does NOT declare VARCHAR(255) for style or or_number in or_style_relations
  assert.match(
    PPIC_SUPABASE_SCHEMA_SQL,
    /or_style_relations\s*\(\s*id UUID PRIMARY KEY DEFAULT gen_random_uuid\(\),\s*or_number TEXT NOT NULL UNIQUE,\s*style TEXT NOT NULL/i
  );

  // Ensure migration script includes ALTER TABLE commands for all core tables
  assert.match(PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL, /ALTER TABLE IF EXISTS public\.or_style_relations ALTER COLUMN style TYPE TEXT/);
  assert.match(PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL, /ALTER TABLE IF EXISTS public\.material_requirements ALTER COLUMN style TYPE TEXT/);
  assert.match(PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL, /ALTER TABLE IF EXISTS public\.upload_history ALTER COLUMN style TYPE TEXT/);
  assert.match(PPIC_SUPABASE_MIGRATION_WIDEN_TEXT_SQL, /ALTER TABLE IF EXISTS public\.production_schedules ALTER COLUMN style TYPE TEXT/);
});
