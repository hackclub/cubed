<script>
  // Shown inline inside ProjectsPopup when a project is selected, keeping
  // its URL in sync (?project=<id>) without a real page navigation.
  // Display depends on status: draft → editable form; submitted →
  // read-only "waiting on a reviewer"; approved → read-only, credited
  // hours; rejected → read-only, terminal, feedback only. "Need changes" isn't
  // a project status: the project goes back to draft and the latest submission
  // reads "changes requested" (banner below).
  import { fade } from "svelte/transition";
  import { apiFetch } from "../../lib/api-client";
  import SubmissionModal from "../SubmissionModal.svelte";
  import FieldCounter from "../FieldCounter.svelte";
  import ConfirmDialog from "./ConfirmDialog.svelte";
  import HackatimeProjectPicker from "../HackatimeProjectPicker.svelte";

  let { project, onUpdated, onDeleted } = $props();

  let submissions = $state([]);
  let loadingSubmissions = $state(true);

  $effect(() => {
    const projectId = project.id;
    loadingSubmissions = true;
    apiFetch(`/projects/${projectId}/submissions`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        submissions = rows;
      })
      .catch(() => {
        submissions = [];
      })
      .finally(() => {
        loadingSubmissions = false;
      });
  });

  let latestSubmission = $derived(submissions[0] ?? null);
  // A draft whose latest attempt came back as "need changes" — the reviewer's
  // note is shown at the top, and the next submit is another attempt.
  let changesRequested = $derived(
    project.status === "draft" && latestSubmission?.status === "changes_requested",
  );
  let isEditable = $derived(project.status === "draft");

  let name = $state(project.name);
  let description = $state(project.description);
  let repoUrl = $state(project.repoUrl ?? "");
  let demoUrl = $state(project.demoUrl ?? "");
  // Defaults to whatever's already saved, not empty — the picker only
  // overwrites these if the user actually interacts with it this session,
  // so saving other fields (e.g. just a description tweak) can't
  // accidentally wipe out an already-chosen Hackatime selection.
  // undefined until the user touches the picker, so an unrelated save never re-sends (and re-verifies) it.
  let hackatimeProjects = $state(undefined);
  let saving = $state(false);
  let saveStatus = $state("");

  // Auto-clears "Saved." after a delay; "Saving..."/error states clear immediately instead.
  let saveStatusTimer;
  function setSaveStatus(text, autoClearMs = 0) {
    clearTimeout(saveStatusTimer);
    saveStatus = text;
    if (autoClearMs > 0) {
      saveStatusTimer = setTimeout(() => {
        saveStatus = "";
      }, autoClearMs);
    }
  }

  async function save(event) {
    event.preventDefault();
    saving = true;
    setSaveStatus("Saving...");
    try {
      const res = await apiFetch(`/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          repoUrl: repoUrl.trim() || undefined,
          demoUrl: demoUrl.trim() || undefined,
          // Names only — an empty list clears it. The server fixes the date
          // range and resolves the Hackatime user ID.
          hackatimeProjects,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        const messages = {
          hackatime_project_not_found: "One of those Hackatime projects wasn't found on your account.",
          invalid_hackatime_selection: "That Hackatime selection isn't valid. Re-select your projects.",
          hackatime_unavailable: "Couldn't verify with Hackatime right now. Try again in a moment.",
        };
        if (body.error === "reused_rejected") {
          throw new Error(
            body.kind === "repo"
              ? "That repo was used on a project of yours that was rejected, so it can't be reused."
              : "One of those Hackatime projects was used on a project of yours that was rejected, so it can't be reused.",
          );
        }
        throw new Error(messages[body.error] ?? "");
      }
      const updated = await res.json();
      setSaveStatus("Saved.", 2500);
      onUpdated(updated);
    } catch (err) {
      setSaveStatus(err instanceof Error && err.message ? err.message : "Couldn't save, try again.");
    } finally {
      saving = false;
    }
  }

  let deleting = $state(false);
  let confirmingDelete = $state(false);

  async function deleteDraft() {
    confirmingDelete = false;
    deleting = true;
    try {
      const res = await apiFetch(`/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "has_submissions"
            ? "This draft already went through a review round, so it can't be deleted. Fix it and submit it again."
            : "Couldn't delete, try again.",
        );
      }
      onDeleted(project.id);
    } catch (err) {
      alert(err instanceof Error && err.message ? err.message : "Couldn't delete, try again.");
      deleting = false;
    }
  }

  let photoStatus = $state("");
  let uploadingPhoto = $state(false);

  async function onPhotoChange(event) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    uploadingPhoto = true;
    photoStatus = "Uploading...";
    const formData = new FormData();
    formData.append("photo", file);
    try {
      const res = await apiFetch(`/projects/${project.id}/photo`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error === "too_many_uploads"
            ? "Too many uploads this hour. Try again later."
            : body.error === "photo_locked"
              ? "The photo can't be changed after you submit."
              : "",
        );
      }
      const updated = await res.json();
      photoStatus = "";
      onUpdated(updated);
    } catch (err) {
      photoStatus = err instanceof Error && err.message ? err.message : "Upload failed, try again.";
    } finally {
      uploadingPhoto = false;
    }
  }

  async function removePhoto() {
    uploadingPhoto = true;
    photoStatus = "Removing...";
    try {
      const res = await apiFetch(`/projects/${project.id}/photo`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      const updated = await res.json();
      photoStatus = "";
      onUpdated(updated);
    } catch {
      photoStatus = "Couldn't remove photo, try again.";
    } finally {
      uploadingPhoto = false;
    }
  }

  async function onSubmitted() {
    const res = await apiFetch(`/projects/${project.id}`);
    if (res.ok) onUpdated(await res.json());
  }

  const fieldClass =
    "rounded-none border-2 border-[#5c4429]/40 bg-white px-3 py-2 font-normal outline-none focus:border-[#5c4429]";
</script>

{#if confirmingDelete}
  <ConfirmDialog
    title="Delete this draft?"
    message="This can't be undone."
    confirmLabel="Delete"
    onConfirm={deleteDraft}
    onCancel={() => (confirmingDelete = false)}
  />
{/if}

<div class="flex flex-col gap-6">
  <div class="flex flex-wrap items-start justify-between gap-4">
    <h3 class="text-2xl font-bold">{project.name}</h3>
    <div class="flex flex-wrap items-center gap-3">
      <span class="flex items-center gap-1 text-sm text-black/50" title="Views">
        <svg viewBox="0 0 24 24" class="h-4 w-4 fill-none stroke-current" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" /><circle cx="12" cy="12" r="3" /></svg>
        {project.viewCount ?? 0}
      </span>
      <span class="flex items-center gap-1 text-sm font-bold text-black/50" title="Upvotes">
        <span>&#9650;</span>
        {project.upvoteCount ?? 0}
      </span>
      <span class="shrink-0 rounded-none border-2 border-[#5c4429]/40 bg-white px-2 py-1 text-xs font-bold uppercase tracking-wide">
        {project.status.replace("_", " ")}
      </span>
    </div>
  </div>

  <!-- Showcase photo -->
  <section class="rounded-none border-2 border-[#5c4429]/30 bg-white/60 p-4">
    <p class="mb-3 text-xs font-bold uppercase tracking-wide text-black/50">Showcase photo</p>
    <div class="flex flex-wrap items-start gap-4">
      {#if project.photoUrl}
        <img src={project.photoUrl} alt={`Screenshot of ${project.name}`} class="h-28 w-44 shrink-0 rounded-none border-2 border-[#5c4429]/40 object-cover" />
      {/if}
      <div class="flex flex-col gap-2">
        <div class="flex flex-wrap gap-2">
          {#if isEditable}
          <label class="w-fit cursor-pointer rounded-none border-2 border-[#5c4429] bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-app-mint">
            {project.photoUrl ? "Replace photo" : "Upload photo"}
            <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" onchange={onPhotoChange} disabled={uploadingPhoto} class="hidden" />
          </label>
          {/if}
          {#if project.photoUrl && isEditable}
            <button type="button" onclick={removePhoto} disabled={uploadingPhoto} class="w-fit cursor-pointer rounded-none border-2 border-[#5c4429] bg-white px-3 py-1.5 text-xs font-bold uppercase tracking-wide hover:bg-app-orange hover:text-white disabled:opacity-30">
              Remove
            </button>
          {/if}
        </div>
        <span class="text-xs text-black/50">
          {isEditable ? "PNG, JPEG, GIF, or WebP. 10MB max." : "The photo is locked once a project is submitted."}
        </span>
        {#if photoStatus}<span class="text-sm text-black/60">{photoStatus}</span>{/if}
      </div>
    </div>
  </section>

  {#if project.status === "approved"}
    <div class="rounded-none border-2 border-[#5c4429] bg-app-mint p-5">
      <p class="font-bold">🎉 Approved!</p>
      {#if latestSubmission?.approvedHours}
        <p class="text-sm">{latestSubmission.approvedHours} hours credited ({Math.floor(latestSubmission.approvedHours * 5)} moles).</p>
      {/if}
    </div>
  {/if}

  {#if project.status === "submitted"}
    <div class="rounded-none border-2 border-[#5c4429] bg-app-lavender/40 p-5">
      <p class="font-bold">Under review</p>
      <p class="text-sm text-black/70">A reviewer hasn't made a decision yet. Check back later.</p>
    </div>
  {/if}

  {#if changesRequested}
    <div class="rounded-none border-2 border-[#5c4429] bg-app-orange/30 p-5">
      <p class="mb-1 font-bold">Changes requested</p>
      <p class="whitespace-pre-wrap text-sm text-black/80">
        {latestSubmission.feedback || "Your reviewer asked for changes. Update your project and submit it again."}
      </p>
      <p class="mt-2 text-xs text-black/50">
        Attempt {submissions.length + 1} of 3 once you submit again.
      </p>
    </div>
  {/if}

  {#if project.status === "rejected" && latestSubmission?.feedback}
    <div class="rounded-none border-2 border-[#5c4429] bg-app-yellow/40 p-5">
      <p class="mb-1 font-bold">Rejected</p>
      <p class="text-sm text-black/80">{latestSubmission.feedback}</p>
    </div>
  {/if}

  {#if isEditable}
    <form onsubmit={save} class="flex flex-col gap-4">
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
        <input type="url" bind:value={repoUrl} class={fieldClass} />
      </label>
      <label class="flex flex-col gap-1 text-sm font-bold">
        Demo URL <span class="font-normal text-black/50">(optional)</span>
        <input type="url" bind:value={demoUrl} class={fieldClass} />
      </label>
      <div class="flex flex-col gap-1 text-sm font-bold">
        Hackatime Project(s)
        <HackatimeProjectPicker
          initialFormatted={project.hackatimeProjectsAndDates ?? ""}
          onSelectionChange={({ names }) => {
            hackatimeProjects = names;
          }}
        />
      </div>
      <div class="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={saving} class="w-fit cursor-pointer rounded-none border-2 border-[#5c4429] bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-mint disabled:opacity-30">
          Save
        </button>
        {#if saveStatus}
          <span class="text-sm text-black/60" transition:fade={{ duration: 400 }}>{saveStatus}</span>
        {/if}
      </div>
    </form>

    <div class="flex flex-wrap items-center gap-3">
      <SubmissionModal projectId={project.id} {project} onSuccess={onSubmitted} />
      <button type="button" onclick={() => (confirmingDelete = true)} disabled={deleting} class="w-fit cursor-pointer rounded-none border-2 border-[#5c4429]/40 bg-white px-4 py-2 text-sm font-bold uppercase tracking-wide hover:bg-app-orange hover:text-white disabled:opacity-30">
        {deleting ? "Deleting..." : "Delete draft"}
      </button>
    </div>
  {:else}
    <div class="flex flex-col gap-4">
      <div>
        <p class="text-xs font-bold uppercase tracking-wide text-black/50">Description</p>
        <p class="whitespace-pre-wrap">{project.description}</p>
      </div>
      {#if project.repoUrl}
        <div>
          <p class="text-xs font-bold uppercase tracking-wide text-black/50">Repo URL</p>
          <a href={project.repoUrl} target="_blank" rel="noreferrer" class="text-app-lavender underline">{project.repoUrl}</a>
        </div>
      {/if}
      {#if project.demoUrl}
        <div>
          <p class="text-xs font-bold uppercase tracking-wide text-black/50">Demo URL</p>
          <a href={project.demoUrl} target="_blank" rel="noreferrer" class="text-app-lavender underline">{project.demoUrl}</a>
        </div>
      {/if}
    </div>
  {/if}

  {#if !loadingSubmissions && submissions.length > 0}
    <!-- In practice a project is only ever submitted once (no resubmit
         path), so this is normally a single entry — still its own section
         since `submissions` is an append-only history table, not a slot
         on the project itself. -->
    <section class="border-t-2 border-[#5c4429]/20 pt-4">
      <h4 class="mb-3 text-sm font-bold uppercase tracking-wide text-black/50">Review history</h4>
      <div class="flex flex-col gap-2">
        {#each submissions as s (s.id)}
          <div class="rounded-none border-2 border-[#5c4429]/20 px-3 py-2 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-bold uppercase tracking-wide">{s.status.replace("_", " ")}</span>
              <span class="text-xs text-black/50">{new Date(s.submittedAt).toLocaleDateString()}</span>
            </div>
            {#if s.status === "accepted" && s.approvedHours}
              <p class="mt-1 text-black/70">{s.approvedHours} hours credited ({Math.floor(s.approvedHours * 5)} moles).</p>
            {/if}
            {#if s.feedback}
              <p class="mt-1 text-black/70">{s.feedback}</p>
            {/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
