import { QueryClient } from '@tanstack/react-query';

// Single app-wide TanStack Query client. Defaults tuned for a mobile
// app on flaky networks talking to a Render free-tier backend that
// cold-starts after ~15 min idle.
//
//   • staleTime 60s   — within a minute a screen re-uses cached data
//                       instead of re-hitting the API. Kills the
//                       "every tab tap re-fetches" behaviour.
//   • gcTime 30m      — unused cache is kept 30 min so navigating
//                       back to a screen is instant.
//   • retry 2         — flaky mobile networks + cold starts; two
//                       retries with backoff smooths over the gap.
//   • refetchOnReconnect — when the device regains network, refetch.
//   • refetchOnMount 'always' is intentionally NOT set — staleTime
//     governs it, so a quick re-visit is instant and a stale one
//     refreshes in the background.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 30 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 8000),
      refetchOnReconnect: true,
      // RN has no window focus; screen-focus refetch is wired per
      // screen via React Navigation's focus listener where needed.
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});
