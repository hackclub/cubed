<script>
  // Dropped inside ProjectsPopup.svelte as <NewProjectModal onCreated={...} />.
  // On success, hands the project back to `onCreated` rather than
  // navigating — ProjectDetail.svelte then shows it inline.
  import { apiFetch } from "../lib/api-client";
  import PopupShell from "./room/PopupShell.svelte";
  import FieldCounter from "./FieldCounter.svelte";

  let { onCreated } = $props();

  let open = $state(false);
  let name = $state("");
  let description = $state("");
  let repoUrl = $state("");
  let demoUrl = $state("");
  let submitting = $state(false);
  let error = $state("");

  function openModal() {
    open = true;
    error = "";
  }

  function closeModal() {
    if (submitting) return; // don't let them close mid request
    open = false;
  }

  async function createProject(event) {
    event.preventDefault();
    submitting = true;
    error = "";

    try {
      const res = await apiFetch("/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          // Omitted rather than sent as "" — the backend's `.url()` would reject an empty string.
          repoUrl: repoUrl.trim() || undefined,
          demoUrl: demoUrl.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "draft_limit"
            ? "You can have up to 6 drafts at once. Submit or delete one of your drafts first."
            : body.error === "reused_rejected"
              ? "That repo was used on a project of yours that was rejected, so it can't be reused."
              : (body.error ?? "Couldn't create the project."),
        );
      }

      const project = await res.json();
      open = false;
      submitting = false;
      name = "";
      description = "";
      repoUrl = "";
      demoUrl = "";
      onCreated(project);
    } catch (err) {
      error = err instanceof Error ? err.message : "Something went wrong.";
      submitting = false;
    }
  }

  const fieldClass =
    "rounded-none border-2 border-[#5c4429]/40 bg-white px-3 py-2 font-normal outline-none focus:border-[#5c4429]";
</script>

<button
  type="button"
  onclick={openModal}
  class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-5 py-3 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70"
>
  + New project
</button>

{#if open}
  <PopupShell title="New project" maxWidth="max-w-md" onClose={closeModal}>
    {#snippet children()}
      <form onsubmit={createProject} class="flex flex-col gap-4">
        <label class="flex flex-col gap-1 text-sm font-bold">
          Name
          <input type="text" bind:value={name} required minlength="5" maxlength="70" class={fieldClass} />
          <FieldCounter value={name} min={5} max={70} />
        </label>

        <label class="flex flex-col gap-1 text-sm font-bold">
          Description
          <textarea bind:value={description} required minlength="100" maxlength="550" rows="4" class={fieldClass}></textarea>
          <FieldCounter value={description} min={100} max={550} />
        </label>

        <label class="flex flex-col gap-1 text-sm font-bold">
          Repo URL <span class="font-normal text-black/50">(optional)</span>
          <input type="url" bind:value={repoUrl} placeholder="https://github.com/you/project" class={fieldClass} />
        </label>

        <label class="flex flex-col gap-1 text-sm font-bold">
          Demo URL <span class="font-normal text-black/50">(optional)</span>
          <input type="url" bind:value={demoUrl} placeholder="https://your-project.hackclub.app" class={fieldClass} />
        </label>

        {#if error}
          <p class="text-sm text-app-orange">{error}</p>
        {/if}

        <div class="mt-2 flex justify-end gap-3">
          <button
            type="button"
            onclick={closeModal}
            class="cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-black hover:text-white"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            class="cursor-pointer rounded-none border-2 border-[#5c4429] bg-app-mint px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint/70 disabled:opacity-30"
          >
            {submitting ? "Creating..." : "Create"}
          </button>
        </div>
      </form>
    {/snippet}
  </PopupShell>
{/if}
