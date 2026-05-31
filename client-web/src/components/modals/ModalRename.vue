<!-- ModalRename — Renomear / Mover pasta ou arquivo -->
<script setup>
import { ref, computed, watch } from 'vue';
import { useExplorer } from '../../composables/useExplorer.js';
import { useAuth } from '../../composables/useAuth.js';

const props = defineProps({
    item: { type: Object, required: true },
    type: { type: String, required: true } // 'file' | 'folder'
});

const emit = defineEmits(['close']);
const { masterKey } = useAuth();
const { allSystemFolders, saveRename, getFolderPathRepresentation } = useExplorer();

const renameName = ref(props.item.name);
const renameParentId = ref(props.type === 'file' ? (props.item.folderId || 0) : (props.item.parentId || 0));

const availableFolders = computed(() => {
    if (props.type === 'folder') return allSystemFolders.value.filter(f => f.id !== props.item.id);
    return allSystemFolders.value;
});

async function submit() {
    if (!renameName.value.trim()) return;
    await saveRename(props.item, props.type, renameName.value, renameParentId.value, masterKey.value);
    emit('close');
}
</script>

<template>
    <div class="modal-backdrop" @click.self="emit('close')">
        <div class="modal-card glass-panel">
            <div class="modal-header">
                <h3><i class="fa-solid fa-pen"></i> Renomear / Mover Item</h3>
                <button class="modal-close" @click="emit('close')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="rename-item-name">Novo Nome</label>
                    <input type="text" id="rename-item-name" v-model="renameName"
                        placeholder="Digite o novo nome..." required autofocus>
                </div>
                <div class="form-group">
                    <label for="move-item-parent">Mover para Pasta</label>
                    <select id="move-item-parent" v-model="renameParentId">
                        <option :value="0">Raiz (Sem pasta pai)</option>
                        <option v-for="f in availableFolders" :key="f.id" :value="f.id">
                            {{ getFolderPathRepresentation(f.id) }}
                        </option>
                    </select>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" @click="emit('close')">Cancelar</button>
                <button class="btn btn-primary" @click="submit" :disabled="!renameName">Salvar</button>
            </div>
        </div>
    </div>
</template>
