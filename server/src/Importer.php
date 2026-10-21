<?php
/**
 * Importer — loads every worksheet of "Prodction Data.xlsx" into the relational tables and writes an
 * exception report for anything ambiguous. Idempotent: re-importing replaces workbook-derived master data
 * but keeps users, plans, production history and approved cost updates.
 */
final class Importer
{
    private array $exceptions = [];
    private array $summary = [];
    private array $sec = [];

    public function __construct(private App $app) {}

    public function import(?string $file = null, ?callable $log = null): array
    {
        $file = $file ?? $this->app->cfg['app']['workbook'];
        $log = $log ?? fn($m) => null;
        $db = $this->app->db;
        $xl = new XlsxReader($file);
        $this->sec = $this->app->seeder->sectionIds();
        $this->exceptions = []; $this->summary = ['file' => basename($file), 'sheets' => $xl->sheetNames()];

        $db->transaction(function () use ($db, $xl, $log) {
            foreach (['bom_rows', 'capacity_rates', 'cutting_capacity', 'cutting_files'] as $t) $db->run("DELETE FROM {p}$t");
            $db->run("DELETE FROM {p}exceptions WHERE category IN ('BOM','COST','CAPACITY','ROUTING','DATA') AND status='OPEN'");

            $log('Finished Product sheet');
            $finished = $this->importFinishedProducts($xl);
            $log('BOM sheet (this takes a few seconds)');
            $this->importBom($xl, $finished);
            $log('Genset Assembly productivity');
            $this->importGensetAssembly($xl);
            $log('Canopy Assembly productivity');
            $this->importCanopyAssembly($xl);
            $log('Cutting Capacity + machine sheets');
            $this->importCutting($xl);
            $log('Choosing primary rates, reconciling discrepancies');
            $this->choosePrimaryRates();
            $this->deriveCostRates();
            $this->flushExceptions();
            $this->app->setSetting('last_import', ['file' => basename($this->summary['file']), 'at' => $db->now(), 'summary' => $this->summary]);
        });
        $this->summary['exceptions'] = count($this->exceptions);
        return $this->summary;
    }

    // ------------------------------------------------------------------ helpers
    private function ex(string $cat, string $msg, string $sev = 'WARN', ?string $refType = null, ?string $refId = null): void
    {
        $this->exceptions[] = ['category' => $cat, 'severity' => $sev, 'ref_type' => $refType, 'ref_id' => $refId, 'message' => $msg, 'status' => 'OPEN', 'reviewed_by' => null, 'reviewed_at' => null, 'created_at' => $this->app->db->now()];
    }
    private function flushExceptions(): void { $this->app->db->insertMany('exceptions', $this->exceptions); }
    private static function s($v): string { return trim((string)($v ?? '')); }
    private static function f($v): float { return is_numeric($v) ? (float)$v : (float)str_replace(',', '', (string)$v); }
    private static function isNum($v): bool { return $v !== null && $v !== '' && is_numeric($v); }

    // ------------------------------------------------------------------ Finished Product
    private function importFinishedProducts(XlsxReader $xl): array
    {
        $codes = [];
        foreach ($xl->rows('Finished Product') as $i => $r) {
            $c = self::s($r[0] ?? '');
            if ($i === 0 || $c === '') continue;
            $codes[$c] = true;
        }
        $this->summary['finished_products'] = count($codes);
        return $codes;
    }

