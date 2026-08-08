'use client';

import { useCallback, useMemo } from 'react';
import { orderBy } from 'lodash';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BRIEF_REGISTRY } from '@gitroom/nestjs-libraries/agent-brief/brief.registry';
import {
  BriefCategoryDef,
  BriefDocument,
  BriefDocumentDef,
} from '@gitroom/nestjs-libraries/agent-brief/brief.types';
import {
  BriefChannel,
  useBriefChannels,
} from '@gitroom/frontend/components/agent-brief/use.brief.channels';

export interface BriefTreeDocument {
  category: BriefCategoryDef;
  definition: BriefDocumentDef;
  // What the URL and the API address this document by.
  key: string;
  label: string;
  description?: string;
  icon: string;
  channel?: BriefChannel;
}

export interface BriefTreeGroup {
  category: BriefCategoryDef;
  label: string;
  documents: BriefTreeDocument[];
}

// The whole tree is derived from the registry plus whatever the user has
// created, so adding a category or a document upstream shows up here with no
// change.
export const useBriefTree = (documents?: BriefDocument[]) => {
  const t = useT();
  const { data: channels, isLoading } = useBriefChannels();

  const groups = useMemo<BriefTreeGroup[]>(() => {
    const sortedChannels = orderBy(
      channels || [],
      ['disabled', 'identifier', 'name'],
      ['asc', 'asc', 'asc']
    );

    return BRIEF_REGISTRY.map((category) => {
      const template = category.documentTemplate;
      let entries: BriefTreeDocument[] = [];

      if (category.source === 'integration' && template) {
        entries = sortedChannels.map((channel) => ({
          category,
          definition: template,
          key: channel.id,
          label: channel.name,
          description: t(template.descriptionKey!, template.description!),
          icon: template.icon,
          channel,
        }));
      } else if (category.source === 'user' && template) {
        entries = (documents || [])
          .filter((document) => document.category === category.id)
          .map((document) => ({
            category,
            definition: template,
            key: document.key,
            label:
              document.content?.title?.trim() ||
              t(template.labelKey, template.label),
            description: t(template.descriptionKey!, template.description!),
            icon: template.icon,
          }));
      } else {
        entries = (category.documents || []).map((definition) => ({
          category,
          definition,
          key: definition.key,
          label: t(definition.labelKey, definition.label),
          description: definition.descriptionKey
            ? t(definition.descriptionKey, definition.description!)
            : undefined,
          icon: definition.icon,
        }));
      }

      return { category, label: t(category.labelKey, category.label), documents: entries };
    });
  }, [channels, documents, t]);

  const findDocument = useCallback(
    (categoryId?: string, key?: string) =>
      groups
        .find((group) => group.category.id === categoryId)
        ?.documents.find((document) => document.key === key),
    [groups]
  );

  const firstDocument = useMemo(
    () => groups.find((group) => group.documents.length)?.documents[0],
    [groups]
  );

  return { groups, findDocument, firstDocument, isLoading };
};
