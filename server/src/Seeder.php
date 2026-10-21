<?php
/** Seeder — master data that is not in the workbook: manufacturing sections, resource routing map, machines, calendar, users. */
final class Seeder
{
    public function __construct(private App $app) {}

    public const ACTIVITIES = [
        'CUT_BEND' => 'Cutting and Bending', 'WELD' => 'Welding', 'PWC' => 'Powder Coating', 'BASE' => 'Base Frame Manufacturing',
        'PANEL' => 'Panel / Basic Component Manufacturing', 'CANOPY_ASSY' => 'Canopy Assembly', 'GENSET_ASSY' => 'Genset Assembly',
        'QC' => 'Final Quality Inspection', 'FG' => 'Finished Goods Receipt',
    ];

    /** code, name, department, activity, seq, site, lines, staff, colour */
    public const SECTIONS = [
        ['CANOPY_CUT', 'Canopy Cutting (Punch 1 / Punch 2 / Plasma)', 'Cutting and Bending', 'CUT_BEND', 10, 'Gbagada', 3, 2, '#2a78d6'],
        ['CANOPY_BEND', 'Canopy Bending', 'Cutting and Bending', 'CUT_BEND', 20, 'Gbagada', 1, 2, '#3f8fe0'],
        ['BASE_CUT', 'Base Laser Cutting', 'Cutting and Bending', 'BASE', 10, 'Ikotun', 1, 1, '#1f6fc0'],
        ['IK_BEND', 'Ikotun Bending (Bases & Panels)', 'Cutting and Bending', 'BASE', 20, 'Ikotun', 1, 1, '#5aa0e8'],
        ['PANEL_CUT', 'Panel Punch Cutting', 'Panel Manufacturing', 'PANEL', 10, 'Ikotun', 1, 1, '#4b8fd8'],
        ['CUT_THREAD', 'Cutting & Threading (pipes, fillers)', 'Cutting and Bending', 'CUT_BEND', 12, 'Ikotun', 1, 1, '#7ab3ec'],
        ['CANOPY_WELD', 'Canopy Welding', 'Welding', 'WELD', 30, 'Gbagada', 1, 7, '#eb6834'],
        ['CANOPY_GRIND', 'Canopy Grinding', 'Welding', 'WELD', 40, 'Gbagada', 1, 6, '#f08a5e'],
        ['BASE_WELD', 'Base Frame Welding', 'Base Frame Manufacturing', 'BASE', 30, 'Ikotun', 4, 15, '#d95926'],
        ['BASE_GRIND', 'Base Frame Grinding', 'Base Frame Manufacturing', 'BASE', 40, 'Ikotun', 4, 8, '#e87a4f'],
        ['BASE_TEST', 'Base Tank Testing', 'Base Frame Manufacturing', 'BASE', 50, 'Ikotun', 4, 6, '#c9792a'],
        ['PANEL_WELD', 'Panel Welding', 'Panel Manufacturing', 'PANEL', 30, 'Ikotun', 1, 2, '#f29b6b'],
        ['PANEL_GRIND', 'Panel Grinding', 'Panel Manufacturing', 'PANEL', 40, 'Ikotun', 1, 2, '#f4ad86'],
        ['EXH_WELD', 'Exhaust & Diesel Tank Welding', 'Welding', 'WELD', 30, 'Gbagada', 1, 3, '#c75b2e'],
        ['EXH_GRIND', 'Exhaust & Diesel Tank Grinding', 'Welding', 'WELD', 40, 'Gbagada', 1, 2, '#d47b55'],
        ['EXH_PAINT', 'Exhaust & Diesel Tank Painting', 'Powder Coating', 'PWC', 60, 'Gbagada', 1, 2, '#b98a1c'],
        ['CANOPY_PWC', 'Canopy Powder Coating', 'Powder Coating', 'PWC', 60, 'Gbagada', 1, 2, '#eda100'],
        ['IK_PWC', 'Ikotun Powder Coating Line (Bases & Panels)', 'Powder Coating', 'PWC', 60, 'Ikotun', 1, 1, '#c98500'],
        ['LOOM_ASSY', 'Power Loom & Cable Assembly', 'Panel Manufacturing', 'PANEL', 70, 'Ikotun', 1, 2, '#8e7cc3'],
        ['PANEL_ASSY', 'Control Panel Assembly', 'Panel Manufacturing', 'PANEL', 80, 'Ikotun', 1, 21, '#7b5fc0'],
        ['CANOPY_STAND', 'Canopy Standing / Soundproofing (STC)', 'Canopy Assembly', 'CANOPY_ASSY', 90, 'Gbagada', 1, 30, '#1baf7a'],
        ['CANOPY_GLASS', 'Canopy Glass Fixing / GSP', 'Canopy Assembly', 'CANOPY_ASSY', 100, 'Gbagada', 1, 4, '#2fc08c'],
        ['CANOPY_FOAM', 'Foam Cutting & Fixing', 'Canopy Assembly', 'CANOPY_ASSY', 110, 'Gbagada', 1, 4, '#56cf9f'],
        ['GENSET_ASSY', 'Genset Assembly', 'Genset Assembly', 'GENSET_ASSY', 120, 'Ikotun', 7, 21, '#199e70'],
        ['GENSET_PRETEST', 'Genset Pre-test', 'Final Quality Inspection', 'QC', 130, 'Ikotun', 1, 4, '#5b6b7a'],
        ['GENSET_TEST', 'Genset Testing', 'Final Quality Inspection', 'QC', 140, 'Ikotun', 1, 4, '#44535f'],
        ['GENSET_POSTTEST', 'Post-test Finishing', 'Final Quality Inspection', 'QC', 150, 'Ikotun', 1, 8, '#6f7f8e'],
        ['PACKAGING', 'Packaging & Dispatch Preparation', 'Finished Goods', 'FG', 160, 'Gbagada', 1, 10, '#8a8a8a'],
        ['FG_RECEIPT', 'Finished Goods Receipt', 'Finished Goods', 'FG', 170, 'Warehouse', 1, 1, '#a0a0a0'],
    ];

