<?php
/**
 * Отдаёт весь каталог процессоров из таблицы cpus в виде JSON-массива.
 * Фронтенд (js/app.js, страница cpu.html) обращается только сюда — единственный источник данных.
 */
require __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');

if (isset($_GET['diag'])) {
    $out = ['php' => PHP_VERSION, 'pdo_mysql' => in_array('mysql', PDO::getAvailableDrivers(), true)];
    try {
        $pdo = db_connect_silent();
        $out['connect'] = 'ok';
        $n = $pdo->query('SELECT COUNT(*) FROM cpus')->fetchColumn();
        $out['table_cpus'] = 'ok';
        $out['rows'] = (int)$n;
    } catch (Throwable $e) {
        $out['error'] = $e->getMessage();
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

$pdo = db_connect();
try {
    $rows = $pdo->query('SELECT * FROM cpus')->fetchAll();
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'query_failed', 'detail' => 'Не удалось прочитать таблицу cpus: ' . $e->getMessage() . '. Импортируйте database/cpus_import.sql через phpMyAdmin.'], JSON_UNESCAPED_UNICODE);
    exit;
}
if (!$rows) {
    http_response_code(500);
    echo json_encode(['error' => 'empty_table', 'detail' => 'Таблица cpus пуста. Импортируйте database/cpus_import.sql через phpMyAdmin (Импорт -> выбрать файл -> Выполнить).'], JSON_UNESCAPED_UNICODE);
    exit;
}
echo json_encode($rows, JSON_UNESCAPED_UNICODE);
