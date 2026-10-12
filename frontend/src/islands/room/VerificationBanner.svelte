<script>
  // Shown on the dashboard for anyone who hasn't finished ID verification. The
  // "I've verified" button asks the backend to re-check Hack Club Auth right
  // now (POST /me/recheck-eligibility) and reloads once it confirms, so people
  // don't have to log out and back in after verifying.
  import { apiFetch } from "../../lib/api-client";
  import { NOT_VERIFIED_MESSAGE, VERIFY_URL } from "../../lib/verification";

  let checking = $state(false);
  let stillUnverified = $state(false);

  async function recheck() {
    checking = true;
    stillUnverified = false;
    try {
      const res = await apiFetch("/me/recheck-eligibility", { method: "POST" });
      if (!res.ok) throw new Error();
      const body = await res.json();
      if (body.idVerified || body.reason) {
        window.location.reload();
        return;
      }
      stillUnverified = true;
    } catch {
      stillUnverified = true;
    } finally {
      checking = false;
    }
  }
</script>

<div
  class="fixed bottom-4 left-1/2 z-40 w-[calc(100%-2rem)] max-w-2xl -translate-x-1/2 rounded-none border-[4px] border-[#5c4429] bg-[#f0e2c9] p-4 text-sm shadow-lg"
  role="status"
>
  <p class="font-bold text-[#4a3220]">{NOT_VERIFIED_MESSAGE}</p>
  <div class="mt-3 flex flex-wrap items-center gap-3">
    <a
      href={VERIFY_URL}
      target="_blank"
      rel="noopener noreferrer"
      class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-app-mint/70"
    >
      Verify in Hack Club Auth
    </a>
    <button
      type="button"
      onclick={recheck}
      disabled={checking}
      class="cursor-pointer rounded-none border-2 border-[#5c4429]/60 bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-black/5 disabled:opacity-40"
    >
      {checking ? "Checking..." : "I've verified"}
    </button>
    {#if stillUnverified}
      <span class="text-xs text-black/60">Not verified yet. It can take a little while after you finish.</span>
    {/if}
  </div>
</div>
