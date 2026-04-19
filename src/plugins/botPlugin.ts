import { registerPlugin } from '@capacitor/core';

export interface BotPlugin {
    isAccessibilityEnabled(): Promise<{ enabled: boolean }>;
    openAccessibilitySettings(): Promise<void>;
    saveCoordinates(opts: { store: string; shareX: number; shareY: number; copyX: number; copyY: number; fallbackX?: number; fallbackY?: number }): Promise<void>;
    getCoordinates(opts: { store: string }): Promise<{ shareX: number; shareY: number; copyX: number; copyY: number; fallbackX: number; fallbackY: number }>;
    startCapture(opts: { type: 'share' | 'copy' | 'fallback'; storeName?: string }): Promise<{ x: number; y: number }>;
    cancelCapture(): Promise<void>;
    runCycle(opts: { url: string; store: string; shareDelay?: number; copyDelay?: number; backDelay?: number }): Promise<void>;
}

const BotPlugin = registerPlugin<BotPlugin>('BotPlugin');
export default BotPlugin;
