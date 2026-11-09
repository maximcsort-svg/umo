<?php
/**
 * Прибавляет 1 к счётчику популярности процессора (сколько раз его выбрали в сравнение).
 * Если таблицы/счётчика нет — молча отвечает ok, чтобы не ломать сайт (счётчик остаётся в localStorage).
 */
require __DIR__ . '/db.php';
header('Content-Type: application/json; charset=utf-8');
$in = json_decode(file_get_contents('php://input'), true);
$name = isset($in['name']) ? trim($in['name']) : '';
if ($name === '') { echo json_encode(['ok' => false]); exit; }
$pdo = db_connect();
try {
    $st = $pdo->prepare('UPDATE cpus SET hits = hits + 1 WHERE name = ?');
    $st->execute([$name]);
    echo json_encode(['ok' => true]);
} catch (PDOException $e) {
    echo json_encode(['ok' => false]);
}