    // ------------------------------------------------------------------ BOM
    private function importBom(XlsxReader $xl, array $finished): void
    {
        $db = $this->app->db;
        $rows = $xl->rows('BOM');
        $hdr = array_map(fn($h) => self::s($h), $rows[0]);
        $H = [];
        foreach ($hdr as $i => $h) { if ($h !== '' && !isset($H[$h])) $H[$h] = $i; }
        // the sheet has two "Unit Cost" columns (24 and 28); the first is the one aligned with "Total Cost"
        $need = ['Item number', 'Item/Resource', 'Parent Bom', 'Product name', 'Level', 'Consumption per lot size', 'Calculation Type'];
        foreach ($need as $n) if (!isset($H[$n])) throw new RuntimeException("BOM sheet is missing column '$n'");
        $g = fn(array $r, string $col) => isset($H[$col]) ? ($r[$H[$col]] ?? null) : null;

        $outdatedMonths = (int)($this->app->setting('cost_outdated_months') ?? 12);
        $cutoff = (new DateTime())->modify("-$outdatedMonths months")->format('Y-m-d');
        $batch = []; $items = []; $itemCosts = []; $dupes = []; $seen = [];
        $nRows = 0; $zeroCost = 0; $mismatch = 0; $phantom = 0; $dateCounts = [];
        $subBoms = [];  // parent => root => sorted child signature (for consistency check)

        foreach ($rows as $i => $r) {
            if ($i === 0) continue;
            $root = self::s($g($r, 'Item number')); $comp = self::s($g($r, 'Item/Resource')); $parent = self::s($g($r, 'Parent Bom'));
            if ($root === '' || $comp === '') continue;
            $calc = self::s($g($r, 'Calculation Type'));
            $level = (int)self::f($g($r, 'Level'));
            $qty = self::f($g($r, 'Consumption per lot size'));
            $costLot = self::f($g($r, 'Cost per lot size')); $lot = self::f($g($r, 'Lot Size Qty')) ?: 1.0; $cpu = self::f($g($r, 'Cost per unit'));
            $unitCost = self::f($g($r, 'Unit Cost')); $total = self::f($g($r, 'Total Cost'));
            $date = XlsxReader::serialToDate($g($r, 'Date'));
            $cg = self::s($g($r, 'Cost Group'));
            $name = self::s($g($r, 'Product name'));
            $unit = self::s($g($r, 'Unit'));
            $flags = [];
            $isPhantom = $cg === 'STATUS ITE' || str_starts_with($comp, 'S-') && $calc === 'Item' && $cpu == 0;
            if ($isPhantom) { $flags[] = 'PHANTOM'; $phantom++; }
            // Sheet semantics: "Cost per lot size" is the standard cost of the consumed quantity; "Unit Cost" (when given) is the latest price per unit.
            $derivedUnit = ($calc === 'Item' && $qty != 0) ? $costLot / $lot / abs($qty) : $cpu;
            if ($calc === 'Item' && !$isPhantom && $costLot == 0 && $unitCost == 0) { $flags[] = 'ZERO_COST'; $zeroCost++; }
            if ($calc === 'Item' && $unitCost > 0 && $derivedUnit > 0 && abs($unitCost - $derivedUnit) > 0.05 * $unitCost) $flags[] = 'PRICE_MOVED';
            if ($date && $date < $cutoff) $flags[] = 'OUTDATED';
            if ($unitCost != 0 && $total != 0 && abs($qty * $unitCost - $total) > 0.01 * max(1, abs($total))) { $flags[] = 'TOTAL_MISMATCH'; $mismatch++; }
            if ($date) $dateCounts[$date] = ($dateCounts[$date] ?? 0) + 1;
            $key = "$root|$parent|$comp";
            if (isset($seen[$key])) $dupes[$key] = ($dupes[$key] ?? 1) + 1; else $seen[$key] = true;

            $batch[] = [
                'root_code' => $root, 'parent_code' => $parent === '' ? null : $parent, 'component_code' => $comp, 'product_name' => $name,
                'status' => self::s($g($r, 'Status')), 'type1' => self::s($g($r, 'Type 1')), 'finished_code' => self::s($g($r, 'Finished Code')),
                'type2' => self::s($g($r, 'Type 2')), 'model' => self::s($g($r, 'Model')), 'type3' => self::s($g($r, 'Type 3')),
                'level' => $level, 'line_no' => (int)self::f($g($r, 'Line number')), 'qty_per' => $qty, 'unit' => $unit ?: null,
                'cost_per_lot' => $costLot, 'lot_size' => $lot, 'cost_per_unit' => $cpu, 'calc_type' => $calc,
                'warehouse' => self::s($g($r, 'Warehouse')) ?: null, 'site' => self::s($g($r, 'Site')) ?: null, 'cost_group' => $cg ?: null,
                'operation' => self::s($g($r, 'Operation')) ?: null, 'cost_date' => $date, 'unit_cost' => $unitCost, 'total_cost' => $total,
                'cost_flag' => $flags ? implode(',', $flags) : null,
            ];
            $nRows++;
            if (count($batch) >= 2000) { $db->insertMany('bom_rows', $batch); $batch = []; }

            if ($parent !== '' && !in_array($calc, ['Process', 'Rate', 'Output unit based'], true)) $subBoms[$parent][$root][] = "$comp@$qty";

            // item master
            if (in_array($calc, ['Process', 'Rate', 'Output unit based'], true)) continue;
            if (!isset($items[$comp])) {
                $cl = Families::classify($comp, $name);
                $type = match (true) {
                    $isPhantom => 'PHANTOM',
                    $calc === 'Production' || isset($finished[$comp]) => 'FINISHED',
                    $calc === 'BOM' && (str_contains($cg, 'KITBOX') || str_starts_with($comp, 'KIT')) => 'KIT',
                    $calc === 'BOM' => 'SEMI',
                    default => 'RAW',
                };
                $ptype = $type === 'FINISHED' ? (preg_match('/CANOPY|ENCLOSURE|STACKED/i', $name) && !preg_match('/GENSET/i', $name) ? 'CANOPY' : 'GENSET') : 'COMPONENT';
                $items[$comp] = ['code' => $comp, 'name' => $name, 'item_type' => $type, 'product_type' => $ptype, 'unit' => $unit ?: null,
                    'warehouse' => self::s($g($r, 'Warehouse')) ?: null, 'cost_group' => $cg ?: null, 'type1' => self::s($g($r, 'Type 1')) ?: null,
                    'type2' => self::s($g($r, 'Type 2')) ?: null, 'type3' => self::s($g($r, 'Type 3')) ?: null, 'bom_model' => self::s($g($r, 'Model')) ?: null, 'model' => $cl['model'],
                    'family' => $cl['family'], 'is_finished_product' => isset($finished[$comp]) ? 1 : 0,
                    'std_cost' => $derivedUnit, 'current_price' => $unitCost > 0 ? $unitCost : null, 'cost_status' => null, 'cost_date' => $date, 'cost_updated_at' => null, 'cost_updated_by' => null];
                $itemCosts[$comp] = [(string)round($derivedUnit, 2) => true];
            } else {
                $itemCosts[$comp][(string)round($derivedUnit, 2)] = true;
                if ($unitCost > 0 && empty($items[$comp]['current_price'])) $items[$comp]['current_price'] = $unitCost;
                if ($items[$comp]['item_type'] === 'RAW' && $calc === 'BOM') $items[$comp]['item_type'] = 'SEMI';
                if (isset($finished[$comp])) { $items[$comp]['item_type'] = 'FINISHED'; $items[$comp]['is_finished_product'] = 1; }
            }
        }
        if ($batch) $db->insertMany('bom_rows', $batch);

        // item cost status + write items (preserving approved cost overrides)
        $existing = [];
        foreach ($db->all('SELECT code, std_cost, cost_updated_at, cost_updated_by FROM {p}items WHERE cost_updated_by IS NOT NULL') as $e) $existing[$e['code']] = $e;
        $db->run('DELETE FROM {p}items');
        $inconsistent = 0;
        foreach ($items as $code => &$it) {
            $costs = array_keys($itemCosts[$code]);
            $nonzero = array_filter($costs, fn($c) => (float)$c != 0);
            if ($it['item_type'] === 'RAW' || $it['item_type'] === 'KIT' || $it['item_type'] === 'SEMI') {
                if ($it['item_type'] === 'RAW' && count($nonzero) > 1 && (max($nonzero) - min($nonzero)) > 0.05 * max($nonzero)) {
                    $it['cost_status'] = 'INCONSISTENT'; $inconsistent++;
                    $this->ex('COST', "Material $code ($it[name]) is costed at " . count($nonzero) . " different unit values across BOM lines: " . implode(', ', array_map(fn($c) => number_format((float)$c, 2), $nonzero)) . '. The highest is used until the Cost Accountant confirms the standard.', 'WARN', 'item', $code);
                    $it['std_cost'] = max($nonzero);
                } elseif ($it['item_type'] === 'RAW' && !$nonzero && empty($it['current_price'])) $it['cost_status'] = 'ZERO';
                elseif ($it['item_type'] === 'RAW' && $it['current_price'] && $it['std_cost'] > 0 && abs($it['current_price'] - $it['std_cost']) > 0.05 * $it['std_cost']) { $it['cost_status'] = 'PRICE_MOVED'; }
                elseif ($it['cost_date'] && $it['cost_date'] < $cutoff) $it['cost_status'] = 'OUTDATED';
                else $it['cost_status'] = 'OK';
                if ($nonzero && $it['std_cost'] == 0) $it['std_cost'] = max($nonzero);
                if ($it['std_cost'] == 0 && !empty($it['current_price'])) { $it['std_cost'] = $it['current_price']; $it['cost_status'] = 'OK'; }
            } else $it['cost_status'] = $it['cost_date'] && $it['cost_date'] < $cutoff ? 'OUTDATED' : 'OK';
            if ($it['item_type'] === 'PHANTOM') $it['cost_status'] = 'OK';
            if (isset($existing[$code])) { $it['std_cost'] = (float)$existing[$code]['std_cost']; $it['cost_updated_at'] = $existing[$code]['cost_updated_at']; $it['cost_updated_by'] = $existing[$code]['cost_updated_by']; $it['cost_status'] = 'OK'; }
        }
        unset($it);
        $db->insertMany('items', array_values($items), 300);

        // exceptions
        $zeroItems = array_filter($items, fn($i) => $i['cost_status'] === 'ZERO');
        $moved = array_filter($items, fn($i) => $i['cost_status'] === 'PRICE_MOVED');
        $this->summary['price_moved_items'] = count($moved);
        foreach ($moved as $code => $i) $this->ex('COST', "Material $code ($i[name]): latest unit price " . number_format((float)$i['current_price'], 2) . " differs from the BOM standard " . number_format((float)$i['std_cost'], 2) . " by more than 5%. Standard is used until approved.", 'INFO', 'item', $code);
        $this->summary['bom_rows'] = $nRows; $this->summary['items'] = count($items);
        $this->summary['items_by_type'] = array_count_values(array_column($items, 'item_type'));
        $this->summary['zero_cost_rows'] = $zeroCost; $this->summary['zero_cost_items'] = count($zeroItems); $this->summary['total_mismatch_rows'] = $mismatch; $this->summary['phantom_rows'] = $phantom;
        $this->summary['duplicate_keys'] = count($dupes); $this->summary['inconsistent_cost_items'] = $inconsistent;
        arsort($dateCounts);
        $this->summary['cost_dates'] = array_slice($dateCounts, 0, 5, true);
        foreach ($zeroItems as $code => $i) $this->ex('COST', "Material $code ($i[name]) has a zero unit cost in the BOM sheet. Costing treats it as missing and flags every plan that uses it.", 'WARN', 'item', $code);
        if ($dateCounts) {
            $newest = max(array_keys($dateCounts));
            if ($newest < $cutoff) $this->ex('COST', "All BOM costs are dated $newest (older than $outdatedMonths months). Every cost is flagged OUTDATED until the Cost Accountant confirms or updates it.", 'WARN', 'bom', null);
        }
        if ($mismatch) $this->ex('DATA', "$mismatch BOM rows have Total Cost ≠ Consumption × Unit Cost. The engine recalculates extended cost from quantity × unit cost and ignores the sheet's Total Cost column.", 'INFO', 'bom', null);
        if ($phantom) $this->ex('BOM', "$phantom rows are status/phantom items (cost group STATUS ITE, +1/−1 pairs such as S-BASE-S3-OPT). They carry no material or cost and are excluded from requirements.", 'INFO', 'bom', null);
        if ($dupes) {
            $sample = array_slice(array_keys($dupes), 0, 8);
            $this->ex('BOM', count($dupes) . ' (root, parent, component) combinations appear more than once (e.g. ' . implode('; ', $sample) . '). Each row is kept and consumed as written — review whether these are genuine repeated lines.', 'WARN', 'bom', null);
        }
        $diff = 0;
        foreach ($subBoms as $parent => $byRoot) {
            $sigs = [];
            foreach ($byRoot as $root => $kids) { sort($kids); $sigs[implode('|', $kids)][] = $root; }
            if (count($sigs) > 1) { $diff++; $this->ex('BOM', "Sub-assembly $parent has a different component list depending on the finished product it is exploded under (" . implode(' vs ', array_map(fn($rs) => implode(',', array_slice($rs, 0, 3)), $sigs)) . "). The engine uses the rows recorded under the requested finished product.", 'WARN', 'item', $parent); }
        }
        $this->summary['subbom_variants'] = $diff;
        // routing coverage: sub-assemblies with no process rows
        $noRoute = $db->all("SELECT DISTINCT component_code, product_name FROM {p}bom_rows b WHERE calc_type='BOM' AND NOT EXISTS (SELECT 1 FROM {p}bom_rows p WHERE p.root_code=b.root_code AND p.parent_code=b.component_code AND p.calc_type='Process') AND EXISTS (SELECT 1 FROM {p}bom_rows c WHERE c.root_code=b.root_code AND c.parent_code=b.component_code)");
        $this->summary['subassemblies_without_routing'] = count($noRoute);
        foreach ($noRoute as $r) if (!str_starts_with($r['component_code'], 'KIT') && !preg_match('/KIT/', (string)$r['product_name'])) $this->ex('ROUTING', "Sub-assembly $r[component_code] ($r[product_name]) has component lines but no labour/process rows. It is planned as a kitting / purchased assembly with no section operation.", 'INFO', 'item', $r['component_code']);
        $unknownRes = $db->all("SELECT DISTINCT component_code, product_name, operation FROM {p}bom_rows WHERE calc_type='Process' AND component_code NOT IN (SELECT code FROM {p}resources)");
        foreach ($unknownRes as $r) $this->ex('ROUTING', "Process resource $r[component_code] ($r[product_name], operation $r[operation]) is not mapped to a manufacturing section. Operations using it are skipped until an administrator maps it.", 'ERROR', 'resource', $r['component_code']);
    }

