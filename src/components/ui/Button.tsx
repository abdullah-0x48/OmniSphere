import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: React.ReactNode;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary:
    'bg-indigo-600 text-white hover:bg-indigo-700 border border-indigo-600 focus-visible:ring-indigo-500 disabled:bg-indigo-400 disabled:border-indigo-400',
  secondary:
    'bg-white text-slate-700 hover:bg-slate-50 border border-slate-300 focus-visible:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400',
  danger:
    'bg-red-600 text-white hover:bg-red-700 border border-red-600 focus-visible:ring-red-500 disabled:bg-red-400 disabled:border-red-400',
  ghost:
    'bg-transparent text-slate-700 hover:bg-slate-100 border border-transparent focus-visible:ring-indigo-500 disabled:text-slate-400',
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-xs gap-1.5',
  md: 'h-9 px-4 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className = '', children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" /> : icon}
      <span>{children}</span>
    </button>
  );
});

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  variant?: 'ghost' | 'secondary' | 'danger';
  size?: 'sm' | 'md';
}

export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  className = '',
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const sizeCls = size === 'sm' ? 'h-8 w-8' : 'h-9 w-9';
  const varCls =
    variant === 'secondary'
      ? 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
      : variant === 'danger'
        ? 'text-red-600 hover:bg-red-50'
        : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900';

  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`inline-flex items-center justify-center rounded-lg transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${sizeCls} ${varCls} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
