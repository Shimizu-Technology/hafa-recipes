import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { api } from '@/lib/api';
import type { AppealCreatePayload, ReportCreatePayload } from '@/types/communitySafety';

export const communitySafetyKeys = {
  all: ['communitySafety'] as const,
  reports: () => [...communitySafetyKeys.all, 'reports'] as const,
  blocks: () => [...communitySafetyKeys.all, 'blocks'] as const,
  status: () => [...communitySafetyKeys.all, 'status'] as const,
};

export function useMySafetyReports(enabled = true) {
  return useQuery({
    queryKey: communitySafetyKeys.reports(),
    queryFn: () => api.getMyReports(),
    enabled,
  });
}

export function useBlockedContributors(enabled = true) {
  return useQuery({
    queryKey: communitySafetyKeys.blocks(),
    queryFn: () => api.getBlockedContributors(),
    enabled,
  });
}

export function useSafetyStatus(enabled = true) {
  return useQuery({
    queryKey: communitySafetyKeys.status(),
    queryFn: () => api.getSafetyStatus(),
    enabled,
  });
}

export function useCreateSafetyReport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ReportCreatePayload) => api.createReport(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: communitySafetyKeys.reports() }),
  });
}

export function useCreateSafetyAppeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: AppealCreatePayload) => api.createAppeal(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: communitySafetyKeys.reports() }),
  });
}

export function useBlockContributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contributorId: string) => api.blockContributor(contributorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: communitySafetyKeys.blocks() }),
        queryClient.invalidateQueries({ queryKey: ['recipes'] }),
        queryClient.invalidateQueries({ queryKey: ['discover'] }),
        queryClient.invalidateQueries({ queryKey: ['savedRecipes'] }),
        queryClient.invalidateQueries({ queryKey: ['similarRecipes'] }),
        queryClient.invalidateQueries({ queryKey: ['allContributors'] }),
      ]);
    },
  });
}

export function useUnblockContributor() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (contributorId: string) => api.unblockContributor(contributorId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: communitySafetyKeys.blocks() }),
        queryClient.invalidateQueries({ queryKey: ['recipes'] }),
        queryClient.invalidateQueries({ queryKey: ['discover'] }),
        queryClient.invalidateQueries({ queryKey: ['savedRecipes'] }),
        queryClient.invalidateQueries({ queryKey: ['similarRecipes'] }),
        queryClient.invalidateQueries({ queryKey: ['allContributors'] }),
      ]);
    },
  });
}