    // ------------------------------------------------------------------ Genset Assembly sheet
    private const GA_BLOCKS = [
        'Base_Cutting' => 'BASE_CUT', 'Canopy Cutting' => 'CANOPY_CUT', 'Base_Bending' => 'IK_BEND', 'Canopy Bending' => 'CANOPY_BEND',
        'Panels_Bending' => 'IK_BEND', 'Canopy Welding' => 'CANOPY_WELD', 'Canopy Grinding' => 'CANOPY_GRIND', 'Canopy PWC' => 'CANOPY_PWC',
        'White Goods_Manual Shearing Machine' => 'PANEL_CUT', 'White Goods_Punch Manual' => 'PANEL_CUT', 'Panels_Cutting' => 'PANEL_CUT',
        'Base_Welding P13 to P165' => 'BASE_WELD', 'Base_Welding_P250_P800' => 'BASE_WELD', 'White Goods_welding' => 'BASE_WELD', 'Panels_Welding' => 'PANEL_WELD',
        'Base_grinding' => 'BASE_GRIND', 'Base_Testing' => 'BASE_TEST', 'Panels_Grinding' => 'PANEL_GRIND', 'Base_PWC' => 'IK_PWC',
        'White Goods_PWC' => 'IK_PWC', 'Panels_PWC' => 'IK_PWC', 'Panels_Metal Assembly' => 'PANEL_ASSY', 'Panels_Electical Assembly' => 'PANEL_ASSY',
        'JMG gensets_assembly' => 'GENSET_ASSY', 'JMG gensets_Pre_testing' => 'GENSET_PRETEST', 'JMG gensets_testing' => 'GENSET_TEST',
        'JMG gensets_Post_testing' => 'GENSET_POSTTEST', 'STC_Day' => 'CANOPY_STAND', 'GSP' => 'CANOPY_GLASS', 'PKG' => 'PACKAGING',
    ];

