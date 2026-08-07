import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Identic cu /opt/faikkitbox/src/lib/utils.ts — necesar local pentru că
// componentele shadcn importate din @faikkitbox/components/ui/* folosesc
// intern alias-ul "@/lib/utils", care în acest proiect trebuie să rezolve
// la propriul "@" (plex/src), nu la cel din FaikkitBox.
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
