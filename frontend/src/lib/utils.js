import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Standard shadcn helper for conditional and merged tailwind classes
export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