    private function importGensetAssembly(XlsxReader $xl): void
    {
        $rows = $xl->rows('Genset Assembly');
        $n = 0;
        foreach ($rows as $r) {
            $code = self::s($r[0] ?? ''); $type = self::s($r[1] ?? '');
            if ($code === '' || $type === '' || in_array($code, ['Finished Code', 'Type', '0'], true)) continue;
            if (str_starts_with($code, 'Optional')) continue;
            $blockKey = $type; if (!isset(self::GA_BLOCKS[$blockKey])) $blockKey = self::s($r[2] ?? '');
            $scode = self::GA_BLOCKS[$blockKey] ?? self::GA_BLOCKS[$type] ?? null;
            if (!$scode) { $this->ex('CAPACITY', "Genset Assembly sheet: production type '$type' (code $code) is not mapped to a section; row ignored.", 'WARN', 'capacity', $code); continue; }
            $isGroup = in_array($type, ['STC', 'GSP', 'PKG'], true);
            $perLine = self::f($r[3] ?? 0); $staff = self::f($r[4] ?? 0); $lines = self::f($r[5] ?? 0); $total = self::f($r[6] ?? 0); $new = self::f($r[12] ?? 0);
            if ($isGroup) { $total = $total ?: $new; }
            $units = $total > 0 ? $total : $perLine;
            $cl = Families::classify($code);
            $family = $cl['family'] ?? ($type === 'White Goods_Manual Shearing Machine' ? 'ALL' : null);
            if (!$family) { $this->ex('CAPACITY', "Genset Assembly sheet: cannot derive a model family from code '$code' ($type). Rate stored with family UNKNOWN and matched by exact code only.", 'INFO', 'capacity', $code); $family = 'UNKNOWN'; }
            $note = "Productivity $perLine" . ($staff ? ", staff $staff" : '') . ($lines ? ", lines $lines" : '') . ", total $total" . ($new ? ", revised (new staffing) $new" : '') . ($blockKey !== $type ? " [$blockKey]" : '');
            $this->addRate($scode, $family, $cl['model'], 'Genset Assembly sheet: ' . $type, $code, $units, $perLine, $staff, $lines, $note);
            if ($new > 0 && abs($new - $units) > 0.01) $this->addRate($scode, $family, $cl['model'], 'Genset Assembly sheet (New Productivity): ' . $type, $code, $new, $perLine, $staff, $lines, 'Revised productivity after staffing change');
            $n++;
        }
        $this->summary['genset_assembly_rates'] = $n;
    }

