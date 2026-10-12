<script>
  // `items`/`orders` prefetched server-side (GET /shop, GET /shop/orders).
  // Sorted by prices low to high with optional filtering per catagory
  import PopupShell from "./PopupShell.svelte";
  import BuyButton from "../BuyButton.svelte";
  import moleIcon from "../../Images/mole.png";

  let { items, orders, user, onClose } = $props();

  let categoryFilter = $state("all");
  let showOrders = $state(false);

  const categories = $derived.by(() => {
    const seen = new Set();
    for (const item of items) {
      if (item.category?.trim()) seen.add(item.category.trim());
    }
    return ["all", ...[...seen].sort()];
  });

  let sortedItems = $derived.by(() => {
    return items
      .filter((item) => categoryFilter === "all" || item.category?.trim() === categoryFilter)
      .slice()
      .sort((a, b) => a.priceMoles - b.priceMoles);
  });
</script>

<PopupShell title="Shop" subtitle="Spend your moles. If we don't have something you want, request it in Slack." maxWidth="max-w-6xl" {onClose}>
  {#snippet children()}
    <div class="mb-6 flex flex-wrap items-center gap-3">
      <div class="inline-flex items-center gap-2 rounded-full border-2 border-[#5c4429] bg-app-gold/40 px-5 py-2.5">
        <span class="text-xs font-bold uppercase tracking-wide text-black/60">Balance</span>
        <span class="text-lg font-bold">{user.molesBalance} moles</span>
      </div>
      <button
        type="button"
        onclick={() => (showOrders = !showOrders)}
        class="cursor-pointer rounded-full border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-xs font-bold uppercase tracking-wide hover:bg-[#5c4429]/10"
      >
        {showOrders ? "← Back to shop" : "Order history"}
      </button>
    </div>

    {#if showOrders}
      <h3 class="mb-3 text-xl font-bold text-[#2e4a3d]">Order history</h3>
      {#if orders.length === 0}
        <p class="text-black/60">You haven't ordered anything yet...</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each orders as order (order.id)}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-none border-2 border-[#5c4429]/30 bg-white/60 px-4 py-3 text-sm">
              <span>{order.quantity > 1 ? `${order.quantity}× ` : ""}{order.itemName}</span>
              <span class="flex items-center gap-1 text-black/50">
                <img src={moleIcon.src} alt="" width="16" height="16" class="h-4 w-4 shrink-0" />
                {order.pricePaid}, {new Date(order.createdAt).toLocaleDateString()}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    {:else if items.length === 0}
      <p class="mb-8 text-black/60">Nothing in the shop right now. Check back soon.</p>
    {:else}
      <div class="mb-6 flex flex-wrap gap-1.5">
        {#each categories as cat (cat)}
          <button
            type="button"
            onclick={() => (categoryFilter = cat)}
            class={`cursor-pointer rounded-none border-2 border-[#5c4429]/40 px-3 py-2 text-xs font-bold uppercase tracking-wide transition-all ${categoryFilter === cat ? "bg-[#5c4429] text-white" : "bg-white hover:bg-[#5c4429]/10"}`}
          >
            {cat === "all" ? "All" : cat}
          </button>
        {/each}
      </div>

      <div class="mb-8 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {#each sortedItems as item (item.id)}
          <div class="flex flex-col rounded-lg border-2 border-[#5c4429]/30 bg-[#e4ecdf] p-4 transition-all hover:-translate-y-1 hover:border-[#5c4429]">
            {#if item.imageUrl}
              <img src={item.imageUrl} alt={item.name} class="aspect-video w-full rounded-md border-2 border-[#5c4429]/20 object-cover" />
            {/if}
            <div class="flex flex-1 flex-col gap-2 pt-3">
              {#if item.category}
                <span class="w-fit rounded-full border border-[#5c4429]/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-black/60">
                  {item.category}
                </span>
              {/if}
              <h4 class="text-lg font-bold">{item.name}</h4>
              {#if item.description}
                <p class="flex-1 text-sm text-black/60">{item.description}</p>
              {/if}
              <div class="mt-2 flex flex-col gap-2">
                <div class="flex items-center gap-1.5 text-lg font-bold">
                  <img src={moleIcon.src} alt="" width="24" height="24" class="h-6 w-6 shrink-0" />
                  {item.priceMoles}
                </div>
                <BuyButton
                  itemId={item.id}
                  itemName={item.name}
                  priceMoles={item.priceMoles}
                  userBalance={user.molesBalance}
                  userEmail={user.email}
                />
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/snippet}
</PopupShell>
