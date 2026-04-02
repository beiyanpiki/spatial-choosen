import { PREPROCESS_STORAGE_SCHEMA_VERSION } from './constants';
import type { PreprocessProject } from '@/types/preprocess';

export function migratePreprocessProject(project: PreprocessProject): PreprocessProject {
  const storageVersion = project.storageVersion ?? 0;

  if (storageVersion >= PREPROCESS_STORAGE_SCHEMA_VERSION) {
    return project;
  }

  return {
    ...project,
    storageVersion: PREPROCESS_STORAGE_SCHEMA_VERSION,
    tissueSelection: {
      ...project.tissueSelection,
      forcedInSpotIds: project.tissueSelection.forcedInSpotIds ?? [],
      forcedOutSpotIds: project.tissueSelection.forcedOutSpotIds ?? [],
      overrideNotice: project.tissueSelection.overrideNotice ?? null,
      autoSelectedSpotIds: project.tissueSelection.autoSelectedSpotIds ?? [],
      selectedRegionId: project.tissueSelection.selectedRegionId ?? null,
      regions: (project.tissueSelection.regions ?? []).map((region) => ({
        ...region,
        paths: region.paths?.length ? region.paths : [region.points],
      })),
    },
  };
}
