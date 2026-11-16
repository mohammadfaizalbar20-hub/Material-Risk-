import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAllMaterialsComparisonData,
  buildAllParetoMitigationData,
  fetchAllDrilldownRequirementsFromSupabaseClient,
  fetchAllPagedRowsFromQuery,
  filterRequirementsForDrilldown,
  toJakartaDateStr,
} from '../src/utils/dashboardDrilldown';
import { MaterialItemRequirement } from '../src/types/ppic';

interface MockDbTables {
  material_requirements: Array<Record<string, any>>;
  upload_history: Array<Record<string, any>>;
}

/**
 * Simulates a Supabase PostgREST query builder including:
 * - .select('*', { count: 'exact' })
 * - .or('or_number.ilike.%q%,style.ilike.%q%')
 * - .in(col, values)
 * - .is(col, null)
 * - .gte(col, val) / .lte(col, val)
 * - multi-column .order(col, { ascending })
 * - .range(from, to) with optional simulated PostgREST `dbMaxRows` cap
 */
function createMockSupabaseClient(
  tables: MockDbTables,
  options?: { dbMaxRows?: number; omitCount?: boolean }
) {
  const dbMaxRows = options?.dbMaxRows ?? 1000;
  const omitCount = options?.omitCount ?? false;

  return {
    from(tableName: keyof MockDbTables) {
      const filters: Array<(row: Record<string, any>) => boolean> = [];
      const orders: Array<{ column: string; ascending: boolean }> = [];
      let wantCount = false;

      const builder: any = {
        select(_cols: string, opts?: { count?: 'exact' }) {
          if (opts?.count === 'exact') {
            wantCount = true;
          }
          return builder;
        },
        or(expr: string) {
          // Parses simple expressions like `or_number.ilike.%foo%,style.ilike.%foo%`
          const clauses = expr.split(',').map((part) => {
            const [col, op, rawPattern] = part.split('.');
            const term = (rawPattern || '').replace(/^%|%$/g, '').toLowerCase();
            return { col, op, term };
          });
          filters.push((row) =>
            clauses.some(({ col, term }) =>
              String(row[col] ?? '').toLowerCase().includes(term)
            )
          );
          return builder;
        },
        in(col: string, vals: any[]) {
          const set = new Set(vals);
          filters.push((row) => set.has(row[col]));
          return builder;
        },
        is(col: string, val: any) {
          filters.push((row) => (val === null ? row[col] == null : row[col] === val));
          return builder;
        },
        gte(col: string, val: string) {
          filters.push((row) => {
            const rv = row[col];
            if (rv == null) return false;
            // Compare timestamps numerically if ISO datetime, otherwise lexicographically
            if (col === 'created_at') {
              return new Date(rv).getTime() >= new Date(val).getTime();
            }
            return String(rv) >= String(val);
          });
          return builder;
        },
        lte(col: string, val: string) {
          filters.push((row) => {
            const rv = row[col];
            if (rv == null) return false;
            if (col === 'created_at') {
              return new Date(rv).getTime() <= new Date(val).getTime();
            }
            return String(rv) <= String(val);
          });
          return builder;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          orders.push({ column, ascending: opts?.ascending !== false });
          return builder;
        },
        async range(from: number, to: number) {
          let rows = [...(tables[tableName] || [])].filter((row) =>
            filters.every((fn) => fn(row))
          );

          if (orders.length > 0) {
            rows.sort((a, b) => {
              for (const ord of orders) {
                const av = String(a[ord.column] ?? '');
                const bv = String(b[ord.column] ?? '');
                const cmp = av.localeCompare(bv);
                if (cmp !== 0) return ord.ascending ? cmp : -cmp;
              }
              return 0;
            });
          }

          const totalMatching = rows.length;
          const requestedSlice = rows.slice(from, to + 1);
          // Enforce server-side PostgREST db-max-rows limit if smaller than client chunk
          const cappedSlice = requestedSlice.slice(0, dbMaxRows);

          return {
            data: cappedSlice,
            count: wantCount && !omitCount ? totalMatching : null,
            error: null,
          };
        },
      };

      return builder;
    },
  };
}

