"use client";

import { useEffect, useId, useMemo, useRef, useState, useTransition } from "react";
import type { RegistrationFieldType } from "@prisma/client";
import { useRouter } from "next/navigation";
import { Eye, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Chip, EmptyState } from "@/components/ui/display";
import { cn } from "@/lib/cn";
import { useToast } from "@/components/feedback/ToastProvider";
import { ConfirmationDialog } from "@/components/feedback/ConfirmationDialog";
import { useUnsavedChangesGuard } from "@/components/forms/useUnsavedChangesGuard";
import { deleteEventRegistrationField, reorderEventRegistrationFields, upsertEventRegistrationField } from "@/app/actions/registration-form";
import { fieldTypeMeta, type FieldSettings, type QuestionTemplate } from "@/lib/registrationFields";
import { AddQuestionPanel } from "./AddQuestionPanel";
import { FieldTypeIcon } from "./FieldTypeIcon";
import { FormPreview, type PreviewField } from "./FormPreview";
import { QuestionCard } from "./QuestionCard";
import { QuestionEditor } from "./QuestionEditor";
import {
  draftFromField,
  draftsEqual,
  duplicateLabel,
  findLogicProblems,
  hasLabel,
  newDraft,
  orderWithFieldBelow,
  predictKey,
  previewFromDraft,
  summarizeField,
  validateDraft,
  type DraftErrors,
  type QuestionDraft,
  type SaveableQuestion,
} from "./builderModel";
import { HelpLink } from "@/components/help/HelpLink";

export type RegistrationFieldRow = {
  id: string;
  /** Internal answer key; never shown to organisers. */
  key: string;
  label: string;
  type: RegistrationFieldType;
  required: boolean;
  sortOrder: number;
  options: string[];
  helpText: string;
  placeholder: string;
  settings: FieldSettings;
};

const NEW_ID = "__new__";

type Editing = {
  id: string;
  draft: QuestionDraft;
  original: QuestionDraft;
  errors: DraftErrors;
};

type FocusRequest = { target: "label" } | { target: "edit"; id: string } | { target: "add" };

const sorted = (rows: RegistrationFieldRow[]) => [...rows].sort((a, b) => a.sortOrder - b.sortOrder);
const renumber = (rows: RegistrationFieldRow[]) => rows.map((row, index) => ({ ...row, sortOrder: index + 1 }));
const toSaveable = (field: RegistrationFieldRow): SaveableQuestion => ({
  label: field.label,
  type: field.type,
  required: field.required,
  options: field.options,
  helpText: field.helpText,
  placeholder: field.placeholder,
  settings: field.settings,
});

