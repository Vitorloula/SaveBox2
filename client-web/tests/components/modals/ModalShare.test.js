// =======================================================================
// TESTES: ModalShare.vue
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ModalShare from '../../../src/components/modals/ModalShare.vue';
import * as useSharingMod from '../../../src/composables/useSharing.js';
import { ref } from 'vue';

describe('ModalShare.vue', () => {
    let mockSharing;

    beforeEach(() => {
        mockSharing = {
            showShareModal: ref(false),
            shareLink: ref('http://share.link'),
            copyShareLink: vi.fn()
        };
        vi.spyOn(useSharingMod, 'useSharing').mockReturnValue(mockSharing);
    });

    it('deve renderizar o titulo', () => {
        const wrapper = mount(ModalShare);
        expect(wrapper.find('.modal-header h3').text()).toContain('Compartilhar Link Público');
    });

    it('deve exibir o link de compartilhamento e botão de copiar', async () => {
        const wrapper = mount(ModalShare);
        
        expect(wrapper.find('input').element.value).toBe('http://share.link');
        
        await wrapper.find('.btn-copy').trigger('click');
        expect(mockSharing.copyShareLink).toHaveBeenCalled();
    });

    it('deve emitir close ao clicar fechar', async () => {
        const wrapper = mount(ModalShare);
        await wrapper.find('.btn-outline').trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
    });
});
