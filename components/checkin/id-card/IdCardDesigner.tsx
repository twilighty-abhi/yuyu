"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, Download, Eye, Grid3x3, Plus, Printer, Redo2, RotateCcw, Undo2, Upload, X } from "lucide-react";
import { Button, IconButton } from "@/components/ui/button";
import { SegmentedControl, Switch } from "@/components/ui/choice";
import { Callout } from "@/components/ui/display";
import { Dropdown, Field, Input } from "@/components/ui/field";
import { Tooltip } from "@/components/ui/menu";
import { cn } from "@/lib/cn";
import {
  exportIdCardDesign,
  ID_CARD_GRID_SIZES_MM,
  ID_CARD_PAPER_PRESETS,
  ID_CARD_TEAM_FIELD_KEY,
  ID_CARD_TEAM_MERGE_FIELD,
  importIdCardDesign,
  layoutForPaper,
  matchPaperPreset,
  type IdCardLayoutElement,
  type IdCardPrintSettings,
} from "@/lib/idCardPrint";
import { BadgeCanvas } from "./BadgeCanvas";
import { printCard } from "./printCards";
import {
  ELEMENT_LABELS,
  registrationFieldKey,
  SAFE_MARGIN_MM,
  safeLogoUrl,
  sampleAttendee,
  type IdCardAttendee,
  type RegistrationField,
  useIdCardSettings,
} from "./shared";
import { HelpLink } from "@/components/help/HelpLink";

const TEMPLATES = [
  { key: "classic", label: "Classic", hint: "Thin frame, hairline under the heading" },
  { key: "bold", label: "Bold", hint: "Heading on a black band, name in capitals" },
  { key: "minimal", label: "Minimal", hint: "No lines, just the name" },
] as const;

type Sample = "short" | "long" | "attendee";

/**
 * Badge designer: style, paper and content on the left, the card drawn to
 * scale in the middle, and the selected item's properties on the right.
 * Everything saves to this browser for this event as you go.
 */
