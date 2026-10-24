// not a "use client" file: an effect here is not counted
import { useEffect } from "react";

export function useServerish(url: string) {
  useEffect(() => {
    void fetch(url);
  }, [url]);
}
