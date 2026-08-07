'use client';

import { useCallback, useRef, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';

// One thing the agent did. Label and emoji come straight from the gateway;
// arguments and reasoning text are never carried.
export interface HermesStep {
  id: string;
  tool: string;
  label: string;
  emoji?: string;
  done: boolean;
}

export interface HermesAttachment {
  name: string;
  mime: string;
  // Images travel inline as a data: URL so the model can actually see them.
  data?: string;
  // Anything too big to inline — video — is uploaded first and passed by link.
  url?: string;
}

export interface HermesMessage {
  role: 'user' | 'assistant';
  content: string;
  attachments?: HermesAttachment[];
  // What the agent did, in order. The reasoning text itself is never kept or
  // shown: the user gets progress, not the model's internals.
  activity?: HermesStep[];
}

// Status vocabularies differ between gateways, so anything that reads as
// finished counts as finished and everything else is still running.
const DONE = ['done', 'completed', 'complete', 'success', 'succeeded', 'finished', 'error', 'failed', 'cancelled'];

// The gateway's own label is the tool's argument — a shell command, an internal
// file path, a search pattern. That is not the user's business and some of it is
// sensitive, so progress is described by what the tool does, never by what it
// was given.
const TOOL_LABELS: Record<string, string> = {
  terminal: 'Running a command',
  read_file: 'Reading a document',
  write_file: 'Writing a document',
  edit_file: 'Editing a document',
  search_files: 'Searching the knowledge base',
  skill_view: 'Loading a skill',
  web_search: 'Searching the web',
  browser: 'Browsing',
};

const describeTool = (tool: string) =>
  TOOL_LABELS[tool] ||
  // Fall back to the tool's own name, tidied: "read_file" -> "Read file".
  (tool || 'Working')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase());

// Later frames for the same step replace the earlier one, so a tool that
// reports running and then done is a single line that ticks over.
const mergeSteps = (existing: HermesStep[] = [], incoming: HermesStep[] = []) => {
  const merged = [...existing];

  for (const step of incoming) {
    const byId = merged.findIndex((one) => one.id === step.id);
    if (byId !== -1) {
      merged[byId] = { ...merged[byId], ...step };
      continue;
    }

    if (step.done) {
      // A close with no id of its own: retire the oldest run of that tool that
      // is still open, so parallel calls tick off in order.
      const open = merged.findIndex(
        (one) => one.tool === step.tool && !one.done
      );

      if (open !== -1) {
        merged[open] = { ...merged[open], done: true };
        continue;
      }
    }

    merged.push(step);
  }

  return merged;
};

