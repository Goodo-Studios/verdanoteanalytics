// Client-or-Internal and category pickers for time with no task (OS-012). Used by the Switch
// popover in the timer pill and by the weekly log's entry form.
import { SelectField } from "@/components/page-kit";
import { useTimeClients } from "@/hooks/useTimer";
import { TIME_CATEGORIES } from "@/lib/timeLog";

/** The value of the client picker that means Internal (no client). */
export const INTERNAL = "__internal__";

export function TimePurposeFields({
  client,
  category,
  onClient,
  onCategory,
  idPrefix,
}: {
  client: string;
  category: string;
  onClient: (v: string) => void;
  onCategory: (v: string) => void;
  idPrefix: string;
}) {
  const clients = useTimeClients();
  const options = [{ value: INTERNAL, label: "Internal" }, ...(clients.data ?? []).map((c) => ({ value: c.slug, label: c.name || c.slug }))];
  return (
    <>
      <SelectField
        id={`${idPrefix}-client`}
        label="Client or Internal"
        value={client}
        onChange={(e) => onClient(e.target.value)}
        placeholder="Choose"
        options={options}
        data-testid={`${idPrefix}-client`}
      />
      <SelectField
        id={`${idPrefix}-category`}
        label="Category"
        value={category}
        onChange={(e) => onCategory(e.target.value)}
        placeholder="Choose"
        options={TIME_CATEGORIES.map((c) => ({ value: c, label: c }))}
        data-testid={`${idPrefix}-category`}
      />
    </>
  );
}
