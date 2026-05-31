// =======================================================================
// TESTES: useTransfers.js — Upload/Download Pipeline E2EE
// Cobertura: upload tracker, clearFinished, cancelTransfer,
// loadPendingUploads, estado de progresso
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTransfers } from '../../src/composables/useTransfers.js';

describe('useTransfers', () => {
    let transfers;

    beforeEach(() => {
        transfers = useTransfers();
        transfers.uploads.value = [];
        localStorage.clear();
        vi.mocked(globalThis.fetch).mockReset();
    });

    // ── Transfer Controls ────────────────────────────────────────────────
    describe('clearFinishedUploads', () => {
        it('deve remover transfers completed e failed, manter active e paused', () => {
            transfers.uploads.value = [
                { id: 0, status: 'completed', name: 'done' },
                { id: 1, status: 'uploading', name: 'active' },
                { id: 2, status: 'failed', name: 'fail' },
                { id: 3, status: 'paused', name: 'paused' }
            ];

            transfers.clearFinishedUploads();

            expect(transfers.uploads.value).toHaveLength(2);
            expect(transfers.uploads.value.map(u => u.name)).toEqual(['active', 'paused']);
        });

        it('deve funcionar com lista vazia', () => {
            transfers.clearFinishedUploads();
            expect(transfers.uploads.value).toEqual([]);
        });
    });

    describe('cancelTransfer', () => {
        it('deve marcar transfer como failed/cancelado', () => {
            const mockTransfer = {
                id: 1, name: 'test.txt', status: 'uploading',
                statusText: 'Transmitindo...', cancel: false, paused: false, fileId: null
            };

            transfers.cancelTransfer(mockTransfer);

            expect(mockTransfer.cancel).toBe(true);
            expect(mockTransfer.paused).toBe(false);
            expect(mockTransfer.status).toBe('failed');
            expect(mockTransfer.statusText).toBe('Cancelado');
        });

        it('deve remover item pendente do localStorage', () => {
            const pending = [{ fileId: 42, name: 'file.pdf' }];
            localStorage.setItem('savebox_pending_uploads', JSON.stringify(pending));

            const mockTransfer = {
                id: 1, name: 'file.pdf', status: 'uploading',
                statusText: '', cancel: false, paused: false, fileId: 42
            };

            transfers.cancelTransfer(mockTransfer);

            const stored = JSON.parse(localStorage.getItem('savebox_pending_uploads'));
            expect(stored).toHaveLength(0);
        });
    });

    // ── Pending Uploads from Storage ─────────────────────────────────────
    describe('loadPendingUploadsFromStorage', () => {
        it('deve carregar uploads pendentes do localStorage', () => {
            const pending = [
                { fileId: 1, name: 'upload1.zip', sizeBytes: 1024, folderId: null, encryptedFDK: 'abc', totalChunks: 1 },
                { fileId: 2, name: 'upload2.zip', sizeBytes: 2048, folderId: 5, encryptedFDK: 'def', totalChunks: 2 }
            ];
            localStorage.setItem('savebox_pending_uploads', JSON.stringify(pending));

            transfers.loadPendingUploadsFromStorage();

            expect(transfers.uploads.value).toHaveLength(2);
            expect(transfers.uploads.value[0].name).toBe('upload1.zip');
            expect(transfers.uploads.value[0].status).toBe('paused');
            expect(transfers.uploads.value[0].isResumePending).toBe(true);
            expect(transfers.uploads.value[1].name).toBe('upload2.zip');
        });

        it('não deve duplicar uploads já existentes', () => {
            transfers.uploads.value = [{ fileId: 1, name: 'existente' }];
            const pending = [{ fileId: 1, name: 'existente', sizeBytes: 100, folderId: null, encryptedFDK: 'x', totalChunks: 1 }];
            localStorage.setItem('savebox_pending_uploads', JSON.stringify(pending));

            transfers.loadPendingUploadsFromStorage();

            // Não duplicou — manteve apenas o existente
            expect(transfers.uploads.value.filter(u => u.fileId === 1)).toHaveLength(1);
        });

        it('deve lidar com localStorage vazio', () => {
            transfers.loadPendingUploadsFromStorage();
            expect(transfers.uploads.value).toHaveLength(0);
        });

        it('deve lidar com JSON inválido no localStorage', () => {
            localStorage.setItem('savebox_pending_uploads', 'not-json');
            // Não deve lançar — silencia o erro
            expect(() => transfers.loadPendingUploadsFromStorage()).not.toThrow();
        });
    });

    // ── Panel State ──────────────────────────────────────────────────────
    describe('panel state', () => {
        it('deve ter showTransfersPanel e isTransfersExpanded como refs reativas', () => {
            expect(transfers.showTransfersPanel.value).toBeDefined();
            expect(transfers.isTransfersExpanded.value).toBeDefined();
        });
    });

    // ── Pipeline Actions ─────────────────────────────────────────────────
    describe('Pipeline Actions', () => {
        let masterKey;

        beforeEach(() => {
            masterKey = { name: 'testKey' };
            vi.mock('../../src/composables/useCrypto.js', async (importOriginal) => {
                const actual = await importOriginal();
                return {
                    ...actual,
                    decryptFDK: vi.fn().mockResolvedValue({}),
                    decryptChunk: vi.fn().mockResolvedValue(new ArrayBuffer(10)),
                    CHUNK_SIZE: 1024
                };
            });
        });

        it('downloadFile deve simular download em chunks', async () => {
            const mockFile = { id: 1, name: 'arq.txt', sizeBytes: 10, encryptedFDK: 'enc' };
            globalThis.fetch.mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(10)
            });

            const appendSpy = vi.spyOn(document.body, 'appendChild');
            const removeSpy = vi.spyOn(document.body, 'removeChild');
            const onDone = vi.fn();

            await transfers.downloadFile(mockFile, masterKey, onDone);

            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/files/1/download'),
                expect.objectContaining({ headers: expect.any(Object) })
            );
            expect(appendSpy).toHaveBeenCalled();
            expect(removeSpy).toHaveBeenCalled();
            expect(onDone).toHaveBeenCalled();
        });

        it('previewFile deve decodificar e retornar url obj para imagens', async () => {
            const mockFile = { id: 1, name: 'imagem.png', sizeBytes: 10, encryptedFDK: 'enc' };
            globalThis.fetch.mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(10)
            });

            const preview = await transfers.previewFile(mockFile, masterKey);
            expect(preview.type).toBe('image');
            expect(preview.url).toContain('mock-url');
        });

        it('previewFile deve retornar textContent para arquivos texto', async () => {
            const mockFile = { id: 1, name: 'texto.txt', sizeBytes: 10, encryptedFDK: 'enc' };
            globalThis.fetch.mockResolvedValue({
                ok: true,
                arrayBuffer: async () => new ArrayBuffer(10)
            });

            // Blob mock workaround for happy-dom text() method
            const originalBlob = globalThis.Blob;
            globalThis.Blob = class MockBlob extends originalBlob {
                async text() { return "conteudo-texto"; }
            };

            const preview = await transfers.previewFile(mockFile, masterKey);
            expect(preview.type).toBe('text');
            expect(preview.textContent).toBe('conteudo-texto');

            globalThis.Blob = originalBlob;
        });

        it('resumePendingFileSelection deve criar input e abortar se nome for diferente', () => {
            const up = { name: 'arq.txt', sizeBytes: 10 };
            
            const createElementSpy = vi.spyOn(document, 'createElement');
            const clickSpy = vi.fn();
            createElementSpy.mockImplementation(() => ({
                type: '',
                click: clickSpy,
                onchange: null
            }));

            transfers.resumePendingFileSelection(up, masterKey, 1, vi.fn());
            expect(createElementSpy).toHaveBeenCalledWith('input');

            const inputElement = createElementSpy.mock.results[0].value;
            expect(inputElement.type).toBe('file');
            expect(clickSpy).toHaveBeenCalled();

            // Simulate file selection with wrong name
            inputElement.onchange({ target: { files: [{ name: 'errado.txt', size: 10 }] } });
            
            // Should not have uploaded (since uploads ref wouldn't have it added)
            expect(transfers.uploads.value).toHaveLength(0);
        });
    });
});