export function IdCardDesigner({
  eventId,
  eventTitle,
  organisationName,
  organisationLogoUrl,
  attendee,
  registrationFields,
  teamEvent = false,
  onClose,
}: {
  eventId: string;
  eventTitle: string;
  organisationName: string;
  organisationLogoUrl: string | null;
  attendee: IdCardAttendee | null;
  registrationFields: RegistrationField[];
  /** TEAM event: offers the Team line and the {{team}} merge field. */
  teamEvent?: boolean;
  onClose: () => void;
}) {
  const { settings, update, checkpoint, undo, redo, canUndo, canRedo } = useIdCardSettings(eventId, eventTitle, organisationName);
  const [selected, setSelected] = useState<IdCardLayoutElement>("name");
  const [sample, setSample] = useState<Sample>(attendee ? "attendee" : "short");
  const [guides, setGuides] = useState(true);
  const [notice, setNotice] = useState<{ tone: "danger" | "success"; text: string } | null>(null);
  const [printing, setPrinting] = useState(false);

  const previewPerson = sample === "attendee" && attendee ? attendee : sampleAttendee(registrationFields, sample === "long", teamEvent);
  const logoUrl = settings.showLogo ? safeLogoUrl(organisationLogoUrl) : null;

  // Undo/redo from the keyboard while the designer is open (not while typing).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo, redo]);

  const move = (element: IdCardLayoutElement, xMm: number, yMm: number) => {
    const square = element === "qr" || element === "logo";
    const size = settings.elementSizes[element];
    const snap = (value: number) => Math.round(value / settings.gridSizeMm) * settings.gridSizeMm;
    const next = {
      xMm: Math.min(Math.max(0, settings.widthMm - size - SAFE_MARGIN_MM), Math.max(0, snap(xMm))),
      yMm: Math.min(Math.max(0, settings.heightMm - (square ? size : 0) - SAFE_MARGIN_MM), Math.max(0, snap(yMm))),
    };
    const current = settings.elementPositions[element];
    if (current.xMm === next.xMm && current.yMm === next.yMm) return;
    update({ elementPositions: { ...settings.elementPositions, [element]: next } }, false);
  };

  const setPaper = (widthMm: number, heightMm: number) => {
    update({ widthMm, heightMm, ...layoutForPaper(settings.template, widthMm, heightMm) });
  };

  const runPrint = async (person: IdCardAttendee) => {
    setPrinting(true);
    setNotice(null);
    try {
      const ok = await printCard({ settings, attendee: person, organisationLogoUrl });
      if (!ok) setNotice({ tone: "danger", text: "The print window was blocked. Allow pop-ups for this site and try again." });
    } catch {
      setNotice({ tone: "danger", text: "Could not prepare the card. Please try again." });
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="id-card-designer-title" className="text-h4 text-ink">Badge designer</h2>
          <p className="truncate text-caption text-ink-muted">{eventTitle} · saved on this device as you go</p>
        </div>
        <HelpLink article="check-in/badges" />
        <Tooltip content="Undo (⌘Z)">
          <span><IconButton label="Undo" size="sm" disabled={!canUndo} onClick={undo}><Undo2 /></IconButton></span>
        </Tooltip>
        <Tooltip content="Redo (⇧⌘Z)">
          <span><IconButton label="Redo" size="sm" disabled={!canRedo} onClick={redo}><Redo2 /></IconButton></span>
        </Tooltip>
        <IconButton label="Close designer" onClick={onClose}><X /></IconButton>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:grid lg:grid-cols-[300px_minmax(0,1fr)_272px] lg:overflow-hidden">
        {/* Settings */}
        <aside aria-label="Badge settings" className="order-2 flex shrink-0 flex-col gap-6 border-line p-4 sm:p-5 lg:order-none lg:overflow-y-auto lg:border-r">
          <Section title="Style">
            <div role="radiogroup" aria-label="Badge style" className="grid grid-cols-3 gap-2">
              {TEMPLATES.map((template) => {
                const active = settings.template === template.key;
                return (
                  <button
                    key={template.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    title={template.hint}
                    onClick={() => update({ template: template.key, ...layoutForPaper(template.key, settings.widthMm, settings.heightMm) })}
                    className={cn("flex flex-col items-center gap-1.5 rounded-xl border bg-canvas p-2 text-center transition-colors hover:bg-subtle", active ? "border-ink shadow-[inset_0_0_0_0.5px_var(--color-ink)]" : "border-line")}
                  >
                    <TemplateThumb template={template.key} />
                    <span className="text-[12px] font-semibold leading-tight text-ink">{template.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="text-caption text-ink-muted">Changing style resets positions. Black and white prints cleanly on laser and thermal printers.</p>
          </Section>

          <PaperSection settings={settings} onPaper={setPaper} onCustom={(patch) => update(patch)} />

          <Section title="Text">
            <Field label="Heading">
              <Input maxLength={120} value={settings.heading} onChange={(event) => update({ heading: event.target.value })} />
            </Field>
            <ToggleField label="Badge label" checked={settings.showBadgeLabel} onCheckedChange={(showBadgeLabel) => update({ showBadgeLabel })}>
              <Input maxLength={40} value={settings.badgeLabel} disabled={!settings.showBadgeLabel} onChange={(event) => update({ badgeLabel: event.target.value })} placeholder="ATTENDEE" />
            </ToggleField>
            <ToggleField label="Footer" checked={settings.showFooter} onCheckedChange={(showFooter) => update({ showFooter })}>
              <Input maxLength={80} value={settings.footerText} disabled={!settings.showFooter} onChange={(event) => update({ footerText: event.target.value })} />
            </ToggleField>
            {teamEvent ? (
              <p className="text-caption text-ink-muted">
                Type <code className="rounded bg-subtle px-1 font-mono text-[12px] text-ink">{ID_CARD_TEAM_MERGE_FIELD}</code> in any of these to print the attendee&apos;s team name.
              </p>
            ) : null}
          </Section>

          <Section title="Show on the badge">
            <SwitchLine label="Attendee email" checked={settings.showEmail} onCheckedChange={(showEmail) => update({ showEmail })} />
            <SwitchLine
              label="Organisation logo"
              hint={organisationLogoUrl ? undefined : "Add a logo in organisation settings first."}
              disabled={!organisationLogoUrl}
              checked={settings.showLogo && Boolean(organisationLogoUrl)}
              onCheckedChange={(showLogo) => update({ showLogo })}
            />
            <SwitchLine label="Shrink long names to fit" hint="Keeps names on one line, down to 60% of the size." checked={settings.nameAutoFit} onCheckedChange={(nameAutoFit) => update({ nameAutoFit })} />
          </Section>

          <AnswersSection settings={settings} fields={registrationFields} teamEvent={teamEvent} update={update} />
        </aside>

        {/* Canvas */}
        <section aria-label="Badge preview" className="order-1 flex shrink-0 min-h-[420px] min-w-0 flex-col bg-subtle lg:order-none lg:min-h-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas px-3 py-2">
            <SegmentedControl<Sample>
              ariaLabel="Preview with"
              size="sm"
              value={sample}
              onValueChange={setSample}
              options={[
                { value: "short", label: "Short name" },
                { value: "long", label: "Long name" },
                ...(attendee ? [{ value: "attendee" as const, label: attendee.displayName.split(" ")[0] || "Attendee" }] : []),
              ]}
            />
            <div className="ml-auto flex items-center gap-1">
              <Tooltip content={guides ? "Hide grid and guides" : "Show grid and guides"}>
                <span>
                  <IconButton label={guides ? "Hide guides" : "Show guides"} size="sm" variant={guides ? "secondary" : "quiet"} aria-pressed={guides} onClick={() => setGuides(!guides)}>
                    {guides ? <Grid3x3 /> : <Eye />}
                  </IconButton>
                </span>
              </Tooltip>
              <Dropdown aria-label="Snap to" value={String(settings.gridSizeMm)} onChange={(event) => update({ gridSizeMm: Number(event.target.value) as IdCardPrintSettings["gridSizeMm"] }, false)} className="min-h-8 w-[132px] py-1 text-[13px]">
                {ID_CARD_GRID_SIZES_MM.map((size) => <option key={size} value={size}>Snap {size} mm</option>)}
              </Dropdown>
            </div>
          </div>
          <FitArea widthMm={settings.widthMm} heightMm={settings.heightMm}>
            {(pxPerMm) => (
              <BadgeCanvas
                settings={settings}
                attendee={previewPerson}
                logoUrl={logoUrl}
                pxPerMm={pxPerMm}
                interaction={guides ? { selected, onSelect: setSelected, onBeginChange: checkpoint, onMove: move, showGrid: settings.showGrid } : undefined}
              />
            )}
          </FitArea>
          <p className="border-t border-line bg-canvas px-4 py-2 text-caption text-ink-muted">
            {guides ? "Click an item to edit it. Drag, or use arrow keys (Shift for bigger steps)." : "This is how the card prints. Guides never print."}
          </p>
        </section>

        {/* Inspector */}
        <aside aria-label="Selected item" className="order-1 shrink-0 border-line p-4 sm:p-5 lg:order-none lg:overflow-y-auto lg:border-l">
          <Inspector settings={settings} selected={selected} onSelect={setSelected} update={update} logoAvailable={Boolean(logoUrl)} />
        </aside>
      </div>

      {notice ? (
        <div className="px-4 pt-2">
          <Callout tone={notice.tone} role={notice.tone === "danger" ? "alert" : "status"} action={<Button size="sm" variant="quiet" onClick={() => setNotice(null)}>Dismiss</Button>}>{notice.text}</Callout>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-5">
        <DesignFileButtons
          settings={settings}
          eventTitle={eventTitle}
          organisationName={organisationName}
          onImport={(next) => {
            update(next);
            setNotice({ tone: "success", text: "Design imported." });
          }}
          onError={(text) => setNotice({ tone: "danger", text })}
        />
        <span className="hidden text-caption text-ink-muted md:inline">Print at 100% (actual size), no headers or footers.</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="secondary" startIcon={<Printer />} disabled={printing} onClick={() => runPrint(sampleAttendee(registrationFields, false, teamEvent))}>
            Print test card
          </Button>
          {attendee ? (
            <Button variant="primary" startIcon={<Printer />} disabled={printing} onClick={() => runPrint(attendee)}>
              Print {attendee.displayName.split(" ")[0]}&apos;s badge
            </Button>
          ) : (
            <Button variant="primary" onClick={onClose}>Done</Button>
          )}
        </div>
      </footer>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h3 id={id} className="text-overline text-ink-muted">{title}</h3>
      {children}
    </section>
  );
}

function SwitchLine({ label, hint, checked, disabled, onCheckedChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onCheckedChange: (checked: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className={cn("min-w-0 cursor-pointer", disabled && "cursor-not-allowed")}>
        <span className={cn("block text-body-ui", disabled ? "text-ink-muted" : "text-ink")}>{label}</span>
        {hint ? <span className="block text-caption text-ink-muted">{hint}</span> : null}
      </label>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
    </div>
  );
}

function ToggleField({ label, checked, onCheckedChange, children }: { label: string; checked: boolean; onCheckedChange: (checked: boolean) => void; children: ReactNode }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${id}-input`} className="text-label text-ink">{label}</label>
        <Switch aria-label={`Show ${label.toLowerCase()}`} checked={checked} onCheckedChange={onCheckedChange} />
      </div>
      <div id={`${id}-input`} className="contents">{children}</div>
    </div>
  );
}

/** A tiny drawing of each template: the frame, band or bare page, a big name bar and the QR corner. */
function TemplateThumb({ template }: { template: IdCardPrintSettings["template"] }) {
  return (
    <span aria-hidden className="relative block h-[52px] w-[38px] overflow-hidden bg-white outline outline-1 outline-[#ddd]">
      {template === "classic" ? (
        <>
          <span className="absolute inset-[2px] rounded-[1.5px] border border-[#111]" />
          <span className="absolute left-[6px] top-[6px] block h-[1.5px] w-[9px] bg-[#111]" />
          <span className="absolute left-[6px] top-[9px] block h-[2.5px] w-[18px] bg-[#111]" />
          <span className="absolute left-[6px] top-[13.5px] block h-px w-[20px] bg-[#111]" />
          <span className="absolute left-[6px] top-[18px] block h-[5px] w-[24px] bg-[#111]" />
          <span className="absolute left-[6px] top-[25px] block h-[1.5px] w-[15px] bg-[#111]" />
        </>
      ) : null}
      {template === "bold" ? (
        <>
          <span className="absolute inset-x-[2px] top-[2px] block h-[12px] rounded-[1.5px] bg-[#111]" />
          <span className="absolute left-[5px] top-[5px] block h-[1.5px] w-[8px] bg-white" />
          <span className="absolute left-[5px] top-[8.5px] block h-[2.5px] w-[18px] bg-white" />
          <span className="absolute left-[5px] top-[17px] block h-[5px] w-[26px] bg-[#111]" />
          <span className="absolute left-[5px] top-[24px] block h-[1.5px] w-[15px] bg-[#111]" />
        </>
      ) : null}
      {template === "minimal" ? (
        <>
          <span className="absolute left-[5px] top-[5px] block h-[1.5px] w-[11px] bg-[#111]" />
          <span className="absolute left-[5px] top-[19px] block h-[5px] w-[26px] bg-[#111]" />
          <span className="absolute left-[5px] top-[26px] block h-[1.5px] w-[14px] bg-[#111]" />
        </>
      ) : null}
      <span
        className={cn(
          "absolute block border-[1.5px] border-dotted border-[#111]",
          template === "minimal" ? "bottom-[5px] right-[5px] size-[9px]" : "bottom-[5px] right-[5px] size-[11px]",
        )}
      />
    </span>
  );
}

function PaperSection({
  settings,
  onPaper,
  onCustom,
}: {
  settings: IdCardPrintSettings;
  onPaper: (widthMm: number, heightMm: number) => void;
  onCustom: (patch: Partial<IdCardPrintSettings>) => void;
}) {
  const match = matchPaperPreset(settings.widthMm, settings.heightMm);
  const [custom, setCustom] = useState(!match);
  const landscape = settings.widthMm > settings.heightMm;
  const presetId = custom ? "custom" : match?.preset.id ?? "custom";
  return (
    <Section title="Paper">
      <Field label="Badge stock" helperText={custom ? "Enter your stock's size. Positions keep where they are." : match?.preset.detail}>
        <Dropdown
          value={presetId}
          onChange={(event) => {
            const preset = ID_CARD_PAPER_PRESETS.find((item) => item.id === event.target.value);
            if (!preset) return setCustom(true);
            setCustom(false);
            const [w, h] = landscape !== preset.widthMm > preset.heightMm ? [preset.heightMm, preset.widthMm] : [preset.widthMm, preset.heightMm];
            onPaper(w, h);
          }}
        >
          {ID_CARD_PAPER_PRESETS.map((preset) => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          <option value="custom">Custom size</option>
        </Dropdown>
      </Field>
      {custom ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Width (mm)"><Input type="number" min={40} max={300} step={0.1} value={settings.widthMm} onChange={(event) => onCustom({ widthMm: Number(event.target.value) })} /></Field>
          <Field label="Height (mm)"><Input type="number" min={40} max={300} step={0.1} value={settings.heightMm} onChange={(event) => onCustom({ heightMm: Number(event.target.value) })} /></Field>
        </div>
      ) : null}
      <SegmentedControl<"portrait" | "landscape">
        ariaLabel="Orientation"
        size="sm"
        value={landscape ? "landscape" : "portrait"}
        onValueChange={(next) => {
          if ((next === "landscape") !== landscape) onPaper(settings.heightMm, settings.widthMm);
        }}
        options={[{ value: "portrait", label: "Portrait" }, { value: "landscape", label: "Landscape" }]}
        className="self-start"
      />
    </Section>
  );
}

function AnswersSection({ settings, fields, teamEvent, update }: { settings: IdCardPrintSettings; fields: RegistrationField[]; teamEvent: boolean; update: (patch: Partial<IdCardPrintSettings>) => void }) {
  const options = [
    ...(teamEvent ? [{ key: ID_CARD_TEAM_FIELD_KEY, label: "Team" }] : []),
    ...fields.map((field) => ({ key: registrationFieldKey(field.key), label: field.label })),
  ];
  const chosen = settings.printFieldKeys.flatMap((key) => options.find((option) => option.key === key) ?? []);
  const available = options.filter((option) => !settings.printFieldKeys.includes(option.key));
  const moveField = (index: number, by: -1 | 1) => {
    const keys = [...settings.printFieldKeys];
    const [item] = keys.splice(index, 1);
    keys.splice(index + by, 0, item!);
    update({ printFieldKeys: keys });
  };
  return (
    <Section title="Registration answers">
      {options.length === 0 ? (
        <p className="text-caption text-ink-muted">This event&apos;s sign-up form has no extra questions to print.</p>
      ) : (
        <>
          {chosen.length > 0 ? (
            <ol className="flex flex-col gap-2">
              {chosen.map((field, index) => (
                <li key={field.key} className="flex flex-col gap-2 rounded-xl border border-line p-2.5">
                  <div className="flex items-center gap-1">
                    <span className="min-w-0 flex-1 truncate text-label text-ink">{field.label}</span>
                    <IconButton label={`Move ${field.label} up`} size="sm" disabled={index === 0} onClick={() => moveField(index, -1)}><ArrowUp /></IconButton>
                    <IconButton label={`Move ${field.label} down`} size="sm" disabled={index === chosen.length - 1} onClick={() => moveField(index, 1)}><ArrowDown /></IconButton>
                    <IconButton label={`Remove ${field.label}`} size="sm" onClick={() => update({ printFieldKeys: settings.printFieldKeys.filter((key) => key !== field.key) })}><X /></IconButton>
                  </div>
                  <Input
                    aria-label={`Printed label for ${field.label}`}
                    maxLength={60}
                    value={settings.printFieldLabels[field.key] ?? field.label}
                    placeholder="No label, just the answer"
                    onChange={(event) => update({ printFieldLabels: { ...settings.printFieldLabels, [field.key]: event.target.value } })}
                    className="py-2 text-sm"
                  />
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-caption text-ink-muted">Print answers like company or role under the name.</p>
          )}
          {available.length > 0 ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Add an answer">
              {available.map((field) => (
                <button
                  key={field.key}
                  type="button"
                  onClick={() => update({ printFieldKeys: [...settings.printFieldKeys, field.key] })}
                  className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed border-line-strong px-3 text-[13px] font-semibold text-ink-secondary hover:bg-subtle hover:text-ink"
                >
                  <Plus aria-hidden className="size-3.5" />
                  {field.label}
                </button>
              ))}
            </div>
          ) : null}
        </>
      )}
    </Section>
  );
}

function Inspector({
  settings,
  selected,
  onSelect,
  update,
  logoAvailable,
}: {
  settings: IdCardPrintSettings;
  selected: IdCardLayoutElement;
  onSelect: (element: IdCardLayoutElement) => void;
  update: (patch: Partial<IdCardPrintSettings>) => void;
  logoAvailable: boolean;
}) {
  const square = selected === "qr" || selected === "logo";
  const at = settings.elementPositions[selected];
  const size = settings.elementSizes[selected];
  const visible: Record<IdCardLayoutElement, boolean> = {
    header: Boolean((settings.showBadgeLabel && settings.badgeLabel.trim()) || settings.heading.trim()),
    name: true,
    email: settings.showEmail,
    details: settings.printFieldKeys.length > 0,
    qr: true,
    footer: settings.showFooter && Boolean(settings.footerText.trim()),
    logo: logoAvailable,
  };
  const place = (xMm: number, yMm: number) => update({ elementPositions: { ...settings.elementPositions, [selected]: { xMm: Math.round(xMm * 10) / 10, yMm: Math.round(yMm * 10) / 10 } } });
  const height = square ? size : 0;
  const align = {
    left: () => place(SAFE_MARGIN_MM, at.yMm),
    centre: () => place((settings.widthMm - size) / 2, at.yMm),
    right: () => place(settings.widthMm - size - SAFE_MARGIN_MM, at.yMm),
    top: () => place(at.xMm, SAFE_MARGIN_MM),
    middle: () => place(at.xMm, (settings.heightMm - height) / 2),
    bottom: () => place(at.xMm, settings.heightMm - height - SAFE_MARGIN_MM),
  };
  const resetItem = () => {
    const fresh = layoutForPaper(settings.template, settings.widthMm, settings.heightMm);
    update({
      elementPositions: { ...settings.elementPositions, [selected]: fresh.elementPositions[selected] },
      elementSizes: { ...settings.elementSizes, [selected]: fresh.elementSizes[selected] },
      elementTextSizes: { ...settings.elementTextSizes, [selected]: fresh.elementTextSizes[selected] },
      elementBold: { ...settings.elementBold, [selected]: fresh.elementBold[selected] },
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <h3 className="text-overline text-ink-muted">Items</h3>
        <div role="radiogroup" aria-label="Select an item" className="flex flex-wrap gap-1.5">
          {(Object.keys(ELEMENT_LABELS) as IdCardLayoutElement[]).map((element) => (
            <button
              key={element}
              type="button"
              role="radio"
              aria-checked={selected === element}
              disabled={!visible[element]}
              onClick={() => onSelect(element)}
              className={cn(
                "min-h-8 rounded-full border px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
                selected === element ? "border-ink bg-ink text-canvas" : "border-line text-ink-secondary hover:bg-subtle hover:text-ink",
              )}
            >
              {ELEMENT_LABELS[element]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border border-line p-3.5">
        <p className="text-label text-ink">{ELEMENT_LABELS[selected]}</p>
        {!visible[selected] ? <p className="text-caption text-ink-muted">Hidden on the badge right now.</p> : null}
        {!square ? (
          <NumberSlider
            label="Text size"
            unit="pt"
            min={6}
            max={48}
            step={0.5}
            value={settings.elementTextSizes[selected]}
            onChange={(value) => update({ elementTextSizes: { ...settings.elementTextSizes, [selected]: value } })}
          />
        ) : null}
        <NumberSlider
          label={square ? "Size" : "Box width"}
          unit="mm"
          min={square ? 10 : 20}
          max={Math.max(square ? 10 : 20, settings.widthMm - 4)}
          step={1}
          value={size}
          onChange={(value) => update({ elementSizes: { ...settings.elementSizes, [selected]: value } })}
        />
        {!square ? <SwitchLine label="Bold" checked={settings.elementBold[selected]} onCheckedChange={(bold) => update({ elementBold: { ...settings.elementBold, [selected]: bold } })} /> : null}
        <div className="grid grid-cols-2 gap-2">
          <Field label="From left (mm)"><Input type="number" step={settings.gridSizeMm} value={at.xMm} onChange={(event) => place(Number(event.target.value), at.yMm)} className="py-2" /></Field>
          <Field label="From top (mm)"><Input type="number" step={settings.gridSizeMm} value={at.yMm} onChange={(event) => place(at.xMm, Number(event.target.value))} className="py-2" /></Field>
        </div>
        <div className="flex flex-col gap-1.5">
          <p className="text-caption text-ink-muted">Align on the badge</p>
          <div className="grid grid-cols-3 gap-1">
            {(Object.keys(align) as Array<keyof typeof align>).map((key) => (
              <Button key={key} size="sm" variant="secondary" className="px-2 capitalize" onClick={align[key]}>{key}</Button>
            ))}
          </div>
        </div>
        <Button size="sm" variant="quiet" startIcon={<RotateCcw />} onClick={resetItem} className="self-start">Reset this item</Button>
      </div>

      {selected === "qr" && size < 20 ? <Callout tone="warning">Keep the QR at least 20 mm so it scans reliably once printed.</Callout> : null}

      <Button size="sm" variant="quiet" startIcon={<RotateCcw />} className="self-start" onClick={() => update(layoutForPaper(settings.template, settings.widthMm, settings.heightMm))}>
        Reset the whole layout
      </Button>
    </div>
  );
}

function NumberSlider({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-caption text-ink-muted">{label}</label>
        <span className="flex items-center gap-1">
          <Input aria-label={`${label} (${unit})`} type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="h-8 w-[68px] px-2 py-1 text-right text-sm" />
          <span className="text-caption text-ink-muted">{unit}</span>
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full accent-[var(--color-ink)]" />
    </div>
  );
}

/** Measures the space and hands the card the largest scale that fits. */
function FitArea({ widthMm, heightMm, children }: { widthMm: number; heightMm: number; children: (pxPerMm: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setBox({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const fit = box.width ? Math.min((box.width - 40) / widthMm, (Math.max(box.height, 320) - 40) / heightMm) : 0;
  const pxPerMm = Math.min(6, Math.max(1.6, fit || 3));
  return (
    <div
      ref={ref}
      className="grid min-h-[380px] flex-1 place-items-center overflow-auto p-5"
      style={{ backgroundImage: "radial-gradient(circle, rgba(128,128,128,0.22) 1px, transparent 1px)", backgroundSize: "16px 16px" }}
    >
      {box.width ? children(pxPerMm) : null}
    </div>
  );
}

function DesignFileButtons({
  settings,
  eventTitle,
  organisationName,
  onImport,
  onError,
}: {
  settings: IdCardPrintSettings;
  eventTitle: string;
  organisationName: string;
  onImport: (settings: IdCardPrintSettings) => void;
  onError: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-1">
      <Tooltip content="Save this design as a file, to use on another check-in desk">
        <span>
          <Button
            size="sm"
            variant="quiet"
            startIcon={<Download />}
            onClick={() => {
              const blob = new Blob([exportIdCardDesign(settings)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "badge-design.json";
              link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}
          >
            Export
          </Button>
        </span>
      </Tooltip>
      <Button size="sm" variant="quiet" startIcon={<Upload />} onClick={() => fileInput.current?.click()}>Import</Button>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > 200_000) return onError("That file is too large to be a badge design.");
          const next = importIdCardDesign(await file.text(), eventTitle, organisationName);
          if (next) onImport(next);
          else onError("That file isn't a Yuyu badge design.");
        }}
      />
    </div>
  );
}
