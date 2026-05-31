// =======================================================================
// TESTES: ModalPreview.vue
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ModalPreview from '../../../src/components/modals/ModalPreview.vue';
import * as useTransfersMod from '../../../src/composables/useTransfers.js';
import * as useAuthMod from '../../../src/composables/useAuth.js';
import { ref } from 'vue';

describe('ModalPreview.vue', () => {
    let mockTransfers;
    let mockAuth;

    beforeEach(() => {
        mockTransfers = {
            previewFile: vi.fn()
        };
        vi.spyOn(useTransfersMod, 'useTransfers').mockReturnValue(mockTransfers);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);

        globalThis.URL.revokeObjectURL = vi.fn();
    });

    it('deve renderizar o nome do arquivo', () => {
        const wrapper = mount(ModalPreview, { props: { file: { name: 'foto.jpg', sizeBytes: 100 } } });
        expect(wrapper.find('.modal-header h3').text()).toContain('foto.jpg');
    });

    it('deve carregar imagem e emitir close ao fechar', async () => {
        mockTransfers.previewFile.mockResolvedValue({ type: 'image', url: 'img-url' });
        
        const file = { name: 'foto.jpg', sizeBytes: 1024 };
        const wrapper = mount(ModalPreview, { props: { file } });
        
        await new Promise(resolve => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();
        
        expect(wrapper.find('.image-preview img').exists()).toBe(true);
        expect(wrapper.find('.image-preview img').attributes('src')).toBe('img-url');
        
        await wrapper.find('.modal-close').trigger('click');
        expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('deve exibir mensagem de tipo não suportado', async () => {
        mockTransfers.previewFile.mockResolvedValue({ type: 'unsupported' });
        const file = { name: 'arq.exe', sizeBytes: 2048 };
        const wrapper = mount(ModalPreview, { props: { file } });
        
        await new Promise(resolve => setTimeout(resolve, 0));
        await wrapper.vm.$nextTick();
        
        expect(wrapper.text()).toContain('Visualização indisponível');
    });
});
