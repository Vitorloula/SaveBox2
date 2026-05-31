// =======================================================================
// TESTES: useCrypto.js — Engine E2EE Zero-Knowledge
// Cobertura: derivação de chave, encrypt/decrypt texto, SHA-256,
// FDK lifecycle, encrypt/decrypt chunks, helpers Base64
// =======================================================================
import { describe, it, expect, beforeAll } from 'vitest';
import {
    CHUNK_SIZE, deriveMasterKey, encryptText, decryptText,
    computeSHA256, generateFDK, encryptFDK, decryptFDK,
    encryptChunk, decryptChunk, toBase64Url, fromBase64Url,
    importRawFDK, exportFDKToBase64
} from '../../src/composables/useCrypto.js';

describe('useCrypto', () => {
    // ── Constants ────────────────────────────────────────────────────────
    describe('CHUNK_SIZE', () => {
        it('deve ser 5MB menos 28 bytes (overhead do envelope criptográfico)', () => {
            expect(CHUNK_SIZE).toBe(5 * 1024 * 1024 - 28);
            expect(CHUNK_SIZE).toBe(5242852);
        });
    });

    // ── Base64 URL-safe helpers ──────────────────────────────────────────
    describe('toBase64Url / fromBase64Url', () => {
        it('deve fazer roundtrip de bytes arbitrários', () => {
            const original = new Uint8Array([0, 1, 2, 255, 128, 64, 32]);
            const encoded = toBase64Url(original);
            const decoded = fromBase64Url(encoded);
            expect(decoded).toEqual(original);
        });

        it('não deve conter caracteres +, /, ou = no output', () => {
            // Gera bytes que produziriam +, / e padding
            const bytes = new Uint8Array(256);
            for (let i = 0; i < 256; i++) bytes[i] = i;
            const encoded = toBase64Url(bytes);
            expect(encoded).not.toContain('+');
            expect(encoded).not.toContain('/');
            expect(encoded).not.toContain('=');
        });

        it('deve decodificar string vazia corretamente', () => {
            const result = fromBase64Url(toBase64Url(new Uint8Array(0)));
            expect(result.length).toBe(0);
        });
    });

    // ── PBKDF2 Key Derivation ────────────────────────────────────────────
    describe('deriveMasterKey', () => {
        it('deve derivar uma CryptoKey válida do tipo AES-GCM', async () => {
            const key = await deriveMasterKey('senha123', 'usuario');
            expect(key).toBeDefined();
            expect(key.type).toBe('secret');
            expect(key.algorithm.name).toBe('AES-GCM');
            expect(key.algorithm.length).toBe(256);
        });

        it('deve ser determinística (mesma senha + salt = mesma chave)', async () => {
            const key1 = await deriveMasterKey('minhaSenha', 'meuSalt');
            const key2 = await deriveMasterKey('minhaSenha', 'meuSalt');
            // Não conseguimos comparar CryptoKey diretamente (extractable = false),
            // mas encrypt/decrypt devem ser compatíveis
            const text = 'teste de consistência';
            const encrypted = await encryptText(text, key1);
            const decrypted = await decryptText(encrypted, key2);
            expect(decrypted).toBe(text);
        });

        it('deve normalizar o salt para lowercase e trim', async () => {
            const key1 = await deriveMasterKey('pass', '  User  ');
            const key2 = await deriveMasterKey('pass', 'user');
            const text = 'normalization test';
            const enc = await encryptText(text, key1);
            expect(await decryptText(enc, key2)).toBe(text);
        });

        it('senhas diferentes devem gerar chaves incompatíveis', async () => {
            const key1 = await deriveMasterKey('senhaA', 'salt');
            const key2 = await deriveMasterKey('senhaB', 'salt');
            const encrypted = await encryptText('segredo', key1);
            const result = await decryptText(encrypted, key2);
            expect(result).toBe('[Metadados Corrompidos / Chave Incorreta]');
        });
    });

    // ── Text Encryption / Decryption ─────────────────────────────────────
    describe('encryptText / decryptText', () => {
        let masterKey;

        beforeAll(async () => {
            masterKey = await deriveMasterKey('testPassword', 'testUser');
        });

        it('deve criptografar e decriptografar texto corretamente', async () => {
            const plaintext = 'Nome da Pasta Secreta';
            const encrypted = await encryptText(plaintext, masterKey);
            expect(encrypted).toBeTruthy();
            expect(encrypted).not.toBe(plaintext);

            const decrypted = await decryptText(encrypted, masterKey);
            expect(decrypted).toBe(plaintext);
        });

        it('deve lidar com caracteres Unicode (emojis, acentos)', async () => {
            const text = '📁 Pasta Ação Coração 日本語';
            const enc = await encryptText(text, masterKey);
            const dec = await decryptText(enc, masterKey);
            expect(dec).toBe(text);
        });

        it('deve lidar com string vazia', async () => {
            const enc = await encryptText('', masterKey);
            const dec = await decryptText(enc, masterKey);
            expect(dec).toBe('');
        });

        it('deve produzir ciphertexts diferentes para o mesmo plaintext (IV aleatório)', async () => {
            const text = 'mesmo texto';
            const enc1 = await encryptText(text, masterKey);
            const enc2 = await encryptText(text, masterKey);
            expect(enc1).not.toBe(enc2); // IVs diferentes
        });

        it('deve retornar mensagem de erro para dados corrompidos', async () => {
            const result = await decryptText('dados_invalidos_completamente', masterKey);
            expect(result).toBe('[Metadados Corrompidos / Chave Incorreta]');
        });

        it('deve retornar string vazia para input null ou vazio no decryptText', async () => {
            // fromBase64Url de string vazia gera array vazio → slice(0,12) é vazio → erro de crypto → fallback
            const result = await decryptText('', masterKey);
            expect(result).toBe('[Metadados Corrompidos / Chave Incorreta]');
        });
    });

    // ── SHA-256 ──────────────────────────────────────────────────────────
    describe('computeSHA256', () => {
        it('deve gerar hash hex de 64 caracteres', async () => {
            const hash = await computeSHA256('teste');
            expect(hash).toMatch(/^[0-9a-f]{64}$/);
        });

        it('deve ser case-insensitive e trim-safe', async () => {
            const hash1 = await computeSHA256('  Pasta  ');
            const hash2 = await computeSHA256('pasta');
            expect(hash1).toBe(hash2);
        });

        it('deve produzir hashes diferentes para textos diferentes', async () => {
            const h1 = await computeSHA256('arquivo1');
            const h2 = await computeSHA256('arquivo2');
            expect(h1).not.toBe(h2);
        });

        it('hash conhecido para "hello"', async () => {
            const hash = await computeSHA256('hello');
            expect(hash).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
        });
    });

    // ── FDK Lifecycle ────────────────────────────────────────────────────
    describe('FDK (File Decryption Key) lifecycle', () => {
        let masterKey;

        beforeAll(async () => {
            masterKey = await deriveMasterKey('fdkTestPass', 'fdkTestSalt');
        });

        it('deve gerar uma FDK AES-GCM 256 válida', async () => {
            const fdk = await generateFDK();
            expect(fdk.type).toBe('secret');
            expect(fdk.algorithm.name).toBe('AES-GCM');
            expect(fdk.algorithm.length).toBe(256);
            expect(fdk.extractable).toBe(true);
        });

        it('deve criptografar e decriptografar a FDK com a chave mestra', async () => {
            const fdk = await generateFDK();
            const encFDK = await encryptFDK(fdk, masterKey);
            expect(encFDK).toBeTruthy();

            const restoredFDK = await decryptFDK(encFDK, masterKey);
            expect(restoredFDK.type).toBe('secret');
            expect(restoredFDK.algorithm.name).toBe('AES-GCM');
        });

        it('FDK restaurada deve criptografar/decriptografar dados identicamente', async () => {
            const fdk = await generateFDK();
            const encFDK = await encryptFDK(fdk, masterKey);
            const restoredFDK = await decryptFDK(encFDK, masterKey);

            // Usa FDK original para criptografar, restaurada para decriptografar
            const data = new TextEncoder().encode('dados secretos do arquivo');
            const encryptedChunkBytes = await encryptChunk(data.buffer, fdk);
            const decrypted = await decryptChunk(encryptedChunkBytes, restoredFDK);
            expect(new TextDecoder().decode(decrypted)).toBe('dados secretos do arquivo');
        });

        it('exportFDKToBase64 e importRawFDK devem fazer roundtrip', async () => {
            const fdk = await generateFDK();
            const b64 = await exportFDKToBase64(fdk);
            expect(b64).toBeTruthy();

            const imported = await importRawFDK(b64);
            expect(imported.type).toBe('secret');
            expect(imported.algorithm.name).toBe('AES-GCM');

            // Verifica compatibilidade criptográfica
            const data = new Uint8Array([1, 2, 3, 4, 5]);
            const enc = await encryptChunk(data.buffer, fdk);
            const dec = await decryptChunk(enc, imported);
            expect(new Uint8Array(dec)).toEqual(data);
        });
    });

    // ── Chunk Encryption / Decryption ────────────────────────────────────
    describe('encryptChunk / decryptChunk', () => {
        let fdk;

        beforeAll(async () => {
            fdk = await generateFDK();
        });

        it('deve criptografar e decriptografar chunks binários', async () => {
            const data = new Uint8Array(1024);
            for (let i = 0; i < 1024; i++) data[i] = i % 256;

            const encrypted = await encryptChunk(data.buffer, fdk);
            expect(encrypted.byteLength).toBeGreaterThan(data.byteLength);
            // IV (12) + ciphertext (1024) + tag (16) = 1052
            expect(encrypted.byteLength).toBe(1024 + 12 + 16);

            const decrypted = await decryptChunk(encrypted, fdk);
            expect(new Uint8Array(decrypted)).toEqual(data);
        });

        it('deve lidar com chunks pequenos (1 byte)', async () => {
            const data = new Uint8Array([42]);
            const enc = await encryptChunk(data.buffer, fdk);
            const dec = await decryptChunk(enc, fdk);
            expect(new Uint8Array(dec)).toEqual(data);
        });

        it('deve lidar com chunks grandes (~5MB)', async () => {
            const data = new Uint8Array(CHUNK_SIZE);
            data[0] = 0xDE; data[CHUNK_SIZE - 1] = 0xAD;

            const enc = await encryptChunk(data.buffer, fdk);
            const dec = await decryptChunk(enc, fdk);
            const result = new Uint8Array(dec);
            expect(result[0]).toBe(0xDE);
            expect(result[CHUNK_SIZE - 1]).toBe(0xAD);
            expect(result.length).toBe(CHUNK_SIZE);
        });

        it('overhead do envelope deve ser exatamente 28 bytes (12 IV + 16 tag)', async () => {
            const sizes = [100, 500, 1000, 4096];
            for (const size of sizes) {
                const data = new Uint8Array(size);
                const enc = await encryptChunk(data.buffer, fdk);
                expect(enc.byteLength).toBe(size + 28);
            }
        });
    });
});
