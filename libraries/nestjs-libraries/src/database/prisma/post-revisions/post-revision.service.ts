import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { PostRevision, RevisionLearnedOutcome } from '@prisma/client';
import { PostRevisionRepository } from '@gitroom/nestjs-libraries/database/prisma/post-revisions/post-revision.repository';
import { stableStringify } from '@gitroom/helpers/utils/stable.stringify';
import { renderWordDiff, wordDiff } from '@gitroom/helpers/utils/word.diff';
import { stripHtmlValidation } from '@gitroom/helpers/utils/strip.html.validation';

type SnapshotImage = {
  id?: string;
  path: string;
  alt?: string;
  thumbnail?: string;
};

type SnapshotValue = {
  content: string;
  delay: number;
  image: SnapshotImage[];
};

type SnapshotPayload = {
  value: SnapshotValue[];
  settings: Record<string, any>;
  publishDate: string;
};

export type CaptureSnapshotArgs = {
  orgId: string;
  // The group the caller is replacing. Absent on a first create.
  oldGroup?: string;
  newGroup: string;
  postIds: string[];
  integrationId: string;
  publishDate: Date | string;
  value: { content?: string; delay?: number; image?: any[] }[];
  settings: any;
};

export type PostRevisionDiff = {
  textDiff: { item: number; diff: string }[];
  itemsAdded: number;
  itemsRemoved: number;
  media: { added: string[]; removed: string[]; reordered: boolean };
  settingsChanged: string[];
  scheduleChange?: { from: string; to: string };
};

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

@Injectable()
export class PostRevisionService {
  constructor(private _postRevisionRepository: PostRevisionRepository) {}

  /**
   * Records what a post looked like at this save. The first save of a post
   * becomes its INITIAL revision and is never rewritten; every later save
   * updates FINAL, until the post publishes and FINAL freezes.
   */
  async captureSnapshot(args: CaptureSnapshotArgs) {
    const payloadObject = this.normalize(
      args.value,
      args.settings,
      args.publishDate
    );

    const contentHash = sha256(
      stableStringify({
        value: payloadObject.value,
        settings: payloadObject.settings,
        integrationId: args.integrationId,
      })
    );

    // The date is deliberately outside contentHash: moving a post is a change
    // worth snapshotting but not a rewrite of what the agent drafted.
    const payloadHash = sha256(`${contentHash}|${payloadObject.publishDate}`);
    const payload = JSON.stringify(payloadObject);

    const chainId = await this.resolveChainId(
      args.orgId,
      args.postIds,
      args.oldGroup
    );

    const snapshot = {
      integrationId: args.integrationId,
      payload,
      payloadHash,
      contentHash,
    };

    if (!chainId) {
      const created = await this._postRevisionRepository.create({
        organizationId: args.orgId,
        chainId: uuidv4(),
        kind: 'INITIAL',
        group: args.newGroup,
        postIds: args.postIds,
        ...snapshot,
      });
      await this.appendVersion(args.orgId, created.chainId, snapshot);
      return created;
    }

    const rows = await this._postRevisionRepository.getChain(
      args.orgId,
      chainId
    );

    // Every distinct state is kept as a version, including edits made after
    // the post went out, which FINAL below no longer follows.
    await this.appendVersion(args.orgId, chainId, snapshot, rows);

    const final = rows.find((row) => row.kind === 'FINAL');
    const latest = final || rows.find((row) => row.kind === 'INITIAL');

    if (!latest) {
      return;
    }

    // Published is the end state we set out to capture, so nothing after it is
    // allowed to overwrite the record of what actually went out.
    if (final?.publishedAt) {
      return;
    }

    if (payloadHash === latest.payloadHash) {
      // Nothing changed — opening and closing the editor, or ticking the
      // reviewed box, both rewrite the post rows. Keep the snapshot as it is
      // and only follow the post to its new group.
      return this._postRevisionRepository.refreshLinking(
        latest.id,
        args.newGroup,
        args.postIds
      );
    }

    const initial = rows.find((row) => row.kind === 'INITIAL');

    return this._postRevisionRepository.upsertFinal(args.orgId, chainId, {
      integrationId: args.integrationId,
      group: args.newGroup,
      postIds: args.postIds,
      payload,
      payloadHash,
      contentHash,
      // Measured against the original draft, not against the previous save: an
      // edit that puts the wording back how it started leaves nothing to learn.
      changed: !!initial && contentHash !== initial.contentHash,
      // Changed again after a lesson was drawn: there is something new to learn.
      ...(contentHash !== latest.contentHash
        ? { learnedAt: null, learnedTopic: null, learnedOutcome: null }
        : {}),
    });
  }

