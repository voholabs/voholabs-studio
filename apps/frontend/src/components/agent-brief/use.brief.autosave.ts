'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { usePreventWindowUnload } from '@gitroom/react/helpers/use.prevent.window.unload';
import {
  BRIEF_AUTOSAVE_MS,
  BRIEF_SAVE_TIMEOUT_MS,
  BRIEF_SAVED_INDICATOR_MS,
} from '@gitroom/nestjs-libraries/agent-brief/brief.registry';
import {
  BriefAsset,
  BriefBlock,
  BriefLink,
} from '@gitroom/nestjs-libraries/agent-brief/brief.types';
import {
  BRIEF_DOCUMENTS_KEY,
  BriefDocumentsResponse,
} from '@gitroom/frontend/components/agent-brief/use.brief.documents';

export type BriefSaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

// Only the parts of the document that changed are sent; anything absent keeps
// whatever is already stored.
export interface BriefPatch {
  title?: string;
  blocks?: BriefBlock[];
  links?: BriefLink[];
  assets?: BriefAsset[];
}

// One controller per document, never per section: a single in-flight save is
// what keeps two sections of the same document from clobbering each other, and
// the document view is keyed on the document so switching documents tears this
// down (flushing on the way out) rather than retargeting it mid-flight.
export const useBriefAutosave = (category: string, documentKey: string) => {
  const fetch = useFetch();
  const { mutate } = useSWRConfig();
  const [state, setState] = useState<BriefSaveState>('idle');

  const dirty = useRef<BriefPatch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  const inFlight = useRef(false);
  const inFlightPromise = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const mounted = useRef(true);

  const url = `/brief/${encodeURIComponent(category)}/${encodeURIComponent(
    documentKey
  )}`;

  const setStateIfMounted = useCallback((next: BriefSaveState) => {
    if (mounted.current) {
      setState(next);
    }
  }, []);

  const flush = useCallback(
    async (keepalive?: boolean): Promise<void> => {
      if (!Object.keys(dirty.current).length) {
        return;
      }

      if (inFlight.current) {
        queued.current = true;
        return;
      }

      const patch = dirty.current;

      dirty.current = {};
      inFlight.current = true;
      setStateIfMounted('saving');

      // Exposed so a delete can wait for a save that is already on the wire,
      // rather than racing it and having the content written straight back.
      let settle: () => void = () => {};
      inFlightPromise.current = new Promise<void>((resolve) => {
        settle = resolve;
      });

      try {
        // useFetch resolves to a promise that never settles on some auth and
        // billing responses, so every save needs its own deadline.
        const response = await Promise.race([
          fetch(url, {
            method: 'PATCH',
            body: JSON.stringify(patch),
            ...(keepalive ? { keepalive: true } : {}),
          }),
          new Promise<Response>((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), BRIEF_SAVE_TIMEOUT_MS)
          ),
        ]);

        // fetch only rejects on network errors, so a rejected save still looks
        // like a successful one unless the status is checked.
        if (!response.ok) {
          throw new Error(`save failed: ${response.status}`);
        }

        const saved = await response.json();

        mutate<BriefDocumentsResponse>(
          BRIEF_DOCUMENTS_KEY,
          (current) => {
            if (!current) {
              return current;
            }

            const rest = current.documents.filter(
              (document) =>
                document.category !== saved.category ||
                document.key !== saved.key
            );

            return { ...current, documents: [...rest, saved] };
          },
          { revalidate: false }
        );

        setStateIfMounted('saved');
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(
          () => setStateIfMounted('idle'),
          BRIEF_SAVED_INDICATOR_MS
        );
      } catch (err) {
        // Put the work back so nothing typed is lost, without overwriting
        // anything that was edited again while the request was in flight.
        dirty.current = { ...patch, ...dirty.current };
        setStateIfMounted('error');
      } finally {
        inFlight.current = false;
        inFlightPromise.current = null;
        settle();

        if (queued.current) {
          queued.current = false;
          flush();
        }
      }
    },
    [fetch, mutate, url, setStateIfMounted]
  );

  const schedule = useCallback(() => {
    setStateIfMounted('dirty');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => flush(), BRIEF_AUTOSAVE_MS);
  }, [flush, setStateIfMounted]);

  const save = useCallback(
    (patch: BriefPatch) => {
      dirty.current = { ...dirty.current, ...patch };
      schedule();
    },
    [schedule]
  );

  // Everything buffered is dropped and anything already sent is waited out, so
  // a delete cannot be undone by a save that was still in the air.
  const discardPending = useCallback(async () => {
    clearTimeout(timer.current);
    dirty.current = {};
    queued.current = false;
    await inFlightPromise.current;
    setStateIfMounted('idle');
  }, [setStateIfMounted]);

  const retry = useCallback(() => flush(), [flush]);

  usePreventWindowUnload(state === 'dirty' || state === 'saving');

  // Held in a ref so the teardown below can depend on nothing and therefore can
  // only ever run when the document is actually going away.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  useEffect(() => {
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      clearTimeout(savedTimer.current);
      // Leaving the document must not lose the last keystrokes.
      flushRef.current(true);
    };
  }, []);

  return { state, save, discardPending, retry };
};
