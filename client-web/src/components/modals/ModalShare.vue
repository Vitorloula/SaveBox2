<!-- ModalShare — Exibe link público zero-knowledge com botão de copiar -->
<script setup>
import { useSharing } from '../../composables/useSharing.js';

const emit = defineEmits(['close']);
const { shareLink, copyShareLink } = useSharing();
</script>

<template>
    <div class="modal-backdrop" @click.self="emit('close')">
        <div class="modal-card glass-panel">
            <div class="modal-header">
                <h3><i class="fa-solid fa-share-nodes"></i> Compartilhar Link Público</h3>
                <button class="modal-close" @click="emit('close')">&times;</button>
            </div>
            <div class="modal-body">
                <p class="share-description">
                    Este arquivo agora pode ser acessado por qualquer pessoa através do link abaixo.
                    A chave de decodificação está incluída no link como uma hash (#) e
                    <strong>nunca é transmitida para o servidor</strong>. A decodificação ocorre
                    totalmente no navegador do destinatário.
                </p>
                <div class="form-group share-link-group">
                    <input type="text" id="share-link-input" :value="shareLink" readonly>
                    <button class="btn btn-primary btn-copy" @click="copyShareLink">
                        <i class="fa-solid fa-copy"></i> Copiar
                    </button>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-outline btn-block" @click="emit('close')">Fechar</button>
            </div>
        </div>
    </div>
</template>
