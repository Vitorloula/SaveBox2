// =======================================================================
// TRANSFER COMPOSABLE (UPLOAD + DOWNLOAD)
// Single Responsibility: pipeline E2EE de upload/download chunked,
// rastreamento de progresso, pausa/retomada, resume de uploads parciais
// =======================================================================
import { ref, reactive } from "vue";
import { encryptText, encryptChunk, encryptFDK, generateFDK,
         decryptFDK, decryptChunk, computeSHA256, CHUNK_SIZE } from "./useCrypto.js";
import { useApi } from "./useApi.js";
import { useToast } from "./useToast.js";

const { fetchAPI } = useApi();
const { showToast } = useToast();

const uploads = ref([]);
let uploadIdCounter = 0;
const showTransfersPanel = ref(true);
const isTransfersExpanded = ref(true);

export function useTransfers() {
    // ── Upload Pipeline ───────────────────────────────────────────────────
    async function uploadFilePipeline(fileObject, currentFolderId, masterKey, onDone) {
        const tracker = reactive({
            id: uploadIdCounter++,
            name: fileObject.name,
            progress: 0,
            status: "uploading",
            statusText: "Processando...",
            paused: false,
            cancel: false,
            fileId: null,
            isResumePending: false,
            sizeBytes: fileObject.size,
            folderId: currentFolderId
        });
        uploads.value.unshift(tracker);
        showTransfersPanel.value = true;
        isTransfersExpanded.value = true;

        try {
            let fileId, fdk, encFDK, totalChunks;
            const sizeBytes = fileObject.size;
            const plainName = fileObject.name;
            let uploadedChunksSet = new Set();

            const pendingUploads = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
            const pendingEntry = pendingUploads.find(
                p => p.name === plainName && p.sizeBytes === sizeBytes && p.folderId === currentFolderId
            );

            if (pendingEntry) {
                tracker.statusText = "Retomando upload parcial...";
                fileId = pendingEntry.fileId;
                encFDK = pendingEntry.encryptedFDK;
                totalChunks = pendingEntry.totalChunks;
                tracker.fileId = fileId;
                fdk = await decryptFDK(encFDK, masterKey);

                const chunksRes = await fetchAPI(`/files/${fileId}/uploaded-chunks`);
                if (chunksRes.ok) {
                    const chunksData = await chunksRes.json();
                    const uploaded = chunksData.uploaded_chunks || [];
                    uploadedChunksSet = new Set(uploaded);
                    tracker.progress = Math.round((uploaded.length / totalChunks) * 100);
                    showToast("Upload Retomado", `Retomando envio de "${plainName}" do bloco ${uploaded.length + 1}.`, "info");
                }
            } else {
                fdk = await generateFDK();
                const encName = await encryptText(plainName, masterKey);
                const nameHash = await computeSHA256(plainName);
                encFDK = await encryptFDK(fdk, masterKey);
                totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;
                tracker.statusText = "Inicializando cofre...";

                const initRes = await fetchAPI("/files", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        folder_id: currentFolderId,
                        encrypted_name: encName,
                        name_hash: nameHash,
                        encrypted_fdk: encFDK,
                        size_bytes: sizeBytes,
                        total_chunks: totalChunks
                    })
                });
                const initData = await initRes.json();
                if (!initRes.ok) throw new Error(initData.error || "Erro ao inicializar upload");

                fileId = initData.file_id;
                tracker.fileId = fileId;

                const currentPending = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
                currentPending.push({ fileId, name: plainName, sizeBytes, folderId: currentFolderId, encryptedFDK: encFDK, totalChunks });
                localStorage.setItem("savebox_pending_uploads", JSON.stringify(currentPending));
            }

            for (let index = 0; index < totalChunks; index++) {
                if (uploadedChunksSet.has(index)) {
                    tracker.progress = Math.round(((index + 1) / totalChunks) * 100);
                    continue;
                }
                while (tracker.paused && !tracker.cancel) {
                    tracker.statusText = `Pausado no bloco ${index}/${totalChunks}...`;
                    tracker.status = "paused";
                    await new Promise(r => setTimeout(r, 300));
                }
                if (tracker.cancel) throw new Error("Envio cancelado pelo usuário.");
                tracker.status = "uploading";

                const startByte = index * CHUNK_SIZE;
                const endByte = Math.min(startByte + CHUNK_SIZE, sizeBytes);
                tracker.statusText = `Criptografando bloco ${index + 1}/${totalChunks}...`;

                const sliceBuffer = await fileObject.slice(startByte, endByte).arrayBuffer();
                const encryptedSlice = await encryptChunk(sliceBuffer, fdk);

                tracker.statusText = `Transmitindo bloco ${index + 1}/${totalChunks}...`;
                const chunkRes = await fetchAPI(`/files/${fileId}/chunks`, {
                    method: "POST",
                    headers: { "Content-Type": "application/octet-stream", "X-Chunk-Index": index.toString() },
                    body: encryptedSlice
                });
                if (!chunkRes.ok) {
                    const errData = await chunkRes.json();
                    throw new Error(errData.error || `Erro no bloco ${index}`);
                }
                tracker.progress = Math.round(((index + 1) / totalChunks) * 100);
            }

            tracker.status = "completed";
            tracker.statusText = "Concluído & Protegido";
            showToast("Envio Concluído", `O arquivo "${plainName}" foi criptografado e salvo com sucesso.`, "success");

            const after = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
            localStorage.setItem("savebox_pending_uploads", JSON.stringify(after.filter(p => p.fileId !== fileId)));

            if (onDone) await onDone();
        } catch (err) {
            tracker.status = "failed";
            tracker.statusText = "Erro: " + err.message;
            showToast("Erro no Envio", `Falha: ${err.message}`, "error");
        }
    }

    // ── Download Pipeline ─────────────────────────────────────────────────
    async function downloadFile(file, masterKey, onDone) {
        showToast("Preparando Download", `Buscando chaves de decodificação para "${file.name}"...`, "info");
        const fdk = await decryptFDK(file.encryptedFDK, masterKey);
        const sizeBytes = file.sizeBytes;
        const totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;

        const tracker = reactive({
            id: uploadIdCounter++,
            name: `Download: ${file.name}`,
            progress: 0,
            status: "uploading",
            statusText: "Baixando blocos...",
            paused: false,
            cancel: false
        });
        uploads.value.unshift(tracker);
        showTransfersPanel.value = true;
        isTransfersExpanded.value = true;

        try {
            const chunkArrayBuffers = [];
            for (let index = 0; index < totalChunks; index++) {
                await new Promise(r => setTimeout(r, 30));
                while (tracker.paused && !tracker.cancel) {
                    tracker.statusText = `Pausado no bloco ${index}/${totalChunks}...`;
                    tracker.status = "paused";
                    await new Promise(r => setTimeout(r, 300));
                }
                if (tracker.cancel) throw new Error("Download cancelado pelo usuário.");
                tracker.status = "uploading";

                const startByte = index * (CHUNK_SIZE + 28);
                const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes + totalChunks * 28);
                tracker.statusText = `Baixando bloco ${index + 1}/${totalChunks}...`;

                const res = await fetchAPI(`/files/${file.id}/download`, {
                    headers: { "Range": `bytes=${startByte}-${endByte}` }
                });
                if (!res.ok) throw new Error("Erro de download no servidor");

                const encBytes = new Uint8Array(await res.arrayBuffer());
                tracker.statusText = `Decriptografando bloco ${index + 1}/${totalChunks}...`;
                chunkArrayBuffers.push(await decryptChunk(encBytes, fdk));
                tracker.progress = Math.round(((index + 1) / totalChunks) * 100);
            }

            const blob = new Blob(chunkArrayBuffers, { type: "application/octet-stream" });
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = file.name;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);

            tracker.status = "completed";
            tracker.statusText = "Salvo com sucesso";
            showToast("Download Concluído", `Arquivo "${file.name}" decodificado e salvo localmente.`, "success");
            if (onDone) await onDone();
        } catch (err) {
            tracker.status = "failed";
            tracker.statusText = "Erro: " + err.message;
            showToast("Erro no Download", `Não foi possível baixar o arquivo: ${err.message}`, "error");
        }
    }

    // ── Preview (partial download) ────────────────────────────────────────
    async function previewFile(file, masterKey) {
        const fdk = await decryptFDK(file.encryptedFDK, masterKey);
        const sizeBytes = file.sizeBytes;
        const totalChunks = Math.ceil(sizeBytes / CHUNK_SIZE) || 1;

        const ext = file.name.split(".").pop().toLowerCase();
        const isMedia = ["mp4","webm","ogg","mov","mkv","avi","flv","mp3","wav","m4a"].includes(ext);
        const previewChunks = isMedia ? Math.min(totalChunks, 5) : totalChunks;
        const chunkBuffers = [];

        for (let index = 0; index < previewChunks; index++) {
            await new Promise(r => setTimeout(r, 30));
            const startByte = index * (CHUNK_SIZE + 28);
            const endByte = Math.min((index + 1) * (CHUNK_SIZE + 28) - 1, sizeBytes + totalChunks * 28);
            const res = await fetchAPI(`/files/${file.id}/download`, {
                headers: { "Range": `bytes=${startByte}-${endByte}` }
            });
            if (!res.ok) throw new Error("Erro de download no servidor");
            const encBytes = new Uint8Array(await res.arrayBuffer());
            chunkBuffers.push(await decryptChunk(encBytes, fdk));
        }

        const finalBlob = new Blob(chunkBuffers, { type: "application/octet-stream" });

        // Determina tipo de preview
        if (["png","jpg","jpeg","gif","webp","svg"].includes(ext)) {
            return { type: "image", url: URL.createObjectURL(new Blob(chunkBuffers, { type: `image/${ext === "jpg" ? "jpeg" : ext}` })) };
        } else if (ext === "pdf") {
            return { type: "pdf", url: URL.createObjectURL(new Blob(chunkBuffers, { type: "application/pdf" })) };
        } else if (["mp4","webm","ogg","mov","mkv","avi","flv"].includes(ext)) {
            const mime = ext === "mov" ? "video/quicktime" : ext === "mkv" ? "video/x-matroska" : `video/${ext}`;
            return { type: "video", url: URL.createObjectURL(new Blob(chunkBuffers, { type: mime })) };
        } else if (["mp3","wav","m4a"].includes(ext)) {
            return { type: "audio", url: URL.createObjectURL(new Blob(chunkBuffers, { type: `audio/${ext === "mp3" ? "mpeg" : ext}` })) };
        } else if (["txt","md","json","js","css","html","xml","csv","cpp","h","java","py"].includes(ext)) {
            return { type: "text", textContent: await finalBlob.text() };
        }
        return { type: "unsupported" };
    }

    // ── Transfer controls ─────────────────────────────────────────────────
    function clearFinishedUploads() {
        uploads.value = uploads.value.filter(up => up.status === "uploading" || up.status === "paused");
    }

    function cancelTransfer(up) {
        up.cancel = true;
        up.paused = false;
        up.status = "failed";
        up.statusText = "Cancelado";
        if (up.fileId) {
            const pending = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
            localStorage.setItem("savebox_pending_uploads", JSON.stringify(pending.filter(p => p.fileId !== up.fileId)));
        }
        showToast("Transferência Cancelada", `A operação para "${up.name}" foi interrompida.`, "info");
    }

    function loadPendingUploadsFromStorage() {
        try {
            const pending = JSON.parse(localStorage.getItem("savebox_pending_uploads") || "[]");
            for (const item of pending) {
                if (uploads.value.some(up => up.fileId === item.fileId)) continue;
                uploads.value.push({
                    id: uploadIdCounter++,
                    fileId: item.fileId,
                    name: item.name,
                    progress: 0,
                    status: "paused",
                    statusText: "Pendente: Selecione o arquivo local",
                    paused: true,
                    cancel: false,
                    isResumePending: true,
                    sizeBytes: item.sizeBytes,
                    folderId: item.folderId,
                    encryptedFDK: item.encryptedFDK,
                    totalChunks: item.totalChunks
                });
            }
        } catch (e) {
            console.error("Erro ao carregar uploads pendentes:", e);
        }
    }

    function resumePendingFileSelection(up, masterKey, currentFolderId, onDone) {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            if (file.name !== up.name || file.size !== up.sizeBytes) {
                showToast("Arquivo Incorreto", `Por favor, selecione exatamente o arquivo "${up.name}".`, "error");
                return;
            }
            uploads.value = uploads.value.filter(u => u.fileId !== up.fileId);
            await uploadFilePipeline(file, currentFolderId, masterKey, onDone);
        };
        input.click();
    }

    return {
        uploads, showTransfersPanel, isTransfersExpanded,
        uploadFilePipeline, downloadFile, previewFile,
        clearFinishedUploads, cancelTransfer,
        loadPendingUploadsFromStorage, resumePendingFileSelection
    };
}