    /** resource code => [name, kind, section code, seq] — the labour / machine resources used in the BOM Process rows. */
    public const RESOURCES = [
        'GB-MCM-1' => ['Manual Cutting Machine (Gbagada)', 'MACHINE', 'CANOPY_CUT', 10],
        'GB-CCT-1' => ['Gbagada Cutting Worker', 'LABOUR', 'CANOPY_CUT', 10],
        'GB-BBM-1' => ['Baykal Bending Machine (Gbagada)', 'MACHINE', 'CANOPY_BEND', 20],
        'GB-CBD-1' => ['Gbagada Bending Worker', 'LABOUR', 'CANOPY_BEND', 20],
        'GB-CWL-1' => ['Gbagada Canopy Welding Worker', 'LABOUR', 'CANOPY_WELD', 30],
        'GB-CGR-1' => ['Gbagada Canopy Grinder Worker', 'LABOUR', 'CANOPY_GRIND', 40],
        'GB-PCP-1' => ['Gbagada Powder Coating Plant', 'MACHINE', 'CANOPY_PWC', 60],
        'GB-CPW-1' => ['Gbagada Canopy Powder Coating Worker', 'LABOUR', 'CANOPY_PWC', 60],
        'GB-CST-1' => ['Gbagada Canopy Standing Worker', 'LABOUR', 'CANOPY_STAND', 90],
        'GB-CGS-1' => ['Gbagada Canopy Glass Fixing Worker', 'LABOUR', 'CANOPY_GLASS', 100],
        'GB-CFF-1' => ['Gbagada Canopy Foam Cutting Worker', 'LABOUR', 'CANOPY_FOAM', 110],
        'GB-CPK-1' => ['Gbagada Canopy Packaging Worker', 'LABOUR', 'PACKAGING', 160],
        'GB-EX&DT-1' => ['Gbagada Exhaust & Diesel Tank Welding Worker', 'LABOUR', 'EXH_WELD', 30],
        'GB-EX&DT-2' => ['Gbagada Exhaust & Diesel Tank Grinding Worker', 'LABOUR', 'EXH_GRIND', 40],
        'GB-TPN-1' => ['Gbagada Exhaust & Diesel Tank Painting Worker', 'LABOUR', 'EXH_PAINT', 60],
        'IK-BCT-LM' => ['Ikotun Laser Cutting Machine', 'MACHINE', 'BASE_CUT', 10],
        'IK-BCT-1' => ['Ikotun Laser Cutting Worker', 'LABOUR', 'BASE_CUT', 10],
        'IK-BBD-BM1' => ['Ikotun Bending Machine 1', 'MACHINE', 'IK_BEND', 20],
        'IK-BBD-1' => ['Ikotun Bending Worker', 'LABOUR', 'IK_BEND', 20],
        'IK-PCT-PM' => ['Ikotun Punch Machine', 'MACHINE', 'PANEL_CUT', 10],
        'IK-PCT-1' => ['Ikotun Punch Cutting Worker', 'LABOUR', 'PANEL_CUT', 10],
        'IK-CDP-FCD' => ['Ikotun Fixed Cutting Disk', 'MACHINE', 'CUT_THREAD', 12],
        'IK-CDP-1' => ['Ikotun Threading Machine Worker', 'LABOUR', 'CUT_THREAD', 12],
        'IK-WBT-1' => ['Ikotun Base Welding Worker', 'LABOUR', 'BASE_WELD', 30],
        'IK-WBG-1' => ['Ikotun Base Grinding Worker', 'LABOUR', 'BASE_GRIND', 40],
        'IK-TBT-1' => ['Ikotun Base Tank Testing Worker', 'LABOUR', 'BASE_TEST', 50],
        'IK-WCP-1' => ['Ikotun Panel Welding Worker', 'LABOUR', 'PANEL_WELD', 30],
        'IK-WCG-1' => ['Ikotun Panel Grinding Worker', 'LABOUR', 'PANEL_GRIND', 40],
        'IK-PCP-M1' => ['Ikotun Powder Coating Line', 'MACHINE', 'IK_PWC', 60],
        'IK-PCP-1' => ['Ikotun Powder Coating Worker', 'LABOUR', 'IK_PWC', 60],
        'IK-PLA-1' => ['Ikotun Power Loom Assembly Worker', 'LABOUR', 'LOOM_ASSY', 70],
        'IK-CPA-1' => ['Ikotun Panel Assembly Worker', 'LABOUR', 'PANEL_ASSY', 80],
        'IK-GAS-1' => ['Ikotun Generator Assembly Worker', 'LABOUR', 'GENSET_ASSY', 120],
        'IK-GPT-1' => ['Ikotun Pre-test Worker', 'LABOUR', 'GENSET_PRETEST', 130],
        'IK-GTT-1' => ['Ikotun Test Worker', 'LABOUR', 'GENSET_TEST', 140],
        'IK-PTG-1' => ['Ikotun Post-test Worker', 'LABOUR', 'GENSET_POSTTEST', 150],
    ];

