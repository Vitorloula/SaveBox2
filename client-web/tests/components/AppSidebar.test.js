// =======================================================================
// TESTES: AppSidebar.vue
// Cobertura: navegação de abas, árvore de pastas, dropdown de novo item e quota
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import AppSidebar from '../../src/components/AppSidebar.vue';
import * as useExplorerMod from '../../src/composables/useExplorer.js';
import * as useTransfersMod from '../../src/composables/useTransfers.js';
import { ref, computed } from 'vue';

describe('AppSidebar.vue', () => {
    let mockExplorer;
    let mockTransfers;

    beforeEach(() => {
        mockExplorer = {
            currentFolderId: ref(null),
            folderTree: computed(() => []),
            quotaUsed: ref(0),
            quotaTotal: ref(100),
            quotaPercent: computed(() => 0),
            navigateToFolder: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);

        mockTransfers = {
            uploads: ref([])
        };
        vi.spyOn(useTransfersMod, 'useTransfers').mockReturnValue(mockTransfers);
    });

    it('deve renderizar botões de abas com a aba atual ativa', () => {
        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: false }
        });
        
        const btns = wrapper.findAll('.menu-btn');
        expect(btns[0].classes('active')).toBe(true); // Meu Drive
        expect(btns[1].classes('active')).toBe(false); // Lixeira
        expect(btns[2].classes('active')).toBe(false); // Transferências
    });

    it('deve emitir set-tab ao clicar nas abas', async () => {
        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: false }
        });
        
        const btns = wrapper.findAll('.menu-btn');
        await btns[1].trigger('click'); // Lixeira
        
        expect(wrapper.emitted('set-tab')).toBeTruthy();
        expect(wrapper.emitted('set-tab')[0]).toEqual(['trash']);
    });

    it('deve mostrar dropdown de "Novo" baseado na prop', async () => {
        let wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: false }
        });
        expect(wrapper.find('.new-dropdown').exists()).toBe(false);

        wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: true }
        });
        expect(wrapper.find('.new-dropdown').exists()).toBe(true);
    });

    it('deve emitir eventos corretos do dropdown de "Novo"', async () => {
        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: true }
        });
        
        const buttons = wrapper.findAll('.new-dropdown button');
        
        // Nova Pasta
        await buttons[0].trigger('click');
        expect(wrapper.emitted('open-create-folder')).toBeTruthy();
        expect(wrapper.emitted('update:showNewDropdown')[0]).toEqual([false]);
        
        // Fazer upload
        await buttons[1].trigger('click');
        expect(wrapper.emitted('trigger-upload')).toBeTruthy();
    });

    it('deve exibir quota com formatação', () => {
        // Quota: 50%
        mockExplorer.quotaUsed.value = 1048576; // 1 MB
        mockExplorer.quotaTotal.value = 2097152; // 2 MB
        mockExplorer.quotaPercent = computed(() => 50);

        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: false }
        });

        const percText = wrapper.find('.quota-perc');
        expect(percText.text()).toBe('50%');
        const pb = wrapper.find('.quota-progress');
        expect(pb.attributes('style')).toContain('width: 50%');
    });

    it('deve renderizar a árvore de pastas se estiver na tab de files', async () => {
        mockExplorer.folderTree = computed(() => [
            { id: 10, name: 'Dir A', depth: 0 },
            { id: 20, name: 'Dir B', depth: 1 }
        ]);

        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'files', showNewDropdown: false }
        });

        const treeItems = wrapper.findAll('.sidebar-tree-item');
        expect(treeItems).toHaveLength(2);
        expect(treeItems[0].text()).toContain('Dir A');
        
        await treeItems[1].trigger('click');
        expect(mockExplorer.navigateToFolder).toHaveBeenCalledWith(20);
    });

    it('não deve renderizar a árvore de pastas se não estiver na tab de files', () => {
        const wrapper = mount(AppSidebar, {
            props: { currentTab: 'trash', showNewDropdown: false }
        });

        expect(wrapper.find('.sidebar-tree-container').exists()).toBe(false);
    });
});
