// =======================================================================
// ZERO-KNOWLEDGE E2EE CRYPTOGRAPHIC ENGINE (WEB CRYPTO API)
// Single Responsibility: todas as operações criptográficas do SaveBox
// =======================================================================

export const CHUNK_SIZE = 5 * 1024 * 1024 - 28; // 5,242,852 bytes

// ── 1. Deriva Chave Mestra usando PBKDF2 (senha + salt = username) ──────
export async function deriveMasterKey(password, saltText) {
    const encoder = new TextEncoder();
    const baseKey = await globalThis.crypto.subtle.importKey(
        "raw",
        encoder.encode(password),
        "PBKDF2",
        false,
        ["deriveKey"]
    );
    const salt = encoder.encode(saltText.toLowerCase().trim());
    return globalThis.crypto.subtle.deriveKey(
        { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
    );
}

// ── 2. Criptografa texto (nomes de metadados) ────────────────────────────
export async function encryptText(text, key) {
    const encoder = new TextEncoder();
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        encoder.encode(text)
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return toBase64Url(combined);
}

// ── 3. Decriptografa texto ───────────────────────────────────────────────
export async function decryptText(base64Text, key) {
    try {
        const combined = fromBase64Url(base64Text);
        const iv = combined.slice(0, 12);
        const data = combined.slice(12);
        const decrypted = await globalThis.crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            key,
            data
        );
        return new TextDecoder().decode(decrypted);
    } catch {
        return "[Metadados Corrompidos / Chave Incorreta]";
    }
}

// ── 4. SHA-256 para prevenção de duplicidade (Zero-Knowledge) ────────────
export async function computeSHA256(text) {
    const data = new TextEncoder().encode(text.trim().toLowerCase());
    const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

// ── 5. Gera Chave de Arquivo Aleatória (FDK) ────────────────────────────
export function generateFDK() {
    return globalThis.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
}

// ── 6. Criptografa FDK com a Chave Mestra ───────────────────────────────
export async function encryptFDK(fdk, mKey) {
    const rawFDK = await globalThis.crypto.subtle.exportKey("raw", fdk);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        mKey,
        rawFDK
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return toBase64Url(combined);
}

// ── 7. Decriptografa FDK usando a Chave Mestra ──────────────────────────
export async function decryptFDK(encFDKBase64, mKey) {
    const combined = fromBase64Url(encFDKBase64);
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const rawFDK = await globalThis.crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        mKey,
        data
    );
    return globalThis.crypto.subtle.importKey("raw", rawFDK, "AES-GCM", true, ["encrypt", "decrypt"]);
}

// ── 8. Importa FDK pura (para links de compartilhamento) ────────────────
export async function importRawFDK(base64Url) {
    const bytes = fromBase64Url(base64Url);
    return globalThis.crypto.subtle.importKey("raw", bytes, "AES-GCM", true, ["encrypt", "decrypt"]);
}

// ── 9. Exporta FDK como Base64 URL-safe (para link público) ─────────────
export async function exportFDKToBase64(fdkKey) {
    const raw = await globalThis.crypto.subtle.exportKey("raw", fdkKey);
    return toBase64Url(new Uint8Array(raw));
}

// ── 10. Criptografa chunk binário (ArrayBuffer) usando FDK ───────────────
export async function encryptChunk(arrayBuffer, fdk) {
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await globalThis.crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        fdk,
        arrayBuffer
    );
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);
    return combined;
}

// ── 11. Decriptografa chunk binário usando FDK ───────────────────────────
export function decryptChunk(encryptedBytes, fdk) {
    const iv = encryptedBytes.slice(0, 12);
    const data = encryptedBytes.slice(12);
    return globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, fdk, data);
}

// ── Helpers internos Base64 URL-safe ─────────────────────────────────────
export function toBase64Url(uint8Array) {
    return btoa(String.fromCodePoint.apply(null, uint8Array))
        .replaceAll("+", "-")
        .replaceAll("/", "_")
        .replace(/=+$/, "");
}

export function fromBase64Url(str) {
    let s = str.replaceAll("-", "+").replaceAll("_", "/");
    while (s.length % 4) s += "=";
    const raw = atob(s);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.codePointAt(i);
    return bytes;
}