    // ------------------------------------------------------------------ Canopy Assembly sheet
    private const CA_BLOCKS = [
        'Canopy Cutting' => 'CANOPY_CUT', 'Canopy Pwc' => 'CANOPY_PWC', 'General Welding' => 'CANOPY_WELD', 'Door And Roof Grinding' => 'CANOPY_GRIND',
        'STC_Day' => 'CANOPY_STAND', 'Packaging_Day' => 'PACKAGING', 'Canopy Stacking' => 'CANOPY_STAND', 'Canopy Dealers Scoa STC' => 'CANOPY_STAND',
        'Lister electrical assembly' => 'GENSET_ASSY', 'Lister mechanical assembly' => 'GENSET_ASSY', 'Preparation of AC looms' => 'LOOM_ASSY', 'Lister testing' => 'GENSET_TEST',
        'Lister Control Panel' => 'PANEL_ASSY', 'Foam Cutting' => 'CANOPY_FOAM', 'Finishing Foam Fixing and GSP_Day' => 'CANOPY_GLASS', 'Exhaust Pot Welding' => 'EXH_WELD',
        'Base Tank for 350-500' => 'BASE_WELD', 'Stackers Cutting section' => 'CANOPY_CUT', 'Stackers Powder Coating Section' => 'CANOPY_PWC',
        'Welding DT1500' => 'EXH_WELD', 'Framing Of DT1500' => 'EXH_WELD', 'Welding Of DT Channels' => 'EXH_WELD', 'Testing Of DT1500' => 'BASE_TEST',
        'Grinding Of Deisel Tanks 1500' => 'EXH_GRIND', 'Painting Deisel Tanks 1500' => 'EXH_PAINT', 'Welding Oil Tanks Small' => 'BASE_WELD', 'Framing Base' => 'BASE_WELD',
        'Grinding Of Base Frames' => 'BASE_GRIND', 'Testing Of Oil Tanks and base' => 'BASE_TEST', 'Wedling Channels' => 'BASE_WELD',
        'Base frame (145 ltrs) weld' => 'BASE_WELD', 'Base frame (145ltrs) grind' => 'BASE_GRIND', 'Base frame (145ltrs) test' => 'BASE_TEST',
    ];

