import { Trophy } from "lucide-react";
import { Chip } from "@/components/ui/display";
import type { PublicAwardBadgeDto } from "@/lib/judgingDto";

/** "1st place", "2nd place", "11th place", … */
export function placeLabel(place: number): string {
  const mod100 = place % 100;
  const suffix = mod100 >= 11 && mod100 <= 13 ? "th" : place % 10 === 1 ? "st" : place % 10 === 2 ? "nd" : place % 10 === 3 ? "rd" : "th";
  return `${place}${suffix} place`;
}

/** The awards a project won, as chips ("Best design · 1st place"), in the results page's award order. */
export function AwardBadges({ awards, className }: { awards: PublicAwardBadgeDto[]; className?: string }) {
  if (awards.length === 0) return null;
  return (
    <ul aria-label="Awards" className={className ?? "flex flex-wrap gap-1.5"}>
      {awards.map((award, index) => (
        <li key={`${award.name}-${award.place}-${index}`} className="max-w-full">
          <Chip size="sm" tone={award.place === 1 ? "accent" : "neutral"} icon={<Trophy className="size-3.5" />}>
            {award.name} · {placeLabel(award.place)}
          </Chip>
        </li>
      ))}
    </ul>
  );
}
