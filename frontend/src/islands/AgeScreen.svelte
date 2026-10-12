<script>
  // Asked once, right after Hack Club Auth login, of someone who hasn't done ID
  // verification. "13–18" creates their (read-only) account; "12 or under" and
  // "19 or older" create NOTHING — see backend/src/lib/signup-cookie.ts. The
  // screen shows the sorry-message for those two without ever contacting a
  // server that stores anything.
  import { navigate } from "astro:transitions/client";
  import { apiFetch } from "../lib/api-client";

  let { initiallyBlocked = false } = $props();

  let blocked = $state(initiallyBlocked);
  let busy = $state(false);
  let error = $state("");

  const OPTIONS = [
    { band: "12_or_under", label: "12 or under" },
    { band: "13_18", label: "13–18" },
    { band: "19_plus", label: "19 or older" },
  ];

  async function choose(band) {
    if (busy) return;
    busy = true;
    error = "";
    try {
      const res = await apiFetch("/auth/age", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ band }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.blocked) {
        blocked = true;
      } else if (res.ok && body.suspended) {
        window.location.href = "/suspended";
      } else if (res.ok && body.next) {
        await navigate(body.next);
      } else if (body.error === "signup_expired") {
        error = "That took too long. Please start again.";
      } else {
        error = "Something went wrong. Please try again.";
      }
    } catch {
      error = "Something went wrong. Please try again.";
    } finally {
      busy = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center bg-[#cfe0d5] p-4">
  <div class="w-full max-w-md rounded-none border-[8px] border-[#5c4429] bg-white p-6 text-center sm:border-[10px] sm:p-8">
    {#if blocked}
      <h1 class="font-anta text-3xl font-bold text-[#2e4a3d] sm:text-4xl">Cubed is for ages 13–18</h1>
      <p class="mt-4 text-black/70">
        Sorry, you can't join Cubed. We haven't saved anything about you. You're welcome to tell friends aged 13–18 about it!
      </p>
      <div class="mt-6 border-t-2 border-[#5c4429]/20 pt-4">
        <a href="/" class="text-sm font-bold text-black/50 underline hover:text-black">Back home</a>
      </div>
    {:else}
      <h1 class="font-anta text-3xl font-bold text-[#2e4a3d] sm:text-4xl">Which age group are you in?</h1>
      <p class="mt-3 text-sm text-black/60">
        You haven't verified your ID yet. You can still explore Cubed and work on projects, but you'll need to verify to submit or get prizes.
      </p>
      <div class="mt-6 flex flex-col gap-3">
        {#each OPTIONS as option (option.band)}
          <button
            type="button"
            onclick={() => choose(option.band)}
            disabled={busy}
            class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-[#e4ecdf] px-5 py-3 text-lg font-bold text-[#3d5245] hover:bg-white disabled:opacity-40"
          >
            {option.label}
          </button>
        {/each}
      </div>
      {#if error}
        <p class="mt-4 text-sm text-app-orange">{error}</p>
      {/if}
    {/if}
  </div>
</div>
