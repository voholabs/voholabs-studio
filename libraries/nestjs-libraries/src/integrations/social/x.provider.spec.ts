// How X's answer to a new post is read: as it always was, except for a
// publish the wallet pays for, which must know for sure whether X took it.
import { XProvider } from '@gitroom/nestjs-libraries/integrations/social/x.provider';
import { BadBody } from '@gitroom/nestjs-libraries/integrations/social.abstract';
import {
  isWalletPublish,
  withWalletPublish,
} from '@gitroom/nestjs-libraries/database/prisma/wallet/wallet.x';

const integration = { id: 'i1', organizationId: 'org' } as any;
const answer = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

describe('XProvider reading a new post', () => {
  const provider = new XProvider();
  const tweetCreated = (response: Response, target: any) =>
    (provider as any).tweetCreated(response, { text: 'hi' }, target);

  it('marks only a wallet publish', () => {
    expect(isWalletPublish(withWalletPublish(integration, false))).toBe(false);
    expect(withWalletPublish(integration, false)).toBe(integration);
    expect(isWalletPublish(withWalletPublish(integration, true))).toBe(true);
  });

  it('reads the id as before on a paid plan', async () => {
    await expect(
      tweetCreated(answer(201, { data: { id: '42' } }), integration)
    ).resolves.toEqual({ id: '42' });
    // An answer without an id is read as before: no data, no mapped error.
    await expect(
      tweetCreated(answer(200, { errors: [{ message: 'nope' }] }), integration)
    ).resolves.toBeUndefined();
  });

  it('fails a wallet publish with a clear reason when X sends no id', async () => {
    const wallet = withWalletPublish(integration, true);
    await expect(
      tweetCreated(answer(201, { data: { id: '42' } }), wallet)
    ).resolves.toEqual({ id: '42' });
    await expect(
      tweetCreated(answer(200, { errors: [{ message: 'nope' }] }), wallet)
    ).rejects.toBeInstanceOf(BadBody);
  });

  it('names X credits running out only for a wallet publish', () => {
    const err = new BadBody(
      'x',
      '{"type":"https://api.x.com/2/problems/credits","title":"CreditsDepleted"}',
      '{}',
      'Unknown Error'
    );
    const rethrown = (target: any) => {
      try {
        (provider as any).walletPublishError(err, target);
      } catch (e) {
        return e as BadBody;
      }
      throw new Error('expected a throw');
    };
    expect(rethrown(integration)).toBe(err);
    expect(rethrown(withWalletPublish(integration, true)).message).toMatch(
      /X is not accepting posts right now/
    );
  });

  it('keeps the error mapping it had before', () => {
    expect(provider.handleErrors('{"title":"CreditsDepleted"}')).toBeUndefined();
  });
});

describe('XProvider article body', () => {
  const provider = new XProvider();
  const contentState = (html: string, inline: Record<string, string> = {}) =>
    (provider as any).articleContentState(html, [], inline);

  it('keeps the long-form structure of a blog post', () => {
    const { blocks, entities } = contentState(
      '<p>One <em>plain</em> line</p>' +
        '<blockquote>A callout</blockquote>' +
        '<ol><li>First</li><li>Second</li></ol>' +
        '<pre><code class="language-bash">mkdir -p x\n</code></pre>' +
        '<figure><img src="https://u.example/a.png"><figcaption>The fix</figcaption></figure>' +
        '<hr>',
      { 'https://u.example/a.png': 'm1' }
    );

    expect(blocks.map((b: any) => b.type)).toEqual([
      'unstyled',
      'blockquote',
      'ordered-list-item',
      'ordered-list-item',
      'atomic',
      'atomic',
      'atomic',
    ]);
    expect(blocks[0].inline_style_ranges).toEqual([
      { offset: 4, length: 5, style: 'italic' },
    ]);
    expect(entities.map((e: any) => e.value.type)).toEqual([
      'markdown',
      'image',
      'divider',
    ]);
    expect(entities[0].value.data.markdown).toBe('```bash\nmkdir -p x\n```');
    expect(entities[1].value.data).toEqual({
      media_items: [{ media_category: 'tweet_image', media_id: 'm1' }],
      caption: 'The fix',
    });
  });

  it('asks for the extra tags only for an article', () => {
    expect(provider.htmlTags({ post_type: 'post' })).toEqual([]);
    expect(provider.htmlTags({ post_type: 'article' })).toContain('pre');
  });
});
