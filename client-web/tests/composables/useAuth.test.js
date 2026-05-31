// =======================================================================
// TESTES: useAuth.js — Fluxo de autenticação completo
// Cobertura: login, register, verify, logout, vault lock/unlock,
// restore session, integração com localStorage
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAuth } from '../../src/composables/useAuth.js';
import { useApi } from '../../src/composables/useApi.js';

describe('useAuth', () => {
    let auth;

    beforeEach(() => {
        auth = useAuth();
        // Reset state
        auth.isAuthenticated.value = false;
        auth.isVaultLocked.value = false;
        auth.username.value = '';
        auth.masterKey.value = null;
        auth.authView.value = 'login';
        auth.authLoading.value = false;
        auth.authForm.username = '';
        auth.authForm.email = '';
        auth.authForm.password = '';
        auth.authForm.token = '';
        auth.unlockPassword.value = '';
        localStorage.clear();
        vi.mocked(globalThis.fetch).mockReset();
    });

    // ── Login ────────────────────────────────────────────────────────────
    describe('handleLogin', () => {
        it('deve autenticar com sucesso e derivar chave mestra', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ token: 'jwt-token-123' })
            });

            auth.authForm.username = 'vitor';
            auth.authForm.password = 'senha123';

            await auth.handleLogin();

            expect(auth.isAuthenticated.value).toBe(true);
            expect(auth.username.value).toBe('vitor');
            expect(auth.masterKey.value).not.toBeNull();
            expect(auth.authForm.password).toBe(''); // Limpa senha da memória
            expect(localStorage.getItem('savebox_token')).toBe('jwt-token-123');
            expect(localStorage.getItem('savebox_username')).toBe('vitor');
        });

        it('deve tratar erro de login corretamente', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                status: 401,
                json: async () => ({ error: 'Credenciais inválidas' })
            });

            auth.authForm.username = 'errado';
            auth.authForm.password = 'errado';

            await auth.handleLogin();

            expect(auth.isAuthenticated.value).toBe(false);
            expect(auth.masterKey.value).toBeNull();
        });

        it('deve definir e restaurar authLoading durante o processo', async () => {
            let loadingDuringFetch = false;
            globalThis.fetch.mockImplementationOnce(async () => {
                loadingDuringFetch = auth.authLoading.value;
                return { ok: true, json: async () => ({ token: 'tk' }) };
            });

            auth.authForm.username = 'user';
            auth.authForm.password = 'pass';
            await auth.handleLogin();

            expect(loadingDuringFetch).toBe(true);
            expect(auth.authLoading.value).toBe(false);
        });
    });

    // ── Register ─────────────────────────────────────────────────────────
    describe('handleRegister', () => {
        it('deve registrar com sucesso e mudar para tela de verificação', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                status: 201,
                json: async () => ({ message: 'ok' })
            });

            auth.authForm.username = 'novo';
            auth.authForm.email = 'email@test.com';
            auth.authForm.password = 'pass';

            await auth.handleRegister();
            expect(auth.authView.value).toBe('verify');
        });

        it('deve tratar erro de registro', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Usuario ja existe' })
            });

            auth.authForm.username = 'existente';
            auth.authForm.email = 'e@test.com';
            auth.authForm.password = 'p';

            await auth.handleRegister();
            expect(auth.authView.value).not.toBe('verify');
        });
    });

    // ── Verify Email ─────────────────────────────────────────────────────
    describe('handleVerifyEmail', () => {
        it('deve verificar com sucesso e mudar para login', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ message: 'verificado' })
            });

            auth.authForm.token = 'token-123';
            auth.authView.value = 'verify';
            await auth.handleVerifyEmail();

            expect(auth.authView.value).toBe('login');
            expect(auth.authForm.token).toBe('');
        });

        it('deve tratar erro de verificação', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Token inválido' })
            });

            auth.authForm.token = 'invalido';
            auth.authView.value = 'verify';
            await auth.handleVerifyEmail();

            // Permanece na tela de verificação (não muda para login)
            expect(auth.authView.value).toBe('verify');
        });
    });

    // ── Logout ───────────────────────────────────────────────────────────
    describe('logout', () => {
        it('deve limpar todo o estado de autenticação', () => {
            auth.isAuthenticated.value = true;
            auth.isVaultLocked.value = true;
            auth.username.value = 'vitor';
            auth.masterKey.value = { fake: 'key' };
            localStorage.setItem('savebox_token', 'tk');
            localStorage.setItem('savebox_username', 'vitor');

            auth.logout();

            expect(auth.isAuthenticated.value).toBe(false);
            expect(auth.isVaultLocked.value).toBe(false);
            expect(auth.username.value).toBe('');
            expect(auth.masterKey.value).toBeNull();
            expect(localStorage.getItem('savebox_token')).toBeNull();
            expect(localStorage.getItem('savebox_username')).toBeNull();
        });
    });

    // ── Vault Lock/Unlock ────────────────────────────────────────────────
    describe('unlockVault', () => {
        it('deve desbloquear com senha correta', async () => {
            auth.username.value = 'testUser';
            auth.unlockPassword.value = 'senhaCorreta';

            await auth.unlockVault();

            expect(auth.isVaultLocked.value).toBe(false);
            expect(auth.isAuthenticated.value).toBe(true);
            expect(auth.masterKey.value).not.toBeNull();
            expect(auth.unlockPassword.value).toBe('');
        });

        it('não deve fazer nada se a senha está vazia', async () => {
            auth.unlockPassword.value = '';
            await auth.unlockVault();
            expect(auth.masterKey.value).toBeNull();
        });
    });

    // ── Restore Session ──────────────────────────────────────────────────
    describe('restoreSessionFromStorage', () => {
        it('deve restaurar sessão do localStorage e ativar vault lock', () => {
            localStorage.setItem('savebox_token', 'saved-token');
            localStorage.setItem('savebox_username', 'saved-user');

            auth.restoreSessionFromStorage();

            expect(auth.username.value).toBe('saved-user');
            expect(auth.isVaultLocked.value).toBe(true);
        });

        it('não deve restaurar se não há dados salvos', () => {
            auth.restoreSessionFromStorage();
            expect(auth.username.value).toBe('');
            expect(auth.isVaultLocked.value).toBe(false);
        });

        it('não deve restaurar se apenas um dos valores existe', () => {
            localStorage.setItem('savebox_token', 'tk');
            // sem username
            auth.restoreSessionFromStorage();
            expect(auth.isVaultLocked.value).toBe(false);
        });
    });
});
