import React, { useId } from 'react';

interface FieldWrapperProps {
  id: string;
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactNode;
}

function FieldWrapper({ id, label, hint, error, required, children }: FieldWrapperProps) {
  return (
    <div className="space-y-1.5">
      {label && (
        <label htmlFor={id} className="block text-sm font-medium text-slate-700">
          {label}
          {required && <span className="text-red-600 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

const INPUT_BASE =
  'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 disabled:bg-slate-100 disabled:text-slate-500';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, id, required, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} required={required}>
      <input
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${INPUT_BASE} ${error ? 'border-red-500' : 'border-slate-300'} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
});

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
}

export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, id, required, options, placeholder, children, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} required={required}>
      <select
        ref={ref}
        id={fieldId}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${INPUT_BASE} ${error ? 'border-red-500' : 'border-slate-300'} ${className}`}
        {...rest}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options
          ? options.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))
          : children}
      </select>
    </FieldWrapper>
  );
});

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, id, required, className = '', rows = 3, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} required={required}>
      <textarea
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={Boolean(error)}
        className={`${INPUT_BASE} ${error ? 'border-red-500' : 'border-slate-300'} ${className}`}
        {...rest}
      />
    </FieldWrapper>
  );
});

interface MultiSelectProps {
  label?: string;
  hint?: string;
  error?: string;
  options: Array<{ value: string; label: string; meta?: string }>;
  value: string[];
  onChange: (next: string[]) => void;
}

export function MultiSelect({ label, hint, error, options, value, onChange }: MultiSelectProps) {
  const autoId = useId();
  const toggle = (optVal: string) => {
    if (value.includes(optVal)) {
      onChange(value.filter((v) => v !== optVal));
    } else {
      onChange([...value, optVal]);
    }
  };

  return (
    <FieldWrapper id={autoId} label={label} hint={hint} error={error}>
      <div
        id={autoId}
        role="group"
        aria-label={label}
        className={`rounded-lg border divide-y divide-slate-100 max-h-48 overflow-y-auto bg-white ${
          error ? 'border-red-500' : 'border-slate-300'
        }`}
      >
        {options.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">No options available</p>
        ) : (
          options.map((opt) => {
            const checked = value.includes(opt.value);
            return (
              <label
                key={opt.value}
                className="flex items-center justify-between gap-3 px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer"
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                    className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="text-slate-800 truncate">{opt.label}</span>
                </span>
                {opt.meta && (
                  <span className="text-xs font-mono text-slate-500 shrink-0">{opt.meta}</span>
                )}
              </label>
            );
          })
        )}
      </div>
    </FieldWrapper>
  );
}

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
  description?: string;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox(
  { label, description, id, className = '', ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <label htmlFor={fieldId} className={`flex items-start gap-3 cursor-pointer ${className}`}>
      <input
        ref={ref}
        id={fieldId}
        type="checkbox"
        className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
        {...rest}
      />
      <span className="space-y-0.5">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
});

interface JsonEditorProps {
  label?: string;
  value: string;
  onChange: (next: string) => void;
  error?: string;
  rows?: number;
}

export function JsonEditor({ label, value, onChange, error, rows = 6 }: JsonEditorProps) {
  let parseError: string | undefined;
  if (value.trim().length > 0) {
    try {
      JSON.parse(value);
    } catch (e) {
      parseError = e instanceof Error ? e.message : 'Invalid JSON';
    }
  }
  return (
    <Textarea
      label={label}
      rows={rows}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      error={error ?? parseError}
      className="font-mono text-xs"
      spellCheck={false}
    />
  );
}
