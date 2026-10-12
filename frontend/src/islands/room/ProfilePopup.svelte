<script>
  // Nickname edit, balance, ledger, sign-out, and the Admin buttom
  import { apiFetch } from "../../lib/api-client";
  import PopupShell from "./PopupShell.svelte";

  let { user, initialTransactions, onNicknameSaved, onClose } = $props();

  let nickname = $state(user.nickname ?? "");
  let nicknameStatus = $state("");
  let savingNickname = $state(false);

  let transactions = $state(initialTransactions);
  let page = $state(1);
  let loadingPage = $state(false);

  let signingOut = $state(false);

  async function saveNickname(event) {
    event.preventDefault();
    savingNickname = true;
    nicknameStatus = "Saving...";

    try {
      const res = await apiFetch("/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: nickname.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error === "nickname_taken" ? "That nickname is already taken." : "");
      }
      nicknameStatus = "Saved.";
      onNicknameSaved(nickname.trim());
    } catch (err) {
      nicknameStatus = err instanceof Error && err.message ? err.message : "Couldn't save, try again.";
    } finally {
      savingNickname = false;
    }
  }

  async function goToPage(nextPage) {
    if (nextPage < 1 || loadingPage) return;
    loadingPage = true;
    try {
      const res = await apiFetch(`/me/transactions?page=${nextPage}`);
      if (!res.ok) throw new Error();
      transactions = await res.json();
      page = nextPage;
    } catch {
      // Leave the current page showing rather than clearing it on a transient failure.
    } finally {
      loadingPage = false;
    }
  }

  let signOutError = $state("");

  // Only leaves once the server confirms the session is gone — redirecting
  // after a failed call would look signed out while the cookie is still valid.
  async function signOut(everywhere = false) {
    signingOut = true;
    signOutError = "";
    try {
      const res = await apiFetch(everywhere ? "/auth/logout-all" : "/auth/logout", { method: "POST" });
      if (!res.ok) throw new Error();
      window.location.href = "/";
    } catch {
      signOutError = "Couldn't sign out. Please try again.";
      signingOut = false;
    }
  }
</script>

<PopupShell title="Profile" maxWidth="max-w-lg" {onClose}>
  {#snippet children()}
    <section class="mb-6 rounded-none border-2 border-[#5c4429]/30 bg-[#e4ecdf] p-5">
      <h3 class="mb-4 text-lg font-bold">Nickname</h3>
      <div class="mb-4 flex items-center gap-3">
        {#if user.avatarUrl}
          <img src={user.avatarUrl} alt="" class="h-16 w-16 shrink-0 rounded-full border-2 border-[#5c4429]/40 object-cover" />
        {:else}
          <div class="grid h-16 w-16 shrink-0 place-items-center rounded-full border-2 border-[#5c4429]/40 bg-app-mint text-2xl font-bold">
            {(user.nickname ?? "?").trim().charAt(0).toUpperCase() || "?"}
          </div>
        {/if}
        <p class="text-xs text-black/50">
          Pulled from you profile picture on slack
        </p>
      </div>
      <form onsubmit={saveNickname} class="flex flex-wrap items-center gap-3">
        <input
          type="text"
          bind:value={nickname}
          minlength="3"
          maxlength="20"
          required
          pattern="[A-Za-z0-9_]+"
          title="Letters, numbers, and underscores only"
          class="rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-lg outline-none focus:border-[#5c4429]"
        />
        <button
          type="submit"
          disabled={savingNickname}
          class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-white px-5 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint disabled:opacity-30"
        >
          Save
        </button>
        <span class="text-sm text-black/60">{nicknameStatus}</span>
      </form>
      <p class="mt-2 text-xs text-black/50">Letters, numbers, and underscores only. 3-20 characters.</p>
    </section>

    <section class="mb-6 rounded-none border-2 border-[#5c4429]/30 bg-[#e4ecdf] p-5">
      <h3 class="mb-1 text-lg font-bold">Balance</h3>
      <p class="text-2xl font-bold">{user.molesBalance} moles</p>
    </section>

    <section class="mb-6">
      <h3 class="mb-3 text-lg font-bold">Ledger</h3>
      {#if transactions.length === 0}
        <p class="text-black/60">Nothing here yet...</p>
      {:else}
        <div class="flex flex-col gap-2">
          {#each transactions as t (t.id)}
            <div class="flex flex-wrap items-center justify-between gap-2 rounded-none border-2 border-[#5c4429]/30 bg-[#e4ecdf] px-4 py-3">
              <div>
                <p class="text-sm font-bold">{t.reason}</p>
                <p class="text-xs text-black/50">{new Date(t.createdAt).toLocaleString()}</p>
              </div>
              <p class={`font-bold ${t.type === "spent" ? "text-app-orange" : "text-black"}`}>
                {t.type === "spent" ? "-" : "+"}{t.amount}
              </p>
            </div>
          {/each}
        </div>
      {/if}
      <div class="mt-3 flex gap-3">
        {#if page > 1}
          <button
            type="button"
            onclick={() => goToPage(page - 1)}
            disabled={loadingPage}
            class="cursor-pointer rounded-none border-2 border-[#5c4429]/30 bg-white px-4 py-2 text-sm font-bold hover:bg-[#5c4429]/10 disabled:opacity-30"
          >
            &larr; Newer
          </button>
        {/if}
        {#if transactions.length === 20}
          <button
            type="button"
            onclick={() => goToPage(page + 1)}
            disabled={loadingPage}
            class="cursor-pointer rounded-none border-2 border-[#5c4429]/30 bg-white px-4 py-2 text-sm font-bold hover:bg-[#5c4429]/10 disabled:opacity-30"
          >
            Older &rarr;
          </button>
        {/if}
      </div>
    </section>

    <a
      href="/onboarding"
      class="mb-4 block w-fit cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-5 py-2 text-sm font-bold uppercase tracking-wide hover:bg-[#5c4429]/10"
    >
      Onboarding
    </a>

    {#if user.isAdmin}
      <a
        href="/admin"
        class="mb-4 block w-fit cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-orange px-5 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-orange/70"
      >
        Admin panel
      </a>
    {/if}

    {#if signOutError}
      <p class="mb-2 text-sm text-app-orange">{signOutError}</p>
    {/if}
    <div class="flex flex-wrap gap-3">
      <button
        type="button"
        onclick={() => signOut(false)}
        disabled={signingOut}
        class="cursor-pointer rounded-none border-2 border-[#5c4429]/30 bg-white px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-black hover:text-white disabled:opacity-30"
      >
        {signingOut ? "Signing out..." : "Sign out"}
      </button>
      <button
        type="button"
        onclick={() => signOut(true)}
        disabled={signingOut}
        class="cursor-pointer rounded-none border-2 border-[#5c4429]/30 bg-white px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-black hover:text-white disabled:opacity-30"
      >
        Sign out everywhere
      </button>
    </div>
  {/snippet}
</PopupShell>
