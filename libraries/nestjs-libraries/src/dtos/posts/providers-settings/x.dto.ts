import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { JSONSchema } from 'class-validator-jsonschema';
import { MediaDto } from '@gitroom/nestjs-libraries/dtos/media/media.dto';

export class XDto {
  @IsOptional()
  @Matches(/^(https:\/\/x\.com\/i\/communities\/\d+)?$/, {
    message:
      'Invalid X community URL. It should be in the format: https://x.com/i/communities/1493446837214187523',
  })
  community?: string;

  @ValidateIf((o) => o.post_type !== 'article')
  @IsIn(['everyone', 'following', 'mentionedUsers', 'subscribers', 'verified'])
  who_can_reply_post:
    | 'everyone'
    | 'following'
    | 'mentionedUsers'
    | 'subscribers'
    | 'verified';

  @IsOptional()
  @IsIn(['post', 'article'])
  @JSONSchema({
    description:
      'post = a regular short post (plain text). article = a long-form X article. For an article the post content is the article BODY only, written as HTML, never markdown (markdown like **bold** or ## Heading shows on X as literal text): p, h1, h2 (h3 goes out as h2), ul, ol, li, strong, em, a, blockquote (a quote or callout box), <pre><code class="language-bash">...</code></pre> (a code block), hr (a divider), <img src> (a picture where it stands) and <figure><img src><figcaption>caption</figcaption></figure> (a picture with a caption). Do not repeat the title or the cover in the body, they go in article_title and article_cover. Every <img src> must be a media-library path (put external pictures through uploadFromUrlTool first), any other picture is dropped. Leave attachments empty: attachments are added at the END of the article. Copying a blog post: carry every block in order (headings, lists, quotes, code, pictures with captions, links, FAQ, sources) and leave out the site furniture (table of contents, author bio, related posts, share buttons).',
  })
  post_type?: 'post' | 'article';

  @ValidateIf((o) => o.post_type === 'article')
  @IsString()
  @MinLength(1, { message: 'Article title is required' })
  @JSONSchema({
    description:
      'The title of the article, required when post_type is article. It is shown above the body, so the body must not start with the same heading',
  })
  article_title?: string;

  @ValidateIf((o) => o.post_type === 'article')
  @IsIn(['draft', 'published'])
  @JSONSchema({
    description:
      'draft = save the article as a draft on X, published = publish it right away, required when post_type is article',
  })
  article_status?: 'draft' | 'published';

  @IsOptional()
  @ValidateNested()
  @Type(() => MediaDto)
  @JSONSchema({
    description:
      'Optional cover image for the article ({id, path} from the media library), only used when post_type is article. X shows it above the title cropped to 5:2, so keep the subject in the middle. Do not put the same picture in the body or the attachments too',
  })
  article_cover?: MediaDto;

  @IsOptional()
  @IsBoolean()
  made_with_ai?: boolean;

  @IsOptional()
  @IsBoolean()
  paid_partnership?: boolean;
}
