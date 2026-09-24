import { useEffect, useRef, type ChangeEvent, type KeyboardEvent, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange"> & {
  value: string;
  onChange: (value: string) => void;
  /** Called on Enter (without Shift). Defaults to submitting the enclosing form. */
  onSubmit?: () => void;
};

/**
 * The textarea every "add" field uses: grows with its content, Enter submits (Shift+Enter
 * inserts a newline), and otherwise behaves like the plain input it replaces.
 */
export function AddTextarea({ value, onChange, onSubmit, rows = 1, className, onKeyDown, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    if (onSubmit) onSubmit();
    else event.currentTarget.form?.requestSubmit();
  };

  return (
    <textarea
      ref={ref}
      rows={rows}
      className={`add-textarea${className ? ` ${className}` : ""}`}
      value={value}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
      onKeyDown={keyDown}
      {...rest}
    />
  );
}
