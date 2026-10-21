<?php
/**
 * Families — derives the capacity family (enclosure size class) and kVA model key from an item or
 * worksheet code. The workbook uses several naming schemes (BASE-S3-OPT, SF-C&B-BT-S3, P110, spgP110,
 * SFP-FGWP110, 350-500, P220-275 ...); every productivity lookup goes through this normalisation.
 */
final class Families
{
    public const FAMILIES = ['LST', '400SRS', 'S1', 'S2', 'S3', 'S4', '200-250', '350-500', '700-800', '1100+'];

    public static function familyForKva(float $n): ?string
    {
        if ($n <= 0) return null;
        if ($n <= 27) return '400SRS';
        if ($n <= 40) return 'S1';
        if ($n <= 100) return 'S2';
        if ($n <= 125) return 'S3';
        if ($n <= 180) return 'S4';
        if ($n <= 299) return '200-250';
        if ($n <= 599) return '350-500';
        if ($n <= 950) return '700-800';
        return '1100+';
    }

    /** Returns ['family' => ..., 'model' => ..., 'models' => [...]] (models when the code spans a range). */
    public static function classify(?string $code, ?string $name = null): array
    {
        $c = strtoupper(trim((string)$code));
        $n = strtoupper((string)$name);
        $out = ['family' => null, 'model' => null, 'models' => []];
        if ($c === '') return $out;

        if (str_contains($c, 'LST') || str_contains($c, 'LISTER') || str_contains($n, 'LISTER')) { $out['family'] = 'LST'; $out['model'] = 'LST'; return $out; }
        if (preg_match('/400[- ]?S(RS|ERIES)|400SRS/', $c)) $out['family'] = '400SRS';
        if (preg_match('/1300\s*SRS/', $c)) $out['family'] = '1100+';
        if (preg_match('/(?<![A-Z0-9])S([1-4])(?![0-9])/', $c, $m) && !str_contains($c, 'SRS')) {
            // S1..S4 enclosure classes, possibly as a range S3/S4 or S1-S4
            $out['family'] = 'S' . $m[1];
            if (preg_match('/S([1-4])\s*[\/\-]\s*S?([1-4])/', $c, $r)) { $out['family'] = 'S' . $r[1]; $out['models'] = ['S' . $r[1], 'S' . $r[2]]; }
        }
        // numeric kVA tokens: P110, EY110, 110-OPT, P13.5, 200-220, 220/275, 350-500, 150/165, M1100
        $nums = [];
        if (preg_match_all('/(?:P|EY|EM|M|MGS|SPGP|SPGEY)?\s*(\d{2,4}(?:[\.\-]5)?)(?!\d)/', $c, $mm)) {
            foreach ($mm[1] as $tok) {
                $v = (float)str_replace('-5', '.5', $tok);
                if ($v >= 13 && $v <= 2500 && !in_array($v, [400.0], true) || ($v === 400.0 && !str_contains($c, 'SRS') && !str_contains($c, 'SERIES'))) $nums[] = $v;
            }
        }
        $nums = array_values(array_unique($nums));
        // ignore numbers that are clearly dimensions (e.g. 1500x1220 sheets)
        if (preg_match('/\d+X\d+/', $c)) $nums = [];
        if ($nums) {
            $prefix = preg_match('/(EY|EM)\s*\d/', $c) ? 'EY' : 'P';
            $out['models'] = array_map(fn($v) => $prefix . self::fmtNum($v), $nums);
            $out['model'] = $out['models'][0];
            if ($out['family'] === null) $out['family'] = self::familyForKva(min($nums));
        }
        if ($out['family'] === null && $out['model'] === null) {
            foreach (['S1', 'S2', 'S3', 'S4'] as $f) if (str_contains($c, '-' . $f) || str_ends_with($c, $f)) $out['family'] = $f;
        }
        return $out;
    }

    /** 13.5 kVA is written P13, P13-5 and P13.5 in the workbook: treat them as one model key. */
    public static function fmtNum(float $v): string
    {
        if (abs($v - 13.5) < 0.01) $v = 13.0;
        return rtrim(rtrim(number_format($v, 1, '.', ''), '0'), '.');
    }

    /** Alias groups used by the productivity worksheets, e.g. "P50-88" covers P50, P65, P88. */
    public static function expandModels(string $sourceCode): array
    {
        $cl = self::classify($sourceCode);
        $models = $cl['models'];
        if (count($models) === 2 && preg_match('/^P([\d\.]+)$/', $models[0], $a) && preg_match('/^P([\d\.]+)$/', $models[1], $b)) {
            $lo = (float)$a[1]; $hi = (float)$b[1];
            $known = [13, 13.5, 16, 18, 20, 22, 25, 33, 39, 46, 50, 65, 69, 88, 97, 110, 138, 150, 165, 200, 220, 250, 275, 330, 350, 400, 500, 550, 600, 700, 800, 1100, 1250, 1500, 2000];
            $models = [];
            foreach ($known as $k) if ($k >= $lo && $k <= $hi) $models[] = 'P' . self::fmtNum($k);
            $models = array_values(array_unique($models));
        }
        return $models ?: ($cl['model'] ? [$cl['model']] : []);
    }
}
