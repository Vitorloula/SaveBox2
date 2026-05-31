// =======================================================================
// TESTES: FileExplorer.vue
// Cobertura: renderização de grid de pastas, lista de arquivos, drag and drop
// breadcrumbs, ações de arquivos
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import FileExplorer from '../../src/components/FileExplorer.vue';
import * as useExplorerMod from '../../src/composables/useExplorer.js';
import * as useAuthMod from '../../src/composables/useAuth.js';
import { ref, computed } from 'vue';

describe('FileExplorer.vue', () => {
    let mockExplorer;
    let mockAuth;

    beforeEach(() => {
        mockExplorer = {
            currentFolderId: ref(null),
            filteredFolders: computed(() => []),
            filteredFiles: computed(() => []),
            breadcrumbs: ref([]),
            searchQuery: ref(''),
            navigateToFolder: vi.fn(),
            deleteFolder: vi.fn(),
            deleteFile: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);
    });

    it('deve mostrar estado vazio quando não há pastas ou arquivos', () => {
        const wrapper = mount(FileExplorer);
        expect(wrapper.find('.empty-explorer').exists()).toBe(true);
        expect(wrapper.find('.folders-section').exists()).toBe(false);
        expect(wrapper.find('.files-section').exists()).toBe(false);
    });

    it('deve renderizar breadcrumbs corretamente', async () => {
        mockExplorer.breadcrumbs.value = [
            { id: 1, name: 'Root' },
            { id: 2, name: 'Docs' }
        ];
        const wrapper = mount(FileExplorer);
        
        const items = wrapper.findAll('.breadcrumb-item');
        expect(items).toHaveLength(3); // Raiz + Root + Docs
        
        await items[2].trigger('click');
        expect(mockExplorer.navigateToFolder).toHaveBeenCalledWith(2);
    });

    it('deve listar pastas', async () => {
        mockExplorer.filteredFolders = computed(() => [
            { id: 10, name: 'Pasta Secreta' }
        ]);
        const wrapper = mount(FileExplorer);
        
        const folderCards = wrapper.findAll('.folder-card');
        expect(folderCards).toHaveLength(1);
        expect(folderCards[0].text()).toContain('Pasta Secreta');
        
        await folderCards[0].trigger('dblclick');
        expect(mockExplorer.navigateToFolder).toHaveBeenCalledWith(10);
    });

    it('deve listar arquivos e disparar eventos', async () => {
        mockExplorer.filteredFiles = computed(() => [
            { id: 20, name: 'relatorio.pdf', sizeBytes: 1024, createdAt: new Date().toISOString() }
        ]);
        const wrapper = mount(FileExplorer);
        
        const fileRows = wrapper.findAll('.item-file');
        expect(fileRows).toHaveLength(1);
        expect(fileRows[0].text()).toContain('relatorio.pdf');
        
        // Botão Visualizar
        const btns = fileRows[0].findAll('.action-btn');
        await btns[0].trigger('click'); // Preview
        expect(wrapper.emitted('preview')).toBeTruthy();
        expect(wrapper.emitted('preview')[0][0].id).toBe(20);
        
        // Botão Download
        await btns[1].trigger('click'); // Download
        expect(wrapper.emitted('download')).toBeTruthy();
        
        // Botão Share
        await btns[2].trigger('click'); // Share
        expect(wrapper.emitted('share')).toBeTruthy();
        
        // Botão Excluir
        await btns[4].trigger('click'); // Lixeira
        expect(mockExplorer.deleteFile).toHaveBeenCalledWith(20, mockAuth.masterKey.value);
    });

    it('deve ligar o overlay de drag ao passar com arquivo', async () => {
        const wrapper = mount(FileExplorer);
        
        await wrapper.find('.explorer-body').trigger('dragenter');
        expect(wrapper.vm.dragActive).toBe(true);
        expect(wrapper.find('.drop-overlay').exists()).toBe(true);
        
        await wrapper.find('.explorer-body').trigger('dragleave');
        expect(wrapper.vm.dragActive).toBe(false);
    });
});
