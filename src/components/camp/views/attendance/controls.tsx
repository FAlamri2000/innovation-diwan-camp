/**
 * Camp operations — controls the attendance tabs share: the camp-day picker,
 * the person filter bar and the rate cell.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useTranslation } from "@/i18n/use-translation";
import type { DayRow, RateDto } from "@/lib/camp/types";
import { FilterSelect, ROLE_KEY, SearchBox, toneColor, useCampFormat } from "../../camp-ui";
import { rateTone, ROLES, type PersonFilter } from "./model";

export function DaySelect({
  days,
  value,
  onChange,
}: {
  days: DayRow[];
  value: number;
  onChange: (dayNo: number) => void;
}) {
  const { t } = useTranslation();
  const fmt = useCampFormat();
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger className="h-9 w-auto min-w-52" aria-label={t("camp.common.day")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {days.map((d) => (
          <SelectItem key={d.dayNo} value={String(d.dayNo)}>
            {t("camp.att.dayOption", { n: d.dayNo, date: fmt.date(d.date) })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PersonFilterBar({
  value,
  onChange,
  teams,
}: {
  value: PersonFilter;
  onChange: (next: PersonFilter) => void;
  teams: { value: string; label: string }[];
}) {
  const { t } = useTranslation();
  return (
    <>
      <SearchBox value={value.search} onChange={(search) => onChange({ ...value, search })} />
      <FilterSelect
        label={t("camp.att.group")}
        value={value.group}
        onChange={(group) => onChange({ ...value, group })}
        options={[
          { value: "participants" as const, label: t("camp.role.participants") },
          { value: "enablers" as const, label: t("camp.role.enablers") },
        ]}
      />
      <FilterSelect
        label={t("camp.col.role")}
        value={value.role}
        onChange={(role) => onChange({ ...value, role })}
        options={ROLES.map((r) => ({ value: r, label: t(ROLE_KEY[r]) }))}
      />
      <FilterSelect
        label={t("camp.col.team")}
        value={value.team}
        onChange={(team) => onChange({ ...value, team })}
        options={teams}
      />
    </>
  );
}

/** "86.4% 19/22", coloured by rateTone. */
export function RateCell({ value }: { value: RateDto }) {
  const fmt = useCampFormat();
  if (!value.expected) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap tabular-nums">
      <span className="font-medium" style={{ color: toneColor(rateTone(value.rate)) }}>
        {fmt.percent(value.rate)}
      </span>
      <span className="text-xs text-muted-foreground">
        {value.attended}/{value.expected}
      </span>
    </span>
  );
}
