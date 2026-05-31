// =======================================================================
// TESTES: useApi.js — Cliente HTTP autenticado
// Cobertura: token management, fetchAPI com auth header, interceptação 401
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useApi, API_URL } from '../../src/composables/useApi.js';

describe('useApi', () => {
    let api;

    beforeEach(() => {
        api = useApi();
        api.clearToken();
        vi.mocked(globalThis.fetch).mockReset();
    });

    describe('API_URL', () => {
        it('deve apontar para localhost:8080', () => {
            expect(API_URL).toBe('http://localhost:8080');
        });
    });

    describe('setToken / clearToken', () => {
        it('deve armazenar e limpar o token', () => {
            expect(api.token.value).toBe('');
            api.setToken('jwt-abc-123');
            expect(api.token.value).toBe('jwt-abc-123');
            api.clearToken();
            expect(api.token.value).toBe('');
        });
    });

    describe('fetchAPI', () => {
        it('deve adicionar header Authorization quando há token', async () => {
            api.setToken('meu-token');
            globalThis.fetch.mockResolvedValueOnce({ status: 200, ok: true });

            await api.fetchAPI('/test');

            expect(globalThis.fetch).toHaveBeenCalledWith(
                'http://localhost:8080/test',
                expect.objectContaining({
                    headers: expect.objectContaining({
                        Authorization: 'Bearer meu-token'
                    })
                })
            );
        });

        it('não deve adicionar Authorization sem token', async () => {
            api.clearToken();
            globalThis.fetch.mockResolvedValueOnce({ status: 200, ok: true });

            await api.fetchAPI('/test');

            const callHeaders = globalThis.fetch.mock.calls[0][1].headers;
            expect(callHeaders.Authorization).toBeUndefined();
        });

        it('deve propagar opções customizadas (method, body, headers extras)', async () => {
            api.setToken('tk');
            globalThis.fetch.mockResolvedValueOnce({ status: 201, ok: true });

            await api.fetchAPI('/files', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{"test":true}'
            });

            const [url, opts] = globalThis.fetch.mock.calls[0];
            expect(url).toBe('http://localhost:8080/files');
            expect(opts.method).toBe('POST');
            expect(opts.headers['Content-Type']).toBe('application/json');
            expect(opts.headers.Authorization).toBe('Bearer tk');
            expect(opts.body).toBe('{"test":true}');
        });

        it('deve lançar erro e limpar token ao receber 401', async () => {
            api.setToken('token-expirado');
            globalThis.fetch.mockResolvedValueOnce({ status: 401, ok: false });

            await expect(api.fetchAPI('/protected')).rejects.toThrow('UNAUTHORIZED');
            expect(api.token.value).toBe('');
        });

        it('deve retornar a response normalmente para status não-401', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                status: 200,
                ok: true,
                json: async () => ({ data: 'ok' })
            });

            const res = await api.fetchAPI('/data');
            expect(res.status).toBe(200);
            expect(await res.json()).toEqual({ data: 'ok' });
        });

        it('deve retornar a response para erros não-401 (500, 403, etc)', async () => {
            globalThis.fetch.mockResolvedValueOnce({ status: 500, ok: false });
            const res = await api.fetchAPI('/error');
            expect(res.status).toBe(500);
        });
    });
});
