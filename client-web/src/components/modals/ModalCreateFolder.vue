<!-- ModalCreateFolder — Criação de nova pasta com E2EE -->
<script setup>
import { ref } from 'vue';
import { useExplorer } from '../../composables/useExplorer.js';
import { useAuth } from '../../composables/useAuth.js';

const emit = defineEmits(['close']);
const { masterKey } = useAuth();
const { createFolder } = useExplorer();

const folderName = ref('');

async function submit() {
    if (!folderName.value.trim()) return;
    await createFolder(folderName.value, masterKey.value);
    folderName.value = '';
    emit('close');
}
</script>

<template>
    <div class="modal-backdrop" @click.self="emit('close')">
        <div class="modal-card glass-panel">
            <div class="modal-header">
                <h3><i class="fa-solid fa-folder-plus"></i> Criar Nova Pasta</h3>
                <button class="modal-close" @click="emit('close')">&times;</button>
            </div>
            <div class="modal-body">
                <div class="form-group">
                    <label for="new-folder-name">Nome da Pasta</label>
                    <input type="text" id="new-folder-name" v-model="folderName"
                        placeholder="Digite o nome..." required @keyup.enter="submit" autofocus>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline" @click="emit('close')">Cancelar</button>
                <button class="btn btn-primary" @click="submit" :disabled="!folderName">Criar Pasta</button>
            </div>
        </div>
    </div>
</template>
