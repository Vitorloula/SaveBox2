// =======================================================================
// GLOBAL TEST SETUP
// Configura mocks globais para APIs do navegador ausentes no happy-dom
// =======================================================================
import { vi, beforeEach, afterEach } from 'vitest';

// ── Mock localStorage ────────────────────────────────────────────────────
const store = {};
const localStorageMock = {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, value) => { store[key] = String(value); }),
    removeItem: vi.fn((key) => { delete store[key]; }),
    clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); })
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

// ── Mock sessionStorage ──────────────────────────────────────────────────
const sessionStore = {};
const sessionStorageMock = {
    getItem: vi.fn((key) => sessionStore[key] ?? null),
    setItem: vi.fn((key, value) => { sessionStore[key] = String(value); }),
    removeItem: vi.fn((key) => { delete sessionStore[key]; }),
    clear: vi.fn(() => { Object.keys(sessionStore).forEach(k => delete sessionStore[k]); })
};
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock, writable: true });

// ── Mock Web Crypto API ──────────────────────────────────────────────────
// Utiliza a implementação nativa do Node.js crypto module
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto?.subtle) {
    Object.defineProperty(globalThis, 'crypto', {
        value: webcrypto,
        writable: true
    });
}
// Alias 'window.crypto' para globalThis.crypto (happy-dom pode não setar)
if (typeof window !== 'undefined' && !window.crypto?.subtle) {
    Object.defineProperty(window, 'crypto', {
        value: globalThis.crypto,
        writable: true
    });
}

// ── Mock fetch global ────────────────────────────────────────────────────
globalThis.fetch = vi.fn();

// ── Mock navigator.clipboard ─────────────────────────────────────────────
if (typeof navigator !== 'undefined') {
    Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: vi.fn().mockResolvedValue(undefined) },
        writable: true
    });
}

// ── Mock navigator.serviceWorker ─────────────────────────────────────────
if (typeof navigator !== 'undefined' && !navigator.serviceWorker) {
    Object.defineProperty(navigator, 'serviceWorker', {
        value: {
            register: vi.fn().mockResolvedValue({ scope: '/' }),
            controller: null
        },
        writable: true
    });
}

// ── Mock URL.createObjectURL / revokeObjectURL ───────────────────────────
if (typeof URL !== 'undefined') {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
}

// ── Limpa estado entre testes ────────────────────────────────────────────
beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock.clear();
    sessionStorageMock.clear();
});

afterEach(() => {
    vi.restoreAllMocks();
});