function generateSampleRequirements(count: number, sharedCodeModulo = 35): MaterialItemRequirement[] {
  const batchTimestamp = '2026-11-15T03:00:00.000Z'; // Identical batch timestamp (10:00 WIB)
  const items: MaterialItemRequirement[] = [];
  for (let i = 0; i < count; i++) {
    const codeIndex = (i % sharedCodeModulo) + 1;
    const isDeficit = i % 2 === 1;
    const requiredQty = 100 + (i % 7) * 15;
    const receivedQty = isDeficit ? requiredQty - (10 + (i % 5) * 5) : requiredQty + 10;
    items.push({
      id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
      uploadId: `upload-batch-${Math.floor(i / 60) + 1}`,
      orNumber: `OR-${900 + Math.floor(i / 10)}`,
      style: `STYLE-${(i % 5) + 1}`,
      materialCode: `MAT-${String(codeIndex).padStart(3, '0')}`,
      materialName: `Material Sample ${i + 1}`,
      category: i % 3 === 0 ? 'Auxiliary' : 'Raw Material',
      unit: i % 4 === 0 ? 'Gros' : 'pcs',
      requiredQty,
      receivedQty,
      unitPrice: 12000,
      updateDate: '2026-11-15',
      createdAt: batchTimestamp,
      importedAt: batchTimestamp,
    });
  }
  return items;
}

function modelToDbRow(item: MaterialItemRequirement): Record<string, any> {
  return {
    id: item.id,
    upload_id: item.uploadId ?? null,
    or_number: item.orNumber,
    style: item.style,
    material_code: item.materialCode,
    material_name: item.materialName,
    category: item.category,
    unit: item.unit,
    required_qty: item.requiredQty,
    received_qty: item.receivedQty,
    unit_price: item.unitPrice ?? 0,
    update_date: item.updateDate ?? null,
    imported_at: item.importedAt ?? null,
    created_at: item.createdAt ?? new Date().toISOString(),
  };
}

test('Suite 1: 30, 50, 60, and >100 (150, 2500) rows — Zero merging on repeated materialCodes', () => {
  for (const rowCount of [30, 50, 60, 150, 2500]) {
    // Use 35 unique codes so 60 rows would previously shrink to 35 rows if merged by materialCode!
    const requirements = generateSampleRequirements(rowCount, 35);
    const expectedDeficits = requirements.filter((r) => r.receivedQty < r.requiredQty).length;

    const comparison = buildAllMaterialsComparisonData(requirements, 1);
    const pareto = buildAllParetoMitigationData(requirements, 1);

    assert.equal(
      comparison.totalRows,
      rowCount,
      `[N=${rowCount}] totalRows must equal exact row count without merging`
    );
    assert.equal(
      comparison.items.length,
      rowCount,
      `[N=${rowCount}] comparison.items.length must equal ${rowCount}, got ${comparison.items.length}`
    );
    assert.ok(
      comparison.totalUniqueMaterials <= rowCount,
      `[N=${rowCount}] unique codes (${comparison.totalUniqueMaterials}) tracked separately from totalRows (${comparison.totalRows})`
    );
    assert.equal(
      pareto.totalDeficitRows,
      expectedDeficits,
      `[N=${rowCount}] every deficit row must appear in Pareto/Mitigation without merging`
    );
    assert.equal(pareto.items.length, expectedDeficits);
  }
});

test('Suite 2: PPIC Formula & UOM Preservation — Kekurangan = Diterima - Kebutuhan & unit verbatim', () => {
  const rows: MaterialItemRequirement[] = [
    {
      id: 'row-1',
      orNumber: 'OR-100',
      style: 'ST-A',
      materialCode: 'MAT-SAME',
      materialName: 'Kancing Gold',
      category: 'Auxiliary',
      unit: 'Gros',
      requiredQty: 120,
      receivedQty: 80,
      unitPrice: 5000,
    },
    {
      id: 'row-2',
      orNumber: 'OR-101',
      style: 'ST-B',
      materialCode: 'MAT-SAME', // Identical materialCode across different OR
      materialName: 'Kancing Gold',
      category: 'Auxiliary',
      unit: 'Gros',
      requiredQty: 50,
      receivedQty: 60,
      unitPrice: 5000,
    },
  ];

  const comp = buildAllMaterialsComparisonData(rows);
  assert.equal(comp.items.length, 2, 'Two rows with identical materialCode must remain two rows');
  assert.equal(comp.totalUniqueMaterials, 1);

  const first = comp.items.find((i) => i.id === 'row-1')!;
  const second = comp.items.find((i) => i.id === 'row-2')!;

  assert.equal(first.balance, -40);
  assert.equal(first.isReady, false);
  assert.equal(first.unit, 'Gros');
  assert.equal(first.orNumber, 'OR-100');

  assert.equal(second.balance, 10);
  assert.equal(second.isReady, true);
  assert.equal(second.unit, 'Gros');
  assert.equal(second.orNumber, 'OR-101');

  const pareto = buildAllParetoMitigationData(rows);
  assert.equal(pareto.items.length, 1);
  assert.equal(pareto.items[0].id, 'row-1');
  assert.equal(pareto.items[0].shortageQty, 40);
  assert.equal(pareto.items[0].shortageValue, 200000);
});

