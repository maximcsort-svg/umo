<?php
/**
 * Прибавляет 1 к счётчику популярности карты (сколько раз её выбрали в сравнение).
 * Вызывается из js/app.js через fetch POST {name}. Если таблицы/счётчика нет — молча отвечает ok,
 * чтобы не ломать работу сайта (в этом случае счётчик остаётся только в localStorage браузера).
 */
require __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');
$in = json_decode(file_get_contents('php://input'), true);
$name = isset($in['name']) ? trim($in['name']) : '';
if ($name === '') { echo json_encode(['ok' => false]); exit; }
$pdo = db_connect();
try {
    $st = $pdo->prepare('UPDATE gpus SET hits = hits + 1 WHERE name = ?');
    $st->execute([$name]);
    echo json_encode(['ok' => true]);
} catch (PDOException $e) {
    // например, колонка hits ещё не добавлена — не роняем сайт
    echo json_encode(['ok' => false]);
}
