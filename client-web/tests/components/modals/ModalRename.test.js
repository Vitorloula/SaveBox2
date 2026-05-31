// =======================================================================
// TESTES: ModalRename.vue
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ModalRename from '../../../src/components/modals/ModalRename.vue';
import * as useExplorerMod from '../../../src/composables/useExplorer.js';
import * as useAuthMod from '../../../src/composables/useAuth.js';
import { ref } from 'vue';

describe('ModalRename.vue', () => {
    let mockExplorer;
    let mockAuth;

    beforeEach(() => {
        mockExplorer = {
            allSystemFolders: ref([
                { id: 1, name: 'Pasta A', parentId: null }
            ]),
            getFolderPathRepresentation: vi.fn().mockReturnValue('/Pasta A'),
            saveRename: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);
    });

    it('deve renderizar informações do item', () => {
        const item = { id: 10, name: 'old.txt', folderId: null };
        const wrapper = mount(ModalRename, { props: { item, type: 'file' } });
        expect(wrapper.find('.modal-header h3').text()).toContain('Renomear / Mover Item');
        expect(wrapper.find('input').element.value).toBe('old.txt');
    });

    it('deve emitir close ao clicar cancelar', async () => {
        const wrapper = mount(ModalRename, { props: { item: { name: 'arq.txt' }, type: 'file' } });
        await wrapper.find('.btn-outline').trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('deve chamar saveRename e emitir close', async () => {
        const item = { id: 10, name: 'old.txt', folderId: null };
        const wrapper = mount(ModalRename, { props: { item, type: 'file' } });
        
        await wrapper.find('input').setValue('new.txt');
        
        await wrapper.find('.btn-primary').trigger('click');
        
        expect(mockExplorer.saveRename).toHaveBeenCalledWith(item, 'file', 'new.txt', 0, mockAuth.masterKey.value);
        expect(wrapper.emitted('close')).toBeTruthy();
    });
});
