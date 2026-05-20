import { useCallback, useRef } from 'react';
import { useFocusEffect } from '@react-navigation/native';

// Refetches a query whenever its screen comes into focus — the
// TanStack Query replacement for the hand-rolled
// `navigation.addListener('focus', loadX)` that every screen used
// to carry.
//
// Skips the very first focus (the query already fetched on mount),
// so we don't fire a duplicate request the moment the screen opens.
// staleTime on the query still applies — if the data is fresh,
// refetch() is a cheap no-op that returns the cache.
export function useRefetchOnFocus(refetch: () => unknown): void {
  const firstFocusRef = useRef<boolean>(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocusRef.current) {
        firstFocusRef.current = false;
        return;
      }
      refetch();
    }, [refetch]),
  );
}
