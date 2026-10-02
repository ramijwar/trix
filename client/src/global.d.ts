import type { OfflineMatch } from './game/offline';

declare global {
  interface Window {
    /** مباراة التدريب المحلية (وضع بدون إنترنت) */
    __trixOffline?: OfflineMatch;
  }
}

export {};
