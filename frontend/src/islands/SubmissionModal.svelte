<script>
  // Everything typed here (real name, address, birthday) is forwarded to
  // Airtable by the backend and never stored in Postgres — this component
  // just collects it. Two-stage flow: "checklist" (a nudge, not validated)
  // → "form", reset to "checklist" every time the modal reopens. Sent as
  // multipart/form-data (not JSON) because of the screenshot upload.
  //
  // `project` prop is only read for repoUrl/demoUrl/hackatime fields
  // (missingFields() below) — description/repoUrl/demoUrl are sent from
  // the project's current row, not retyped here, so a rushed edit here
  // can't diverge from what the project shows elsewhere. Email is likewise
  // not collected — the backend sends the session's own email. Hackatime
  // project/dates are chosen earlier, in the draft editor
  // (ProjectDetail.svelte's HackatimeProjectPicker), not here — this form
  // only checks that it's already been done.
  import { fade } from "svelte/transition";
  import { apiFetch } from "../lib/api-client";
  import PopupShell from "./room/PopupShell.svelte";
  import { getContext } from "svelte";
  import { ID_VERIFIED_CONTEXT, NOT_VERIFIED_MESSAGE } from "../lib/verification";

  let { projectId, project, onSuccess } = $props();

  // Button stays enabled either way; clicking with something missing
  // surfaces exactly what via `error`. The backend enforces the same rule
  // independently (handleSubmission() in routes/projects.ts) — this is
  // just a head start on that error.
  function missingFields() {
    const missing = [];
    if (!project.repoUrl) missing.push("a Code URL");
    if (!project.demoUrl) missing.push("a Playable URL");
    if (!project.hackatimeProjectsAndDates || !project.hackatimeUserId) missing.push("your Hackatime project(s)");
    return missing;
  }

  // "a, b, and c" — the old two-item-only `join(" and ")` reads badly once
  // there can be three missing things.
  function joinWithAnd(items) {
    if (items.length <= 1) return items[0] ?? "";
    if (items.length === 2) return `${items[0]} and ${items[1]}`;
    return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
  }

  const CHECKLIST = [
    {
      title: "Your project is original & finished",
      desc: "Your project should be Original, custom design by you. Not by AI, not a direct copy of a tutorial, or someone else. And all the features in your project should be working.",
    },
    {
      title: "Open source code on GitHub",
      desc: "Your GitHub repository should contain all of your project files. Make sure your repository is well organized and name your files clearly",
    },
    {
      title: "You have a good README",
      desc: "Your README is people's first impression. Make it awesome! Someone landing on your repository for the first time should understand what your project is, what it does, why it exists.",
    },
    {
      title: "You used Hackatime to track your project",
      desc: "We use Hackatime to track how long you spend on your project. Make sure all your hours are tracked in hackatime",
    },
    {
      title: "Your demo should be deployed",
      desc: "Provide a live demo URL. If your project isn't deployable, link a downloadable build, compiled binary, GitHub release, or clear setup instructions",
    },
  ];

  let open = $state(false);
  /** @type {'checklist' | 'form'} */
  let stage = $state("checklist");
  let checked = $state(CHECKLIST.map(() => false));
  let allChecked = $derived(checked.every(Boolean));

  let firstName = $state("");
  let lastName = $state("");
  let addressLine1 = $state("");
  let addressLine2 = $state("");
  let city = $state("");
  let stateProvince = $state("");
  let country = $state("");
  let zip = $state("");
  let birthday = $state("");
  // Blocks an accidental future date.
  const birthdayMax = new Date().toISOString().slice(0, 10);
  let githubUsername = $state("");
  let howHeard = $state("");
  let doingWell = $state("");
  let improve = $state("");
  let usedAi = $state(false);
  let aiDetails = $state("");
  // Mandatory yes/no, deliberately no default so it can't be skipped; when yes,
  // the link and both explanations are required.
  let tutorialAnswer = $state(/** @type {"yes" | "no" | null} */ (null));
  let usedTutorial = $derived(tutorialAnswer === "yes");
  let tutorialLink = $state("");
  let tutorialHowClose = $state("");
  let tutorialUnique = $state("");
  let reviewerNotes = $state("");

  let screenshotFile = $state(null);

  let submitting = $state(false);
  let error = $state("");

  // Auto-clears the "you need X to submit" nudge after 10s (same
  // pattern as ProjectDetail.svelte's save-status timer) — the other
  // `error` assignments below (screenshot missing, submit failed) aren't
  // routed through this, they stay until the user acts on them.
  let errorTimer;
  function setTemporaryError(text, autoClearMs = 10000) {
    clearTimeout(errorTimer);
    error = text;
    errorTimer = setTimeout(() => {
      error = "";
    }, autoClearMs);
  }

  const idVerified = getContext(ID_VERIFIED_CONTEXT) !== false;

  function openModal() {
    if (!idVerified) {
      setTemporaryError(NOT_VERIFIED_MESSAGE, 15000);
      return;
    }
    const missing = missingFields();
    if (missing.length > 0) {
      setTemporaryError(
        `You need ${joinWithAnd(missing)} to submit. Add ${missing.length > 1 ? "them" : "it"} to your project above.`,
      );
      return;
    }
    clearTimeout(errorTimer);
    open = true;
    stage = "checklist";
    checked = CHECKLIST.map(() => false);
    error = "";
  }

  function closeModal() {
    if (submitting) return;
    open = false;
  }

  function continueToForm() {
    if (!allChecked) return;
    stage = "form";
  }

  function onScreenshotChange(event) {
    const file = event.currentTarget.files?.[0] ?? null;
    // The YSWS guidelines don't allow GIFs/animated screenshots (the server also
    // checks the file's real contents, so a renamed GIF or animated WebP is caught too).
    if (file && file.type === "image/gif") {
      event.currentTarget.value = "";
      screenshotFile = null;
      error = "Your screenshot can't be a GIF or any animated image. Use a still PNG, JPEG or WebP.";
      return;
    }
    error = "";
    screenshotFile = file;
  }

  // Matches the backend's firstName/lastName regex (Unicode letters, marks,
  // spaces, hyphens, apostrophes, periods) — strips anything else as-you-type
  // but keeps accents like José and O'Brien intact.
  function onlyLettersAndSpaces(event) {
    return event.currentTarget.value.replace(/[^\p{L}\p{M} .'’-]/gu, "");
  }

  async function submitForm(event) {
    event.preventDefault();

    if (!screenshotFile) {
      error = "Please attach a screenshot of your project.";
      return;
    }

    submitting = true;
    error = "";

    const formData = new FormData();
    formData.append("firstName", firstName.trim());
    formData.append("lastName", lastName.trim());
    formData.append("addressLine1", addressLine1.trim());
    formData.append("addressLine2", addressLine2.trim());
    formData.append("city", city.trim());
    formData.append("stateProvince", stateProvince.trim());
    formData.append("country", country.trim());
    formData.append("zip", zip.trim());
    formData.append("birthday", birthday);
    formData.append("githubUsername", githubUsername.trim());
    formData.append("howHeard", howHeard.trim());
    formData.append("doingWell", doingWell.trim());
    formData.append("improve", improve.trim());
    formData.append("usedAi", usedAi ? "true" : "false");
    formData.append("aiDetails", aiDetails.trim());
    formData.append("usedTutorial", usedTutorial ? "true" : "false");
    formData.append("tutorialLink", tutorialLink.trim());
    formData.append("tutorialHowClose", tutorialHowClose.trim());
    formData.append("tutorialUnique", tutorialUnique.trim());
    formData.append("reviewerNotes", reviewerNotes.trim());
    formData.append("screenshot", screenshotFile);

    try {
      // No Content-Type header — the browser sets it (with the required
      // boundary string) when a FormData body is passed; setting it manually breaks that.
      const res = await apiFetch(`/projects/${projectId}/submit`, {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        if (body.error === "not_eligible") {
          // Full navigation, not a client-side route change — /blocked
          // reads the session server-side, which this same request just updated.
          window.location.href = "/blocked";
          return;
        }
        if (body.error === "not_verified") {
          throw new Error(NOT_VERIFIED_MESSAGE);
        }
        if (body.error === "eligibility_unverifiable") {
          throw new Error("We couldn't verify your eligibility right now. Please try again in a moment.");
        }
        throw new Error(
          body.error === "missing_urls"
            ? "Add a Code URL and Playable URL to your project before submitting."
            : body.error === "missing_hackatime"
              ? "Select your Hackatime project(s) on your project before submitting."
              : body.error === "hackatime_project_not_found"
                ? "One of your selected Hackatime projects wasn't found on your account. Re-select your Hackatime projects."
                : body.error === "hackatime_unavailable"
                  ? "Couldn't reach Hackatime right now. Please try again in a moment."
                  : body.error === "reused_rejected"
                    ? "A project of yours was already rejected on this Hackatime project or repo, so it can't be submitted again under a new project."
                    : body.error === "hours_in_use"
                      ? `Your Hackatime project "${body.hackatimeProject}" is already used on your project "${body.projectName}", which is pending review or approved. The same hours can't be submitted twice, so pick different Hackatime projects.`
                      : body.error === "attempt_limit"
                      ? "This project has used all of its submission attempts."
                      : (body.error ?? "Submission failed."),
        );
      }

      open = false;
      if (onSuccess) {
        await onSuccess();
        submitting = false;
      } else {
        window.location.reload();
      }
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
      submitting = false;
    }
  }

  const fieldClass =
    "rounded-none border-2 border-[#5c4429]/40 bg-white px-3 py-2 font-normal outline-none focus:border-[#5c4429]";

  // Grows a textarea to fit typed content, up to the `max-h-40` cap on the
  // two textareas using it — overflow-y-auto takes over past that.
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

<div>
  <button
    type="button"
    onclick={openModal}
    class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70"
  >
    Submit for review
  </button>
  {#if !open && error}
    <p class="mt-2 text-xs text-app-orange" transition:fade={{ duration: 400 }}>{error}</p>
  {/if}
</div>

{#if open}
  <PopupShell
    title={stage === "checklist" ? "Before you submit" : "Submit your project"}
    subtitle={stage === "form"
      ? "Please double check your answers to make sure each one is accurate"
      : "Make sure all of this is true before you send it off. A reviewer will be checking every one of these."}
    maxWidth="max-w-xl"
    onClose={closeModal}
  >
    {#snippet children()}
      {#if stage === "checklist"}
        <div class="flex flex-col gap-3">
          {#each CHECKLIST as item, i (item.title)}
            <label class="flex cursor-pointer items-start gap-3 rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4 transition-all hover:border-[#5c4429]">
              <input type="checkbox" bind:checked={checked[i]} class="mt-1 h-5 w-5 shrink-0 accent-[#5c4429]" />
              <span>
                <span class="block font-bold">{i + 1}. {item.title}</span>
                {#if item.desc}
                  <span class="mt-1 block text-sm text-black/60">{item.desc}</span>
                {/if}
              </span>
            </label>
          {/each}
          <button
            type="button"
            onclick={continueToForm}
            disabled={!allChecked}
            class="mt-2 w-full cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-4 py-3 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70 disabled:cursor-not-allowed disabled:opacity-30"
          >
            Continue
          </button>
        </div>
      {:else}
        <form onsubmit={submitForm} class="flex flex-col gap-4">
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
            Please use your legal first and last name.
          </p>

          <hr class="my-2 border-t-2 border-[#5c4429]/20" />

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

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label class="flex flex-col gap-1 text-sm font-bold">
              Birthday
              <input
                type="date"
                bind:value={birthday}
                required
                min="1970-01-01"
                max={birthdayMax}
                class={fieldClass}
              />
            </label>
            <label class="flex flex-col gap-1 text-sm font-bold">
              GitHub username
              <input type="text" bind:value={githubUsername} required class={fieldClass} />
            </label>
          </div>

          <label class="flex flex-col gap-1 text-sm font-bold">
            Screenshot
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onchange={onScreenshotChange}
              required
              class={`${fieldClass} file:mr-3 file:border-2 file:border-[#5c4429] file:bg-app-lavender file:px-2 file:py-1 file:font-bold`}
            />
            <span class="text-xs font-normal text-black/50">A still PNG, JPEG or WebP (no GIFs or animated images). 5MB max.</span>
          </label>

          <label class="flex cursor-pointer items-start gap-3 rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4">
            <input type="checkbox" bind:checked={usedAi} class="mt-1 h-5 w-5 shrink-0 accent-[#5c4429]" />
            <span class="text-sm font-bold">Did you use AI anywhere in this project?</span>
          </label>
          {#if usedAi}
            <label class="flex flex-col gap-1 text-sm font-bold">
              Where and how much AI did you use? Please be detailed
              <textarea
                bind:value={aiDetails}
                required
                maxlength="2000"
                rows="3"
                use:autoResize
                class={`${fieldClass} max-h-40 resize-none overflow-y-auto`}
              ></textarea>
            </label>
          {/if}

          <fieldset class="flex flex-col gap-2 rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4">
            <legend class="px-1 text-sm font-bold">Did you follow a tutorial for this project?</legend>
            <div class="flex gap-6 text-sm font-bold">
              <label class="flex cursor-pointer items-center gap-2">
                <input type="radio" name="tutorialAnswer" value="yes" bind:group={tutorialAnswer} required class="h-4 w-4 accent-[#5c4429]" />
                Yes
              </label>
              <label class="flex cursor-pointer items-center gap-2">
                <input type="radio" name="tutorialAnswer" value="no" bind:group={tutorialAnswer} required class="h-4 w-4 accent-[#5c4429]" />
                No
              </label>
            </div>
          </fieldset>
          {#if usedTutorial}
            <label class="flex flex-col gap-1 text-sm font-bold">
              Which tutorial did you follow? (link)
              <input type="url" bind:value={tutorialLink} required placeholder="https://..." class={fieldClass} />
            </label>
            <label class="flex flex-col gap-1 text-sm font-bold">
              How closely did you follow it?
              <textarea
                bind:value={tutorialHowClose}
                required
                maxlength="2000"
                rows="2"
                use:autoResize
                class={`${fieldClass} max-h-40 resize-none overflow-y-auto`}
              ></textarea>
            </label>
            <label class="flex flex-col gap-1 text-sm font-bold">
              What did you add or do yourself that wasn't in the tutorial?
              <textarea
                bind:value={tutorialUnique}
                required
                maxlength="2000"
                rows="3"
                use:autoResize
                class={`${fieldClass} max-h-40 resize-none overflow-y-auto`}
              ></textarea>
            </label>
          {/if}

          <label class="flex flex-col gap-1 text-sm font-bold">
            Notes for the reviewer <span class="font-normal text-black/50">(optional)</span>
            <textarea
              bind:value={reviewerNotes}
              maxlength="2000"
              rows="2"
              use:autoResize
              class={`${fieldClass} max-h-40 resize-none overflow-y-auto`}
            ></textarea>
            <span class="text-xs font-normal text-black/50">
              Is there anything important the reviewer should know about your project?
            </span>
          </label>

          <hr class="my-2 border-t-2 border-[#5c4429]/20" />

          <label class="flex flex-col gap-1 text-sm font-bold">
            How'd you hear about Cubed? <span class="font-normal text-black/50">(optional)</span>
            <input type="text" bind:value={howHeard} class={fieldClass} />
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            What are we doing well? <span class="font-normal text-black/50">(optional)</span>
            <textarea bind:value={doingWell} rows="2" class={fieldClass}></textarea>
          </label>
          <label class="flex flex-col gap-1 text-sm font-bold">
            How can we improve? <span class="font-normal text-black/50">(optional)</span>
            <textarea bind:value={improve} rows="2" class={fieldClass}></textarea>
          </label>

          {#if error}
            <p class="text-sm text-app-orange">{error}</p>
          {/if}

          <div class="mt-2 flex flex-wrap justify-end gap-3">
            <button
              type="button"
              onclick={() => (stage = "checklist")}
              class="cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-black/5"
            >
              Back
            </button>
            <button
              type="submit"
              disabled={submitting}
              class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70 disabled:opacity-30"
            >
              {submitting ? "Sending..." : "Send it"}
            </button>
          </div>
        </form>
      {/if}
    {/snippet}
  </PopupShell>
{/if}
