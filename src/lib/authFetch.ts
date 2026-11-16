import { auth } from './firebase';

/**
 * fetch с подписанным токеном входа Firebase (Authorization: Bearer ...).
 * Сервер проверяет токен и сам определяет пользователя — uid в теле не нужен.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const user = auth.currentUser;
  const headers = new Headers(init.headers);
  if (user) {
    const token = await user.getIdToken();
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
