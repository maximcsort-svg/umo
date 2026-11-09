/* ===== ПЕРЕКЛЮЧАТЕЛИ ФУНКЦИЙ =====
   true  = функция включена, false = скрыта. Код функций НЕ удалён: чтобы вернуть, замените false на true.
   login      — кнопка «Войти / Зарегистрироваться»
   processors — раздел «Сравнение процессоров»
   rate       — раздел «Моя видеокарта»
   error      — раздел «Нашли ошибку?»
   contact    — раздел «Напишите нам»
   feedback   — кнопка «Отзыв о сайте»
   cookies    — уведомление о cookie (true = показывать)
   brandname  — крупная надпись «у Мо» рядом с логотипом (true = показывать) */
window.FEATURES={login:false,processors:true,rate:false,error:false,contact:false,feedback:false,cookies:true,brandname:false};
(function(){var off=Object.keys(FEATURES).filter(function(k){return !FEATURES[k]});
off.forEach(function(k){document.documentElement.classList.add('off-'+k)});
if(off.length){var s=document.createElement('style');s.textContent=off.map(function(k){return '[data-feature="'+k+'"]'}).join(',')+'{display:none!important}';document.head.appendChild(s);}})();
