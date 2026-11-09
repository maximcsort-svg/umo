<?php
/**
 * Отдаёт весь каталог видеокарт из таблицы gpus в виде JSON-массива.
 * Фронтенд (js/app.js) обращается только сюда — это единственный источник данных.
 */
require __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');

/**
 * Диагностика для пользователя: если что-то не так с подключением или таблицей,
 * отвечаем ПОНЯТНОЙ ошибкой (фронтенд выведет её в консоль браузера),
 * а не пустым списком. Режим "diag" (?diag=1) показывает статус без выдачи карт.
 */
if (isset($_GET['diag'])) {
    $out = ['php' => PHP_VERSION, 'pdo_mysql' => in_array('mysql', PDO::getAvailableDrivers(), true)];
    try {
        $pdo = db_connect_silent();
        $out['connect'] = 'ok';
        $n = $pdo->query('SELECT COUNT(*) FROM gpus')->fetchColumn();
        $out['table_gpus'] = 'ok';
        $out['rows'] = (int)$n;
    } catch (Throwable $e) {
        $out['error'] = $e->getMessage();
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE);
    exit;
}

$pdo = db_connect();
try {
    $rows = $pdo->query('SELECT * FROM gpus')->fetchAll();
} catch (PDOException $e) {
    http_response_code(500);
    echo json_encode(['error' => 'query_failed', 'detail' => 'Не удалось прочитать таблицу gpus: ' . $e->getMessage() . '. Импортируйте database/gpus_import.sql через phpMyAdmin.'], JSON_UNESCAPED_UNICODE);
    exit;
}
if (!$rows) {
    http_response_code(500);
    echo json_encode(['error' => 'empty_table', 'detail' => 'Таблица gpus пуста. Импортируйте database/gpus_import.sql через phpMyAdmin (Импорт -> выбрать файл -> Выполнить).'], JSON_UNESCAPED_UNICODE);
    exit;
}
echo json_encode($rows, JSON_UNESCAPED_UNICODE);
