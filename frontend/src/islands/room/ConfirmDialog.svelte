<script>
  // Own lightweight component rather than reusing PopupShell — this needs
  // to layer on top of an already-open popup at a higher z-index, not replace it.
  import { fade } from "svelte/transition";

  let { title, message, confirmLabel = "Delete", onConfirm, onCancel } = $props();
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-[2px]"
  onclick={onCancel}
  transition:fade={{ duration: 150 }}
>
  <div
    class="w-full max-w-sm rounded-none border-[6px] border-[#5c4429] bg-[#cfe0d5] p-6 text-center shadow-xl"
    onclick={(e) => e.stopPropagation()}
    transition:fade={{ duration: 150 }}
  >
    <h3 class="mb-2 text-xl font-bold text-[#2e4a3d]">{title}</h3>
    <p class="mb-6 text-sm text-black/70">{message}</p>
    <div class="flex justify-center gap-3">
      <button
        type="button"
        onclick={onCancel}
        class="cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-black/5"
      >
        Cancel
      </button>
      <button
        type="button"
        onclick={onConfirm}
        class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-orange px-4 py-2 text-sm font-bold uppercase tracking-wide text-black hover:bg-app-orange/70"
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>
