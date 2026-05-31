const API_URL = "http://localhost:8080";

self.addEventListener('install', event => {
    console.log('[SW] Instalando Service Worker...');
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    console.log('[SW] Ativando Service Worker e reivindicando clientes...');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Intercepta requisições de stream do player de mídia
    if (url.pathname.startsWith('/stream-media/')) {
        console.log(`[SW] Interceptado streaming de mídia: ${url.pathname}`);
        event.respondWith(handleStreamRequest(event.request, url));
    }
});

async function handleStreamRequest(request, url) {
    const pathParts = url.pathname.split('/');
    const fileId = pathParts[pathParts.length - 2] || pathParts[pathParts.length - 1];
    
    const fdkBase64 = url.searchParams.get('fdkBase64');
    const sizeBytes = parseInt(url.searchParams.get('size'), 10);
    const token = url.searchParams.get('token');
    
    if (!fdkBase64 || !sizeBytes || !token) {
        console.error('[SW] Parâmetros de streaming ausentes ou inválidos.');
        return new Response('Parâmetros de streaming inválidos', { status: 400 });
    }
    
    // Obtém o Range solicitado pelo navegador (ex: "bytes=10485760-")
    const rangeHeader = request.headers.get('Range');
    let startByte = 0;
    let endByte = sizeBytes - 1;
    
    const CHUNK_SIZE = 5242852;
    const ENCRYPTED_CHUNK_OVERHEAD = 28;
    const PLAIN_CHUNK_SIZE = CHUNK_SIZE;
    const ENCRYPTED_CHUNK_SIZE = CHUNK_SIZE + ENCRYPTED_CHUNK_OVERHEAD;
    
    if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        startByte = parseInt(parts[0], 10);
        if (parts[1]) {
            endByte = parseInt(parts[1], 10);
        }
    } else {
        // Se for a requisição inicial sem range, limitamos ao primeiro chunk (5MB) para entregar os metadados do vídeo rapidamente
        console.log('[SW] Inicialização do player sem Range. Carregando bloco inicial (chunk 0) para leitura de metadados...');
        endByte = Math.min(sizeBytes - 1, PLAIN_CHUNK_SIZE - 1);
    }
    
    const mimeType = getMimeType(url.pathname);
    console.log(`[SW] Solicitação de Range: ${rangeHeader || 'Nenhum (Carregando Chunk 0)'} | Bytes: ${startByte}-${endByte} | Tipo: ${mimeType}`);

    try {
        // Identifica os chunks inicial e final correspondentes à faixa solicitada
        const startChunkIndex = Math.floor(startByte / PLAIN_CHUNK_SIZE);
        const endChunkIndex = Math.floor(endByte / PLAIN_CHUNK_SIZE);
        
        console.log(`[SW] Mapeado para Chunks: ${startChunkIndex} até ${endChunkIndex}`);

        // Importa a chave do arquivo (FDK)
        const rawKeyBytes = new Uint8Array(atob(fdkBase64).split("").map(c => c.charCodeAt(0)));
        const fdk = await self.crypto.subtle.importKey(
            "raw",
            rawKeyBytes,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );
        
        const decryptedBuffers = [];
        
        for (let i = startChunkIndex; i <= endChunkIndex; i++) {
            const chunkStartEnc = i * ENCRYPTED_CHUNK_SIZE;
            const chunkEndEnc = (i + 1) * ENCRYPTED_CHUNK_SIZE - 1;
            
            console.log(`[SW] Baixando chunk criptografado ${i} | Faixa de bytes no servidor: ${chunkStartEnc}-${chunkEndEnc}`);

            // Busca o pedaço criptografado correspondente no C++ backend
            const response = await fetch(`${API_URL}/files/${fileId}/download`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Range': `bytes=${chunkStartEnc}-${chunkEndEnc}`
                }
            });
            
            if (!response.ok) {
                console.error(`[SW] Erro ao baixar chunk ${i}:`, response.status, response.statusText);
                throw new Error(`Falha ao baixar chunk de stream ${i}`);
            }
            
            const encryptedBytes = new Uint8Array(await response.arrayBuffer());
            const decryptedBytes = await decryptChunk(encryptedBytes, fdk);
            decryptedBuffers.push(decryptedBytes);
        }
        
        // Une os buffers descriptografados
        const totalPlainLength = decryptedBuffers.reduce((acc, b) => acc + b.byteLength, 0);
        const plainBuffer = new Uint8Array(totalPlainLength);
        let offset = 0;
        for (const buf of decryptedBuffers) {
            plainBuffer.set(new Uint8Array(buf), offset);
            offset += buf.byteLength;
        }
        
        // Extrai a fatia exata requisitada pelo player de mídia do navegador
        const relativeStart = startByte - (startChunkIndex * PLAIN_CHUNK_SIZE);
        const requestedLength = endByte - startByte + 1;
        const slicedData = plainBuffer.slice(relativeStart, relativeStart + requestedLength);
        
        console.log(`[SW] Retornando 206 Partial Content: bytes ${startByte}-${endByte}/${sizeBytes} | Bytes descriptografados enviados: ${slicedData.byteLength}`);

        return new Response(slicedData, {
            status: 206,
            headers: {
                'Content-Range': `bytes ${startByte}-${endByte}/${sizeBytes}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': slicedData.byteLength.toString(),
                'Content-Type': mimeType
            }
        });
        
    } catch (err) {
        console.error('[SW] Erro de decodificação sob-demanda do Service Worker:', err);
        return new Response(err.message, { status: 500 });
    }
}

async function decryptChunk(encryptedChunkBytes, fdk) {
    const iv = encryptedChunkBytes.slice(0, 12);
    const data = encryptedChunkBytes.slice(12);
    
    return self.crypto.subtle.decrypt(
        { name: "AES-GCM", iv: iv },
        fdk,
        data
    );
}

function getMimeType(path) {
    const ext = path.split('.').pop().toLowerCase();
    if (ext === 'mp4') return 'video/mp4';
    if (ext === 'webm') return 'video/webm';
    if (ext === 'ogg') return 'video/ogg';
    if (ext === 'mov') return 'video/quicktime';
    // Trick Chrome: Mapeamos .mkv para video/webm ou video/mp4 para que o browser tente decodificar com aceleração
    if (ext === 'mkv') return 'video/webm'; 
    if (ext === 'avi') return 'video/mp4';
    if (ext === 'flv') return 'video/mp4';
    if (ext === 'mp3') return 'audio/mpeg';
    if (ext === 'wav') return 'audio/wav';
    if (ext === 'm4a') return 'audio/x-m4a';
    return 'video/mp4';
}
