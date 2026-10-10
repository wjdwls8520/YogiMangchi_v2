import type { ReactNode } from "react";

type Choice = { value: string; label: string };

export function OrderChoices({
  legend,
  name,
  choices,
  selected,
}: {
  legend: string;
  name: string;
  choices: readonly Choice[];
  selected: string;
}) {
  return (
    <fieldset disabled>
      <legend>{legend}</legend>
      <div>
        {choices.map((choice) => (
          <label key={choice.value}>
            <input type="radio" name={name} value={choice.value} defaultChecked={choice.value === selected} />
            <span>{choice.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OrderInput({
  id,
  label,
  unit,
  placeholder,
  hint,
}: {
  id: string;
  label: string;
  unit: string;
  placeholder: string;
  hint?: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={id}>{label}</label>
      <div>
        <input id={id} name={id} type="text" inputMode="decimal" placeholder={placeholder} disabled aria-describedby={hint ? `${id}-hint` : undefined} />
        <span>{unit}</span>
      </div>
      {hint && <p id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}
