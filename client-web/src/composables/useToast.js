// =======================================================================
// TOAST NOTIFICATION SYSTEM
// Single Responsibility: gerenciamento de notificações globais
// =======================================================================
import { ref } from "vue";

const toasts = ref([]);
let toastIdCounter = 0;

export function useToast() {
    function showToast(title, message, type = "info") {
        const id = toastIdCounter++;
        toasts.value.push({ id, title, message, type });
        setTimeout(() => removeToast(id), 5000);
    }

    function removeToast(id) {
        toasts.value = toasts.value.filter(t => t.id !== id);
    }

    function getToastIcon(type) {
        switch (type) {
            case "success": return "fa-solid fa-circle-check";
            case "error":   return "fa-solid fa-circle-exclamation";
            case "warning": return "fa-solid fa-triangle-exclamation";
            default:        return "fa-solid fa-circle-info";
        }
    }

    return { toasts, showToast, removeToast, getToastIcon };
}
