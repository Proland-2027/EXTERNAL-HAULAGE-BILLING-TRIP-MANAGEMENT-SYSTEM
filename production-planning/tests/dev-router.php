<?php
// Dev router: serve real files/directories directly, everything else through WordPress.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$file = $_SERVER['DOCUMENT_ROOT'] . $path;
if ($path !== '/' && file_exists($file) && !is_dir($file)) { return false; }
if (is_dir($file) && file_exists(rtrim($file, '/') . '/index.php')) { $_SERVER['SCRIPT_NAME'] = rtrim($path, '/') . '/index.php'; require rtrim($file, '/') . '/index.php'; return true; }
$_SERVER['SCRIPT_NAME'] = '/index.php';
require $_SERVER['DOCUMENT_ROOT'] . '/index.php';
