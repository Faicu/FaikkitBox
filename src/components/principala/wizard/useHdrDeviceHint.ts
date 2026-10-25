import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getHdrDeviceHint, type HdrDeviceHint } from "@/lib/services/device-hdr.functions";

export const HDR_HINT_QUERY_KEY = ["hdr-device-hint"];

// Indiciul HDR după dispozitiv (vezi HdrDeviceHint.tsx), comun rândurilor de
// indiciu și butoanelor din HdrQuestion — aceeași cerere, din cache.
export function useHdrDeviceHint() {
  const fetchHint = useServerFn(getHdrDeviceHint);
  return useQuery({
    queryKey: HDR_HINT_QUERY_KEY,
    queryFn: () => fetchHint(),
    staleTime: 60_000,
  });
}

// Butonul de evidențiat (nu de preselectat), după dispozitivul obișnuit —
// nu după ultimul, care poate fi o abatere. „Nu știu sigur" = niciunul.
export function recommendedHdrAnswer(hint: HdrDeviceHint | undefined): "yes" | "no" | null {
  if (!hint || hint.verdict === "unknown") return null;
  return hint.verdict;
}
