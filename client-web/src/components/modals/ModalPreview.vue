<!-- ModalPreview — Visualizador de arquivo decriptografado in-browser -->
<script setup>
import { reactive, onUnmounted } from 'vue';
import { useTransfers } from '../../composables/useTransfers.js';
import { useToast } from '../../composables/useToast.js';
import { useAuth } from '../../composables/useAuth.js';

const props = defineProps({
    file: { type: Object, required: true }
});

const emit = defineEmits(['close', 'download']);
const { masterKey } = useAuth();
const { previewFile } = useTransfers();
const { showToast } = useToast();

const state = reactive({
    loading: true,
    type: 'unsupported',
    url: '',
    textContent: ''
});

// Inicia decriptografia ao montar
async function load() {
    try {
        const result = await previewFile(props.file, masterKey.value);
        state.type = result.type;
        state.url = result.url || '';
        state.textContent = result.textContent || '';
    } catch (err) {
        showToast("Erro na Visualização", `Não foi possível descriptografar: ${err.message}`, "error");
        emit('close');
    } finally {
        state.loading = false;
    }
}
load();

function getFileIconClass(filename) {
    if (!filename) return 'fa-solid fa-file-lines';
    const ext = filename.split('.').pop().toLowerCase();
    const map = { pdf: 'fa-file-pdf', mp4: 'fa-file-video', mkv: 'fa-file-video', mp3: 'fa-file-audio', jpg: 'fa-file-image', png: 'fa-file-image' };
    return 'fa-solid ' + (map[ext] || 'fa-file-lines');
}

function formatBytes(bytes, decimals = 2) {
    if (!bytes || bytes === 0) return '0 Bytes';
    const k = 1024, sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(decimals)) + ' ' + sizes[i];
}

onUnmounted(() => {
    if (state.url) URL.revokeObjectURL(state.url);
});
</script>

<template>
    <div class="modal-backdrop" @click.self="emit('close')">
        <div class="modal-card modal-preview-card glass-panel">
            <div class="modal-header">
                <h3>
                    <i :class="getFileIconClass(file?.name)"></i>
                    {{ file?.name }}
                </h3>
                <button class="modal-close" @click="emit('close')">&times;</button>
            </div>
            <div class="modal-body preview-body-content">
                <!-- Loading -->
                <div class="preview-loading" v-if="state.loading">
                    <i class="fa-solid fa-circle-notch fa-spin"></i>
                    <p>Descriptografando arquivos no navegador (Zero-Knowledge)...</p>
                </div>
                <!-- Conteúdo -->
                <div class="preview-container" v-else>
                    <div class="preview-wrapper image-preview" v-if="state.type === 'image'">
                        <img :src="state.url" alt="Visualização de Imagem">
                    </div>
                    <div class="preview-wrapper pdf-preview" v-else-if="state.type === 'pdf'">
                        <iframe :src="state.url" width="100%" height="450px" frameborder="0"></iframe>
                    </div>
                    <div class="preview-wrapper video-preview" v-else-if="state.type === 'video'">
                        <video :src="state.url" controls autoplay></video>
                    </div>
                    <div class="preview-wrapper audio-preview" v-else-if="state.type === 'audio'">
                        <div class="audio-card">
                            <i class="fa-solid fa-music"></i>
                            <audio :src="state.url" controls autoplay></audio>
                        </div>
                    </div>
                    <div class="preview-wrapper text-preview" v-else-if="state.type === 'text'">
                        <pre><code>{{ state.textContent }}</code></pre>
                    </div>
                    <div class="preview-wrapper unsupported-preview" v-else>
                        <i class="fa-solid fa-file-circle-question"></i>
                        <h3>Visualização indisponível</h3>
                        <p>Este formato não pode ser exibido diretamente no navegador.</p>
                        <button class="btn btn-primary" @click="emit('download', file); emit('close')">
                            <i class="fa-solid fa-cloud-arrow-down"></i> Baixar Arquivo Plano
                        </button>
                    </div>
                </div>
            </div>
            <div class="modal-footer" v-if="!state.loading">
                <span class="preview-file-size">{{ formatBytes(file?.sizeBytes) }}</span>
                <div class="modal-footer-actions">
                    <button class="btn btn-outline" @click="emit('close')">Fechar</button>
                    <button class="btn btn-primary" @click="emit('download', file)">
                        <i class="fa-solid fa-cloud-arrow-down"></i> Download
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