    private function importCanopyAssembly(XlsxReader $xl): void
    {
        $rows = $xl->rows('Canopy Assembly');
        $n = 0; $hdr = null;
        foreach ($rows as $r) {
            $type = self::s($r[0] ?? ''); $dept = self::s($r[1] ?? ''); $section = self::s($r[2] ?? '');
            if ($type === 'Type') { $hdr = array_map(fn($h) => self::s($h), $r); continue; }
            if ($type === '' || $type === '0' || $dept === '' || $section === '') continue;
            $scode = self::CA_BLOCKS[$section] ?? null;
            if (!$scode) { $this->ex('CAPACITY', "Canopy Assembly sheet: section '$section' ($dept, type $type) is not mapped; row ignored.", 'WARN', 'capacity', $type); continue; }
            $perUnit = self::f($r[3] ?? 0); $staff = self::f($r[4] ?? 0); $prod = self::f($r[5] ?? 0); $new = self::f($r[11] ?? 0);
            $units = $prod > 0 ? $prod : ($new > 0 ? $new : $perUnit);
            $cl = Families::classify($type);
            $family = $cl['family'] ?? 'UNKNOWN';
            if ($family === 'UNKNOWN') $this->ex('CAPACITY', "Canopy Assembly sheet: cannot derive a model family from type '$type' ($section). Stored with family UNKNOWN.", 'INFO', 'capacity', $type);
            $colName = $hdr[3] ?? 'Productivity'; $prodName = $hdr[5] ?? 'Productivity';
            $note = "$colName $perUnit" . ($staff ? ", staff $staff" : '') . ", $prodName $prod" . ($new ? ", new productivity $new" : '') . " [$dept / $section]";
            $this->addRate($scode, $family, $cl['model'], 'Canopy Assembly sheet: ' . $section, $type, $units, $perUnit, $staff, null, $note);
            if ($new > 0 && abs($new - $units) > 0.01) $this->addRate($scode, $family, $cl['model'], 'Canopy Assembly sheet (New Productivity): ' . $section, $type, $new, $perUnit, $staff, null, 'Revised productivity after staffing change');
            $n++;
        }
        $this->summary['canopy_assembly_rates'] = $n;
    }

    // ------------------------------------------------------------------ Cutting
    private function importCutting(XlsxReader $xl): void
    {
        $db = $this->app->db;
        $rows = $xl->rows('Cutting Capacity');
        $machines = ['Punch 1', 'Punch 2', 'Plasma'];
        $n = 0;
        foreach ($rows as $i => $r) {
            if ($i < 2) continue;
            $type = self::s($r[0] ?? '');
            if ($type === '') continue;
            $cl = Families::classify($type);
            $family = $cl['family'] ?? $type;
            $summaryQty = self::f($r[10] ?? 0);
            $recordedMin = [];
            foreach ($machines as $k => $m) {
                $minutes = self::f($r[1 + $k] ?? 0); $calc = self::f($r[4 + $k] ?? 0); $rec = self::f($r[7 + $k] ?? 0); $pct = self::f($r[12 + $k] ?? 0);
                $db->insert('cutting_capacity', ['family' => $family, 'machine' => $m, 'minutes_per_canopy' => $minutes, 'qty_per_shift_calc' => $calc, 'qty_per_shift_recorded' => $rec,
                    'summary_qty_per_shift' => $summaryQty, 'minutes_required_per_canopy' => self::f($r[11] ?? 0), 'pct_machine_consumed' => $pct]);
                if ($rec > 0) $recordedMin[$m] = $rec;
                if ($minutes > 0 && abs($calc - 480 / $minutes) > 0.5) $this->ex('CAPACITY', "Cutting Capacity: $type on $m — $minutes min/canopy implies " . round(480 / $minutes, 1) . "/shift but the sheet shows $calc.", 'INFO', 'cutting', $type);
            }
            if ($recordedMin) {
                $bottleneck = array_keys($recordedMin, min($recordedMin))[0];
                $this->addRate('CANOPY_CUT', $family, $cl['model'], 'Cutting Capacity sheet (slowest machine: ' . $bottleneck . ')', $type, min($recordedMin), null, null, 3, 'Machine-level: Punch 1 ' . ($recordedMin['Punch 1'] ?? '-') . ', Punch 2 ' . ($recordedMin['Punch 2'] ?? '-') . ', Plasma ' . ($recordedMin['Plasma'] ?? '-') . " per shift; summary column says $summaryQty");
                if ($summaryQty > 0 && abs($summaryQty - min($recordedMin)) > 0.5) $this->ex('CAPACITY', "Cutting Capacity: $type — summary 'Qty Produced Per Shift' is $summaryQty but the slowest machine ($bottleneck) only produces " . min($recordedMin) . "/shift. The engine uses the machine figure; please validate.", 'WARN', 'cutting', $type);
            }
            $n++;
        }
        $this->summary['cutting_models'] = $n;

        // detailed machine sheets
        $sheetFamilies = ['Capacity S1' => 'S1', 'Capacity S2' => 'S2', 'CapacityS3' => 'S3', 'CapacityS4' => 'S4', 'Capacity200' => '200-250', 'Capacity500' => '350-500'];
        $files = 0;
        foreach ($sheetFamilies as $sheet => $family) {
            if (!in_array($sheet, $xl->sheetNames(), true)) { $this->ex('DATA', "Worksheet '$sheet' not found in workbook.", 'WARN'); continue; }
            $rows = $xl->rows($sheet);
            $machine = null; $capPerShift = null; $sectionTotals = [];
            foreach ($rows as $r) {
                $c0 = self::s($r[0] ?? '');
                $norm = strtolower(str_replace(' ', '', $c0));
                if (in_array($norm, ['punch1', 'punch2', 'plasma'], true)) { $machine = $norm === 'punch1' ? 'Punch 1' : ($norm === 'punch2' ? 'Punch 2' : 'Plasma'); continue; }
                foreach ($r as $ci => $v) if (self::s($v) === 'Capacity/shift' && $capPerShift === null) { $next = $rows[array_search($r, $rows, true) + 1] ?? null; if ($next && self::isNum($next[$ci] ?? null)) $capPerShift = self::f($next[$ci]); }
                if ($machine && preg_match('/^file\s*\d+/i', $c0)) {
                    $desc = self::s($r[1] ?? '');
                    $minutes = null; $plate = null;
                    for ($ci = count($r) - 1; $ci >= 2; $ci--) { if (self::isNum($r[$ci] ?? null) && $minutes === null && $ci <= 7) $minutes = self::f($r[$ci]); }
                    foreach ($r as $v) if (is_string($v) && preg_match('/plate|sheet|scrap/i', $v)) $plate = self::s($v);
                    $db->insert('cutting_files', ['family' => $family, 'machine' => $machine, 'file_name' => $c0, 'description' => $desc, 'minutes' => $minutes, 'plate' => $plate, 'sheet_name' => $sheet]);
                    $sectionTotals[$machine] = ($sectionTotals[$machine] ?? 0) + ($minutes ?? 0);
                    $files++;
                }
            }
            foreach ($sectionTotals as $m => $tot) {
                $perShift = $tot > 0 ? 480 / $tot : 0;
                $this->addRate('CANOPY_CUT', $family, null, "$sheet (sum of $m file times)", $sheet, round($perShift, 2), $tot, null, 1, "$tot min per canopy on $m → " . round($perShift, 1) . " canopies/shift; sheet header says Capacity/shift = " . ($capPerShift ?? '?'));
            }
            if ($capPerShift !== null) $this->addRate('CANOPY_CUT', $family, null, "$sheet header (Capacity/shift)", $sheet, $capPerShift, null, null, 3, 'Stated capacity per shift on the detailed machine sheet');
        }
        $this->summary['cutting_files'] = $files;
    }

