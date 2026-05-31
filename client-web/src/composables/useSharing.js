// =======================================================================
// SHARING COMPOSABLE
// Single Responsibility: geração de link público zero-knowledge e
// detecção/download de arquivos acessados via link compartilhado
// =======================================================================
import { ref } from "vue";
import { decryptFDK, decryptChunk, exportFDKToBase64, importRawFDK, CHUNK_SIZE } from "./useCrypto.js";
import { useApi, API_URL } from "./useApi.js";
import { useToast } from "./useToast.js";

const { fetchAPI } = useApi();
const { showToast } = useToast();

const showShareModal = ref(false);
const shareLink = ref("");

export function useSharing() {
    async function shareFile(file, masterKey) {
        try {
            const res = await fetchAPI(`/files/${file.id}/share`, { method: "POST" });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Erro ao compartilhar arquivo");

            const shareUUID = data.share_uuid;
            const fdkKey = await decryptFDK(file.encryptedFDK, masterKey);
            const rawKeyBase64 = await exportFDKToBase64(fdkKey);

            const origin = window.location.origin + window.location.pathname;
            shareLink.value = `${origin}?share=${shareUUID}#${rawKeyBase64}:${encodeURIComponent(file.name)}`;
            showShareModal.value = true;
        } catch (err) {
            showToast("Erro de Compartilhamento", err.message, "error");
        }
    }

    function copyShareLink() {
        const input = document.getElementById("share-link-input");
        if (input) {
            input.select();
            navigator.clipboard.writeText(input.value);
            showToast("Copiado!", "Link copiado para a área de transferência.", "success");
        }
    }

    async function checkSharedLinkAccess() {
        const params = new URLSearchParams(window.location.search);
        const shareUUID = params.get("share");
        if (!shareUUID) return;

        const hash = window.location.hash;
        if (!hash || hash.length < 2) {
            alert("Erro no link: Chave criptográfica ausente.");
            window.location.href = window.location.origin + window.location.pathname;
            return;
        }

        const hashParts = hash.substring(1).split(":");
        const encFDK = hashParts[0];
        const plainName = decodeURIComponent(hashParts[1] || "arquivo_compartilhado");

        if (!confirm(`Deseja baixar o arquivo compartilhado "${plainName}"?\nEle será descriptografado no seu navegador.`)) {
            window.location.href = window.location.origin + window.location.pathname;
            return;
        }

        try {
            const headRes = await fetch(`${API_URL}/share/${shareUUID}`, {
                headers: { "Range": "bytes=0-0" }
            });

            let sizeBytes = 0;
            if (headRes.ok || headRes.status === 206) {
                const contentRange = headRes.headers.get("Content-Range");
                if (contentRange) sizeBytes = parseInt(contentRange.split("/")[1]) || 0;
            }
            if (sizeBytes === 0) {
                const fullRes = await fetch(`${API_URL}/share/${shareUUID}`);
                if (!fullRes.ok) throw new Error("Erro ao baixar arquivo compartilhado");
                sizeBytes = (await fullRes.arrayBuffer()).byteLength;
            }

            const rawFDK = await importRawFDK(encFDK);
            const totalChunks = Math.ceil(sizeBytes / (CHUNK_SIZE + 28)) || 1;
            const chunkArrayBuffers = [];

            for (let index = 0; index < totalChunks; index++) {
                const startByte = index * (CHUNK_SIZE + 28);
                const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes - 1);
                const chunkRes = await fetch(`${API_URL}/share/${shareUUID}`, {
                    headers: { "Range": `bytes=${startByte}-${endByte}` }
                });
                if (!chunkRes.ok && chunkRes.status !== 206) throw new Error(`Erro ao baixar bloco ${index + 1}`);
                const encBytes = new Uint8Array(await chunkRes.arrayBuffer());
                chunkArrayBuffers.push(await decryptChunk(encBytes, rawFDK));
            }

            const blob = new Blob(chunkArrayBuffers, { type: "application/octet-stream" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = plainName;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            alert(`Download concluído: "${plainName}" decodificado com sucesso!`);
            window.location.href = window.location.origin + window.location.pathname;
        } catch (err) {
            alert(`Erro ao baixar arquivo compartilhado: ${err.message}`);
            window.location.href = window.location.origin + window.location.pathname;
        }
    }

    return { showShareModal, shareLink, shareFile, copyShareLink, checkSharedLinkAccess };
}
