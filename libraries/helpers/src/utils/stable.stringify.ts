/**
 * JSON.stringify with object keys sorted, so two structurally identical values
 * always serialize to the same string. Used for hashing snapshots: the editor
 * and the API can send the same settings object with the keys in a different
 * order, and that must not read as a change.
 *
 * Array order is preserved — for a thread, or for a list of images, the order
 * is part of the content.
 */
export const stableStringify = (value: unknown): string => {
  if (value === null || value === undefined) {
    return 'null';
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>)
      .filter(
        (key) => (value as Record<string, unknown>)[key] !== undefined
      )
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(
            (value as Record<string, unknown>)[key]
          )}`
      );

    return `{${entries.join(',')}}`;
  }

  return JSON.stringify(value) ?? 'null';
};