  /**
   * Stamps the chain with the moment it went out. Called once per published
   * post row, so it has to be idempotent.
   */
  async markPublished(orgId: string, postRowId: string, group?: string) {
    const chainId = await this.resolveChainId(orgId, [postRowId], group);
    if (!chainId) {
      return;
    }

    const rows = await this._postRevisionRepository.getChain(orgId, chainId);
    const final = rows.find((row) => row.kind === 'FINAL');

    if (final) {
      if (final.publishedAt) {
        return;
      }

      return this._postRevisionRepository.stampPublished(final.id, new Date());
    }

    // Nobody touched the post after it was created, so what went out is the
    // initial draft. Copy it into FINAL anyway: the freeze needs something to
    // hold, otherwise an edit made after publishing would be recorded as if it
    // were the published state.
    const initial = rows.find((row) => row.kind === 'INITIAL');
    if (!initial) {
      return;
    }

    return this._postRevisionRepository.upsertFinal(orgId, chainId, {
      integrationId: initial.integrationId,
      group: initial.group,
      postIds: initial.postIds,
      payload: initial.payload,
      payloadHash: initial.payloadHash,
      contentHash: initial.contentHash,
      // A copy of the draft, so there is nothing to diff and nothing to review.
      changed: false,
      publishedAt: new Date(),
    });
  }

  async resolveChainId(orgId: string, postIds: string[], group?: string) {
    const byPostIds = await this._postRevisionRepository.findChainByPostIds(
      orgId,
      postIds
    );

    if (byPostIds) {
      return byPostIds.chainId;
    }

    const byGroup = await this._postRevisionRepository.findChainByGroup(
      orgId,
      group
    );

    return byGroup?.chainId;
  }

  // Deleting a post keeps its history: the chain is only marked deleted.
  markChainDeleted(orgId: string, chainId: string) {
    return this._postRevisionRepository.markChainDeleted(orgId, chainId);
  }

  /**
   * A post moved to another time without being opened (dragged on the
   * calendar): the same content at the new date becomes the next version.
   */
  async captureReschedule(
    orgId: string,
    postId: string,
    group: string,
    publishDate: Date | string
  ) {
    const chainId = await this.resolveChainId(orgId, [postId], group);
    if (!chainId) {
      return;
    }
    const versions = await this._postRevisionRepository.getVersions(
      orgId,
      chainId
    );
    const latest = versions[versions.length - 1];
    if (!latest) {
      return;
    }
    const payloadObject = {
      ...this.parsePayload(latest.payload),
      publishDate: new Date(publishDate).toISOString(),
    };
    await this.appendVersion(orgId, chainId, {
      integrationId: latest.integrationId,
      payload: JSON.stringify(payloadObject),
      payloadHash: sha256(
        `${latest.contentHash}|${payloadObject.publishDate}`
      ),
      contentHash: latest.contentHash,
    });
  }

  /**
   * Adds the snapshot as the chain's next version unless it is the same as
   * the last one. A chain recorded before versions existed is first given its
   * INITIAL (and FINAL, when it differs) as v1 and v2.
   */
  private async appendVersion(
    orgId: string,
    chainId: string,
    snapshot: {
      integrationId: string;
      payload: string;
      payloadHash: string;
      contentHash: string;
    },
    rows?: PostRevision[]
  ) {
    let latest = await this._postRevisionRepository.latestVersion(chainId);

    if (!latest && rows?.length) {
      const earlier = [
        rows.find((row) => row.kind === 'INITIAL'),
        rows.find((row) => row.kind === 'FINAL'),
      ].filter((row): row is PostRevision => !!row);
      for (const row of earlier) {
        if (latest?.payloadHash === row.payloadHash) {
          continue;
        }
        const version = (latest?.version || 0) + 1;
        await this._postRevisionRepository.createVersion({
          organizationId: orgId,
          chainId,
          version,
          integrationId: row.integrationId,
          payload: row.payload,
          payloadHash: row.payloadHash,
          contentHash: row.contentHash,
          createdAt: row.kind === 'INITIAL' ? row.createdAt : row.updatedAt,
        });
        latest = { version, payloadHash: row.payloadHash };
      }
    }

    if (latest?.payloadHash === snapshot.payloadHash) {
      return;
    }

    try {
      await this._postRevisionRepository.createVersion({
        organizationId: orgId,
        chainId,
        version: (latest?.version || 0) + 1,
        ...snapshot,
      });
    } catch (err) {
      // Two saves landing together picked the same number; the one that lost
      // takes the next.
      if ((err as { code?: string })?.code !== 'P2002') {
        throw err;
      }
      const current = await this._postRevisionRepository.latestVersion(chainId);
      if (current?.payloadHash === snapshot.payloadHash) {
        return;
      }
      await this._postRevisionRepository.createVersion({
        organizationId: orgId,
        chainId,
        version: (current?.version || 0) + 1,
        ...snapshot,
      });
    }
  }

