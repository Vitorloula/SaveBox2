// =======================================================================
// API CLIENT
// Single Responsibility: requisições HTTP autenticadas para o backend C++
// =======================================================================
import { ref } from "vue";
import { useToast } from "./useToast.js";

export const API_URL = "http://localhost:8080";

const token = ref("");
const { showToast } = useToast();

export function useApi() {
    function setToken(t) {
        token.value = t;
    }

    function clearToken() {
        token.value = "";
    }

    async function fetchAPI(endpoint, options = {}) {
        const headers = { ...(options.headers || {}) };
        if (token.value) headers["Authorization"] = `Bearer ${token.value}`;

        const response = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        if (response.status === 401) {
            showToast("Sessão Expirada", "Por favor, faça login novamente.", "error");
            clearToken();
            throw new Error("UNAUTHORIZED");
        }
        return response;
    }

    return { token, setToken, clearToken, fetchAPI };
}