    public const MACHINES = [
        ['CANOPY_CUT', 'PUNCH1', 'Punch 1'], ['CANOPY_CUT', 'PUNCH2', 'Punch 2'], ['CANOPY_CUT', 'PLASMA', 'Plasma'],
        ['CANOPY_BEND', 'GB-BBM-1', 'Baykal Bending Machine'], ['CANOPY_PWC', 'GB-PCP-1', 'Gbagada Powder Coating Plant'],
        ['BASE_CUT', 'IK-BCT-LM', 'Ikotun Laser Cutting Machine'], ['IK_BEND', 'IK-BBD-BM1', 'Ikotun Bending Machine 1'],
        ['PANEL_CUT', 'IK-PCT-PM', 'Ikotun Punch Machine'], ['IK_PWC', 'IK-PCP-M1', 'Ikotun Powder Coating Line'],
        ['CUT_THREAD', 'IK-CDP-FCD', 'Fixed Cutting Disk / Threading'],
    ];

    public const DEMO_USERS = [
        ['admin', 'Admin@2026', 'System Administrator', 'ADMIN'],
        ['sales', 'Sales@2026', 'Sales Desk', 'SALES'],
        ['planner', 'Planner@2026', 'Production Planner', 'PLANNER'],
        ['prodmgr', 'Manager@2026', 'Production Manager', 'PROD_MANAGER'],
        ['supervisor', 'Super@2026', 'Section Supervisor', 'SUPERVISOR'],
        ['store', 'Store@2026', 'Store Officer', 'STORE'],
        ['costacct', 'Cost@2026', 'Cost Accountant', 'COST_ACCOUNTANT'],
        ['mgmt', 'Mgmt@2026', 'Management Viewer', 'MANAGEMENT'],
    ];

