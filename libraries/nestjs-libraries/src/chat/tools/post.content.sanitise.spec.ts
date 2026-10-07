jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: { createStorage: () => ({}) },
}));
jest.mock('@gitroom/nestjs-libraries/chat/tools/media.upload.helper', () => ({
  storeUrlAsMedia: jest.fn(),
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.service',
  () => ({ MediaService: class {} })
);

import {
  withPostLinks,
  withSanitisedContent,
} from '@gitroom/nestjs-libraries/chat/tools/post.write.shared';
import {
  sanitizePostContent,
  sanitizePreviewHtml,
} from '@gitroom/helpers/utils/sanitize.post.content';

describe('post content written by tools', () => {
  it('keeps the markup the editor writes', () => {
    const html =
      '<p>Hello <strong>bold</strong> <u>u</u> <a href="https://x.com" target="_blank" rel="noopener">link</a></p><ul><li>one</li></ul><p><span class="mention" data-mention-id="1" data-mention-label="Ann">@Ann</span> (post:abc)</p>';
    // target/rel are dropped, exactly as CreatePostDto drops them for the
    // dashboard.
    expect(withPostLinks({ content: html })).toBe(
      html.replace(' target="_blank" rel="noopener"', '')
    );
  });

  it('removes scripts, handlers and javascript: links', () => {
    const out = withPostLinks({
      content:
        '<img src=x onerror=alert(1)><p onclick="x()">hi</p><a href="javascript:alert(1)">a</a><script>alert(1)</script>',
    });
    expect(out).not.toMatch(/onerror|onclick|javascript:|<script|<img/i);
    expect(out).toContain('hi');
  });

  it('still appends post links, sanitised', () => {
    expect(withPostLinks({ content: '<p>a</p>', linkToPostIds: ['abc'] })).toBe(
      '<p>a</p><p>(post:abc)</p>'
    );
  });

  it('keeps plain text as text', () => {
    expect(withPostLinks({ content: 'line one\nline two' })).toBe(
      'line one\nline two'
    );
  });

  it('sanitises every item of an edit and keeps the rest of each item', () => {
    const [item] = withSanitisedContent([
      { id: '1', delay: 0, content: '<p>ok<img src=x onerror=1></p>' },
    ]);
    expect(item).toEqual({ id: '1', delay: 0, content: '<p>ok</p>' });
  });
});

describe('preview sanitiser', () => {
  it('keeps the preview markup', () => {
    const html =
      'Hi <span class="font-bold font-[arial]" style="color: #ae8afc">Ann</span><mark class="bg-red-500" data-tooltip-id="tooltip" data-tooltip-content="This text will be cropped">rest</mark>';
    expect(sanitizePreviewHtml(html)).toBe(html);
  });

  it('keeps a link opening in a new tab, but never a javascript: link', () => {
    expect(
      sanitizePreviewHtml(
        '<a href="https://x.com" target="_blank" rel="noopener">a</a><a href="javascript:alert(1)">b</a>'
      )
    ).toBe(
      '<a href="https://x.com" target="_blank" rel="noopener">a</a><a>b</a>'
    );
  });

  it('drops any other inline style and active content', () => {
    const out = sanitizePreviewHtml(
      '<span style="position:fixed;inset:0">x</span><img src=x onerror=alert(1)><svg onload=alert(1)></svg>'
    );
    expect(out).toBe('<span>x</span>');
  });

  it('does not leak the preview allowance into stored content', () => {
    sanitizePreviewHtml('<span style="color: #fff">x</span>');
    expect(
      sanitizePostContent('<mark>a</mark><span style="color: #fff">x</span>')
    ).toBe('a<span>x</span>');
  });
});
