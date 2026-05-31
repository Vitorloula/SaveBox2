// =======================================================================
// TESTES: TrashBin.vue
// Cobertura: renderização da lixeira, itens, botões de ação e empty trash
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import TrashBin from '../../src/components/TrashBin.vue';
import * as useExplorerMod from '../../src/composables/useExplorer.js';
import * as useAuthMod from '../../src/composables/useAuth.js';
import { ref } from 'vue';

describe('TrashBin.vue', () => {
    let mockExplorer;
    let mockAuth;

    beforeEach(() => {
        mockExplorer = {
            trashFolders: ref([]),
            trashFiles: ref([]),
            restoreFolder: vi.fn(),
            restoreFile: vi.fn(),
            emptyTrash: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);
    });

    it('deve mostrar estado vazio quando não há itens', () => {
        const wrapper = mount(TrashBin);
        expect(wrapper.find('.empty-explorer').exists()).toBe(true);
        expect(wrapper.find('.items-list').exists()).toBe(false);
        const emptyBtn = wrapper.find('.btn-danger');
        // O botão deve estar desabilitado
        expect(emptyBtn.attributes('disabled')).toBeDefined();
    });

    it('deve listar pastas e arquivos deletados', () => {
        mockExplorer.trashFolders.value = [{ id: 1, name: 'Pasta Excluida', updatedAt: new Date().toISOString() }];
        mockExplorer.trashFiles.value = [{ id: 2, name: 'file.txt', sizeBytes: 1024, updatedAt: new Date().toISOString() }];

        const wrapper = mount(TrashBin);
        expect(wrapper.find('.empty-explorer').exists()).toBe(false);
        expect(wrapper.find('.items-list').exists()).toBe(true);
        
        const folders = wrapper.findAll('.item-folder');
        expect(folders).toHaveLength(1);
        expect(folders[0].text()).toContain('Pasta Excluida');

        const files = wrapper.findAll('.item-file');
        expect(files).toHaveLength(1);
        expect(files[0].text()).toContain('file.txt');
    });

    it('deve chamar restoreFolder ao clicar no botão restaurar de uma pasta', async () => {
        mockExplorer.trashFolders.value = [{ id: 42, name: 'P', updatedAt: new Date().toISOString() }];
        const wrapper = mount(TrashBin);

        const restoreBtn = wrapper.find('.item-folder .action-btn-success');
        await restoreBtn.trigger('click');
        
        expect(mockExplorer.restoreFolder).toHaveBeenCalledWith(42, mockAuth.masterKey.value);
    });

    it('deve chamar restoreFile ao clicar no botão restaurar de um arquivo', async () => {
        mockExplorer.trashFiles.value = [{ id: 99, name: 'F', sizeBytes: 0, updatedAt: new Date().toISOString() }];
        const wrapper = mount(TrashBin);

        const restoreBtn = wrapper.find('.item-file .action-btn-success');
        await restoreBtn.trigger('click');
        
        expect(mockExplorer.restoreFile).toHaveBeenCalledWith(99, mockAuth.masterKey.value);
    });

    it('deve chamar emptyTrash ao clicar no botão Esvaziar Lixeira', async () => {
        mockExplorer.trashFiles.value = [{ id: 1, name: 'X', sizeBytes: 0 }];
        const wrapper = mount(TrashBin);

        const emptyBtn = wrapper.find('.btn-danger');
        expect(emptyBtn.attributes('disabled')).toBeUndefined();
        
        await emptyBtn.trigger('click');
        expect(mockExplorer.emptyTrash).toHaveBeenCalledWith(mockAuth.masterKey.value);
    });
});
