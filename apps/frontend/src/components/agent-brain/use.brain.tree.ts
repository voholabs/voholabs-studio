'use client';

import { useCallback, useMemo } from 'react';
import { orderBy } from 'lodash';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { BRAIN_REGISTRY } from '@gitroom/nestjs-libraries/agent-brain/brain.registry';
import {
  BrainCategoryDef,
  BrainDocument,
  BrainDocumentDef,
} from '@gitroom/nestjs-libraries/agent-brain/brain.types';
import {
  BrainChannel,
  useBrainChannels,
} from '@gitroom/frontend/components/agent-brain/use.brain.channels';

export interface BrainTreeDocument {
  category: BrainCategoryDef;
  definition: BrainDocumentDef;
  // What the URL and the API address this document by.
  key: string;
  label: string;
  description?: string;
  icon: string;
  channel?: BrainChannel;
}

export interface BrainTreeGroup {
  category: BrainCategoryDef;
  label: string;
  documents: BrainTreeDocument[];
}

// The whole tree is derived from the registry plus whatever the user has
// created, so adding a category or a document upstream shows up here with no
// change.
export const useBrainTree = (documents?: BrainDocument[]) => {
  const t = useT();
  const { data: channels, isLoading } = useBrainChannels();

  const groups = useMemo<BrainTreeGroup[]>(() => {
    const sortedChannels = orderBy(
      channels || [],
      ['disabled', 'identifier', 'name'],
      ['asc', 'asc', 'asc']
    );

    return BRAIN_REGISTRY.map((category) => {
      const template = category.documentTemplate;
      let entries: BrainTreeDocument[] = [];

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