// Reads the OpenAI-compatible SSE stream the backend proxies through, appending
// each delta to the assistant message as it arrives.
export const useHermesChat = () => {
  const fetch = useFetch();
  const [messages, setMessages] = useState<HermesMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Deltas arrive one token at a time. Re-rendering the whole thread on each of
  // them is what makes a long answer crawl, so they are buffered and flushed
  // once per frame instead.
  const pending = useRef({ content: '', steps: [] as HermesStep[] });
  const frame = useRef<number | null>(null);

  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    pending.current = { content: '', steps: [] };
    setMessages([]);
    setError(null);
    setStreaming(false);
  }, []);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);

  const send = useCallback(
    async (text: string, attachments: HermesAttachment[] = []) => {
      if ((!text.trim() && !attachments.length) || streaming) {
        return;
      }

      const history: HermesMessage[] = [
        ...messages,
        {
          role: 'user',
          content: text.trim(),
          ...(attachments.length ? { attachments } : {}),
        },
      ];

      setMessages([...history, { role: 'assistant', content: '' }]);
      setStreaming(true);
      setError(null);

      const controller = new AbortController();
      abort.current = controller;

      // Frames that open a step carry a tool call id; the ones that close it
      // often carry only the tool name, so closing matches the oldest step of
      // that tool still running.
      let sequence = 0;
      const startStep = (tool: string, emoji: string | undefined, id?: string) => {
        pending.current.steps.push({
          id: id || `${tool}#${(sequence += 1)}`,
          tool,
          label: describeTool(tool),
          emoji,
          done: false,
        });
        flush();
      };

      const finishStep = (tool: string, id?: string) => {
        pending.current.steps.push({
          id: id || `close:${tool}`,
          tool,
          label: describeTool(tool),
          done: true,
        });
        flush();
      };

      const flush = () => {
        if (frame.current !== null) {
          return;
        }

        frame.current = requestAnimationFrame(() => {
          frame.current = null;
          const { content, steps } = pending.current;
          if (!content && !steps.length) {
            return;
          }

          pending.current = { content: '', steps: [] };
          setMessages((current) => {
            const next = [...current];
            const last = next[next.length - 1];
            next[next.length - 1] = {
              ...last,
              content: last.content + content,
              ...(steps.length
                ? { activity: mergeSteps(last.activity, steps) }
                : {}),
            };
            return next;
          });
        });
      };

      try {
        const response = await fetch('/hermes/chat', {
          method: 'POST',
          body: JSON.stringify({ messages: history }),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          const detail = await response.json().catch(() => ({}));
          throw new Error(detail?.error || `Request failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        for (;;) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });

          // SSE frames are separated by a blank line; anything after the last
          // one is a partial frame and waits for the next chunk.
          const frames = buffer.split('\n\n');
          buffer = frames.pop() || '';

          for (const frame of frames) {
            for (const line of frame.split('\n')) {
              if (!line.startsWith('data:')) {
                continue;
              }

              const payload = line.slice(5).trim();
              if (!payload || payload === '[DONE]') {
                continue;
              }

              try {
                const parsed = JSON.parse(payload);
                // Each tool the gateway runs is reported on its own frame.
                if (parsed?.tool) {
                  const finished = DONE.includes(
                    String(parsed.status || '').toLowerCase()
                  );

                  if (finished) {
                    finishStep(String(parsed.tool), parsed.toolCallId);
                  } else {
                    startStep(
                      String(parsed.tool),
                      parsed.emoji,
                      parsed.toolCallId
                    );
                  }
                }

                const choice = parsed?.choices?.[0];
                const delta =
                  choice?.delta?.content ?? choice?.message?.content ?? '';
                // Field name varies by gateway; both spellings are common.
                const thinking =
                  choice?.delta?.reasoning_content ??
                  choice?.delta?.reasoning ??
                  '';

                // OpenAI-shaped gateways report tools here instead. The name
                // says what is happening; arguments can carry anything, so they
                // are never surfaced.
                for (const call of choice?.delta?.tool_calls || []) {
                  const name = call?.function?.name;
                  if (name) {
                    startStep(String(name), undefined, call.id);
                  }
                }

                if (thinking) {
                  pending.current.steps.push({
                    id: 'reasoning',
                    tool: 'reasoning',
                    label: 'Reasoning',
                    done: false,
                  });
                  flush();
                }

                if (delta) {
                  pending.current.content += delta;
                }

                if (delta || thinking) {
                  flush();
                }
              } catch (err) {
                // A frame that is not JSON is not something to crash over.
              }
            }
          }
        }
      } catch (err) {
        // Stopping is something the user chose; it is not a failure.
        if ((err as Error)?.name !== 'AbortError') {
          setError(
            err instanceof Error ? err.message : 'Could not reach the agent'
          );
        }
      } finally {
        // Anything buffered when the stream ended still has to land.
        if (frame.current !== null) {
          cancelAnimationFrame(frame.current);
          frame.current = null;
        }
        const { content, steps } = pending.current;
        pending.current = { content: '', steps: [] };
        setMessages((current) => {
          const next = [...current];
          const last = next[next.length - 1];
          if (!last || last.role !== 'assistant') {
            return current;
          }

          // Whatever was still open has finished by the time the stream ends.
          const merged = mergeSteps(last.activity, steps).map((one) => ({
            ...one,
            done: true,
          }));

          next[next.length - 1] = {
            ...last,
            content: last.content + content,
            ...(merged.length ? { activity: merged } : {}),
          };
          return next;
        });

        setStreaming(false);
        abort.current = null;
      }
    },
    [fetch, messages, streaming]
  );

  return { messages, setMessages, streaming, error, send, stop, reset };
};
