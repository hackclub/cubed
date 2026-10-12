<script>
  // Flow: Buy → shipping info (+ quantity) → order summary → Confirm
  // purchase. Nothing is charged or recorded until that final confirm: one
  // POST /shop/:id/buy carries the quantity and shipping info together, and
  // the backend creates the order, deducts moles, and writes the Airtable
  // fulfillment record as a single all-or-nothing step (same pass-through
  // PII pattern as SubmissionModal.svelte).
  import { apiFetch } from "../lib/api-client";
  import PopupShell from "./room/PopupShell.svelte";
  import moleIcon from "../Images/mole.png";
  import { getContext } from "svelte";
  import { ID_VERIFIED_CONTEXT, NOT_VERIFIED_MESSAGE } from "../lib/verification";

  let { itemId, itemName, priceMoles, userBalance, userEmail } = $props();

  /** @type {'idle' | 'shipping' | 'review' | 'done'} */
  let stage = $state("idle");
  let quantity = $state(1);
  let buying = $state(false);
  let error = $state("");

  let firstName = $state("");
  let lastName = $state("");
  let addressLine1 = $state("");
  let addressLine2 = $state("");
  let city = $state("");
  let stateProvince = $state("");
  let country = $state("");
  let zip = $state("");
  let phone = $state("");
  let deliveryNotes = $state("");

  const canAfford = $derived(userBalance >= priceMoles);
  const maxQuantity = $derived(Math.max(1, Math.min(20, Math.floor(userBalance / priceMoles) || 1)));
  const totalCost = $derived(priceMoles * quantity);
  const fullName = $derived(`${firstName.trim()} ${lastName.trim()}`.trim());
  const addressSummary = $derived(
    [addressLine1.trim(), addressLine2.trim(), city.trim(), stateProvince.trim(), zip.trim(), country.trim()]
      .filter(Boolean)
      .join(", "),
  );

  const idVerified = getContext(ID_VERIFIED_CONTEXT) !== false;
  let notVerifiedNotice = $state(false);

  function openShipping() {
    if (!canAfford) return;
    if (!idVerified) {
      notVerifiedNotice = true;
      return;
    }
    quantity = 1;
    error = "";
    stage = "shipping";
  }

  function close() {
    if (buying) return;
    stage = "idle";
  }

  function goToReview(event) {
    event.preventDefault();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity || totalCost > userBalance) {
      error = "Pick a quantity you can afford.";
      return;
    }
    error = "";
    stage = "review";
  }

  async function confirmPurchase() {
    buying = true;
    error = "";
    try {
      const res = await apiFetch(`/shop/${itemId}/buy`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          quantity,
          fullName,
          addressLine1: addressLine1.trim(),
          addressLine2: addressLine2.trim() || undefined,
          city: city.trim(),
          stateProvince: stateProvince.trim(),
          country: country.trim(),
          zip: zip.trim(),
          phone: phone.trim(),
          notes: deliveryNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "not_eligible") {
          // Full navigation, not a client-side route change — /blocked
          // reads the session server-side, which this same request just updated.
          window.location.href = "/blocked";
          return;
        }
        if (body.error === "eligibility_unverifiable") {
          throw new Error("We couldn't verify your eligibility right now, so you were not charged. Please try again in a moment.");
        }
        if (body.error === "not_verified") throw new Error(NOT_VERIFIED_MESSAGE);
        if (body.error === "insufficient_balance") throw new Error("You don't have enough moles.");
        if (body.error === "fulfillment_failed") {
          throw new Error("We couldn't record your order, so you were not charged. Please try again.");
        }
        if (body.error === "fulfillment_unconfirmed") {
          throw new Error(
            "We couldn't confirm your order yet. Don't buy again: it is being checked and will either go through or your moles will be returned within a few minutes. Check your Profile for the result.",
          );
        }
        if (res.status === 400) {
          stage = "shipping";
          throw new Error("Some of your shipping info looks invalid. Please check it and try again.");
        }
        throw new Error("The purchase didn't complete. Check your moles balance in your Profile before trying again.");
      }
      stage = "done";
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
    } finally {
      buying = false;
    }
  }

  // Matches the backend's fullName regex (Unicode letters, marks, spaces,
  // hyphens, apostrophes, periods) — strips anything else as-you-type, but
  // keeps accents like José and O'Brien intact.
  function onlyLettersAndSpaces(event) {
    return event.currentTarget.value.replace(/[^\p{L}\p{M} .'’-]/gu, "");
  }

  const fieldClass =
    "rounded-none border-2 border-[#5c4429]/40 bg-white px-3 py-2 font-normal outline-none focus:border-[#5c4429]";

  // Grows a textarea to fit typed content, up to the `max-h-40` cap on the
  // one textarea using it — overflow-y-auto takes over past that.
  function autoResize(node) {
    function resize() {
      node.style.height = "auto";
      node.style.height = `${node.scrollHeight}px`;
    }
    resize();
    node.addEventListener("input", resize);
    return {
      destroy() {
        node.removeEventListener("input", resize);
      },
    };
  }
</script>

<button
  type="button"
  onclick={openShipping}
  disabled={!canAfford}
  class="w-full cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-5 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70 disabled:cursor-not-allowed disabled:opacity-30"
>
  {canAfford ? "Buy" : "Not enough moles"}
</button>
{#if notVerifiedNotice}
  <p class="mt-2 text-xs text-app-orange">{NOT_VERIFIED_MESSAGE}</p>
{/if}

{#if stage === "shipping"}
  <PopupShell title="Shipping info" subtitle="Where should we send it? You won't be charged yet." maxWidth="max-w-xl" onClose={close}>
    {#snippet children()}
      <form onsubmit={goToReview} class="flex flex-col gap-4">
        <label class="flex items-center gap-3 text-sm font-bold">
          Quantity
          <input
            type="number"
            min="1"
            max={maxQuantity}
            bind:value={quantity}
            class="w-20 rounded-none border-2 border-[#5c4429]/40 bg-white px-2 py-1.5 text-center outline-none focus:border-[#5c4429]"
          />
          <span class="flex items-center gap-1.5 font-normal text-black/60">
            <img src={moleIcon.src} alt="" width="16" height="16" class="h-4 w-4 shrink-0" />
            {totalCost}
          </span>
        </label>

        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm font-bold">
            First name
            <input type="text" value={firstName} oninput={(e) => (firstName = onlyLettersAndSpaces(e))} required class={fieldClass} />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            Last name
            <input type="text" value={lastName} oninput={(e) => (lastName = onlyLettersAndSpaces(e))} required class={fieldClass} />
          </label>
        </div>
        <p class="-mt-2 text-xs font-normal text-black/50">
          Please use your legal first and last name. This is what goes on your shipping
          label.
        </p>

        <label class="flex flex-col gap-1 text-sm font-bold">
          Address line 1
          <input type="text" bind:value={addressLine1} required class={fieldClass} />
        </label>
        <label class="flex flex-col gap-1 text-sm font-bold">
          Address line 2 <span class="font-normal text-black/50">(optional)</span>
          <input type="text" bind:value={addressLine2} class={fieldClass} />
        </label>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm font-bold">
            City
            <input type="text" bind:value={city} required class={fieldClass} />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            State / Province
            <input type="text" bind:value={stateProvince} required class={fieldClass} />
          </label>
        </div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label class="flex flex-col gap-1 text-sm font-bold">
            Country
            <input type="text" bind:value={country} required class={fieldClass} />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            ZIP / Postal code
            <input type="text" bind:value={zip} required class={fieldClass} />
          </label>
        </div>
        <label class="flex flex-col gap-1 text-sm font-bold">
          Phone number
          <input type="tel" bind:value={phone} required class={fieldClass} />
        </label>

        <label class="flex flex-col gap-1 text-sm font-bold">
          Delivery & fulfillment notes <span class="font-normal text-black/50">(optional)</span>
          <textarea
            bind:value={deliveryNotes}
            maxlength="1000"
            rows="3"
            placeholder="Details on how/where you want us to buy it, or maybe some detials on delivery or anything else worth knowing..."
            use:autoResize
            class={`${fieldClass} max-h-40 resize-none overflow-y-auto`}
          ></textarea>
          <span class="text-xs font-normal text-black/50">
            Anything specific the person buying and/or shipping this should know.
          </span>
        </label>

        {#if error}
          <p class="text-sm text-app-orange">{error}</p>
        {/if}

        <button
          type="submit"
          class="mt-2 w-fit cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70"
        >
          Review order
        </button>
      </form>
    {/snippet}
  </PopupShell>
{/if}

{#if stage === "review"}
  <PopupShell title="Confirm purchase" subtitle="Review your order. You'll be charged when you confirm." maxWidth="max-w-md" onClose={close}>
    {#snippet children()}
      <div class="flex flex-col gap-4">
        <div class="rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4 text-left">
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-black/50">Order summary</p>
          <div class="flex items-center justify-between text-sm">
            <span>{itemName}</span>
            <span class="font-bold">&times;{quantity}</span>
          </div>
          <div class="mt-2 flex items-center justify-between border-t-2 border-[#5c4429]/20 pt-2 text-sm font-bold">
            <span>Total</span>
            <span class="flex items-center gap-1.5">
              <img src={moleIcon.src} alt="" width="18" height="18" class="h-[18px] w-[18px] shrink-0" />
              {totalCost} moles
            </span>
          </div>
          <div class="mt-1 flex items-center justify-between text-xs text-black/50">
            <span>Balance after</span>
            <span>{userBalance - totalCost} moles</span>
          </div>
        </div>

        <div class="rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4 text-left text-sm">
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-black/50">Shipping to</p>
          <p class="font-bold">{fullName}</p>
          <p>{addressSummary}</p>
          <p class="text-black/60">{phone}</p>
          {#if deliveryNotes.trim()}
            <p class="mt-2 text-xs text-black/60">Notes: {deliveryNotes.trim()}</p>
          {/if}
        </div>

        {#if error}
          <p class="text-sm text-app-orange">{error}</p>
        {/if}

        <div class="flex gap-3">
          <button
            type="button"
            onclick={() => {
              error = "";
              stage = "shipping";
            }}
            disabled={buying}
            class="cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-black/5 disabled:opacity-30"
          >
            Back
          </button>
          <button
            type="button"
            onclick={confirmPurchase}
            disabled={buying || totalCost > userBalance}
            class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70 disabled:opacity-30"
          >
            {buying ? "Buying..." : "Confirm purchase"}
          </button>
        </div>
      </div>
    {/snippet}
  </PopupShell>
{/if}

{#if stage === "done"}
  <PopupShell title="Thank you!" maxWidth="max-w-sm" onClose={() => (stage = "idle")}>
    {#snippet children()}
      <div class="flex flex-col items-center gap-4 text-center">
        <div class="w-full rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4 text-left">
          <p class="mb-2 text-xs font-bold uppercase tracking-wide text-black/50">Order summary</p>
          <div class="flex items-center justify-between text-sm">
            <span>{itemName}</span>
            <span class="font-bold">&times;{quantity}</span>
          </div>
          <div class="mt-2 flex items-center justify-between border-t-2 border-[#5c4429]/20 pt-2 text-sm font-bold">
            <span>Total</span>
            <span class="flex items-center gap-1.5">
              <img src={moleIcon.src} alt="" width="18" height="18" class="h-[18px] w-[18px] shrink-0" />
              {totalCost} moles
            </span>
          </div>
        </div>
        <p class="text-sm text-black/70">
          Your item is being ordered. Check your email soon for more details and an estimated
          delivery time.
        </p>
        <button
          type="button"
          onclick={() => (stage = "idle")}
          class="cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-5 py-2 text-sm font-bold uppercase tracking-wide hover:bg-black hover:text-white"
        >
          Close
        </button>
      </div>
    {/snippet}
  </PopupShell>
{/if}
