import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { OperationType } from '../types/domain';
import { logger } from '../utils/logger';

const app = initializeApp(firebaseConfig);

// Используем long-polling транспорт, чтобы избежать 10-секундных зависаний WebChannel
// в мобильных сетях, VPN и прокси-средах (Android Chrome / встроенный предпросмотр).
function createFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function isFirestoreOfflineError(error: unknown): boolean {
  if (!error) return false;
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '').toLowerCase()
      : '';
  const msg = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return (
    code === 'unavailable' ||
    code === 'failed-precondition' ||
    msg.includes('client is offline') ||
    msg.includes('could not reach cloud firestore') ||
    msg.includes('network error') ||
    msg.includes('failed to fetch')
  );
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authenticated: boolean;
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const sanitizedMessage = rawMessage.includes('Missing or insufficient permissions')
    ? 'Недостаточно прав для выполнения операции в облачном хранилище.'
    : isFirestoreOfflineError(error)
      ? 'Нет стабильной связи с облаком Firestore. Приложение работает локально и синхронизируется автоматически.'
      : 'Ошибка синхронизации с облачным хранилищем.';

  const errInfo: FirestoreErrorInfo = {
    error: sanitizedMessage,
    operationType,
    path: path ? path.split('/').slice(0, 3).join('/') : null,
    authenticated: Boolean(auth.currentUser),
  };
  logger.error('firestore', errInfo.operationType, errInfo.path ?? 'root', errInfo.error);
  throw new Error(sanitizedMessage);
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      logger.error('firestore', 'Please check your Firebase configuration.');
    }
  }
}

void testConnection();
