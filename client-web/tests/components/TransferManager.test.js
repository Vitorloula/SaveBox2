// =======================================================================
// TESTES: TransferManager.vue
// =======================================================================
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import TransferManager from '../../src/components/TransferManager.vue';
import * as useTransfersMod from '../../src/composables/useTransfers.js';
import * as useAuthMod from '../../src/composables/useAuth.js';
import * as useExplorerMod from '../../src/composables/useExplorer.js';
import { ref } from 'vue';

describe('TransferManager.vue', () => {
    let mockTransfers;
    let mockAuth;
    let mockExplorer;

    beforeEach(() => {
        mockTransfers = {
            uploads: ref([]),
            showTransfersPanel: ref(true),
            isTransfersExpanded: ref(true),
            clearFinishedUploads: vi.fn(),
            cancelTransfer: vi.fn(),
            resumePendingFileSelection: vi.fn()
        };
        vi.spyOn(useTransfersMod, 'useTransfers').mockReturnValue(mockTransfers);

        mockAuth = {
            masterKey: ref({ name: 'key' })
        };
        vi.spyOn(useAuthMod, 'useAuth').mockReturnValue(mockAuth);

        mockExplorer = {
            currentFolderId: ref(null),
            loadExplorer: vi.fn()
        };
        vi.spyOn(useExplorerMod, 'useExplorer').mockReturnValue(mockExplorer);
    });

    it('deve mostrar estado vazio se uploads estiver vazio', () => {
        const wrapper = mount(TransferManager);
        expect(wrapper.text()).toContain('Nenhuma transferência registrada');
    });

    it('deve chamar clearFinishedUploads no botão Limpar', async () => {
        mockTransfers.uploads.value = [
            { id: 1, name: 'file.txt', status: 'completed', statusText: 'Concluído', progress: 100 }
        ];
        const wrapper = mount(TransferManager);
        const btn = wrapper.findAll('button').find(b => b.text().includes('Limpar Concluídos'));
        expect(btn).toBeDefined();
        await btn.trigger('click');
        expect(mockTransfers.clearFinishedUploads).toHaveBeenCalled();
    });

    it('deve renderizar lista de uploads', () => {
        mockTransfers.uploads.value = [
            { id: 1, name: 'file.txt', status: 'uploading', statusText: 'Envio', progress: 50, cancel: false }
        ];
        const wrapper = mount(TransferManager);
        const item = wrapper.find('.transfer-row');
        expect(item.exists()).toBe(true);
        expect(item.text()).toContain('file.txt');
        expect(wrapper.find('.upload-progress').attributes('style')).toContain('width: 50%');
    });

    it('deve chamar cancelTransfer', async () => {
        const up = { id: 1, name: 'file.txt', status: 'uploading', statusText: 'Envio', progress: 50, cancel: false };
        mockTransfers.uploads.value = [up];
        const wrapper = mount(TransferManager);

        const cancelBtn = wrapper.findAll('button').find(b => b.text().includes('Cancelar'));
        expect(cancelBtn).toBeDefined();
        await cancelBtn.trigger('click');
        expect(mockTransfers.cancelTransfer).toHaveBeenCalledWith(up);
    });

    it('deve chamar resumePendingFileSelection', async () => {
        const up = { id: 1, name: 'file.txt', status: 'paused', isResumePending: true, progress: 0 };
        mockTransfers.uploads.value = [up];
        const wrapper = mount(TransferManager);

        const resumeBtn = wrapper.findAll('button').find(b => b.text().includes('Vincular Arquivo'));
        expect(resumeBtn).toBeDefined();
        await resumeBtn.trigger('click');
        expect(mockTransfers.resumePendingFileSelection).toHaveBeenCalled();
    });
});
