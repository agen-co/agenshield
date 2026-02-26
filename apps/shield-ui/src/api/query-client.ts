import { QueryClient, QueryCache } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error) => {
      if ((error as Error & { status?: number }).status === 401) {
        // Auth expired — invalidate all cached data so queries
        // don't serve stale results behind the login gate
        queryClient.invalidateQueries();
      }
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 5000,
    },
  },
});
