// =======================================================================
// TESTES: useExplorer.js — Navegação, filtragem, CRUD, lixeira
// Cobertura: navigation, breadcrumbs, filteredFolders/Files, folderTree,
// createFolder, deleteFolder/File, saveRename, trash actions, quota
// =======================================================================
import { vi } from 'vitest';

vi.mock('../../src/composables/useCrypto.js', () => ({
    encryptText: () => Promise.resolve('encrypted'),
    computeSHA256: () => Promise.resolve('hash'),
    decryptText: () => Promise.resolve('decrypted')
}));

import { describe, it, expect, beforeEach } from 'vitest';
import { useExplorer } from '../../src/composables/useExplorer.js';

describe('useExplorer', () => {
    let explorer;

    beforeEach(() => {
        explorer = useExplorer();
        // Reset state
        explorer.currentFolderId.value = null;
        explorer.folders.value = [];
        explorer.files.value = [];
        explorer.trashFolders.value = [];
        explorer.trashFiles.value = [];
        explorer.allSystemFolders.value = [];
        explorer.searchQuery.value = '';
        explorer.breadcrumbs.value = [];
        explorer.quotaUsed.value = 0;
        explorer.quotaTotal.value = 10737418240;
        vi.mocked(globalThis.fetch).mockReset();
    });

    // ── Navigation ────────────────────────────────────────────────────────
    describe('navigateToFolder', () => {
        it('deve atualizar currentFolderId e limpar pesquisa', () => {
            explorer.searchQuery.value = 'busca antiga';
            explorer.navigateToFolder(42);
            expect(explorer.currentFolderId.value).toBe(42);
            expect(explorer.searchQuery.value).toBe('');
        });

        it('deve navegar para raiz com null', () => {
            explorer.currentFolderId.value = 10;
            explorer.navigateToFolder(null);
            expect(explorer.currentFolderId.value).toBeNull();
        });
    });

    // ── Breadcrumbs ──────────────────────────────────────────────────────
    describe('rebuildBreadcrumbs', () => {
        it('deve estar vazio na raiz', () => {
            explorer.currentFolderId.value = null;
            explorer.rebuildBreadcrumbs();
            expect(explorer.breadcrumbs.value).toEqual([]);
        });

        it('deve construir trilha de pastas pai', () => {
            explorer.folders.value = [
                { id: 1, parentId: null, name: 'Root' },
                { id: 2, parentId: 1, name: 'Sub' },
                { id: 3, parentId: 2, name: 'Deep' }
            ];
            explorer.currentFolderId.value = 3;
            explorer.rebuildBreadcrumbs();
            expect(explorer.breadcrumbs.value).toEqual([
                { id: 1, name: 'Root' },
                { id: 2, name: 'Sub' },
                { id: 3, name: 'Deep' }
            ]);
        });
    });

    // ── getFolderPathRepresentation ──────────────────────────────────────
    describe('getFolderPathRepresentation', () => {
        it('deve retornar "/" para pasta raiz inexistente', () => {
            expect(explorer.getFolderPathRepresentation(null)).toBe('/');
        });

        it('deve retornar caminho completo', () => {
            explorer.folders.value = [
                { id: 1, parentId: null, name: 'Docs' },
                { id: 2, parentId: 1, name: 'Fotos' }
            ];
            expect(explorer.getFolderPathRepresentation(2)).toBe('/Docs/Fotos');
        });
    });

    // ── Filtered Folders ─────────────────────────────────────────────────
    describe('filteredFolders', () => {
        it('deve filtrar por currentFolderId', () => {
            explorer.folders.value = [
                { id: 1, parentId: null, name: 'A' },
                { id: 2, parentId: null, name: 'B' },
                { id: 3, parentId: 1, name: 'C' }
            ];
            explorer.currentFolderId.value = null;
            expect(explorer.filteredFolders.value.map(f => f.name)).toEqual(['A', 'B']);
        });

        it('deve filtrar por searchQuery (case-insensitive)', () => {
            explorer.folders.value = [
                { id: 1, parentId: null, name: 'Documentos' },
                { id: 2, parentId: null, name: 'Fotos' },
                { id: 3, parentId: null, name: 'Downloads' }
            ];
            explorer.searchQuery.value = 'doc';
            expect(explorer.filteredFolders.value.map(f => f.name)).toEqual(['Documentos']);
        });

        it('deve ordenar alfabeticamente', () => {
            explorer.folders.value = [
                { id: 1, parentId: null, name: 'Zebra' },
                { id: 2, parentId: null, name: 'Alpha' },
                { id: 3, parentId: null, name: 'Middle' }
            ];
            expect(explorer.filteredFolders.value.map(f => f.name)).toEqual(['Alpha', 'Middle', 'Zebra']);
        });
    });

    // ── Filtered Files ───────────────────────────────────────────────────
    describe('filteredFiles', () => {
        it('deve filtrar por folderId', () => {
            explorer.files.value = [
                { id: 1, folderId: null, name: 'a.pdf' },
                { id: 2, folderId: 5, name: 'b.pdf' }
            ];
            explorer.currentFolderId.value = 5;
            expect(explorer.filteredFiles.value.map(f => f.name)).toEqual(['b.pdf']);
        });

        it('deve filtrar por searchQuery', () => {
            explorer.files.value = [
                { id: 1, folderId: null, name: 'relatorio.pdf' },
                { id: 2, folderId: null, name: 'foto.jpg' }
            ];
            explorer.searchQuery.value = 'relat';
            expect(explorer.filteredFiles.value).toHaveLength(1);
            expect(explorer.filteredFiles.value[0].name).toBe('relatorio.pdf');
        });
    });

    // ── Folder Tree ──────────────────────────────────────────────────────
    describe('folderTree', () => {
        it('deve construir árvore hierárquica com depth', () => {
            explorer.allSystemFolders.value = [
                { id: 1, parentId: null, name: 'Raiz' },
                { id: 2, parentId: 1, name: 'Sub' },
                { id: 3, parentId: 2, name: 'SubSub' }
            ];
            const tree = explorer.folderTree.value;
            expect(tree).toHaveLength(3);
            expect(tree[0]).toMatchObject({ id: 1, depth: 0 });
            expect(tree[1]).toMatchObject({ id: 2, depth: 1 });
            expect(tree[2]).toMatchObject({ id: 3, depth: 2 });
        });

        it('deve retornar vazio sem pastas', () => {
            expect(explorer.folderTree.value).toEqual([]);
        });
    });

    // ── Quota ────────────────────────────────────────────────────────────
    describe('quotaPercent', () => {
        it('deve calcular percentual correto', () => {
            explorer.quotaUsed.value = 5368709120; // 5GB
            explorer.quotaTotal.value = 10737418240; // 10GB
            expect(explorer.quotaPercent.value).toBe(50);
        });

        it('deve retornar 0 quando total é 0', () => {
            explorer.quotaTotal.value = 0;
            expect(explorer.quotaPercent.value).toBe(0);
        });

        it('deve limitar em 100%', () => {
            explorer.quotaUsed.value = 20000000000;
            explorer.quotaTotal.value = 10000000000;
            expect(explorer.quotaPercent.value).toBe(100);
        });
    });

    // ── CRUD / API Operations ────────────────────────────────────────────
    describe('CRUD Operations', () => {
        let masterKey;

        beforeEach(() => {
            masterKey = { name: 'testKey' };
        });

        it('createFolder deve chamar a API corretamente', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
            await explorer.createFolder('Nova Pasta', masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/folders'),
                expect.objectContaining({
                    method: 'POST',
                    body: expect.stringContaining('encrypted')
                })
            );
        });

        it('deleteFolder deve chamar DELETE na API', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.deleteFolder(10, masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/folders/10'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        it('deleteFile deve chamar DELETE na API', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.deleteFile(20, masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/files/20'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });

        it('saveRename deve chamar PUT na API para pasta', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.saveRename({ id: 5 }, 'folder', 'Novo Nome', 1, masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/folders/5'),
                expect.objectContaining({ method: 'PUT' })
            );
        });

        it('restoreFolder deve chamar POST na API', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.restoreFolder(10, masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/folders/10/restore'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('restoreFile deve chamar POST na API', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.restoreFile(20, masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/files/20/restore'),
                expect.objectContaining({ method: 'POST' })
            );
        });

        it('emptyTrash deve chamar DELETE na API', async () => {
            globalThis.fetch.mockResolvedValueOnce({ ok: true });
            await explorer.emptyTrash(masterKey);
            expect(globalThis.fetch).toHaveBeenCalledWith(
                expect.stringContaining('/trash/empty'),
                expect.objectContaining({ method: 'DELETE' })
            );
        });
    });
});
