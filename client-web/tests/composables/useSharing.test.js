// =======================================================================
// TESTES: useSharing.js — Compartilhamento Zero-Knowledge
// Cobertura: geração de link de compartilhamento, detecção e decodificação
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSharing } from '../../src/composables/useSharing.js';
import * as useCrypto from '../../src/composables/useCrypto.js';
import { API_URL } from '../../src/composables/useApi.js';

describe('useSharing', () => {
    let sharing;

    beforeEach(() => {
        sharing = useSharing();
        sharing.showShareModal.value = false;
        sharing.shareLink.value = '';
        vi.mocked(globalThis.fetch).mockReset();
        vi.spyOn(window, 'alert').mockImplementation(() => {});
        vi.spyOn(window, 'confirm').mockImplementation(() => true);
    });

    describe('shareFile', () => {
        it('deve gerar link público com a chave hash e exibir modal', async () => {
            const mockFile = { id: 10, name: 'documento.pdf', encryptedFDK: 'enc-fdk-base64' };
            const mockMasterKey = { name: 'MasterKey' };

            // Mocks de criptografia
            vi.spyOn(useCrypto, 'decryptFDK').mockResolvedValue({ name: 'FDK' });
            vi.spyOn(useCrypto, 'exportFDKToBase64').mockResolvedValue('raw-fdk-base64');

            // Mock da API
            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ share_uuid: 'abc-123-xyz' })
            });

            // Mock location
            Object.defineProperty(window, 'location', {
                value: { origin: 'http://localhost', pathname: '/' },
                writable: true
            });

            await sharing.shareFile(mockFile, mockMasterKey);

            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/files/10/share'),
                expect.objectContaining({ method: 'POST' })
            );

            expect(sharing.shareLink.value).toBe('http://localhost/?share=abc-123-xyz#raw-fdk-base64:documento.pdf');
            expect(sharing.showShareModal.value).toBe(true);
        });

        it('deve tratar erro na criação do compartilhamento', async () => {
            globalThis.fetch.mockResolvedValueOnce({
                ok: false,
                json: async () => ({ error: 'Acesso negado' })
            });

            await sharing.shareFile({ id: 1 }, {});

            expect(sharing.shareLink.value).toBe('');
            expect(sharing.showShareModal.value).toBe(false);
        });
    });

    describe('copyShareLink', () => {
        it('deve copiar o link para a área de transferência', () => {
            // Mock do input no DOM
            const input = document.createElement('input');
            input.id = 'share-link-input';
            input.value = 'http://link';
            document.body.appendChild(input);
            input.select = vi.fn();

            sharing.copyShareLink();

            expect(input.select).toHaveBeenCalled();
            expect(navigator.clipboard.writeText).toHaveBeenCalledWith('http://link');

            document.body.removeChild(input);
        });
    });

    describe('checkSharedLinkAccess', () => {
        it('deve abortar se não houver parâmetro share', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '', hash: '' },
                writable: true
            });
            await sharing.checkSharedLinkAccess();
            expect(window.alert).not.toHaveBeenCalled();
        });

        it('deve alertar erro se houver share mas sem hash', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '?share=123', hash: '', origin: 'http://loc', pathname: '/' },
                writable: true
            });
            await sharing.checkSharedLinkAccess();
            expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('Chave criptográfica ausente'));
        });

        it('deve abortar se usuário cancelar o confirm', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '?share=123', hash: '#chave:arq.txt', origin: 'http://loc', pathname: '/' },
                writable: true
            });
            window.confirm.mockReturnValueOnce(false);
            await sharing.checkSharedLinkAccess();
            expect(globalThis.fetch).not.toHaveBeenCalled();
        });

        it('deve baixar e descriptografar arquivo corretamente', async () => {
            Object.defineProperty(window, 'location', {
                value: { search: '?share=123', hash: '#chave:arq.txt', origin: 'http://loc', pathname: '/' },
                writable: true
            });
            window.confirm.mockReturnValueOnce(true);

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                headers: new Headers({ 'Content-Range': 'bytes 0-0/100' })
            });

            globalThis.fetch.mockResolvedValueOnce({
                ok: true,
                status: 206,
                arrayBuffer: async () => new ArrayBuffer(10)
            });

            vi.spyOn(useCrypto, 'importRawFDK').mockResolvedValue({});
            vi.spyOn(useCrypto, 'decryptChunk').mockResolvedValue(new Uint8Array(10).buffer);

            const appendSpy = vi.spyOn(document.body, 'appendChild');
            const removeSpy = vi.spyOn(document.body, 'removeChild');

            await sharing.checkSharedLinkAccess();

            expect(useCrypto.importRawFDK).toHaveBeenCalledWith('chave');
            expect(useCrypto.decryptChunk).toHaveBeenCalled();
            expect(appendSpy).toHaveBeenCalled();
            expect(removeSpy).toHaveBeenCalled();
            expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('concluído'));
        });
    });
});