test('Suite 3: Supabase .range() Pagination — 30, 50, 60, 150, 2500 rows with strict db-max-rows ceilings', async () => {
  const testScenarios = [
    { count: 30, chunkSize: 1000, dbMaxRows: 1000, omitCount: false },
    { count: 50, chunkSize: 1000, dbMaxRows: 1000, omitCount: false },
    { count: 60, chunkSize: 1000, dbMaxRows: 25, omitCount: false }, // Server caps each response at 25 rows!
    { count: 60, chunkSize: 40, dbMaxRows: 1000, omitCount: true }, // No count header, smaller chunk
    { count: 150, chunkSize: 1000, dbMaxRows: 50, omitCount: false }, // Server caps each response at 50 rows!
    { count: 2500, chunkSize: 1000, dbMaxRows: 1000, omitCount: false }, // Multi-page > 1000 PostgREST limit
  ];

  for (const s of testScenarios) {
    const sourceModels = generateSampleRequirements(s.count, 35);
    const dbRows = sourceModels.map(modelToDbRow);
    const mockSupabase = createMockSupabaseClient(
      { material_requirements: dbRows, upload_history: [] },
      { dbMaxRows: s.dbMaxRows, omitCount: s.omitCount }
    );

    const { requirements, pagesLoaded } = await fetchAllDrilldownRequirementsFromSupabaseClient(
      mockSupabase,
      {},
      s.chunkSize
    );

    assert.equal(
      requirements.length,
      s.count,
      `[count=${s.count}, dbMaxRows=${s.dbMaxRows}, chunk=${s.chunkSize}] must fetch ALL rows (${s.count}), got ${requirements.length}`
    );

    const comparison = buildAllMaterialsComparisonData(requirements, pagesLoaded);
    assert.equal(comparison.totalRows, s.count);
    assert.equal(comparison.items.length, s.count);

    // Ensure zero duplicate IDs and every original ID present
    const fetchedIds = new Set(comparison.items.map((it) => it.id));
    assert.equal(fetchedIds.size, s.count);
  }
});

