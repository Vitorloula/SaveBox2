// =======================================================================
// TESTES: ModalCreateFolder.vue
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ModalCreateFolder from '../../../src/components/modals/ModalCreateFolder.vue';
import * as useExplorerMod from '../../../src/composables/useExplorer.js';
import * as useAuthMod from '../../../src/composables/useAuth.js';
import { ref } from 'vue';

describe('ModalCreateFolder.vue', () => {
    let mockExplorer;
    let mockAuth;

    beforeEach(() => {
        mockExplorer = {
            createFolder: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);
    });

    it('deve renderizar o titulo', () => {
        const wrapper = mount(ModalCreateFolder);
        expect(wrapper.find('.modal-header h3').text()).toContain('Criar Nova Pasta');
    });

    it('deve emitir close ao clicar no botão cancelar', async () => {
        const wrapper = mount(ModalCreateFolder);
        await wrapper.find('.btn-outline').trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('deve chamar createFolder e emitir close ao salvar', async () => {
        const wrapper = mount(ModalCreateFolder);
        
        const input = wrapper.find('input');
        await input.setValue('Nova Pasta 123');
        
        await wrapper.find('.btn-primary').trigger('click');
        
        expect(mockExplorer.createFolder).toHaveBeenCalledWith('Nova Pasta 123', mockAuth.masterKey.value);
        expect(wrapper.emitted('close')).toBeTruthy();
    });
});