    private function addRate(string $scode, string $family, ?string $model, string $source, string $sourceCode, float $units, ?float $perUnit, ?float $staff, ?float $lines, ?string $notes): void
    {
        $this->app->db->insert('capacity_rates', ['section_id' => $this->sec[$scode], 'family' => $family, 'model' => $model, 'source' => $source, 'source_code' => $sourceCode,
            'units_per_day' => $units, 'per_unit_rate' => $perUnit, 'staff' => $staff, 'lines' => $lines, 'is_primary' => 0, 'notes' => $notes]);
    }

    /**
     * Primary-rate policy (editable afterwards in Capacity Master):
     *  - CANOPY_CUT: Cutting Capacity sheet machine figure, else detailed sheet header, else assembly sheets.
     *  - Gbagada canopy sections: Canopy Assembly sheet current productivity.
     *  - Ikotun sections: Genset Assembly sheet current total productivity.
     *  Zero rates are never primary. Discrepancies between sources become CAPACITY exceptions.
     */
    private function choosePrimaryRates(): void
    {
        $db = $this->app->db;
        $rates = $db->all('SELECT r.*, s.code AS scode, s.site FROM {p}capacity_rates r JOIN {p}sections s ON s.id=r.section_id WHERE r.units_per_day > 0 ORDER BY r.id');
        $groups = [];
        foreach ($rates as $r) $groups[$r['section_id'] . '|' . $r['family'] . '|' . ($r['model'] ?? '')][] = $r;
        $primaries = 0; $disc = 0;
        foreach ($groups as $key => $list) {
            $scode = $list[0]['scode'];
            usort($list, function ($a, $b) use ($scode) {
                return self::sourceRank($scode, $a) <=> self::sourceRank($scode, $b);
            });
            $db->run('UPDATE {p}capacity_rates SET is_primary=1 WHERE id=?', [$list[0]['id']]);
            $primaries++;
            $vals = array_unique(array_map(fn($r) => round((float)$r['units_per_day'], 2), $list));
            if (count($vals) > 1 && (max($vals) - min($vals)) > 0.15 * max($vals)) {
                $disc++;
                $desc = implode(' | ', array_map(fn($r) => $r['source'] . ' (' . $r['source_code'] . ') = ' . round((float)$r['units_per_day'], 1) . '/day', $list));
                $this->ex('CAPACITY', "Productivity for section {$list[0]['scode']}, family {$list[0]['family']}" . ($list[0]['model'] ? " / model {$list[0]['model']}" : '') . " differs between worksheets: $desc. Using '{$list[0]['source']}' until management validates.", 'WARN', 'capacity', $list[0]['scode'] . ':' . $list[0]['family']);
            }
        }
        $this->summary['primary_rates'] = $primaries; $this->summary['capacity_discrepancies'] = $disc;
    }