test('Suite 4: Upload Date (Asia/Jakarta WIB) & OR Filter Parity across upload_history + orphan rows', async () => {
  // 2026-11-14T18:00:00.000Z === 2026-11-15 01:00:00 WIB (should match 2026-11-15!)
  // 2026-11-14T16:30:00.000Z === 2026-11-14 23:30:00 WIB (should NOT match 2026-11-15!)
  const uploads = [
    { id: 'up-nov15-early', created_at: '2026-11-14T18:00:00.000Z' },
    { id: 'up-nov14-late', created_at: '2026-11-14T16:30:00.000Z' },
  ];

  // Create 55 more matching uploads on 2026-11-15 to test >50 .in() batch chunking
  for (let i = 0; i < 55; i++) {
    uploads.push({
      id: `up-batch-${i}`,
      created_at: '2026-11-15T04:00:00.000Z',
    });
  }

  const dbRows: Array<Record<string, any>> = [
    // 2 rows linked to up-nov15-early (matches 2026-11-15 WIB)
    ...generateSampleRequirements(2, 10).map((r, idx) =>
      modelToDbRow({ ...r, id: `early-${idx}`, uploadId: 'up-nov15-early', createdAt: '2026-11-10T00:00:00Z' })
    ),
    // 55 rows across 55 upload batches on 2026-11-15 WIB
    ...Array.from({ length: 55 }, (_, i) =>
      modelToDbRow({
        ...generateSampleRequirements(1, 10)[0],
        id: `batch-row-${i}`,
        uploadId: `up-batch-${i}`,
        materialCode: `MAT-${(i % 20) + 1}`,
        createdAt: '2026-11-15T04:00:00.000Z',
      })
    ),
    // 3 orphan rows (upload_id = null) created on 2026-11-15 WIB
    ...generateSampleRequirements(3, 10).map((r, idx) =>
      modelToDbRow({ ...r, id: `orphan-${idx}`, uploadId: undefined, createdAt: '2026-11-15T08:00:00.000Z' })
    ),
    // 10 rows from 2026-11-14 WIB (must be excluded)
    ...generateSampleRequirements(10, 10).map((r, idx) =>
      modelToDbRow({ ...r, id: `old-${idx}`, uploadId: 'up-nov14-late', createdAt: '2026-11-14T16:30:00.000Z' })
    ),
  ];

  const mockSupabase = createMockSupabaseClient(
    { material_requirements: dbRows, upload_history: uploads },
    { dbMaxRows: 30 }
  );

  // Stored rows for 2026-11-15 WIB = 2 + 55 + 3 = 60 rows
  const { requirements } = await fetchAllDrilldownRequirementsFromSupabaseClient(
    mockSupabase,
    { uploadDate: '2026-11-15' },
    1000
  );
  assert.equal(requirements.length, 60, 'Must retrieve all 60 rows for 2026-11-15 WIB across >50 uploads + orphans');

  // Compare with offline/local filterRequirementsForDrilldown parity
  const uploadMap = new Map<string, string>();
  for (const u of uploads) {
    uploadMap.set(u.id, toJakartaDateStr(u.created_at));
  }
  const localModels: MaterialItemRequirement[] = dbRows.map((r) => ({
    id: r.id,
    uploadId: r.upload_id ?? undefined,
    orNumber: r.or_number,
    style: r.style,
    materialCode: r.material_code,
    materialName: r.material_name,
    category: r.category,
    unit: r.unit,
    requiredQty: r.required_qty,
    receivedQty: r.received_qty,
    unitPrice: r.unit_price,
    updateDate: r.update_date,
    createdAt: r.created_at,
  }));

  const localFiltered = filterRequirementsForDrilldown(localModels, {
    uploadDate: '2026-11-15',
    uploadDateByUploadId: uploadMap,
  });
  assert.equal(localFiltered.length, 60, 'Local/offline filter must match Supabase 60-row result identically');
});

test('Suite 5: Frontend Modal UI Pagination Math — All 30, 50, 60, 150, 1250 items reachable without truncation', () => {
  const simulateModalPagination = <T,>(items: T[], pageSize: number): T[] => {
    if (pageSize <= 0) return items;
    const totalPages = items.length === 0 ? 1 : Math.max(1, Math.ceil(items.length / pageSize));
    const renderedAcrossPages: T[] = [];
    for (let page = 1; page <= totalPages; page++) {
      const startIndex = (page - 1) * pageSize;
      renderedAcrossPages.push(...items.slice(startIndex, startIndex + pageSize));
    }
    return renderedAcrossPages;
  };

  for (const count of [30, 50, 60, 150, 1250]) {
    const data = buildAllMaterialsComparisonData(generateSampleRequirements(count, 35)).items;

    // Default pageSize = 500: 30, 50, 60, 150 render 100% on Page 1; 1250 renders across 3 pages (500+500+250)
    const defaultCollected = simulateModalPagination(data, 500);
    assert.equal(defaultCollected.length, count);

    // pageSize = 100
    const page100Collected = simulateModalPagination(data, 100);
    assert.equal(page100Collected.length, count);

    // pageSize = 0 ("Semua")
    const allCollected = simulateModalPagination(data, 0);
    assert.equal(allCollected.length, count);
  }
});

test('Suite 6: fetchAllPagedRowsFromQuery handles empty result sets gracefully', async () => {
  const mockSupabase = createMockSupabaseClient({ material_requirements: [], upload_history: [] });
  const res = await fetchAllPagedRowsFromQuery(
    () =>
      mockSupabase
        .from('material_requirements')
        .select('*', { count: 'exact' })
        .order('id', { ascending: true }),
    1000
  );
  assert.equal(res.rows.length, 0);
  assert.equal(res.pagesLoaded, 1);
});
