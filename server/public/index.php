<?php
/**
 * Front controller for the standalone deployment (PHP 8.1+, Apache/Nginx or `php -S`).
 *   /api/...        JSON API
 *   /haulage/...    the Trip Log application (repository root: index.html, js/, css/)
 *   /...            the production planning application (app/)
 */
declare(strict_types=1);
require dirname(__DIR__) . '/src/App.php';

$uri = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$root = dirname(__DIR__, 2);
$appDir = $root . '/app';

if (str_starts_with($uri, '/api/')) {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    try {
        $app = new App();
        if (!$app->db->tableExists('users')) $app->migrate();
        $raw = file_get_contents('php://input');
        $body = [];
        if ($raw !== '' && str_contains($_SERVER['CONTENT_TYPE'] ?? '', 'application/json')) { $body = json_decode($raw, true); if (!is_array($body)) $body = []; }
        elseif ($_POST) $body = $_POST;
        // CSRF: cookie-authenticated writes must carry the custom header (browsers block it cross-site without CORS approval)
        $method = $_SERVER['REQUEST_METHOD'];
        if ($method !== 'GET' && empty($_SERVER['HTTP_X_REQUESTED_WITH']) && !isset($_SERVER['HTTP_AUTHORIZATION'])) { http_response_code(403); echo json_encode(['error' => 'Missing X-Requested-With header']); exit; }
        [$status, $payload] = (new Api($app))->dispatch($method, substr($uri, 4), $_GET, $body);
        http_response_code($status);
        echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_INVALID_UTF8_SUBSTITUTE);
    } catch (Throwable $e) {
        http_response_code(500);
        echo json_encode(['error' => 'Server error: ' . $e->getMessage(), 'at' => basename($e->getFile()) . ':' . $e->getLine()]);
    }
    exit;
}

// static files
function serveStatic(string $file): void
{
    $types = ['html' => 'text/html; charset=utf-8', 'js' => 'application/javascript; charset=utf-8', 'css' => 'text/css; charset=utf-8', 'json' => 'application/json', 'svg' => 'image/svg+xml', 'png' => 'image/png', 'ico' => 'image/x-icon', 'md' => 'text/markdown; charset=utf-8', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'woff2' => 'font/woff2'];
    $ext = strtolower(pathinfo($file, PATHINFO_EXTENSION));
    header('Content-Type: ' . ($types[$ext] ?? 'application/octet-stream'));
    header('X-Content-Type-Options: nosniff');
    if ($ext === 'html') header('Cache-Control: no-cache'); else header('Cache-Control: public, max-age=300');
    readfile($file);
    exit;
}
$safe = fn(string $base, string $rel): ?string => ($p = realpath($base . '/' . $rel)) && str_starts_with($p, realpath($base)) && is_file($p) ? $p : null;

if ($uri === '/haulage' || $uri === '/haulage/') serveStatic($root . '/index.html');
if (str_starts_with($uri, '/haulage/')) { $f = $safe($root, substr($uri, 9)); if ($f) serveStatic($f); http_response_code(404); echo 'Not found'; exit; }
if ($uri === '/docs' || str_starts_with($uri, '/docs/')) { $f = $safe($root . '/docs', substr($uri, 6) ?: 'USER_GUIDE.md'); if ($f) serveStatic($f); }
if ($uri !== '/' && ($f = $safe($appDir, ltrim($uri, '/')))) serveStatic($f);
serveStatic($appDir . '/index.html');
