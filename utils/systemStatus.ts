const STORAGE_KEY = 'indiva_system_active';

export function isSystemEnabled(): boolean {
    try { return localStorage.getItem(STORAGE_KEY) !== 'false'; }
    catch { return true; }
}