    public function seedMasterData(): void
    {
        $db = $this->app->db;
        $db->transaction(function () use ($db) {
            foreach (self::SECTIONS as [$code, $name, $dept, $act, $seq, $site, $lines, $staff, $color]) {
                if (!$db->val('SELECT COUNT(*) FROM {p}sections WHERE code=?', [$code]))
                    $db->insert('sections', ['code' => $code, 'name' => $name, 'department' => $dept, 'activity' => $act, 'seq' => $seq, 'site' => $site, 'lines' => $lines, 'staff' => $staff, 'minutes_per_day' => 480, 'color' => $color, 'allow_partial_transfer' => 1]);
            }
            $sec = $this->sectionIds();
            foreach (self::RESOURCES as $code => [$name, $kind, $scode, $seq]) {
                if (!$db->val('SELECT COUNT(*) FROM {p}resources WHERE code=?', [$code]))
                    $db->insert('resources', ['code' => $code, 'name' => $name, 'kind' => $kind, 'section_id' => $sec[$scode], 'seq' => $seq]);
            }
            foreach (self::MACHINES as [$scode, $code, $name]) {
                if (!$db->val('SELECT COUNT(*) FROM {p}machines WHERE code=?', [$code]))
                    $db->insert('machines', ['section_id' => $sec[$scode], 'code' => $code, 'name' => $name, 'minutes_per_shift' => 480, 'active' => 1]);
            }
            $this->app->calendar->ensureRange('2026-01-01', '2027-12-31');
            $defaults = ['work_start' => '08:00', 'work_end' => '17:00', 'break_minutes' => 60, 'minutes_per_day' => 480, 'allow_partial_transfer' => true,
                'fg_receipt_days' => 1, 'cost_outdated_months' => 12, 'currency' => 'NGN', 'company' => 'Proland Manufacturing', 'plan_number_prefix' => 'PP'];
            foreach ($defaults as $k => $v) if ($this->app->setting($k) === null) $this->app->setSetting($k, $v);
        });
    }

    public function seedUsers(): array
    {
        $created = [];
        foreach (self::DEMO_USERS as [$u, $p, $n, $r]) {
            if (!$this->app->db->val('SELECT COUNT(*) FROM {p}users WHERE username=?', [$u])) { $this->app->auth->createUser($u, $p, $n, $r); $created[] = $u; }
        }
        return $created;
    }

    public function sectionIds(): array
    {
        $out = [];
        foreach ($this->app->db->all('SELECT id, code FROM {p}sections') as $r) $out[$r['code']] = (int)$r['id'];
        return $out;
    }
}
