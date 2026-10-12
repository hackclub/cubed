<script>
  // Shared backdrop + box wrapper for every dashboard-room popup. Lighter
  // green (#cfe0d5) than DocsNav's dark board — a surface people read for a
  // while needs to stay legible, not copy the dark chalkboard look wholesale.
  // Always scrolls internally past max-h-[85vh], unconditionally (not an
  // opt-in prop) so a short/narrow viewport always has a fallback.
  import { fade } from "svelte/transition";

  let { title, subtitle = "", maxWidth = "max-w-md", onClose, children } = $props();

  const titleId = `popup-title-${Math.random().toString(36).slice(2, 8)}`;
  let box;
  let opener = null;

  // Focus moves into the dialog and goes back to whatever opened it; Escape closes it.
  // (Other popups can stack on top, so only the topmost one reacts to Escape.)
  $effect(() => {
    opener = document.activeElement;
    box?.focus();
    function onKey(event) {
      if (event.key !== "Escape") return;
      const dialogs = document.querySelectorAll("[data-popup-shell]");
      if (dialogs[dialogs.length - 1] !== box?.parentElement) return;
      onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus();
    };
  });

  function onBackdropClick() {
    onClose();
  }

  // An ancestor `transform`/`filter` silently traps a `position: fixed`
  // descendant inside its own box instead of the viewport (e.g. a shop
  // card's `hover:-translate-y`) — moved to `<body>` on mount to sidestep
  // that entirely rather than requiring every call site to stay transform-free.
  function portal(node) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.parentNode?.removeChild(node);
      },
    };
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  use:portal
  data-popup-shell
  class="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/50 p-3 backdrop-blur-[2px] sm:p-6"
  onclick={onBackdropClick}
  transition:fade={{ duration: 180 }}
>
  <div
    bind:this={box}
    role="dialog"
    aria-modal="true"
    aria-labelledby={titleId}
    tabindex="-1"
    class={`relative flex outline-none max-h-[85vh] w-[94vw] ${maxWidth} flex-col rounded-none border-[8px] border-[#5c4429] bg-[#cfe0d5] text-black shadow-xl sm:border-[10px]`}
    onclick={(e) => e.stopPropagation()}
    transition:fade={{ duration: 180 }}
  >
    <div class="relative shrink-0 px-14 pb-5 pt-6 text-center sm:px-16 sm:pb-6 sm:pt-8">
      <button
        type="button"
        onclick={onClose}
        aria-label="Close"
        class="absolute left-3 top-3 grid h-9 w-9 cursor-pointer place-items-center rounded-none border-2 border-[#5c4429] bg-[#e4ecdf] text-lg font-bold leading-none text-[#3d5245] transition-all hover:bg-white sm:left-4 sm:top-4 sm:h-10 sm:w-10"
      >
        &larr;
      </button>
      <h2 id={titleId} class="text-4xl font-bold text-[#2e4a3d] sm:text-5xl">{title}</h2>
      {#if subtitle}
        <p class="mx-auto mt-3 max-w-md text-sm text-black/60 sm:text-base">{subtitle}</p>
      {/if}
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6 sm:px-8 sm:pb-8">
      {@render children()}
    </div>
  </div>
</div>