export function EventRegistrationFormEditor(props: { organisationSlug: string; eventId: string; fields: RegistrationFieldRow[] }) {
  const { organisationSlug, eventId } = props;
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const baseId = useId();

  // Local, optimistic copy of the questions; replaced whenever the server sends fresh rows.
  const [localFields, setLocalFields] = useState<RegistrationFieldRow[]>(() => sorted(props.fields));
  const [syncedFrom, setSyncedFrom] = useState(props.fields);
  if (syncedFrom !== props.fields) {
    setSyncedFrom(props.fields);
    setLocalFields(sorted(props.fields));
  }
  const fields = localFields;
  const latestFields = useRef(localFields);
  useEffect(() => {
    latestFields.current = localFields;
  }, [localFields]);

  const [editing, setEditing] = useState<Editing | null>(null);
  const [addOpen, setAddOpen] = useState(props.fields.length === 0);
  // The picker opens where it was asked for: under the header, or at the end of the list.
  const [addAt, setAddAt] = useState<"top" | "bottom">("top");
  const addPanel = useRef<HTMLDivElement>(null);
  const openAdd = (at: "top" | "bottom") => {
    setAddAt(at);
    setAddOpen(true);
    revealAddPanel.current = true;
  };
  const revealAddPanel = useRef(false);
  const [deleteTarget, setDeleteTarget] = useState<RegistrationFieldRow | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  // Focus moves after the render that shows its target (e.g. the new question's text box).
  const focusRequest = useRef<FocusRequest | null>(null);
  const setFocusRequest = (request: FocusRequest) => {
    focusRequest.current = request;
  };

  const labelInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());

  const dirty = editing ? !draftsEqual(editing.draft, editing.original) : false;
  useUnsavedChangesGuard(dirty);

  useEffect(() => {
    const request = focusRequest.current;
    if (!request) return;
    const node = request.target === "label" ? labelInput.current : request.target === "add" ? addButton.current : editButtons.current.get(request.id);
    if (!node) return;
    focusRequest.current = null;
    node.focus();
    node.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });

  // Bring a newly opened picker into view and put focus on its first choice.
  useEffect(() => {
    if (!addOpen || !revealAddPanel.current || !addPanel.current) return;
    revealAddPanel.current = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    addPanel.current.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
    addPanel.current.querySelector<HTMLElement>("[role='tabpanel'] button:not([disabled]):not([tabindex='-1'])")?.focus({ preventScroll: true });
  }, [addOpen]);

  const problems = useMemo(() => findLogicProblems(fields), [fields]);
  const requiredCount = fields.filter((field) => field.required).length;
  const conditionalCount = fields.filter((field) => field.settings.showIf).length;

  const previewFields = useMemo<PreviewField[]>(() => {
    const rows: PreviewField[] = fields.map((field) => (editing?.id === field.id ? { ...field, ...previewFromDraft(editing.draft) } : field));
    if (editing?.id === NEW_ID) rows.push({ id: NEW_ID, key: NEW_ID, ...previewFromDraft(editing.draft) });
    return rows;
  }, [editing, fields]);

  /* ---------- Server helpers ---------- */

  function upsert(question: SaveableQuestion, extra: { fieldId?: string; key?: string } = {}) {
    return upsertEventRegistrationField({ organisationSlug, eventId, ...extra, ...question });
  }

  function reorder(ids: string[], previous: RegistrationFieldRow[]) {
    return reorderEventRegistrationFields({ organisationSlug, eventId, fieldIds: ids }).then((res) => {
      if (!res.ok) {
        setLocalFields(previous);
        showToast(res.error, "error");
      }
      return res.ok;
    });
  }

  function applyOrder(ids: string[]) {
    const previous = localFields;
    const byId = new Map(localFields.map((field) => [field.id, field]));
    setLocalFields(renumber(ids.map((id) => byId.get(id)!).filter(Boolean)));
    startTransition(async () => {
      if (await reorder(ids, previous)) router.refresh();
    });
  }

  /* ---------- Editing ---------- */

  function confirmDiscard() {
    return !dirty || window.confirm("Discard your unsaved changes to this question?");
  }

  function startEdit(field: RegistrationFieldRow) {
    if (editing?.id === field.id) {
      if (!confirmDiscard()) return;
      setEditing(null);
      return;
    }
    if (!confirmDiscard()) return;
    const draft = draftFromField(field);
    setEditing({ id: field.id, draft, original: draft, errors: {} });
    setFocusRequest({ target: "label" });
  }

  function pickType(type: RegistrationFieldType) {
    if (!confirmDiscard()) return;
    const draft = newDraft(type);
    setEditing({ id: NEW_ID, draft, original: draft, errors: {} });
    setAddOpen(false);
    setFocusRequest({ target: "label" });
  }

  function cancelEdit() {
    if (!editing || !confirmDiscard()) return;
    const id = editing.id;
    setEditing(null);
    setFocusRequest(id === NEW_ID ? { target: "add" } : { target: "edit", id });
  }

  function saveEdit() {
    if (!editing) return;
    const result = validateDraft(editing.draft);
    if (!result.ok) {
      setEditing({ ...editing, errors: result.errors });
      showToast("Check the highlighted fields.", "error");
      return;
    }
    const current = editing;
    const isNew = current.id === NEW_ID;
    const question = result.value;
    startTransition(async () => {
      const res = await upsert(question, isNew ? {} : { fieldId: current.id });
      if (!res.ok) {
        const fieldError = (name: string) => res.fieldErrors?.[name]?.[0];
        setEditing({
          ...current,
          errors: { label: fieldError("label"), helpText: fieldError("helpText"), placeholder: fieldError("placeholder"), options: fieldError("options"), form: res.error === "Invalid input." ? "Some answers need another look." : res.error },
        });
        return;
      }
      const id = res.data!.fieldId;
      setLocalFields((rows) => {
        if (!isNew) return rows.map((row) => (row.id === id ? { ...row, ...question } : row));
        return [...rows, { id, key: predictKey(question.label, rows), sortOrder: rows.length + 1, ...question }];
      });
      setEditing(null);
      setFocusRequest({ target: "edit", id });
      showToast(isNew ? "Question added" : "Question saved", "success");
      router.refresh();
    });
  }

  /* ---------- Quick actions ---------- */

  function setRequired(field: RegistrationFieldRow, required: boolean) {
    const previous = localFields;
    setLocalFields((rows) => rows.map((row) => (row.id === field.id ? { ...row, required } : row)));
    if (editing?.id === field.id) setEditing({ ...editing, draft: { ...editing.draft, required }, original: { ...editing.original, required } });
    startTransition(async () => {
      const res = await upsert({ ...toSaveable(field), required }, { fieldId: field.id });
      if (!res.ok) {
        setLocalFields(previous);
        showToast(res.error, "error");
        return;
      }
      showToast(required ? `“${field.label}” is now required` : `“${field.label}” is now optional`, "success");
      router.refresh();
    });
  }

  function duplicate(field: RegistrationFieldRow) {
    const copy = { ...toSaveable(field), label: duplicateLabel(field.label, fields.map((row) => row.label)) };
    const previous = localFields;
    startTransition(async () => {
      const res = await upsert(copy);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      const id = res.data!.fieldId;
      const ids = previous.map((row) => row.id);
      const at = ids.indexOf(field.id) + 1;
      const order = [...ids.slice(0, at), id, ...ids.slice(at)];
      const row: RegistrationFieldRow = { id, key: predictKey(copy.label, previous), sortOrder: 0, ...copy };
      setLocalFields(renumber(order.map((rowId) => (rowId === id ? row : previous.find((item) => item.id === rowId)!))));
      setFocusRequest({ target: "edit", id });
      showToast(`Added “${copy.label}”`, "success");
      await reorder(order, [...previous, row]);
      router.refresh();
    });
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= fields.length) return;
    const ids = fields.map((field) => field.id);
    [ids[index], ids[target]] = [ids[target]!, ids[index]!];
    applyOrder(ids);
  }

  function removeRule(field: RegistrationFieldRow) {
    const settings = { ...field.settings };
    delete settings.showIf;
    const previous = localFields;
    setLocalFields((rows) => rows.map((row) => (row.id === field.id ? { ...row, settings } : row)));
    startTransition(async () => {
      const res = await upsert({ ...toSaveable(field), settings }, { fieldId: field.id });
      if (!res.ok) {
        setLocalFields(previous);
        showToast(res.error, "error");
        return;
      }
      showToast("Rule removed. The question now always shows.", "success");
      router.refresh();
    });
  }

  function addTemplate(template: QuestionTemplate) {
    if (hasLabel(fields, template.label)) return;
    const question: SaveableQuestion = {
      label: template.label,
      type: template.type,
      required: template.required,
      options: template.options ?? [],
      helpText: template.helpText ?? "",
      placeholder: template.placeholder ?? "",
      settings: template.settings ?? {},
    };
    startTransition(async () => {
      const res = await upsert(question);
      if (!res.ok) {
        showToast(res.error, "error");
        return;
      }
      const id = res.data!.fieldId;
      setLocalFields((rows) => [...rows, { id, key: predictKey(question.label, rows), sortOrder: rows.length + 1, ...question }]);
      setFocusRequest({ target: "edit", id });
      showToast(`Added “${question.label}”`, "success");
      router.refresh();
    });
  }

  function confirmDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    const previous = localFields;
    const position = previous.findIndex((row) => row.id === target.id);
    setDeleteTarget(null);
    if (editing?.id === target.id) setEditing(null);
    setLocalFields((rows) => renumber(rows.filter((row) => row.id !== target.id)));
    startTransition(async () => {
      const res = await deleteEventRegistrationField({ organisationSlug, eventId, fieldId: target.id });
      if (!res.ok) {
        setLocalFields(previous);
        showToast(res.error, "error");
        return;
      }
      router.refresh();
      showToast(
        `Deleted “${target.label}”`,
        "success",
        {
          label: "Undo",
          onClick: () =>
            startTransition(async () => {
              // Restoring with the same internal key keeps later "show only if" rules working.
              const restore = await upsert(toSaveable(target), { key: target.key });
              if (!restore.ok) {
                showToast(restore.error, "error");
                return;
              }
              const id = restore.data!.fieldId;
              const restored: RegistrationFieldRow = { ...target, id };
              const before = latestFields.current;
              const next = [...before];
              next.splice(Math.min(position, next.length), 0, restored);
              const order = next.map((row) => row.id);
              setLocalFields(renumber(next));
              if (order[order.length - 1] !== id) await reorder(order, [...before, restored]);
              showToast("Question restored", "success");
              router.refresh();
            }),
        },
        10000,
      );
    });
  }

  /* ---------- Render ---------- */

  const deleteDependents = deleteTarget ? fields.filter((field) => field.settings.showIf?.fieldKey === deleteTarget.key) : [];
  const addPanelId = `${baseId}-add`;
  const previewId = `${baseId}-preview`;

  const editorFor = (field?: RegistrationFieldRow) =>
    editing ? (
      <QuestionEditor
        ref={labelInput}
        id={`${baseId}-editor-${editing.id}`}
        draft={editing.draft}
        originalType={editing.original.type}
        onChange={(draft) => setEditing((current) => (current ? { ...current, draft } : current))}
        errors={editing.errors}
        fields={fields}
        field={field}
        isNew={!field}
        pending={pending}
        dirty={dirty}
        onSave={saveEdit}
        onCancel={cancelEdit}
      />
    ) : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:gap-7">
        <div className="flex min-w-0 flex-col gap-5">
          <section aria-labelledby={`${baseId}-standard`} className="flex flex-col gap-3 rounded-2xl border border-line bg-subtle p-4 sm:p-5">
            <div>
              <h2 id={`${baseId}-standard`} className="text-h4 text-ink">
                Always collected
              </h2>
              <p className="mt-0.5 text-body-ui text-ink-muted">Every guest gives their name and email. You don&apos;t need to add these.</p>
            </div>
            <ul className="flex flex-col gap-2">
              {[
                { name: "Name", description: "Shown on the guest list and tickets." },
                { name: "Email", description: "Used to send the ticket and event updates." },
              ].map((item) => (
                <li key={item.name} className="flex items-center gap-3 rounded-xl border border-line bg-canvas px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-label text-ink">{item.name}</p>
                    <p className="text-caption text-ink-muted">{item.description}</p>
                  </div>
                  <Chip size="sm" tone="outline">
                    Required
                  </Chip>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby={`${baseId}-questions`} className="flex flex-col gap-3 rounded-2xl border border-line bg-canvas p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1">
                  <h2 id={`${baseId}-questions`} className="text-h4 text-ink">
                    Your questions
                  </h2>
                  <HelpLink article="registration/form" />
                </div>
                <p className="mt-0.5 text-body-ui text-ink-muted" aria-live="polite">
                  {fields.length === 0
                    ? "Ask guests anything else you need to know."
                    : [`${fields.length} ${fields.length === 1 ? "question" : "questions"}`, requiredCount ? `${requiredCount} required` : null, conditionalCount ? `${conditionalCount} conditional` : null].filter(Boolean).join(" · ")}
                </p>
              </div>
              <Button
                ref={addButton}
                variant={addOpen ? "secondary" : "primary"}
                size="sm"
                startIcon={addOpen ? <X /> : <Plus />}
                aria-expanded={addOpen}
                aria-controls={addOpen ? addPanelId : undefined}
                onClick={() => (addOpen ? setAddOpen(false) : openAdd("top"))}
                className="shrink-0"
              >
                {addOpen ? "Close" : "Add question"}
              </Button>
            </div>

            {addOpen && addAt === "top" ? (
              <div ref={addPanel} className="scroll-mt-20">
                <AddQuestionPanel id={addPanelId} fields={fields} pending={pending} onPickType={pickType} onAddTemplate={addTemplate} />
              </div>
            ) : null}

            {fields.length === 0 && editing?.id !== NEW_ID && !addOpen ? (
              <EmptyState>No extra questions yet. Use “Add question” to ask about dietary needs, sizes, or anything else.</EmptyState>
            ) : null}

            {fields.length > 0 || editing?.id === NEW_ID ? (
              <ol className="flex flex-col gap-2.5">
                {fields.map((field, index) => (
                  <QuestionCard
                    key={field.id}
                    ref={(node) => {
                      if (node) editButtons.current.set(field.id, node);
                      else editButtons.current.delete(field.id);
                    }}
                    field={field}
                    number={index + 1}
                    isFirst={index === 0}
                    isLast={index === fields.length - 1}
                    summary={summarizeField(field, fields)}
                    problem={problems.get(field.id)}
                    expanded={editing?.id === field.id}
                    editorId={`${baseId}-editor-${field.id}`}
                    pending={pending}
                    onToggleEdit={() => startEdit(field)}
                    onRequiredChange={(required) => setRequired(field, required)}
                    onDuplicate={() => duplicate(field)}
                    onMove={(direction) => move(index, direction)}
                    onDelete={() => setDeleteTarget(field)}
                    onMoveBelowTrigger={() => {
                      const problem = problems.get(field.id);
                      if (problem?.kind === "later") applyOrder(orderWithFieldBelow(fields.map((row) => row.id), field.id, problem.triggerId));
                    }}
                    onRemoveRule={() => removeRule(field)}
                  >
                    {editing?.id === field.id ? editorFor(field) : null}
                  </QuestionCard>
                ))}
                {editing?.id === NEW_ID ? (
                  <li className="overflow-hidden rounded-xl border border-line-strong bg-canvas shadow-raised">
                    <div className="flex items-center gap-3 px-3 py-3 sm:px-4">
                      <span aria-hidden className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent-text">
                        {fields.length + 1}
                      </span>
                      <h4 className="min-w-0 flex-1 text-label text-ink">New question</h4>
                      <Chip size="sm" tone="neutral" icon={<FieldTypeIcon type={editing.draft.type} />}>
                        {fieldTypeMeta(editing.draft.type).label}
                      </Chip>
                    </div>
                    {editorFor()}
                  </li>
                ) : null}
              </ol>
            ) : null}

            {addOpen && addAt === "bottom" ? (
              <div ref={addPanel} className="flex scroll-mt-20 flex-col gap-2">
                <AddQuestionPanel id={addPanelId} fields={fields} pending={pending} onPickType={pickType} onAddTemplate={addTemplate} />
                <Button variant="quiet" size="sm" startIcon={<X />} onClick={() => setAddOpen(false)} className="self-start">
                  Cancel
                </Button>
              </div>
            ) : null}

            {fields.length > 0 && !addOpen && editing?.id !== NEW_ID ? (
              <Button variant="secondary" size="sm" startIcon={<Plus />} onClick={() => openAdd("bottom")} className="self-start" aria-expanded={false}>
                Add another question
              </Button>
            ) : null}
          </section>
        </div>

        {/* Live, interactive preview of the guest-facing form; nothing here is submitted. */}
        <aside aria-labelledby={`${previewId}-title`} className="order-first flex min-w-0 flex-col gap-2.5 lg:sticky lg:top-6 lg:order-none lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
          <div className="flex items-center justify-between gap-3">
            <span id={`${previewId}-title`} className="flex items-center gap-1.5 text-overline text-ink-muted">
              <Eye aria-hidden className="size-4" />
              Live preview
            </span>
            <Button variant="secondary" size="sm" className="lg:hidden" aria-expanded={previewOpen} aria-controls={previewId} onClick={() => setPreviewOpen((open) => !open)}>
              {previewOpen ? "Hide preview" : "Show preview"}
            </Button>
          </div>
          <div id={previewId} className={cn("flex-col gap-2.5 lg:flex", previewOpen ? "flex" : "hidden")}>
            <FormPreview fields={previewFields} activeId={editing?.id} />
            <span className="text-center text-caption text-ink-muted">Updates as you edit. Questions with rules appear only when their answer matches.</span>
          </div>
        </aside>
      </div>

      <ConfirmationDialog
        open={Boolean(deleteTarget)}
        title="Delete question?"
        message={`Delete “${deleteTarget?.label ?? "this question"}”? Answers guests already gave to it will be deleted too.${
          deleteDependents.length > 0 ? ` ${deleteDependents.length === 1 ? "1 later question uses" : `${deleteDependents.length} later questions use`} it in a “show only if” rule and will always show instead.` : ""
        }`}
        confirmLabel="Delete"
        loading={pending}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

