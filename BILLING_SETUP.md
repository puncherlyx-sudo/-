# Подключение оплаты PRO (криптовалюта, NOWPayments)

Код готов. Чтобы оплата заработала, нужно сделать 5 шагов — все ключи вводятся **только в настройках сервера** (Secrets / переменные окружения), никогда в код и не в чат.

1. **Аккаунт NOWPayments.** Зарегистрируйтесь на https://account.nowpayments.io/create-account, подтвердите почту.
2. **Ключи.** В панели NOWPayments создайте *API key* и *IPN Secret key*.
   Впишите в окружение сервера: `NOWPAYMENTS_API_KEY`, `NOWPAYMENTS_IPN_SECRET`.
3. **Адрес приложения.** `APP_URL` = публичный https-адрес вашего приложения (без `/` в конце).
4. **Сервисный аккаунт Firebase** (чтобы сервер выдавал PRO после оплаты): Firebase Console → Project settings →
   Service accounts → Generate new private key. Содержимое файла — в `FIREBASE_SERVICE_ACCOUNT_JSON`.
5. **Правила Firestore.** Опубликуйте обновлённый файл `firestore.rules`
   (Firebase Console → Firestore → Rules → вставить → Publish, или `firebase deploy --only firestore:rules`).
   Пока это не сделано, старые правила позволяют пользователям включать PRO самим.

Дополнительно: `TOTP_MASTER_KEY` (см. `.env.example`) и цены `PRO_PRICE_MONTH_USD` / `PRO_PRICE_YEAR_USD`
(по умолчанию 29 USD за месяц и 264 USD за год (это 22 USD в месяц), цены можно поменять).

## Как это работает
- Пользователь выбирает «месяц» или «год» → сервер создаёт счёт в NOWPayments → пользователь платит на их странице.
- NOWPayments присылает подписанное уведомление на `/api/billing/ipn`. Сервер проверяет подпись (HMAC-SHA512),
  сверяет сумму и валюту с заказом и только потом ставит `plan: pro` и `proUntil`.
- Раз в час сервер возвращает на бесплатный тариф всех, у кого срок `proUntil` истёк
  (и тех, кто включил PRO вручную до появления оплаты).
