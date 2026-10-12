<script>
  // `onToggleRead` is owned by DashboardRoom (single source of truth for
  // the list, so the HUD's unread badge stays in sync) — flips one
  // announcement's read state via POST /announcements/:id/read.
  import PopupShell from "./PopupShell.svelte";

  let { announcements, onToggleRead, onClose } = $props();

  const DAY_MS = 24 * 60 * 60 * 1000;

  // Relative under a week old, plain calendar date past that.
  function formatPostedAt(iso) {
    const posted = new Date(iso);
    const days = Math.floor((Date.now() - posted.getTime()) / DAY_MS);
    if (days <= 0) return "Today";
    if (days === 1) return "Yesterday";
    if (days < 7) return `${days} days ago`;
    return posted.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
</script>

<PopupShell title="Inbox" maxWidth="max-w-lg" {onClose}>
  {#snippet children()}
    {#if announcements.length === 0}
      <p class="text-black/60">Nothing yet.</p>
    {:else}
      <div class="flex flex-col gap-4">
        {#each announcements as a (a.id)}
          <div
            class={`rounded-none border-2 p-5 transition-all ${a.isRead ? "border-[#5c4429]/20 bg-[#e4ecdf]/50" : "border-[#5c4429]/30 bg-[#e4ecdf]"}`}
          >
            <div class="mb-1 flex items-start justify-between gap-3">
              <h3 class="font-bold">{a.title}</h3>
              {#if !a.isRead}
                <span class="mt-1 h-2 w-2 shrink-0 rounded-full bg-app-orange"></span>
              {/if}
            </div>
            <p class="text-sm text-black/80">{a.body}</p>
            <div class="mt-3 flex items-center justify-between gap-3">
              <span class="text-xs text-black/40">{formatPostedAt(a.createdAt)}</span>
              <button
                type="button"
                onclick={() => onToggleRead(a.id)}
                class="cursor-pointer text-xs text-black/40 underline decoration-dotted hover:text-black/70"
              >
                {a.isRead ? "Mark as unread" : "Mark as read"}
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/snippet}
</PopupShell>
