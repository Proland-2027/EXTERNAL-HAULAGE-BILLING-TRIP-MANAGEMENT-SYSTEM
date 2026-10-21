<?php
/** Calendar — working-day arithmetic. Default: Monday–Friday, 08:00–17:00 with a 1-hour break = 480 productive minutes. */
final class Calendar
{
    private array $cache = [];   // date => minutes (0 = non-working)

    public function __construct(private App $app) {}

    public function ensureRange(string $from, string $to): void
    {
        $db = $this->app->db;
        $existing = [];
        foreach ($db->all('SELECT cdate FROM {p}calendar WHERE cdate BETWEEN ? AND ?', [$from, $to]) as $r) $existing[$r['cdate']] = true;
        $rows = [];
        for ($d = new DateTime($from); $d->format('Y-m-d') <= $to; $d->modify('+1 day')) {
            $k = $d->format('Y-m-d');
            if (isset($existing[$k])) continue;
            $dow = (int)$d->format('N');
            $rows[] = ['cdate' => $k, 'is_working' => $dow <= 5 ? 1 : 0, 'minutes' => $dow <= 5 ? 480 : 0, 'note' => null];
        }
        $db->insertMany('calendar', $rows);
        $this->cache = [];
    }

    public function minutes(string $date): int
    {
        if (!$this->cache) {
            foreach ($this->app->db->all('SELECT cdate, is_working, minutes FROM {p}calendar') as $r) $this->cache[$r['cdate']] = $r['is_working'] ? (int)$r['minutes'] : 0;
        }
        if (!isset($this->cache[$date])) {
            // outside the generated range: extend by a year and default to Mon-Fri
            $this->ensureRange($date, (new DateTime($date))->modify('+1 year')->format('Y-m-d'));
            if (!isset($this->cache[$date])) { $dow = (int)(new DateTime($date))->format('N'); $this->cache[$date] = $dow <= 5 ? 480 : 0; }
        }
        return $this->cache[$date];
    }

    public function isWorking(string $date): bool { return $this->minutes($date) > 0; }

    public function nextWorkingDay(string $date, int $offset = 1): string
    {
        $d = new DateTime($date);
        $n = 0;
        while (true) {
            if ($offset === 0 && $this->isWorking($d->format('Y-m-d'))) return $d->format('Y-m-d');
            $d->modify('+1 day');
            if ($this->isWorking($d->format('Y-m-d'))) { $n++; if ($n >= $offset) return $d->format('Y-m-d'); }
        }
    }

    /** First working day on or after $date. */
    public function alignForward(string $date): string { return $this->nextWorkingDay($date, 0); }

    /** Working days between two dates (inclusive of both when working). */
    public function workingDaysBetween(string $from, string $to): int
    {
        if ($to < $from) return -$this->workingDaysBetween($to, $from);
        $n = 0;
        for ($d = new DateTime($from); $d->format('Y-m-d') <= $to; $d->modify('+1 day')) if ($this->isWorking($d->format('Y-m-d'))) $n++;
        return $n;
    }

    public function setDay(string $date, bool $working, int $minutes = 480, ?string $note = null): void
    {
        $db = $this->app->db;
        if ($db->val('SELECT COUNT(*) FROM {p}calendar WHERE cdate=?', [$date])) $db->run('UPDATE {p}calendar SET is_working=?, minutes=?, note=? WHERE cdate=?', [$working ? 1 : 0, $working ? $minutes : 0, $note, $date]);
        else $db->insert('calendar', ['cdate' => $date, 'is_working' => $working ? 1 : 0, 'minutes' => $working ? $minutes : 0, 'note' => $note]);
        $this->cache = [];
    }
}