  async markLearned(
    orgId: string,
    chainIds: string[],
    outcome: RevisionLearnedOutcome,
    topic?: string
  ) {
    const { count } = await this._postRevisionRepository.markLearned(
      orgId,
      chainIds,
      outcome,
      topic
    );

    // Say which ids did not take rather than only how many did: an id that
    // names a deleted or unpublished post is a mistake worth surfacing, and
    // counting alone would let the caller believe it was handled.
    const rows = await this._postRevisionRepository.getRevisionsByChainIds(
      orgId,
      chainIds
    );

    const marked = new Set(
      rows
        .filter((row) => row.kind === 'FINAL' && !!row.learnedAt)
        .map((row) => row.chainId)
    );

    return {
      count,
      notFound: chainIds.filter((chainId) => !marked.has(chainId)),
    };
  }

  /**
   * The chains worth reviewing, each already reduced to what changed between
   * the draft and what went out.
   */
  async getLearningQueue(
    orgId: string,
    options: {
      limit?: number;
      includeLearned?: boolean;
      chainId?: string;
    } = {}
  ) {
    const finals = options.chainId
      ? (
          await this._postRevisionRepository.getChain(orgId, options.chainId)
        ).filter((row) => row.kind === 'FINAL')
      : await this._postRevisionRepository.getQueue(orgId, {
          limit: options.limit || 10,
          includeLearned: !!options.includeLearned,
        });

    if (!finals.length) {
      return [];
    }

    const rows = await this._postRevisionRepository.getRevisionsByChainIds(
      orgId,
      finals.map((row) => row.chainId)
    );

    const initials = new Map(
      rows
        .filter((row) => row.kind === 'INITIAL')
        .map((row) => [row.chainId, row])
    );

    return finals.map((final) => {
      const initial = initials.get(final.chainId);
      return {
        final,
        initial,
        diff: initial ? this.computeDiff(initial, final) : undefined,
      };
    });
  }

  computeDiff(initial: PostRevision, final: PostRevision): PostRevisionDiff {
    const before = this.parsePayload(initial.payload);
    const after = this.parsePayload(final.payload);

    const shared = Math.min(before.value.length, after.value.length);
    const textDiff: { item: number; diff: string }[] = [];

    for (let index = 0; index < shared; index++) {
      const from = this.toPlainText(before.value[index]?.content);
      const to = this.toPlainText(after.value[index]?.content);

      if (from !== to) {
        textDiff.push({
          item: index + 1,
          diff: renderWordDiff(wordDiff(from, to)),
        });
      }
    }

    const beforeMedia = this.mediaKeys(before);
    const afterMedia = this.mediaKeys(after);
    const beforeKeys = beforeMedia.map((media) => media.key);
    const afterKeys = afterMedia.map((media) => media.key);

    const added = afterMedia
      .filter((media) => !beforeKeys.includes(media.key))
      .map((media) => media.path);

    const removed = beforeMedia
      .filter((media) => !afterKeys.includes(media.key))
      .map((media) => media.path);

    const reordered =
      !added.length &&
      !removed.length &&
      beforeKeys.join('|') !== afterKeys.join('|');

    const settingsKeys = Array.from(
      new Set([
        ...Object.keys(before.settings || {}),
        ...Object.keys(after.settings || {}),
      ])
    ).filter((key) => key !== '__type');

    const settingsChanged = settingsKeys.filter(
      (key) =>
        stableStringify((before.settings || {})[key]) !==
        stableStringify((after.settings || {})[key])
    );

    return {
      textDiff,
      itemsAdded: Math.max(0, after.value.length - before.value.length),
      itemsRemoved: Math.max(0, before.value.length - after.value.length),
      media: { added, removed, reordered },
      settingsChanged,
      ...(before.publishDate !== after.publishDate
        ? {
            scheduleChange: {
              from: before.publishDate,
              to: after.publishDate,
            },
          }
        : {}),
    };
  }

  parsePayload(raw: string): SnapshotPayload {
    try {
      const parsed = JSON.parse(raw || '{}');
      return {
        value: Array.isArray(parsed?.value) ? parsed.value : [],
        settings: parsed?.settings || {},
        publishDate: parsed?.publishDate || '',
      };
    } catch (err) {
      return { value: [], settings: {}, publishDate: '' };
    }
  }

  private normalize(
    value: CaptureSnapshotArgs['value'],
    settings: any,
    publishDate: Date | string
  ): SnapshotPayload {
    return {
      value: (value || []).map((item) => ({
        content: item?.content || '',
        delay: item?.delay || 0,
        image: (item?.image || []).map((media: any) => ({
          ...(media?.id ? { id: media.id } : {}),
          path: media?.path || '',
          ...(media?.alt ? { alt: media.alt } : {}),
          ...(media?.thumbnail ? { thumbnail: media.thumbnail } : {}),
        })),
      })),
      settings: settings || {},
      publishDate: new Date(publishDate).toISOString(),
    };
  }

  private toPlainText(content?: string) {
    return stripHtmlValidation('none', content || '').trim();
  }

  private mediaKeys(payload: SnapshotPayload) {
    return payload.value.flatMap((item) =>
      (item?.image || []).map((media) => ({
        key: media?.id || media?.path || '',
        path: media?.path || '',
      }))
    );
  }
}
