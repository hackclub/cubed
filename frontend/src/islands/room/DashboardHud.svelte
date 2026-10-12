<script>
  // Rendered as a sibling of DashboardRoom's parallax "stage" div, not a
  // descendant — so it never moves with the parallax effect.
  let { user, unreadCount = 0, onOpenProfile, onOpenNews } = $props();

  // Padding applied per-button, not baked in here — the avatar's own image
  // already carries visual weight, so it needs less than the text-only chips.
  const woodChip =
    "flex h-12 items-center gap-2 rounded-lg border-2 border-[#6b4a2b] bg-[#f0e2c9] text-base font-bold text-[#4a3220] shadow-sm sm:h-14 sm:text-lg";
  const chipPadding = "px-5 sm:px-6";
</script>

<div class="pointer-events-none absolute inset-0 z-20">
  <!-- Avatar / News / Docs — generous margin from the top-left corner. -->
  <div class="pointer-events-auto absolute left-6 top-6 flex items-center gap-2 sm:left-8 sm:top-8">
    <button
      type="button"
      onclick={onOpenProfile}
      aria-label="Profile"
      class={`cursor-pointer rounded-lg py-1 pl-2 pr-4 transition-all hover:bg-[#e4d1ac] sm:pl-2.5 sm:pr-5 ${woodChip}`}
    >
      {#if user.avatarUrl}
        <img src={user.avatarUrl} alt="" class="h-8 w-8 rounded-md border-2 border-[#6b4a2b] object-cover sm:h-9 sm:w-9" />
      {:else}
        <div class="grid h-8 w-8 place-items-center rounded-md border-2 border-[#6b4a2b] bg-[#e4d1ac] text-sm font-bold sm:h-9 sm:w-9">
          {(user.nickname ?? "?").trim().charAt(0).toUpperCase() || "?"}
        </div>
      {/if}
      <span class="whitespace-nowrap">{user.nickname}</span>
    </button>

    <button
      type="button"
      onclick={onOpenNews}
      aria-label={unreadCount > 0 ? `Inbox (${unreadCount} unread)` : "Inbox"}
      class={`relative w-12 shrink-0 cursor-pointer justify-center transition-all hover:bg-[#e4d1ac] sm:w-14 ${woodChip}`}
    >
      <svg viewBox="0 0 24 24" class="h-5 w-5 shrink-0 fill-current sm:h-6 sm:w-6">
        <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2Zm6-6v-5c0-3.07-1.63-5.64-4.5-6.32V4a1.5 1.5 0 0 0-3 0v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2Z" />
      </svg>
      {#if unreadCount > 0}
        <span class="absolute -right-2 -top-2 grid h-7 min-w-7 place-items-center rounded-full border-2 border-[#f0e2c9] bg-red-600 px-1.5 text-sm font-bold leading-none text-white">
          {unreadCount > 9 ? "9+" : unreadCount}
        </span>
      {/if}
    </button>

    <a href="/docs" class={`cursor-pointer transition-all hover:bg-[#e4d1ac] ${chipPadding} ${woodChip}`}>
      Docs
    </a>
  </div>

  <!-- Strap runs from the viewport's top edge (top-0 on the wrapper) down
       to the sign, so it reads as one continuous string. -->
  <div class="pointer-events-none absolute right-10 top-0 sm:right-12">
    <div class="mx-auto h-4 w-0.5 -rotate-[8deg] bg-[#6b4a2b] sm:h-6"></div>
    <div class={`pointer-events-auto -rotate-[3deg] ${chipPadding} ${woodChip}`}>
      <span class="text-[#4a3220]/60">Moles</span>
      <span>{user.molesBalance}</span>
    </div>
  </div>
</div>
