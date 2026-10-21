<?php
/**
 * XlsxReader — minimal, dependency-free .xlsx reader (ZipArchive + XMLReader).
 * Returns each worksheet as a list of rows (0-based column arrays) with cached values.
 * Streams the sheet XML so a 26,000-row BOM sheet stays well under memory limits.
 */
final class XlsxReader
{
    private ZipArchive $zip;
    private array $shared = [];
    private array $sheets = [];   // name => zip path

    public function __construct(string $file)
    {
        if (!is_file($file)) throw new RuntimeException("Workbook not found: $file");
        $this->zip = new ZipArchive();
        if ($this->zip->open($file) !== true) throw new RuntimeException("Cannot open workbook: $file");
        $this->loadShared();
        $this->loadSheetMap();
    }

    public function sheetNames(): array { return array_keys($this->sheets); }

    private function loadShared(): void
    {
        $xml = $this->zip->getFromName('xl/sharedStrings.xml');
        if ($xml === false) return;
        $r = new XMLReader();
        $r->XML($xml);
        $cur = null;
        while ($r->read()) {
            if ($r->nodeType === XMLReader::ELEMENT && $r->localName === 'si') { $cur = ''; }
            elseif ($r->nodeType === XMLReader::ELEMENT && $r->localName === 't' && $cur !== null) { $cur .= $r->readString(); }
            elseif ($r->nodeType === XMLReader::END_ELEMENT && $r->localName === 'si') { $this->shared[] = $cur; $cur = null; }
        }
    }

    private function loadSheetMap(): void
    {
        $wb = simplexml_load_string($this->zip->getFromName('xl/workbook.xml'));
        $rels = simplexml_load_string($this->zip->getFromName('xl/_rels/workbook.xml.rels'));
        $relMap = [];
        foreach ($rels->Relationship as $rel) {
            $t = (string)$rel['Target'];
            $relMap[(string)$rel['Id']] = str_starts_with($t, '/') ? ltrim($t, '/') : 'xl/' . $t;
        }
        $wb->registerXPathNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships');
        foreach ($wb->sheets->sheet as $s) {
            $attrs = $s->attributes('http://schemas.openxmlformats.org/officeDocument/2006/relationships');
            $rid = (string)$attrs['id'];
            $this->sheets[(string)$s['name']] = $relMap[$rid] ?? null;
        }
    }

    /** Read a sheet into rows: [[col0, col1, ...], ...]. Empty trailing cells are trimmed. */
    public function rows(string $name): array
    {
        $path = $this->sheets[$name] ?? null;
        if (!$path) throw new RuntimeException("Worksheet '$name' not found");
        $xml = $this->zip->getFromName($path);
        $r = new XMLReader();
        $r->XML($xml);
        $rows = [];
        $row = null; $maxCol = -1;
        $cellCol = 0; $cellType = null; $cellStyleIsDate = false; $inV = false; $inIs = false;
        while ($r->read()) {
            if ($r->nodeType === XMLReader::ELEMENT) {
                switch ($r->localName) {
                    case 'row': $row = []; $maxCol = -1; break;
                    case 'c':
                        $ref = $r->getAttribute('r');
                        $cellCol = self::colIndex($ref);
                        $cellType = $r->getAttribute('t');
                        break;
                    case 'v':
                        $v = $r->readString();
                        $row[$cellCol] = $this->castValue($v, $cellType);
                        $maxCol = max($maxCol, $cellCol);
                        break;
                    case 'is':
                        $row[$cellCol] = $r->readString();
                        $maxCol = max($maxCol, $cellCol);
                        break;
                }
            } elseif ($r->nodeType === XMLReader::END_ELEMENT && $r->localName === 'row') {
                $out = [];
                for ($i = 0; $i <= $maxCol; $i++) $out[$i] = $row[$i] ?? null;
                $rows[] = $out;
                $row = null;
            }
        }
        return $rows;
    }

    private function castValue(string $v, ?string $type)
    {
        if ($type === 's') return $this->shared[(int)$v] ?? '';
        if ($type === 'b') return $v === '1';
        if ($type === 'str' || $type === 'inlineStr') return $v;
        if ($type === 'e') return null;
        if ($v === '') return null;
        return is_numeric($v) ? $v + 0 : $v;
    }

    public static function colIndex(?string $ref): int
    {
        if (!$ref) return 0;
        $letters = preg_replace('/[^A-Z]/', '', strtoupper($ref));
        $n = 0;
        foreach (str_split($letters) as $ch) $n = $n * 26 + (ord($ch) - 64);
        return $n - 1;
    }

    /** Excel serial date → Y-m-d */
    public static function serialToDate($v): ?string
    {
        if ($v === null || $v === '') return null;
        if (is_string($v) && preg_match('/^\d{4}-\d{2}-\d{2}/', $v)) return substr($v, 0, 10);
        if (!is_numeric($v)) return null;
        return gmdate('Y-m-d', (int)round(((float)$v - 25569) * 86400));
    }
}