    private static function sourceRank(string $scode, array $r): int
    {
        $src = $r['source'];
        if ($scode === 'CANOPY_CUT') {
            if (str_starts_with($src, 'Cutting Capacity')) return 0;
            if (str_contains($src, 'header')) return 1;
            if (str_contains($src, 'sum of')) return 2;
            if (str_starts_with($src, 'Canopy Assembly sheet:')) return 3;
            return 5;
        }
        $gb = in_array($scode, ['CANOPY_BEND', 'CANOPY_WELD', 'CANOPY_GRIND', 'CANOPY_PWC', 'CANOPY_STAND', 'CANOPY_GLASS', 'CANOPY_FOAM', 'PACKAGING', 'EXH_WELD', 'EXH_GRIND', 'EXH_PAINT'], true);
        $isCanopySheet = str_starts_with($src, 'Canopy Assembly sheet:');
        $isGensetSheet = str_starts_with($src, 'Genset Assembly sheet:');
        $isNew = str_contains($src, 'New Productivity');
        if ($gb) return $isCanopySheet ? 0 : ($isGensetSheet ? 1 : ($isNew ? 3 : 2));
        return $isGensetSheet ? 0 : ($isCanopySheet ? 1 : ($isNew ? 3 : 2));
    }

    /** Labour and overhead rates per section derived from the BOM Process / Rate rows (cost per hour). Editable later. */
    private function deriveCostRates(): void
    {
        $db = $this->app->db;
        if ($db->val('SELECT COUNT(*) FROM {p}cost_rates')) return; // keep configured rates
        $lab = $db->all("SELECT r.section_id, AVG(b.cost_per_lot / b.qty_per) AS rate FROM {p}bom_rows b JOIN {p}resources r ON r.code=b.component_code WHERE b.calc_type='Process' AND b.qty_per>0 AND b.cost_per_lot>0 AND r.kind='LABOUR' GROUP BY r.section_id");
        foreach ($lab as $l) $db->insert('cost_rates', ['kind' => 'LABOUR', 'section_id' => $l['section_id'], 'rate_per_hour' => round((float)$l['rate'], 2), 'pct_of_material' => null, 'valid_from' => '2021-02-17', 'notes' => 'Derived from BOM labour (Process) rows']);
        $mch = $db->all("SELECT r.section_id, AVG(b.cost_per_lot / b.qty_per) AS rate FROM {p}bom_rows b JOIN {p}resources r ON r.code=b.component_code WHERE b.calc_type='Process' AND b.qty_per>0 AND b.cost_per_lot>0 AND r.kind='MACHINE' GROUP BY r.section_id");
        foreach ($mch as $l) $db->insert('cost_rates', ['kind' => 'MACHINE_OVERHEAD', 'section_id' => $l['section_id'], 'rate_per_hour' => round((float)$l['rate'], 2), 'pct_of_material' => null, 'valid_from' => '2021-02-17', 'notes' => 'Derived from BOM machine (Process, MCH OVH) rows']);
        // manufacturing overhead and labour overhead follow the labour resource they are attached to (MOVH-x / LOVH-x share the resource suffix)
        foreach (['MOVH' => 'MFG_OVERHEAD', 'LOVH' => 'LABOUR_OVERHEAD'] as $prefix => $kind) {
            $rows = $db->all("SELECT b.component_code, AVG(b.cost_per_lot / b.qty_per) AS rate FROM {p}bom_rows b WHERE b.calc_type='Rate' AND b.component_code LIKE ? AND b.qty_per>0 AND b.cost_per_lot>0 GROUP BY b.component_code", [$prefix . '-%']);
            $bySection = [];
            foreach ($rows as $r) {
                $suffix = substr($r['component_code'], strlen($prefix) + 1); // e.g. IK-GAS, GB-CCT-L
                $res = $db->one("SELECT section_id FROM {p}resources WHERE code LIKE ? OR code LIKE ? ORDER BY code LIMIT 1", [$suffix . '-%', rtrim($suffix, '-L') . '-%']);
                if ($res) $bySection[$res['section_id']][] = (float)$r['rate'];
            }
            foreach ($bySection as $sid => $vals) $db->insert('cost_rates', ['kind' => $kind, 'section_id' => $sid, 'rate_per_hour' => round(array_sum($vals) / count($vals), 2), 'pct_of_material' => null, 'valid_from' => '2021-02-17', 'notes' => "Derived from BOM $prefix overhead (Rate) rows"]);
        }
        $mto = $db->val("SELECT AVG(CASE WHEN p.cost_per_unit>0 THEN b.cost_per_lot / p.cost_per_unit ELSE NULL END) FROM {p}bom_rows b JOIN {p}bom_rows p ON p.root_code=b.root_code AND p.component_code=b.parent_code WHERE b.component_code='MTOVHD' AND b.cost_per_lot>0");
        $db->insert('cost_rates', ['kind' => 'MATERIAL_OVERHEAD', 'section_id' => null, 'rate_per_hour' => null, 'pct_of_material' => $mto ? round((float)$mto * 100, 2) : 0, 'valid_from' => '2021-02-17', 'notes' => 'Material overhead (MTOVHD rows) as % of sub-assembly cost; 0 where the sheet shows none']);
    }
}
