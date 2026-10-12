<script>
  // Not built on PopupShell — this flow has no close button (mandatory,
  // one-time), which doesn't fit that component's assumptions.
  //
  // Step lives in the URL as `?step=<key>` (STEP_KEYS below), so browser
  // Back/Forward moves through it too. Field state (nickname etc.) is
  // separate $state, untouched by step changes, so it survives a
  // back-then-forward round trip. "how_to_participate_5" is deliberately
  // the LAST step, not right after welcome, so it reads as a send-off into
  // the dashboard rather than being buried before the data-entry steps.
  import { fade } from "svelte/transition";
  import { navigate } from "astro:transitions/client";
  import { apiFetch } from "../lib/api-client";

  const STEP_KEYS = ["welcome_1", "heard_about_2", "nickname_3", "join_slack_4", "how_to_participate_5"];
  const TOTAL_STEPS = STEP_KEYS.length;

  const HEARD_OPTIONS = [
    { value: "friends_family", label: "Friends/Family" },
    { value: "instagram_youtube", label: "Instagram/YouTube" },
    { value: "hackclub_site", label: "Hack Club site" },
    { value: "slack", label: "Slack" },
    { value: "email", label: "Email" },
    { value: "school", label: "School" },
    { value: "other", label: "Other" },
  ];

  const SLACK_URL = "https://hackclub.enterprise.slack.com/archives/C0BL0LJMUR5";

  // Matches the backend's regex + length bounds (routes/me.ts) so
  // "Continue" blocks client-side instead of only failing in finish()'s API call.
  const NICKNAME_REGEX = /^[A-Za-z0-9_]+$/;
  const NICKNAME_MIN = 3;
  const NICKNAME_MAX = 20;

  function stepFromKey(key) {
    const idx = STEP_KEYS.indexOf(key ?? "");
    return idx === -1 ? 1 : idx + 1;
  }

  const initialParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;

  let step = $state(stepFromKey(initialParams?.get("step")));
  let nickname = $state("");
  let heardAboutSource = $state("");
  let heardAboutDetail = $state("");
  let submitting = $state(false);
  let error = $state("");

  function syncUrl(targetStep, { replace = false } = {}) {
    if (typeof window === "undefined") return;
    const url = `${window.location.pathname}?step=${STEP_KEYS[targetStep - 1]}`;
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }

  // Normalizes a bare `/onboarding` (no `?step=` yet) without adding a history entry.
  if (typeof window !== "undefined") {
    syncUrl(step, { replace: true });
  }

  // Browser Back/Forward moves `step` too, not just the wizard's own nav.
  $effect(() => {
    function onPopState() {
      step = stepFromKey(new URLSearchParams(window.location.search).get("step"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  });

  function canAdvance() {
    if (step === 2) return heardAboutSource.length > 0;
    if (step === 3) {
      const trimmed = nickname.trim();
      return trimmed.length >= NICKNAME_MIN && trimmed.length <= NICKNAME_MAX && NICKNAME_REGEX.test(trimmed);
    }
    return true;
  }

  function next() {
    if (!canAdvance() || step >= TOTAL_STEPS) return;
    step += 1;
    syncUrl(step);
  }

  function back() {
    if (step <= 1) return;
    step -= 1;
    syncUrl(step);
  }

  async function finish() {
    if (!canAdvance() || submitting) return;
    submitting = true;
    error = "";

    try {
      const res = await apiFetch("/me/onboarding", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nickname: nickname.trim(),
          heardAboutSource,
          heardAboutDetail: heardAboutDetail.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "nickname_taken") {
          error = "That nickname is already taken. Try another one.";
          submitting = false;
          return;
        }
        throw new Error("request failed");
      }
      // navigate() (Astro's client router), not a raw location change —
      // the latter bypasses the transition system even with <ClientRouter />.
      await navigate("/dashboard");
    } catch {
      error = "Something went wrong, try again.";
      submitting = false;
    }
  }

  const navButtonBase =
    "grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full border-2 text-2xl font-bold leading-none transition-all disabled:cursor-not-allowed";
</script>

<div class="flex min-h-screen items-center justify-center p-4" transition:fade={{ duration: 180 }}>
  <div
    class="flex min-h-[32rem] w-full max-w-3xl flex-col rounded-none border-[8px] border-[#5c4429] bg-[#cfe0d5] p-8 shadow-xl sm:p-12"
    transition:fade={{ duration: 180 }}
  >
    <div class="flex flex-1 flex-col justify-center">
      {#if step === 1}
        <h2 class="mb-8 text-4xl font-bold text-[#2e4a3d] sm:text-5xl">Welcome to Cubed!</h2>
        <p class="text-xl leading-relaxed text-black/80 sm:text-2xl">
          Cubed is a Hack Club You Ship We Ship program where you build science related projects and we ship you science related prizes.
          Hack Club is the world's largest nonprofit movement of teenagers making cool projects. All of our events are completely free and open to any teen, over the world
        </p>
      {:else if step === 2}
        <h2 class="mb-8 text-4xl font-bold text-[#2e4a3d] sm:text-5xl">How'd you hear about us?</h2>
        <div class="mb-5 flex flex-wrap gap-3">
          {#each HEARD_OPTIONS as option (option.value)}
            <button
              type="button"
              onclick={() => (heardAboutSource = option.value)}
              class={[
                "cursor-pointer rounded-full border-2 px-5 py-3 text-base font-bold uppercase tracking-wide transition-all",
                heardAboutSource === option.value
                  ? "border-[#5c4429] bg-app-gold/40"
                  : "border-[#5c4429]/30 bg-white hover:bg-[#5c4429]/10",
              ]}
            >
              {option.label}
            </button>
          {/each}
        </div>
        <textarea
          bind:value={heardAboutDetail}
          maxlength="1000"
          rows="3"
          placeholder="Tell us more (optional)"
          class="w-full rounded-none border-2 border-[#5c4429]/30 bg-white px-4 py-3 text-base outline-none focus:border-[#5c4429]"
        ></textarea>
      {:else if step === 3}
        <h2 class="mb-8 text-4xl font-bold text-[#2e4a3d] sm:text-5xl">What should we call you?</h2>
        <p class="mb-6 text-lg text-black/70">
          Create a nickname! This is a public nickname that people can see in the project gallery.
          You can change your nickname anytime inside of your profile settings.
        </p>
        <input
          type="text"
          bind:value={nickname}
          minlength={NICKNAME_MIN}
          maxlength={NICKNAME_MAX}
          required
          pattern="[A-Za-z0-9_]+"
          title="Letters, numbers, and underscores only"
          placeholder="Your nickname"
          class="w-full rounded-none border-2 border-[#5c4429]/30 bg-white px-4 py-3 text-xl outline-none focus:border-[#5c4429]"
        />
        <span class="mt-1 text-xs text-black/50">Letters, numbers, and underscores only. 3-20 characters.</span>
      {:else if step === 4}
        <h2 class="mb-8 text-4xl font-bold text-[#2e4a3d] sm:text-5xl">Join the Slack</h2>
        <p class="mb-6 text-xl leading-relaxed text-black/80 sm:text-2xl">
          Join the #cubed channel in the Hack Club Slack to chat, get support, and share ideas with other cubers. 
        </p>
        <a
          href={SLACK_URL}
          target="_blank"
          rel="noreferrer"
          class="inline-block w-fit cursor-pointer rounded-full border-2 border-[#5c4429] bg-app-lavender px-6 py-3 text-base font-bold uppercase tracking-wide transition-all hover:bg-app-lavender/70"
        >
          Join the Slack &rarr;
        </a>
      {:else}
        <h2 class="mb-8 text-4xl font-bold text-[#2e4a3d] sm:text-5xl">How to participate</h2>
        <p class="text-xl leading-relaxed text-black/80 sm:text-2xl">
        You're all set now! <br> Jump into the dashboard to create your first project. From there, make sure to use hackatime to track your progress, open source your project and most importantly have fun.
        If you have any questions check out the docs or ask us #cubed on slack.
        </p>
      {/if}
    </div>

    {#if error}
      <p class="mt-4 text-sm text-app-orange">{error}</p>
    {/if}

    <div class="mt-8 flex items-center justify-center gap-4">
      <button
        type="button"
        onclick={back}
        disabled={step <= 1}
        aria-label="Back"
        class={`${navButtonBase} border-[#5c4429]/40 bg-white hover:bg-[#5c4429]/10 disabled:opacity-0`}
      >
        &larr;
      </button>
      {#if step < TOTAL_STEPS}
        <button
          type="button"
          onclick={next}
          disabled={!canAdvance()}
          aria-label="Continue"
          class={`${navButtonBase} border-[#5c4429] bg-app-mint hover:bg-app-mint/70 disabled:opacity-30`}
        >
          &rarr;
        </button>
      {:else}
        <button
          type="button"
          onclick={finish}
          disabled={!canAdvance() || submitting}
          aria-label="Finish"
          class={`${navButtonBase} border-[#5c4429] bg-app-mint hover:bg-app-mint/70 disabled:opacity-30`}
        >
          {#if submitting}
            <span class="text-sm">...</span>
          {:else}
            &rarr;
          {/if}
        </button>
      {/if}
    </div>
  </div>
</div>
